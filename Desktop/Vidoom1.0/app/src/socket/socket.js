const mediasoup = require('mediasoup');
const jwt = require('jsonwebtoken');
const Logger = require('../Logger');
const config = require('../config');
const log = new Logger('socket');
const Room = require('../Room');
const Peer = require('../Peer');
const Host = require('../Host');
const checkXSS = require('../XSS.js');
const Validator = require('../Validator');
const CryptoJS = require('crypto-js');
const authHost = new Host(); // Authenticated IP by Login
const roomList = new Map(); // All Rooms
const workers = [];
const presenters = {}; // Collect presenters grp by roomId
const streams = {}; // Collect all rtmp streams
const rtmpCfg = config.server.rtmp;
const rtmpDir = rtmpCfg && rtmpCfg.dir ? rtmpCfg.dir : 'rtmp';
// File and Url Rtmp streams count
let rtmpFileStreamsCount = 0;
let rtmpUrlStreamsCount = 0;
// Email alerts and notifications
const nodemailer = require('../lib/nodemailer');
const initializeChatGPT = require('../modules/chatgpt.js')

let nextMediasoupWorkerIdx = 0;
const webRtcServerActive = config.mediasoup.webRtcServerActive;

const hostCfg = {
    protected: config.host.protected,
    user_auth: config.host.user_auth,
    users_from_db: config.host.users_from_db,
    users_api_endpoint: config.host.users_api_endpoint,
    users_api_secret_key: config.host.users_api_secret_key,
    users: config.host.users,
    authenticated: !config.host.protected,
};

const jwtCfg = {
    JWT_KEY: (config.jwt && config.jwt.key) || 'mirotalksfu_jwt_secret',
    JWT_EXP: (config.jwt && config.jwt.exp) || '1h',
};

(async () => {
    try {
        await createWorkers();
    } catch (err) {
        log.error('Create Worker ERROR --->', err);
        process.exit(1);
    }
})();

async function createWorkers() {
    const { numWorkers } = config.mediasoup;

    const { logLevel, logTags, rtcMinPort, rtcMaxPort, disableLiburing } = config.mediasoup.worker;

    log.info('WORKERS:', numWorkers);

    for (let i = 0; i < numWorkers; i++) {
        //
        const worker = await mediasoup.createWorker({
            logLevel: logLevel,
            logTags: logTags,
            rtcMinPort: rtcMinPort,
            rtcMaxPort: rtcMaxPort,
            disableLiburing: disableLiburing,
        });

        if (webRtcServerActive) {
            const webRtcServerOptions = clone(config.mediasoup.webRtcServerOptions);
            const portIncrement = i;

            for (const listenInfo of webRtcServerOptions.listenInfos) {
                if (!listenInfo.portRange) {
                    listenInfo.port += portIncrement;
                }
            }

            log.info('Create a WebRtcServer', {
                worker_pid: worker.pid,
                // webRtcServerOptions: webRtcServerOptions,
            });

            const webRtcServer = await worker.createWebRtcServer(webRtcServerOptions);
            worker.appData.webRtcServer = webRtcServer;
        }

        worker.on('died', () => {
            log.error('Mediasoup worker died, restarting... [pid:%d]', worker.pid);
            setTimeout(async () => {
                const newWorker = await mediasoup.createWorker({
                    logLevel: logLevel,
                    logTags: logTags,
                    rtcMinPort: rtcMinPort,
                    rtcMaxPort: rtcMaxPort,
                    disableLiburing: disableLiburing,
                });

                workers.push(newWorker);
                log.info('New Mediasoup worker created [pid:%d]', newWorker.pid);
            }, 2000);
        });

        workers.push(worker);

        setInterval(async () => {
            const usage = await worker.getResourceUsage();
            log.info('mediasoup Worker resource usage', { worker_pid: worker.pid, usage: usage });
            const dump = await worker.dump();
            log.info('mediasoup Worker dump', { worker_pid: worker.pid, dump: dump });
        }, 120000);

    }
}

async function getMediasoupWorker() {
    const worker = workers[nextMediasoupWorkerIdx];
    if (++nextMediasoupWorkerIdx === workers.length) nextMediasoupWorkerIdx = 0;
    return worker;
}

function socketHandler(io) {
    io.on('connection', (socket) => {
        socket.on('clientError', (error) => {
            try {
                log.error('Client error', error.message);
                socket.disconnect(true); // true indicates a forced disconnection
            } catch (error) {
                log.error('Error handling Client error', error.message);
            }
        });

        socket.on('error', (error) => {
            try {
                log.error('Socket error', error.message);
                socket.disconnect(true); // true indicates a forced disconnection
            } catch (error) {
                log.error('Error handling socket error', error.message);
            }
        });

        socket.on('createRoom', async ({ room_id, userPlan }, callback) => {
            socket.room_id = room_id;

            if (roomList.has(socket.room_id)) {
                callback({ error: 'already exists' });
            } else {
                log.debug('Created room', { room_id: socket.room_id });
                const worker = await getMediasoupWorker();

                // Xonaga qo'shimcha sifatida userPlan qo'shish
                roomList.set(socket.room_id, new Room(socket.room_id, worker, io, userPlan));
                callback({ room_id: socket.room_id });
            }
        });

        socket.on('join', async (dataObject, cb) => {
            if (!roomList.has(socket.room_id)) {
                return cb({
                    error: 'Room does not exist',
                });
            }

            const room = roomList.get(socket.room_id);

            // Foydalanuvchilar limitini tekshirish
            if (!room.canAddPeer()) {
                return cb('fullCapacity');
            }

            // Get peer IPv4 (::1 Its the loopback address in ipv6, equal to 127.0.0.1 in ipv4)
            const peer_ip = getIpSocket(socket);

            // Get peer Geo Location
            if (config.IPLookup.enabled && peer_ip != '::1') {
                dataObject.peer_geo = await getPeerGeoLocation(peer_ip);
            }

            const data = checkXSS(dataObject);

            log.info('User joined', data);

            if (!Validator.isValidRoomName(socket.room_id)) {
                log.warn('[Join] - Invalid room name', socket.room_id);
                return cb('invalid');
            }

            const { peer_name, peer_id, peer_uuid, peer_token, os_name, os_version, browser_name, browser_version } = data.peer_info;

            let is_presenter = true;

            // User Auth required or detect token, we check if peer valid
            if (hostCfg.user_auth || peer_token) {
                // Check JWT
                if (peer_token) {
                    try {
                        const validToken = await isValidToken(peer_token);

                        if (!validToken) {
                            return cb('unauthorized');
                        }

                        const { username, password, presenter } = checkXSS(decodeToken(peer_token));

                        const isPeerValid = await isAuthPeer(username, password);

                        if (!isPeerValid) {
                            return cb('unauthorized');
                        }

                        is_presenter =
                            presenter === '1' ||
                            presenter === 'true' ||
                            (config.presenters.join_first && room.getPeers().size === 0);

                        log.debug('[Join] - HOST PROTECTED - USER AUTH check peer', {
                            ip: peer_ip,
                            peer_username: username,
                            peer_password: password,
                            peer_valid: isPeerValid,
                            peer_presenter: is_presenter,
                        });
                    } catch (err) {
                        log.error('[Join] - JWT error', {
                            error: err.message,
                            token: peer_token,
                        });
                        return cb('unauthorized');
                    }
                } else {
                    return cb('unauthorized');
                }

                if (!hostCfg.users_from_db) {
                    const roomAllowedForUser = isRoomAllowedForUser('[Join]', peer_name, room.id);
                    if (!roomAllowedForUser) {
                        return cb('notAllowed');
                    }
                }
            }

            // check if banned...
            if (room.isBanned(peer_uuid)) {
                log.info('[Join] - peer is banned!', {
                    room_id: data.room_id,
                    peer: {
                        name: peer_name,
                        uuid: peer_uuid,
                        os_name: os_name,
                        os_version: os_version,
                        browser_name: browser_name,
                        browser_version: browser_version,
                    },
                });
                return cb('isBanned');
            }

            // Add peer if the room is not full
            try {
                room.addPeer(new Peer(socket.id, data));
            } catch (err) {
                return cb({
                    error: err.message,
                });
            }

            const activeRooms = getActiveRooms();

            log.info('[Join] - current active rooms', activeRooms);

            const activeStreams = getRTMPActiveStreams();

            log.info('[Join] - current active RTMP streams', activeStreams);

            if (!(socket.room_id in presenters)) presenters[socket.room_id] = {};

            // Set the presenters
            const presenter = {
                peer_ip: peer_ip,
                peer_name: peer_name,
                peer_uuid: peer_uuid,
                is_presenter: is_presenter,
            };

            // first we check if the username match the presenters username
            if (config.presenters && config.presenters.list && config.presenters.list.includes(peer_name)) {
                presenters[socket.room_id][socket.id] = presenter;
            } else {
                // if not match the presenters username, the first one join room is the presenter
                if (Object.keys(presenters[socket.room_id]).length === 0) {
                    presenters[socket.room_id][socket.id] = presenter;
                }
            }

            log.info('[Join] - Connected presenters grp by roomId', presenters);

            const isPresenter = peer_token
                ? is_presenter
                : await isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);

            const peer = room.getPeer(socket.id);

            peer.updatePeerInfo({ type: 'presenter', status: isPresenter });

            log.info('[Join] - Is presenter', {
                roomId: socket.room_id,
                peer_name: peer_name,
                peer_presenter: isPresenter,
            });

            if (room.isLocked() && !isPresenter) {
                log.debug('The user was rejected because the room is locked, and they are not a presenter');
                return cb('isLocked');
            }

            if (room.isLobbyEnabled() && !isPresenter) {
                log.debug(
                    'The user is currently waiting to join the room because the lobby is enabled, and they are not a presenter',
                );
                room.broadCast(socket.id, 'roomLobby', {
                    peer_id: peer_id,
                    peer_name: peer_name,
                    lobby_status: 'waiting',
                });
                return cb('isLobby');
            }

            if ((hostCfg.protected || hostCfg.user_auth) && isPresenter && !hostCfg.users_from_db) {
                const roomAllowedForUser = isRoomAllowedForUser('[Join]', peer_name, room.id);
                if (!roomAllowedForUser) {
                    return cb('notAllowed');
                }
            }

            // SCENARIO: Notify when the first user join room and is awaiting assistance...
            if (room.getPeersCount() === 1) {
                nodemailer.sendEmailAlert('join', {
                    room_id: room.id,
                    peer_name: peer_name,
                    domain: socket.handshake.headers.host.split(':')[0],
                    os: os_name ? `${os_name} ${os_version}` : '',
                    browser: browser_name ? `${browser_name} ${browser_version}` : '',
                }); // config.email.alert: true
            }

            cb(room.toJson());
        });

        socket.on('getRouterRtpCapabilities', (_, callback) => {
            if (!roomList.has(socket.room_id)) {
                return callback({ error: 'Room not found' });
            }

            const room = roomList.get(socket.room_id);

            log.debug('Get RouterRtpCapabilities', getPeerName(room));
            try {
                const getRouterRtpCapabilities = room.getRtpCapabilities();

                //log.debug('Get RouterRtpCapabilities callback', { callback: getRouterRtpCapabilities });

                callback(getRouterRtpCapabilities);
            } catch (err) {
                log.error('Get RouterRtpCapabilities error', err);
                callback({
                    error: err.message,
                });
            }
        });

        socket.on('createWebRtcTransport', async (_, callback) => {
            if (!roomList.has(socket.room_id)) {
                return callback({ error: 'Room not found' });
            }

            const room = roomList.get(socket.room_id);

            log.debug('Create WebRtc transport', getPeerName(room));

            try {
                const createWebRtcTransport = await room.createWebRtcTransport(socket.id);

                // TURN/STUN serverlarini ishlatishni tasdiqlash uchun transport ma'lumotlarini qaytaring
                callback({
                    ...createWebRtcTransport,
                    iceServers: [
                        { urls: 'stun:213.230.91.183:3478' },
                        {
                            urls: 'turn:213.230.91.183:3478',
                            username: 'testuser',
                            credential: 'securepassword123'
                        },
                    ],
                });
            } catch (err) {
                log.error('Create WebRtc Transport error', err);
                callback({
                    error: err.message,
                });
            }
        });

        socket.on('getIceServers', (callback) => {
            callback({
                iceServers: [
                    { urls: 'stun:213.230.91.183:3478' },
                    {
                        urls: 'turn:213.230.91.183:3478',
                        username: 'testuser',
                        credential: 'securepassword123',
                    },
                ],
            });
        });

        socket.on('connectTransport', async ({ transport_id, dtlsParameters }, callback) => {
            if (!roomList.has(socket.room_id)) {
                return callback({ error: 'Room not found' });
            }

            const room = roomList.get(socket.room_id);

            const peer_name = getPeerName(room, false);

            log.debug('Connect transport', { peer_name: peer_name, transport_id: transport_id });

            try {
                const connectTransport = await room.connectPeerTransport(socket.id, transport_id, dtlsParameters);

                //log.debug('Connect transport', { callback: connectTransport });

                callback(connectTransport);
            } catch (err) {
                log.error('Connect transport error', err);
                callback({
                    error: err.message,
                });
            }
        });

        socket.on('restartIce', async ({ transport_id }, callback) => {
            if (!roomList.has(socket.room_id)) {
                return callback({ error: 'Room not found' });
            }

            const room = roomList.get(socket.room_id);

            const peer = room.getPeer(socket.id);

            const peer_name = getPeerName(room, false);

            log.debug('Restart ICE', { peer_name: peer_name, transport_id: transport_id });

            try {
                const transport = peer.getTransport(transport_id);

                if (!transport) {
                    throw new Error(`Restart ICE, transport with id "${transport_id}" not found`);
                }

                const iceParameters = await transport.restartIce();

                log.debug('Restart ICE callback', { callback: iceParameters });

                callback(iceParameters);
            } catch (err) {
                log.error('Restart ICE error', err);
                callback({
                    error: err.message,
                });
            }
        });

        socket.on('produce', async ({ producerTransportId, kind, appData, rtpParameters }, callback, errback) => {
            if (!roomList.has(socket.room_id)) {
                return callback({ error: 'Room not found' });
            }

            const room = roomList.get(socket.room_id);

            const peer_name = getPeerName(room, false);

            // peer_info.audio OR video ON
            const data = {
                room_id: room.id,
                peer_name: peer_name,
                peer_id: socket.id,
                kind: kind,
                type: appData.mediaType,
                status: true,
            };

            const peer = room.getPeer(socket.id);

            peer.updatePeerInfo(data);

            try {
                const producer_id = await room.produce(
                    socket.id,
                    producerTransportId,
                    rtpParameters,
                    kind,
                    appData.mediaType,
                );

                log.debug('Produce', {
                    kind: kind,
                    type: appData.mediaType,
                    peer_name: peer_name,
                    peer_id: socket.id,
                    producer_id: producer_id,
                });

                // add & monitor producer audio level and active speaker
                if (kind === 'audio') {
                    room.addProducerToAudioLevelObserver({ producerId: producer_id });
                    room.addProducerToActiveSpeakerObserver({ producerId: producer_id });
                }

                //log.debug('Producer transport callback', { callback: producer_id });

                callback({
                    producer_id,
                });
            } catch (err) {
                log.error('Producer transport error', err);
                callback({
                    error: err.message,
                });
            }
        });

        socket.on('consume', async ({ consumerTransportId, producerId, rtpCapabilities }, callback) => {
            if (!roomList.has(socket.room_id)) {
                return callback({ error: 'Room not found' });
            }

            const room = roomList.get(socket.room_id);

            const peer_name = getPeerName(room, false);

            try {
                const params = await room.consume(socket.id, consumerTransportId, producerId, rtpCapabilities);

                log.debug('Consuming', {
                    peer_name: peer_name,
                    producer_id: producerId,
                    consumer_id: params ? params.id : undefined,
                });

                //log.debug('Consumer transport callback', { callback: params });

                callback(params);
            } catch (err) {
                log.error('Consumer transport error', err);
                callback({
                    error: err.message,
                });
            }
        });

        socket.on('producerClosed', (data) => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            const peer = room.getPeer(socket.id);

            peer.updatePeerInfo(data); // peer_info.audio OR video OFF

            room.closeProducer(socket.id, data.producer_id);
        });

        socket.on('pauseProducer', async ({ producer_id }, callback) => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            const peer_name = getPeerName(room, false);

            const peer = room.getPeer(socket.id);

            if (!peer) {
                return callback({
                    error: `peer with ID: ${socket.id} for producer with id "${producer_id}" not found`,
                });
            }

            const producer = peer.getProducer(producer_id);

            if (!producer) {
                return callback({ error: `producer with id "${producer_id}" not found` });
            }

            try {
                await producer.pause();
            } catch (error) {
                return callback({ error: error.message });
            }

            log.debug('Producer paused', { peer_name: peer_name, producer_id: producer_id });

            callback('successfully');
        });

        socket.on('resumeProducer', async ({ producer_id }, callback) => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            const peer_name = getPeerName(room, false);

            const peer = room.getPeer(socket.id);

            if (!peer) {
                return callback({
                    error: `peer with ID: "${socket.id}" for producer with id "${producer_id}" not found`,
                });
            }

            const producer = peer.getProducer(producer_id);

            if (!producer) {
                return callback({ error: `producer with id "${producer_id}" not found` });
            }

            try {
                await producer.resume();
            } catch (error) {
                return callback({ error: error.message });
            }

            log.debug('Producer resumed', { peer_name: peer_name, producer_id: producer_id });

            callback('successfully');
        });

        socket.on('resumeConsumer', async ({ consumer_id }, callback) => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            const peer_name = getPeerName(room, false);

            const peer = room.getPeer(socket.id);

            if (!peer) {
                return callback({
                    error: `peer with ID: "${socket.id}" for consumer with id "${consumer_id}" not found`,
                });
            }

            const consumer = peer.getConsumer(consumer_id);

            if (!consumer) {
                return callback({ error: `consumer with id "${consumer_id}" not found` });
            }

            try {
                await consumer.resume();
            } catch (error) {
                return callback({ error: error.message });
            }

            log.debug('Consumer resumed', { peer_name: peer_name, consumer_id: consumer_id });

            callback('successfully');
        });

        socket.on('getProducers', () => {
            if (!roomExists(socket)) return;

            const { room, peer } = getRoomAndPeer(socket);

            const { peer_name } = peer || 'undefined';

            log.debug('Get producers', peer_name);

            // send all the current producer to newly joined member
            const producerList = room.getProducerListForPeer();

            socket.emit('newProducers', producerList);
        });

        socket.on('getPeerCounts', async ({ }, callback) => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            const peerCounts = room.getPeersCount();

            log.debug('Peer counts', { peerCounts: peerCounts });

            callback({ peerCounts: peerCounts });
        });

        socket.on('cmd', async (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            log.debug('cmd', data);

            const room = roomList.get(socket.room_id);

            switch (data.type) {
                case 'privacy':
                    const peer = room.getPeer(socket.id);
                    peer.updatePeerInfo({ type: data.type, status: data.active });
                    break;
                case 'ejectAll':
                    const { peer_name, peer_uuid } = data;
                    const isPresenter = await isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);
                    if (!isPresenter) return;
                    break;
                default:
                    break;
                //...
            }

            data.broadcast ? room.broadCast(socket.id, 'cmd', data) : room.sendTo(data.peer_id, 'cmd', data);
        });

        socket.on('roomAction', async (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const isPresenter = await isPeerPresenter(socket.room_id, socket.id, data.peer_name, data.peer_uuid);

            const room = roomList.get(socket.room_id);

            log.debug('Room action:', data);

            switch (data.action) {
                case 'broadcasting':
                    if (!isPresenter) return;
                    room.setIsBroadcasting(data.room_broadcasting);
                    room.broadCast(socket.id, 'roomAction', data.action);
                    break;
                case 'lock':
                    if (!isPresenter) return;
                    if (!room.isLocked()) {
                        room.setLocked(true, data.password);
                        room.broadCast(socket.id, 'roomAction', data.action);
                    }
                    break;
                case 'checkPassword':
                    let roomData = {
                        room: null,
                        password: 'KO',
                    };
                    if (data.password == room.getPassword()) {
                        roomData.room = room.toJson();
                        roomData.password = 'OK';
                    }
                    room.sendTo(socket.id, 'roomPassword', roomData);
                    break;
                case 'unlock':
                    if (!isPresenter) return;
                    room.setLocked(false);
                    room.broadCast(socket.id, 'roomAction', data.action);
                    break;
                case 'lobbyOn':
                    if (!isPresenter) return;
                    room.setLobbyEnabled(true);
                    room.broadCast(socket.id, 'roomAction', data.action);
                    break;
                case 'lobbyOff':
                    if (!isPresenter) return;
                    room.setLobbyEnabled(false);
                    room.broadCast(socket.id, 'roomAction', data.action);
                    break;
                case 'hostOnlyRecordingOn':
                    if (!isPresenter) return;
                    room.setHostOnlyRecording(true);
                    room.broadCast(socket.id, 'roomAction', data.action);
                    break;
                case 'hostOnlyRecordingOff':
                    if (!isPresenter) return;
                    room.setHostOnlyRecording(false);
                    room.broadCast(socket.id, 'roomAction', data.action);
                    break;
                case 'isBanned':
                    log.info('The user has been banned from the room due to spamming messages', data);
                    room.addBannedPeer(data.peer_uuid);
                    break;
                default:
                    break;
            }
            log.debug('Room status', {
                broadcasting: room.isBroadcasting(),
                locked: room.isLocked(),
                lobby: room.isLobbyEnabled(),
                hostOnlyRecording: room.isHostOnlyRecording(),
            });
        });

        socket.on('roomLobby', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const room = roomList.get(socket.room_id);

            data.room = room.toJson();

            log.debug('Room lobby', {
                peer_id: data.peer_id,
                peer_name: data.peer_name,
                peers_id: data.peers_id,
                lobby: data.lobby_status,
                broadcast: data.broadcast,
            });

            if (data.peers_id && data.broadcast) {
                for (let peer_id in data.peers_id) {
                    room.sendTo(data.peers_id[peer_id], 'roomLobby', data);
                }
            } else {
                room.sendTo(data.peer_id, 'roomLobby', data);
            }
        });

        socket.on('peerAction', async (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            log.debug('Peer action', data);

            const presenterActions = [
                'mute',
                'unmute',
                'hide',
                'unhide',
                'stop',
                'start',
                'eject',
                'ban',
                'geoLocation',
            ];

            if (presenterActions.some((v) => data.action === v)) {
                const isPresenter = await isPeerPresenter(
                    socket.room_id,
                    socket.id,
                    data.from_peer_name,
                    data.from_peer_uuid,
                );
                if (!isPresenter) return;
            }

            const room = roomList.get(socket.room_id);

            if (data.action === 'ban') room.addBannedPeer(data.to_peer_uuid);

            data.broadcast
                ? room.broadCast(data.peer_id, 'peerAction', data)
                : room.sendTo(data.peer_id, 'peerAction', data);
        });

        socket.on('updatePeerInfo', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const room = roomList.get(socket.room_id);

            const peer = room.getPeer(socket.id);

            if (!peer) return;

            peer.updatePeerInfo(data);

            if (data.broadcast) {
                log.debug('updatePeerInfo broadcast data');
                room.broadCast(socket.id, 'updatePeerInfo', data);
            }
        });

        socket.on('updateRoomModerator', async (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const room = roomList.get(socket.room_id);

            const isPresenter = await isPeerPresenter(socket.room_id, socket.id, data.peer_name, data.peer_uuid);

            if (!isPresenter) return;

            const moderator = data.moderator;

            room.updateRoomModerator(moderator);

            switch (moderator.type) {
                case 'audio_cant_unmute':
                case 'video_cant_unhide':
                case 'screen_cant_share':
                case 'chat_cant_privately':
                case 'chat_cant_chatgpt':
                    room.broadCast(socket.id, 'updateRoomModerator', moderator);
                    break;
                default:
                    break;
            }
        });

        socket.on('updateRoomModeratorALL', async (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const room = roomList.get(socket.room_id);

            const isPresenter = await isPeerPresenter(socket.room_id, socket.id, data.peer_name, data.peer_uuid);

            if (!isPresenter) return;

            const moderator = data.moderator;

            room.updateRoomModeratorALL(moderator);

            room.broadCast(socket.id, 'updateRoomModeratorALL', moderator);
        });

        socket.on('getRoomInfo', async (_, cb) => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            log.debug('Send Room Info to', getPeerName(room));

            cb(room.toJson());
        });

        socket.on('fileInfo', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            if (!isValidFileName(data.fileName)) {
                log.debug('File name not valid', data);
                return;
            }

            log.debug('Send File Info', data);

            const room = roomList.get(socket.room_id);

            data.broadcast ? room.broadCast(socket.id, 'fileInfo', data) : room.sendTo(data.peer_id, 'fileInfo', data);
        });

        socket.on('file', (data) => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            data.broadcast ? room.broadCast(socket.id, 'file', data) : room.sendTo(data.peer_id, 'file', data);
        });

        socket.on('fileAbort', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            roomList.get(socket.room_id).broadCast(socket.id, 'fileAbort', data);
        });

        socket.on('receiveFileAbort', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            roomList.get(socket.room_id).broadCast(socket.id, 'receiveFileAbort', data);
        });

        socket.on('shareVideoAction', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            if (data.action == 'open' && !isValidHttpURL(data.video_url)) {
                log.debug('Video src not valid', data);
                return;
            }

            log.debug('Share video: ', data);

            const room = roomList.get(socket.room_id);

            data.peer_id == 'all'
                ? room.broadCast(socket.id, 'shareVideoAction', data)
                : room.sendTo(data.peer_id, 'shareVideoAction', data);
        });

        socket.on('wbCanvasToJson', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const room = roomList.get(socket.room_id);

            // const objLength = bytesToSize(Object.keys(data).length);

            // log.debug('Send Whiteboard canvas JSON', { length: objLength });

            room.broadCast(socket.id, 'wbCanvasToJson', data);
        });

        socket.on('whiteboardAction', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const room = roomList.get(socket.room_id);

            log.debug('Whiteboard', data);
            room.broadCast(socket.id, 'whiteboardAction', data);
        });

        socket.on('setVideoOff', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            log.debug('Video off data', data.peer_name);

            const room = roomList.get(socket.room_id);

            room.broadCast(socket.id, 'setVideoOff', data);
        });

        socket.on('recordingAction', async (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            log.debug('Recording action', data);

            const room = roomList.get(socket.room_id);

            room.broadCast(socket.id, 'recordingAction', data);
        });

        socket.on('refreshParticipantsCount', () => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            const peerCounts = room.getPeers().size;

            const data = {
                room_id: socket.room_id,
                peer_counts: peerCounts,
            };
            log.debug('Refresh Participants count', data);
            room.broadCast(socket.id, 'refreshParticipantsCount', data);
        });

        socket.on('message', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const room = roomList.get(socket.room_id);

            // check if the message coming from real peer
            const realPeer = isRealPeer(data.peer_name, socket.id, socket.room_id);

            if (!realPeer) {
                const peer_name = getPeerName(room, false);
                log.debug('Fake message detected', {
                    realFrom: peer_name,
                    fakeFrom: data.peer_name,
                    msg: data.peer_msg,
                });
                return;
            }

            log.info('message', data);

            data.to_peer_id == 'all'
                ? room.broadCast(socket.id, 'message', data)
                : room.sendTo(data.to_peer_id, 'message', data);
        });

        socket.on('getChatGPT', async ({ time, room, name, prompt, context }, cb) => {
            const chatGPT = initializeChatGPT();

            if (!chatGPT) {
                log.error('ChatGPT obyektini ishga tushirishda xatolik yuz berdi.');
                return cb({ message: 'ChatGPT ishlamayapti!' });
            }

            if (!config.chatGPT.enabled) {
                return cb({ message: 'ChatGPT xizmati o‘chirilgan, keyinroq urinib ko‘ring!' });
            }

            try {
                context.push({ role: 'user', content: prompt });
                const completion = await chatGPT.chat.completions.create({
                    model: config.chatGPT.model || 'gpt-3.5-turbo',
                    messages: context,
                    max_tokens: config.chatGPT.max_tokens,
                    temperature: config.chatGPT.temperature,
                });

                const message = completion.choices[0].message.content.trim();
                context.push({ role: 'assistant', content: message });

                log.info('ChatGPT', { time, room, name, context });
                cb({ message, context });
            } catch (error) {
                log.error('ChatGPT', error);
                cb({ message: error.message });
            }
        });

        // https://docs.heygen.com/reference/overview-copy

        socket.on('getAvatarList', async ({ }, cb) => {
            if (!config.videoAI.enabled || !config.videoAI.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });
            try {
                const response = await axios.get(`${config.videoAI.basePath}/v1/avatar.list`, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Api-Key': config.videoAI.apiKey,
                    },
                });

                const data = { response: response.data.data };

                //log.debug('getAvatarList', data);

                cb(data);
            } catch (error) {
                log.error('getAvatarList', error.response.data);
                cb({ error: error.response?.status === 500 ? 'Internal server error' : error.response.data.message });
            }
        });

        socket.on('getVoiceList', async ({ }, cb) => {
            if (!config.videoAI.enabled || !config.videoAI.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });
            try {
                const response = await axios.get(`${config.videoAI.basePath}/v1/voice.list`, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Api-Key': config.videoAI.apiKey,
                    },
                });

                const data = { response: response.data.data };

                //log.debug('getVoiceList', data);

                cb(data);
            } catch (error) {
                log.error('getVoiceList', error.response.data);
                cb({ error: error.response?.status === 500 ? 'Internal server error' : error.response.data.message });
            }
        });

        socket.on('streamingNew', async ({ quality, avatar_name, voice_id }, cb) => {
            if (!roomList.has(socket.room_id)) return;
            if (!config.videoAI.enabled || !config.videoAI.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });
            try {
                const response = await axios.post(
                    `${config.videoAI.basePath}/v1/streaming.new`,
                    {
                        quality,
                        avatar_name,
                        voice: {
                            voice_id: voice_id,
                        },
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Api-Key': config.videoAI.apiKey,
                        },
                    },
                );

                log.warn('STREAMING NEW', response);

                const data = { response: response.data };

                log.debug('streamingNew', data);

                cb(data);
            } catch (error) {
                log.error('streamingNew', error.response.data);
                cb({ error: error.response?.status === 500 ? 'Internal server error' : error.response.data.message });
            }
        });

        socket.on('streamingStart', async ({ session_id, sdp }, cb) => {
            if (!roomList.has(socket.room_id)) return;
            if (!config.videoAI.enabled || !config.videoAI.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });

            try {
                const response = await axios.post(
                    `${config.videoAI.basePath}/v1/streaming.start`,
                    { session_id, sdp },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Api-Key': config.videoAI.apiKey,
                        },
                    },
                );

                const data = { response: response.data.data };

                log.debug('startSessionAi', data);

                cb(data);
            } catch (error) {
                log.error('streamingStart', error.response.data);
                cb({ error: error.response?.status === 500 ? 'Internal server error' : error.response.data.message });
            }
        });

        socket.on('streamingICE', async ({ session_id, candidate }, cb) => {
            if (!roomList.has(socket.room_id)) return;
            if (!config.videoAI.enabled || !config.videoAI.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });

            try {
                const response = await axios.post(
                    `${config.videoAI.basePath}/v1/streaming.ice`,
                    { session_id, candidate },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Api-Key': config.videoAI.apiKey,
                        },
                    },
                );

                const data = { response: response.data };

                log.debug('streamingICE', data);

                cb(data);
            } catch (error) {
                log.error('streamingICE', error.response.data);
                cb({ error: error.response?.status === 500 ? 'Internal server error' : error.response.data.message });
            }
        });

        socket.on('streamingTask', async ({ session_id, text }, cb) => {
            if (!roomList.has(socket.room_id)) return;
            if (!config.videoAI.enabled || !config.videoAI.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });
            try {
                const response = await axios.post(
                    `${config.videoAI.basePath}/v1/streaming.task`,
                    {
                        session_id,
                        text,
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Api-Key': config.videoAI.apiKey,
                        },
                    },
                );

                const data = { response: response.data };

                log.debug('streamingTask', data);

                cb(data);
            } catch (error) {
                log.error('streamingTask', error.response.data);
                cb({ error: error.response?.status === 500 ? 'Internal server error' : error.response.data.message });
            }
        });

        socket.on('talkToOpenAI', async ({ text, context }, cb) => {
            if (!roomList.has(socket.room_id)) return;
            if (!config.videoAI.enabled || !config.videoAI.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });
            try {
                const systemLimit = config.videoAI.systemLimit;
                const arr = {
                    messages: [...context, { role: 'system', content: systemLimit }, { role: 'user', content: text }],
                    model: 'gpt-3.5-turbo',
                };
                const chatCompletion = await chatGPT.chat.completions.create(arr);
                const chatText = chatCompletion.choices[0].message.content;
                context.push({ role: 'system', content: chatText });
                context.push({ role: 'assistant', content: chatText });

                const data = { response: chatText, context: context };

                log.debug('talkToOpenAI', data);

                cb(data);
            } catch (error) {
                log.error('talkToOpenAI', error.response.data);
                cb({ error: error.response?.status === 500 ? 'Internal server error' : error.response.data.message });
            }
        });

        socket.on('streamingStop', async ({ session_id }, cb) => {
            if (!roomList.has(socket.room_id)) return;
            if (!config.videoAI.enabled || !config.videoAI.apiKey)
                return cb({ error: 'Video AI seems disabled, try later!' });
            try {
                const response = await axios.post(
                    `${config.videoAI.basePath}/v1/streaming.stop`,
                    {
                        session_id,
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Api-Key': config.videoAI.apiKey,
                        },
                    },
                );

                const data = { response: response.data };

                log.debug('streamingStop', data);

                cb(data);
            } catch (error) {
                log.error('streamingStop', error.response.data);
                cb({ error: error.response?.status === 500 ? 'Internal server error' : error.response.data.message });
            }
        });

        socket.on('getRTMP', async ({ }, cb) => {
            if (!roomList.has(socket.room_id)) return;
            const room = roomList.get(socket.room_id);
            const rtmpFiles = await room.getRTMP(rtmpDir);
            cb(rtmpFiles);
        });

        socket.on('startRTMP', async (dataObject, cb) => {
            if (!roomList.has(socket.room_id)) return;

            if (rtmpCfg && rtmpFileStreamsCount >= rtmpCfg.maxStreams) {
                log.warn('RTMP max file streams reached', rtmpFileStreamsCount);
                return cb(false);
            }

            const data = checkXSS(dataObject);
            const { peer_name, peer_uuid, file } = data;
            const isPresenter = await isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);
            if (!isPresenter) return cb(false);

            const room = roomList.get(socket.room_id);
            const host = config.ngrok.enabled ? 'localhost' : socket.handshake.headers.host.split(':')[0];
            const rtmp = await room.startRTMP(socket.id, room, host, 1935, `../${rtmpDir}/${file}`);

            if (rtmp !== false) rtmpFileStreamsCount++;
            log.debug('startRTMP - rtmpFileStreamsCount ---->', rtmpFileStreamsCount);

            cb(rtmp);
        });

        socket.on('stopRTMP', async () => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            rtmpFileStreamsCount--;
            log.debug('stopRTMP - rtmpFileStreamsCount ---->', rtmpFileStreamsCount);

            await room.stopRTMP();
        });

        socket.on('endOrErrorRTMP', async () => {
            if (!roomList.has(socket.room_id)) return;
            rtmpFileStreamsCount--;
            log.debug('endRTMP - rtmpFileStreamsCount ---->', rtmpFileStreamsCount);
        });

        socket.on('startRTMPfromURL', async (dataObject, cb) => {
            if (!roomList.has(socket.room_id)) return;

            if (rtmpCfg && rtmpUrlStreamsCount >= rtmpCfg.maxStreams) {
                log.warn('RTMP max Url streams reached', rtmpUrlStreamsCount);
                return cb(false);
            }

            const data = checkXSS(dataObject);
            const { peer_name, peer_uuid, inputVideoURL } = data;
            const isPresenter = await isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);
            if (!isPresenter) return cb(false);

            const room = roomList.get(socket.room_id);
            const host = config.ngrok.enabled ? 'localhost' : socket.handshake.headers.host.split(':')[0];
            const rtmp = await room.startRTMPfromURL(socket.id, room, host, 1935, inputVideoURL);

            if (rtmp !== false) rtmpUrlStreamsCount++;
            log.debug('startRTMPfromURL - rtmpUrlStreamsCount ---->', rtmpUrlStreamsCount);

            cb(rtmp);
        });

        socket.on('stopRTMPfromURL', async () => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            rtmpUrlStreamsCount--;
            log.debug('stopRTMPfromURL - rtmpUrlStreamsCount ---->', rtmpUrlStreamsCount);

            await room.stopRTMPfromURL();
        });

        socket.on('endOrErrorRTMPfromURL', async () => {
            if (!roomList.has(socket.room_id)) return;
            rtmpUrlStreamsCount--;
            log.debug('endRTMPfromURL - rtmpUrlStreamsCount ---->', rtmpUrlStreamsCount);
        });

        socket.on('createPoll', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const { question, options } = data;

            const room = roomList.get(socket.room_id);

            const newPoll = {
                question: question,
                options: options,
                voters: new Map(),
            };

            const roomPolls = room.getPolls();

            roomPolls.push(newPoll);
            room.sendToAll('updatePolls', room.convertPolls(roomPolls));
            log.debug('[Poll] createPoll', roomPolls);
        });

        socket.on('vote', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const room = roomList.get(socket.room_id);

            const roomPolls = room.getPolls();

            const poll = roomPolls[data.pollIndex];
            if (poll) {
                const peer_name = getPeerName(room, false) || socket.id;
                poll.voters.set(peer_name, data.option);
                room.sendToAll('updatePolls', room.convertPolls(roomPolls));
                log.debug('[Poll] vote', roomPolls);
            }
        });

        socket.on('updatePoll', () => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            const roomPolls = room.getPolls();

            if (roomPolls.length > 0) {
                room.sendToAll('updatePolls', room.convertPolls(roomPolls));
                log.debug('[Poll] updatePoll', roomPolls);
            }
        });

        socket.on('editPoll', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const { index, question, options } = data;

            const room = roomList.get(socket.room_id);

            const roomPolls = room.getPolls();

            if (roomPolls[index]) {
                roomPolls[index].question = question;
                roomPolls[index].options = options;
                room.sendToAll('updatePolls', roomPolls);
                log.debug('[Poll] editPoll', roomPolls);
            }
        });

        socket.on('deletePoll', async (data) => {
            if (!roomList.has(socket.room_id)) return;

            const { index, peer_name, peer_uuid } = checkXSS(data);

            // Disable for now...
            // const isPresenter = await isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);
            // if (!isPresenter) return;

            const room = roomList.get(socket.room_id);

            const roomPolls = room.getPolls();

            if (roomPolls[index]) {
                roomPolls.splice(index, 1);
                room.sendToAll('updatePolls', roomPolls);
                log.debug('[Poll] deletePoll', roomPolls);
            }
        });

        // Room collaborative editor

        socket.on('editorChange', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            //const data = checkXSS(dataObject);
            const data = dataObject;

            const room = roomList.get(socket.room_id);

            room.broadCast(socket.id, 'editorChange', data);
        });

        socket.on('editorActions', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            const data = checkXSS(dataObject);

            const room = roomList.get(socket.room_id);

            log.debug('editorActions', data);

            room.broadCast(socket.id, 'editorActions', data);
        });

        socket.on('editorUpdate', (dataObject) => {
            if (!roomList.has(socket.room_id)) return;

            //const data = checkXSS(dataObject);
            const data = dataObject;

            const room = roomList.get(socket.room_id);

            room.broadCast(socket.id, 'editorUpdate', data);
        });

        socket.on('disconnect', async () => {
            if (!roomList.has(socket.room_id)) return;

            const room = roomList.get(socket.room_id);

            const peer = room.getPeer(socket.id);

            const { peer_name, peer_uuid } = peer || {};

            const isPresenter = await isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);

            log.debug('[Disconnect] - peer name', peer_name);

            room.removePeer(socket.id);

            if (room.getPeers().size === 0) {
                //
                stopRTMPActiveStreams(isPresenter, room);

                roomList.delete(socket.room_id);

                delete presenters[socket.room_id];

                log.info('[Disconnect] - Last peer - current presenters grouped by roomId', presenters);

                const activeRooms = getActiveRooms();

                log.info('[Disconnect] - Last peer - current active rooms', activeRooms);

                const activeStreams = getRTMPActiveStreams();

                log.info('[Disconnect] - Last peer - current active RTMP streams', activeStreams);
            }

            room.broadCast(socket.id, 'removeMe', removeMeData(room, peer_name, isPresenter));

            if (isPresenter) removeIP(socket);

            socket.room_id = null;
        });

        socket.on('exitRoom', async (_, callback) => {
            if (!roomList.has(socket.room_id)) {
                return callback({
                    error: 'Not currently in a room',
                });
            }

            const room = roomList.get(socket.room_id);

            const peer = room.getPeer(socket.id);

            const { peer_name, peer_uuid } = peer || {};

            const isPresenter = await isPeerPresenter(socket.room_id, socket.id, peer_name, peer_uuid);

            log.debug('Exit room', peer_name);

            room.removePeer(socket.id);

            room.broadCast(socket.id, 'removeMe', removeMeData(room, peer_name, isPresenter));

            if (room.getPeers().size === 0) {
                //
                stopRTMPActiveStreams(isPresenter, room);

                roomList.delete(socket.room_id);

                delete presenters[socket.room_id];

                log.info('[REMOVE ME] - Last peer - current presenters grouped by roomId', presenters);

                const activeRooms = getActiveRooms();

                log.info('[REMOVE ME] - Last peer - current active rooms', activeRooms);

                const activeStreams = getRTMPActiveStreams();

                log.info('[REMOVE ME] - Last peer - current active RTMP streams', activeStreams);
            }

            socket.room_id = null;

            if (isPresenter) removeIP(socket);

            callback('Successfully exited room');
        });

        // common
        function getPeerName(room, json = true) {
            try {
                const DEFAULT_PEER_NAME = 'undefined';
                const peer = room.getPeer(socket.id);
                const peerName = peer.peer_name || DEFAULT_PEER_NAME;
                if (json) {
                    return { peer_name: peerName };
                }
                return peerName;
            } catch (err) {
                log.error('getPeerName', err);
                return json ? { peer_name: DEFAULT_PEER_NAME } : DEFAULT_PEER_NAME;
            }
        }

        function isRealPeer(name, id, roomId) {
            if (!roomList.has(socket.room_id)) return false;

            const room = roomList.get(roomId);

            const peer = room.getPeer(id);

            if (!peer) return false;

            const { peer_name } = peer;

            return peer_name == name;
        }

        function isValidFileName(fileName) {
            const invalidChars = /[\\\/\?\*\|:"<>]/;
            return !invalidChars.test(fileName);
        }

        function isValidHttpURL(input) {
            const pattern = new RegExp(
                '^(https?:\\/\\/)?' + // protocol
                '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' + // domain name
                '((\\d{1,3}\\.){3}\\d{1,3}))' + // OR ip (v4) address
                '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
                '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
                '(\\#[-a-z\\d_]*)?$',
                'i',
            ); // fragment locator
            return pattern.test(input);
        }

        function removeMeData(room, peerName, isPresenter) {
            const roomId = room && socket.room_id;
            const peerCounts = room && room.getPeers().size;
            const data = {
                room_id: roomId,
                peer_id: socket.id,
                peer_name: peerName,
                peer_counts: peerCounts,
                isPresenter: isPresenter,
            };
            log.debug('[REMOVE ME DATA]', data);
            return data;
        }
    });
}

function roomExists(socket) {
    return roomList.has(socket.room_id);
}

function getRoomAndPeer(socket) {
    const room = getRoom(socket);

    const peer = getPeer(socket);

    return { room, peer };
}

function getRoom(socket) {
    return roomList.get(socket.room_id) || {};
}

function getPeer(socket) {
    const room = getRoom(socket);

    return room.getPeer ? room.getPeer(socket.id) || {} : {};
}

function getRTMPActiveStreams() {
    return {
        rtmpStreams: Object.keys(streams).length,
        rtmpFileStreamsCount,
        rtmpUrlStreamsCount,
    };
}

function stopRTMPActiveStreams(isPresenter, room) {
    if (isPresenter) {
        if (room.isRtmpFileStreamerActive()) {
            room.stopRTMP();
            rtmpFileStreamsCount--;
            log.info('[REMOVE ME] - Stop RTMP Stream From FIle', rtmpFileStreamsCount);
        }
        if (room.isRtmpUrlStreamerActive()) {
            room.stopRTMPfromURL();
            rtmpUrlStreamsCount--;
            log.info('[REMOVE ME] - Stop RTMP Stream From URL', rtmpUrlStreamsCount);
        }
    }
}

function clone(value) {
    if (value === undefined) return undefined;
    if (Number.isNaN(value)) return NaN;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function getIpSocket(socket) {
    return (
        socket.handshake.headers['x-forwarded-for'] ||
        socket.handshake.headers['X-Forwarded-For'] ||
        socket.handshake.address
    );
}

async function isPeerPresenter(room_id, peer_id, peer_name, peer_uuid) {
    try {
        if (
            config.presenters &&
            config.presenters.join_first &&
            (!presenters[room_id] || !presenters[room_id][peer_id])
        ) {
            // Presenter not in the presenters config list, disconnected, or peer_id changed...
            for (const [existingPeerID, presenter] of Object.entries(presenters[room_id] || {})) {
                if (presenter.peer_name === peer_name) {
                    log.info('Presenter found', {
                        room: room_id,
                        peer_id: existingPeerID,
                        peer_name: peer_name,
                    });
                    return true;
                }
            }
            return false;
        }

        const isPresenter =
            (config.presenters &&
                config.presenters.join_first &&
                typeof presenters[room_id] === 'object' &&
                Object.keys(presenters[room_id][peer_id]).length > 1 &&
                presenters[room_id][peer_id]['peer_name'] === peer_name &&
                presenters[room_id][peer_id]['peer_uuid'] === peer_uuid) ||
            (config.presenters && config.presenters.list && config.presenters.list.includes(peer_name));

        log.debug('isPeerPresenter', {
            room_id: room_id,
            peer_id: peer_id,
            peer_name: peer_name,
            peer_uuid: peer_uuid,
            isPresenter: isPresenter,
        });

        return isPresenter;
    } catch (err) {
        log.error('isPeerPresenter', err);
        return false;
    }
}

function getActiveRooms() {
    const roomIds = Array.from(roomList.keys());
    const roomPeersArray = roomIds.map((roomId) => {
        const room = roomList.get(roomId);
        const peerCount = (room && room.getPeers().size) || 0;
        const broadcasting = (room && room.isBroadcasting()) || false;
        return {
            room: roomId,
            broadcasting: broadcasting,
            peers: peerCount,
        };
    });
    return roomPeersArray;
}

function isRoomAllowedForUser(message, username, room) {
    const logData = { message, username, room };
    log.debug('isRoomAllowedForUser ------>', logData);

    const isOIDCEnabled = config.oidc && config.oidc.enabled;

    if (hostCfg.protected || hostCfg.user_auth) {
        const isInPresenterLists = config.presenters.list.includes(username);

        if (isInPresenterLists) {
            log.debug('isRoomAllowedForUser - user in presenters list room allowed', room);
            return true;
        }

        // Foydalanuvchini qidirish va unga bog'liq shartlar olib tashlandi
        // if (!isOIDCEnabled) {
        //     log.debug('isRoomAllowedForUser - user not found or OIDC not enabled', username);
        //     return false; // Agar OIDC yoqilmagan bo'lsa, foydalanuvchini qidirish shartini olib tashlash
        // }

        // OIDC yoqilganligi bilan bog'liq shartlar
        log.debug('isRoomAllowedForUser - OIDC enabled, room allowed', room);
        return true; // OIDC yoqilgan bo'lsa, xonaga kirish ruxsat beriladi
    }

    log.debug('isRoomAllowedForUser - No host protected or user_auth enabled, user room allowed', room);
    return true; // Agar himoya yoki foydalanuvchi autentifikatsiyasi yo'q bo'lsa, xonaga kirishga ruxsat beriladi
}

async function getPeerGeoLocation(ip) {
    const endpoint = config.IPLookup.getEndpoint(ip);
    log.debug('Get peer geo', { ip: ip, endpoint: endpoint });
    return axios
        .get(endpoint)
        .then((response) => response.data)
        .catch((error) => log.error(error));
}

async function isAuthPeer(username, password) {
    if (hostCfg.users_from_db && hostCfg.users_api_endpoint) {
        try {
            const response = await axios.post(hostCfg.users_api_endpoint, {
                email: username,
                password: password,
                api_secret_key: hostCfg.users_api_secret_key,
            });
            return response.data && response.data.message === true;
        } catch (error) {
            log.error('AXIOS isAuthPeer error', error.message);
            return false;
        }
    } else {
        return (
            hostCfg.users && hostCfg.users.some((user) => user.username === username && user.password === password)
        );
    }
}

async function isValidToken(token) {
    return new Promise((resolve, reject) => {
        jwt.verify(token, jwtCfg.JWT_KEY, (err, decoded) => {
            if (err) {
                // Token is invalid
                resolve(false);
            } else {
                // Token is valid
                resolve(true);
            }
        });
    });
}

function encodeToken(token) {
    if (!token) return '';

    const { username = 'username', password = 'password', presenter = false, expire } = token;

    const expireValue = expire || jwtCfg.JWT_EXP;

    // Constructing payload
    const payload = {
        username: String(username),
        password: String(password),
        presenter: String(presenter),
    };

    // Encrypt payload using AES encryption
    const payloadString = JSON.stringify(payload);
    const encryptedPayload = CryptoJS.AES.encrypt(payloadString, jwtCfg.JWT_KEY).toString();

    // Constructing JWT token
    const jwtToken = jwt.sign({ data: encryptedPayload }, jwtCfg.JWT_KEY, { expiresIn: expireValue });

    return jwtToken;
}

function decodeToken(jwtToken) {
    if (!jwtToken) return null;

    // Verify and decode the JWT token
    const decodedToken = jwt.verify(jwtToken, jwtCfg.JWT_KEY);
    if (!decodedToken || !decodedToken.data) {
        throw new Error('Invalid token');
    }

    // Decrypt the payload using AES decryption
    const decryptedPayload = CryptoJS.AES.decrypt(decodedToken.data, jwtCfg.JWT_KEY).toString(CryptoJS.enc.Utf8);

    // Parse the decrypted payload as JSON
    const payload = JSON.parse(decryptedPayload);

    return payload;
}

function allowedIP(ip) {
    const authorizedIPs = authHost.getAuthorizedIPs();
    const authorizedIP = authHost.isAuthorizedIP(ip);
    const isRoomActive = authHost.isRoomActive();
    log.info('Allowed IPs', {
        ip: ip,
        authorizedIP: authorizedIP,
        authorizedIPs: authorizedIPs,
        isRoomActive: isRoomActive,
    });
    return authHost != null && authorizedIP;
}

function removeIP(socket) {
    if (hostCfg.protected) {
        const ip = getIpSocket(socket);
        if (ip && allowedIP(ip)) {
            authHost.deleteIP(ip);
            hostCfg.authenticated = false;
            log.info('Remove IP from auth', {
                ip: ip,
                authorizedIps: authHost.getAuthorizedIPs(),
                roomActive: authHost.isRoomActive(),
            });
        }
    }
}

module.exports = socketHandler