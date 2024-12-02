'use strict';

const express = require('express');
const { auth, requiresAuth } = require('express-openid-connect');
const cors = require('cors');
const compression = require('compression');
const socketIo = require('socket.io');
const https = require('httpolyglot');
const mediasoup = require('mediasoup');
const mediasoupClient = require('mediasoup-client');
const http = require('http');
const path = require('path');
const axios = require('axios');
const ngrok = require('ngrok');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const config = require('./config');
const checkXSS = require('./XSS.js');
const Host = require('./Host');
const ServerApi = require('./ServerApi');
const Logger = require('./Logger');
const Validator = require('./Validator');
const log = new Logger('Server');
const yaml = require('js-yaml');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = yaml.load(fs.readFileSync(path.join(__dirname, '/../api/swagger.yaml'), 'utf8'));
const Sentry = require('@sentry/node');
const restrictAccessByIP = require('./middleware/IpWhitelist.js');
const packageJson = require('../../package.json');
const socketHandler = require('./socket/socket.js');
const initializeChatGPT = require('./modules/chatgpt.js')

// MongoDB start
require('dotenv').config();
const mongoose = require('mongoose');
// MongoDB end

// Incoming Stream to RTPM
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto-js');
const RtmpStreamer = require('./RtmpStreamer.js'); // Import the RtmpStreamer class
const rtmpCfg = config.server.rtmp;

// Slack API
const CryptoJS = require('crypto-js');
const qS = require('qs');
const slackEnabled = config.slack.enabled;
const slackSigningSecret = config.slack.signingSecret;
const bodyParser = require('body-parser');

const app = express();

const options = {
    cert: fs.readFileSync(path.join(__dirname, config.server.ssl.cert), 'utf-8'),
    key: fs.readFileSync(path.join(__dirname, config.server.ssl.key), 'utf-8'),
};

const corsOptions = {
    origin: config.server?.cors?.origin || '*',
    methods: config.server?.cors?.methods || ['GET', 'POST'],
};

const httpsServer = https.createServer(options, app);
const io = socketIo(httpsServer, {
    maxHttpBufferSize: 1e7,
    transports: ['websocket', 'polling'], // Fallback qo'shiladi
    cors: corsOptions,
});

const host = 'https://' + 'localhost' + ':' + config.server.listen.port; // config.server.listen.ip

const jwtCfg = {
    JWT_KEY: (config.jwt && config.jwt.key) || 'mirotalksfu_jwt_secret',
    JWT_EXP: (config.jwt && config.jwt.exp) || '1h',
};

const hostCfg = {
    protected: config.host.protected,
    user_auth: config.host.user_auth,
    users_from_db: config.host.users_from_db,
    users_api_endpoint: config.host.users_api_endpoint,
    users_api_secret_key: config.host.users_api_secret_key,
    users: config.host.users,
    authenticated: !config.host.protected,
};

const restApi = {
    basePath: '/api/v1', // api endpoint path
    docs: host + '/api/v1/docs', // api docs
    allowed: config.api?.allowed,
};

// Sentry monitoring
const sentryEnabled = config.sentry.enabled;
const sentryDSN = config.sentry.DSN;
const sentryTracesSampleRate = config.sentry.tracesSampleRate;
if (sentryEnabled) {
    Sentry.init({
        dsn: sentryDSN,
        integrations: [
            Sentry.captureConsoleIntegration({
                // ['log', 'info', 'warn', 'error', 'debug', 'assert']
                levels: ['error'],
            }),
        ],
        tracesSampleRate: sentryTracesSampleRate,
    });
    /*
    log.log('test-log');
    log.info('test-info');
    log.warn('test-warning');
    log.error('test-error');
    log.debug('test-debug');
*/
}

// OpenAI/ChatGPT
const chatGPT = initializeChatGPT(); // Natijani saqlash

if (!chatGPT) {
    console.error('ChatGPT obyekti yaratilmagan. API kalitni yoki sozlamalarni tekshiring.');
}
// OpenID Connect
const OIDC = config.oidc ? config.oidc : { enabled: false };

// directory
const dir = {
    public: path.join(__dirname, '../../', 'public'),
    rec: path.join(__dirname, '../', config?.server?.recording?.dir ? config.server.recording.dir + '/' : 'rec/'),
};

// rec directory create
const serverRecordingEnabled = config?.server?.recording?.enabled;
if (serverRecordingEnabled) {
    if (!fs.existsSync(dir.rec)) {
        fs.mkdirSync(dir.rec, { recursive: true });
    }
}

// html views
const views = {
    // about: path.join(__dirname, '../../', 'public/views/about.html'),
    landing: path.join(__dirname, '../../', 'public/views/landing.html'),
    login: path.join(__dirname, '../../', 'public/views/login.html'),
    newRoom: path.join(__dirname, '../../', 'public/views/newroom.html'),
    notFound: path.join(__dirname, '../../', 'public/views/404.html'),
    permission: path.join(__dirname, '../../', 'public/views/permission.html'),
    privacy: path.join(__dirname, '../../', 'public/views/privacy.html'),
    room: path.join(__dirname, '../../', 'public/views/Room.html'),
    rtmpStreamer: path.join(__dirname, '../../', 'public/views/RtmpStreamer.html'),
    register: path.join(__dirname, '../../', 'public/views/register.html'),
};

// Mongo Config
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    surname: { type: String, required: true },
    email: { type: String, required: true },
    phone_number: { type: String, required: true },
    plan: { type: String, required: true },
    inn: { type: String }  // INN yuridik shaxslar uchun
});

const User = mongoose.model('User', userSchema);

const PaymeSettings = {
    paymentAdress: process.env.PAYME_URL,
    paymentKey: process.env.PAYME_KEY
}

const authHost = new Host(); // Authenticated IP by Login

const roomList = new Map(); // All Rooms

const streams = {}; // Collect all rtmp streams

const webRtcServerActive = config.mediasoup.webRtcServerActive;

// ip (server local IPv4)
const IPv4 = webRtcServerActive
    ? config.mediasoup.webRtcServerOptions.listenInfos[0].ip
    : config.mediasoup.webRtcTransport.listenInfos[0].ip;

// announcedAddress (server public IPv4)
let announcedAddress = webRtcServerActive
    ? config.mediasoup.webRtcServerOptions.listenInfos[0].announcedAddress
    : config.mediasoup.webRtcTransport.listenInfos[0].announcedAddress;

// Autodetect announcedAddress (https://www.ipify.org)
if (!announcedAddress && IPv4 === '0.0.0.0') {
    http.get(
        {
            host: 'api.ipify.org',
            port: 80,
            path: '/',
        },
        (resp) => {
            resp.on('data', (ip) => {
                announcedAddress = ip.toString();
                if (webRtcServerActive) {
                    config.mediasoup.webRtcServerOptions.listenInfos.forEach((info) => {
                        info.announcedAddress = announcedAddress;
                    });
                } else {
                    config.mediasoup.webRtcTransport.listenInfos.forEach((info) => {
                        info.announcedAddress = announcedAddress;
                    });
                }
                startServer();
            });
        },
    );
} else {
    startServer();
}

// Custom middleware function for OIDC authentication
function OIDCAuth(req, res, next) {
    if (OIDC.enabled) {
        // Apply requiresAuth() middleware conditionally
        requiresAuth()(req, res, function () {
            log.debug('[OIDC] ------> requiresAuth');
            // Check if user is authenticated
            if (req.oidc.isAuthenticated()) {
                log.debug('[OIDC] ------> User isAuthenticated');
                // User is authenticated
                if (hostCfg.protected) {
                    const ip = authHost.getIP(req);
                    hostCfg.authenticated = true;
                    authHost.setAuthorizedIP(ip, true);
                    // Check...
                    log.debug('[OIDC] ------> Host protected', {
                        authenticated: hostCfg.authenticated,
                        authorizedIPs: authHost.getAuthorizedIPs(),
                        activeRoom: authHost.isRoomActive(),
                    });
                }
                next();
            } else {
                // User is not authenticated
                res.status(401).send('Unauthorized');
            }
        });
    } else {
        next();
    }
}

// BASE64 shifirlash
function base64Encode(data) {
    return Buffer.from(JSON.stringify(data)).toString('base64');
}

function startServer() {
    // Start the app
    app.use(cors(corsOptions));
    app.use(cors());
    app.use(bodyParser.json());
    app.use(compression());
    // app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json()); // Ensure the body parser can handle large files
    app.use(express.static(dir.public));
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(bodyParser.raw({ type: 'video/webm', limit: '2000mb' })); // handle raw binary data
    app.use(restApi.basePath + '/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument)); // api docs

    // IP Whitelist check ...
    app.use(restrictAccessByIP);

    // Logs requests
    /*
    app.use((req, res, next) => {
        log.debug('New request:', {
            headers: req.headers,
            body: req.body,
            method: req.method,
            path: req.originalUrl,
        });
        next();
    });
    */

    // POST start from here...
    app.post('*', function (next) {
        next();
    });

    // GET start from here...
    app.get('*', function (next) {
        next();
    });

    // Remove trailing slashes in url handle bad requests
    app.use((err, req, res, next) => {
        if (err instanceof SyntaxError || err.status === 400 || 'body' in err) {
            log.error('Request Error', {
                header: req.headers,
                body: req.body,
                error: err.message,
            });
            return res.status(400).send({ status: 404, message: err.message }); // Bad request
        }
        if (req.path.substr(-1) === '/' && req.path.length > 1) {
            let query = req.url.slice(req.path.length);
            res.redirect(301, req.path.slice(0, -1) + query);
        } else {
            next();
        }
    });

    // OpenID Connect
    if (OIDC.enabled) {
        try {
            app.use(auth(OIDC.config));
        } catch (err) {
            log.error(err);
            process.exit(1);
        }
    }

    // Route to display user information
    app.get('/profile', OIDCAuth, (req, res) => {
        if (OIDC.enabled) {
            return res.json(req.oidc.user); // Send user information as JSON
        }
        res.sendFile(views.notFound);
    });

    // Authentication Callback Route
    app.get('/auth/callback', (req, res, next) => {
        next(); // Let express-openid-connect handle this route
    });

    // Logout Route
    app.get('/logout', (req, res) => {
        if (OIDC.enabled) {
            //
            if (hostCfg.protected) {
                const ip = authHost.getIP(req);
                if (authHost.isAuthorizedIP(ip)) {
                    authHost.deleteIP(ip);
                }
                hostCfg.authenticated = false;
                //
                log.debug('[OIDC] ------> Logout', {
                    authenticated: hostCfg.authenticated,
                    authorizedIPs: authHost.getAuthorizedIPs(),
                    activeRoom: authHost.isRoomActive(),
                });
            }
            req.logout(); // Logout user
        }
        res.redirect('/'); // Redirect to the home page after logout
    });

    // UI buttons configuration
    app.get('/config', (req, res) => {
        res.status(200).json({ message: config.ui ? config.ui.buttons : false });
    });

    // Mongo Connect 
    mongoose.connect(process.env.MONGO_URL)
        .then(() => console.log('MongoDB ga muvaffaqiyatli ulandi'))
        .catch(err => console.error('MongoDB ga ulanishda xato:', err));

    // main page
    app.get(['/'], OIDCAuth, (req, res) => {
        //log.debug('/ - hostCfg ----->', hostCfg);
        if (!OIDC.enabled && hostCfg.protected) {
            const ip = getIP(req);
            if (allowedIP(ip)) {
                res.sendFile(views.landing);
                hostCfg.authenticated = true;
            } else {
                hostCfg.authenticated = true;
                // res.redirect('/login');  
                res.sendFile(views.landing);
            }
        } else {
            res.sendFile(views.landing);
        }
    });

    // Route to display rtmp streamer
    app.get('/rtmp', OIDCAuth, (req, res) => {
        if (!rtmpCfg || !rtmpCfg.fromStream) {
            return res.json({ message: 'The RTMP Streamer is currently disabled.' });
        }
        return res.sendFile(views.rtmpStreamer);
    });

    // set new room name and join
    app.get(['/newroom'], OIDCAuth, (req, res) => {
        //log.info('/newroom - hostCfg ----->', hostCfg);

        if (!OIDC.enabled && hostCfg.protected) {
            const ip = getIP(req);
            if (allowedIP(ip)) {
                res.redirect('/');
                hostCfg.authenticated = true;
            } else {
                hostCfg.authenticated = false;
                res.redirect('/login');
            }
        } else {
            res.sendFile(views.landing);
        }
    });

    // Handle Direct join room with params
    app.get('/join/', async (req, res) => {
        if (Object.keys(req.query).length > 0) {
            //log.debug('/join/params - hostCfg ----->', hostCfg);

            log.debug('Direct Join', req.query);

            // http://localhost:3010/join?room=test&roomPassword=0&name=mirotalksfu&audio=1&video=1&screen=0&hide=0&notify=1
            // http://localhost:3010/join?room=test&roomPassword=0&name=mirotalksfu&audio=1&video=1&screen=0&hide=0&notify=0&token=token

            const { room, roomPassword, name, audio, video, screen, hide, notify, token, isPresenter } = checkXSS(
                req.query,
            );

            if (!Validator.isValidRoomName(room)) {
                return res.status(400).json({
                    message: 'Invalid Room name!\nPath traversal pattern detected!',
                });
            }

            let peerUsername = '';
            let peerPassword = '';
            let isPeerValid = false;
            let isPeerPresenter = false;

            if (token) {
                try {
                    const validToken = await isValidToken(token);

                    if (!validToken) {
                        return res.status(401).json({ message: 'Invalid Token' });
                    }

                    const { username, password, presenter } = checkXSS(decodeToken(token));

                    peerUsername = username;
                    peerPassword = password;
                    isPeerValid = await isAuthPeer(username, password);
                    isPeerPresenter = presenter === '1' || presenter === 'true';

                    if (isPeerPresenter && !hostCfg.users_from_db) {
                        const roomAllowedForUser = isRoomAllowedForUser('Direct Join with token', username, room);
                        if (!roomAllowedForUser) {
                            return res.status(401).json({ message: 'Direct Room Join for this User is Unauthorized' });
                        }
                    }
                } catch (err) {
                    log.error('Direct Join JWT error', { error: err.message, token: token });
                    return hostCfg.protected || hostCfg.user_auth
                        ? res.sendFile(views.login)
                        : res.sendFile(views.landing);
                }
            } else {
                const allowRoomAccess = isAllowedRoomAccess('/join/params', req, hostCfg, authHost, roomList, room);
                const roomAllowedForUser = isRoomAllowedForUser('Direct Join with token', name, room);
                if (!allowRoomAccess && !roomAllowedForUser) {
                    return res.status(401).json({ message: 'Direct Room Join Unauthorized' });
                }
            }

            const OIDCUserAuthenticated = OIDC.enabled && req.oidc.isAuthenticated();

            if (
                (hostCfg.protected && isPeerValid && isPeerPresenter && !hostCfg.authenticated) ||
                OIDCUserAuthenticated
            ) {
                const ip = getIP(req);
                hostCfg.authenticated = true;
                authHost.setAuthorizedIP(ip, true);
                log.debug('Direct Join user auth as host done', {
                    ip: ip,
                    username: peerUsername,
                    password: peerPassword,
                });
            }

            if (room && (hostCfg.authenticated || isPeerValid)) {
                return res.sendFile(views.room);
            } else {
                return res.sendFile(views.login);
            }
        }
    });

    // join room by id
    app.get('/join/:roomId', (req, res) => {
        //
        const roomId = req.params.roomId;

        if (!Validator.isValidRoomName(roomId)) {
            log.warn('/join/:roomId invalid', roomId);
            return res.redirect('/');
        }

        const allowRoomAccess = isAllowedRoomAccess('/join/:roomId', req, hostCfg, authHost, roomList, roomId);

        if (allowRoomAccess) {
            if (hostCfg.protected) authHost.setRoomActive();

            res.sendFile(views.room);
        } else {
            if (!OIDC.enabled && hostCfg.protected) {
                return res.sendFile(views.login);
            }
            res.redirect('/');
        }
    });

    // not specified correctly the room id
    app.get('/join/*', (req, res) => {
        res.redirect('/');
    });

    // if not allow video/audio
    app.get(['/permission'], (req, res) => {
        res.sendFile(views.permission);
    });

    // privacy policy
    app.get(['/privacy'], (req, res) => {
        res.sendFile(views.privacy);
    });

    // mirotalk about
    // app.get(['/about'], (req, res) => {
    //     res.sendFile(views.about);
    // });

    // Get stats endpoint
    // app.get(['/stats'], (req, res) => {
    //     const stats = config.stats ? config.stats : defaultStats;
    //     // log.debug('Send stats', stats);
    //     res.send(stats);
    // });

    // handle login if user_auth enabled
    app.get(['/login'], (req, res) => {
        res.sendFile(views.login);
    });

    // handle logged on host protected
    app.get(['/logged'], (req, res) => {
        const ip = getIP(req);
        if (allowedIP(ip)) {
            res.redirect('/');
            hostCfg.authenticated = true;
        } else {
            hostCfg.authenticated = false;
            res.redirect('/login');
        }
    });

    app.get(['/register'], (req, res) => {
        res.sendFile(views.register)
    })

    // ####################################################
    // AXIOS
    // ####################################################

    // handle login on host protected
    app.post('/login', async (req, res) => {
        const ip = authHost.getIP(req); // IP manzilni olish
        log.debug(`Request login to host from: ${ip}`, req.body);

        const { email, phone_number } = checkXSS(req.body); // XSS himoyasi

        try {
            // Bazadan foydalanuvchini qidirish
            const user = await User.findOne({ email: email });

            if (!user) {
                // Email topilmagan holat
                return res.status(401).json({ message: 'Invalid email or phone number' });
            }

            // Phone numberni tekshirish
            if (phone_number !== user.phone_number) {
                return res.status(401).json({ message: 'Invalid email or phone number' });
            }

            // Agar foydalanuvchi to‘g‘ri bo‘lsa
            const isPresenter =
                config.presenters?.list?.includes(email) || // Email presenterlar ro‘yxatida bo‘lsa
                config.presenters?.join_first ||            // `join_first` sozlamasi yoqilgan bo‘lsa
                false;

            const token = encodeToken({ email, phone_number, presenter: isPresenter, plan: user.plan });

            // IP-manzilni ruxsat etilganlar ro‘yxatiga qo‘shish
            authHost.setAuthorizedIP(ip);

            log.debug('LOGIN OK', {
                ip: ip,
                authorized: true,
                authorizedIps: authHost.getAuthorizedIPs(),
            });

            return res.status(200).json({ message: token, plan: user.plan });
        } catch (err) {
            log.error('Database query error:', err);
            return res.status(500).json({ message: 'Server error' });
        }
    });


    app.post(['/register'], async (req, res) => {
        const { name, surname, email, phone_number, plan, inn } = req.body;

        // Yangi foydalanuvchi yaratish
        const newUser = new User({
            name,
            surname,
            email,
            phone_number,
            plan
        });

        // Agar yuridik shaxs bo'lsa, INN qiymatini qo'shish
        if (inn) {
            newUser.inn = inn;  // INN ni foydalanuvchi obyekti ichiga qo'shish
        }

        try {
            await newUser.save(); // Foydalanuvchini bazaga saqlash
            res.status(201).json({ message: 'Foydalanuvchi muvaffaqiyatli saqlandi!', user: newUser });
        } catch (error) {
            console.error('Foydalanuvchini saqlashda xato:', error);
            res.status(400).json({ message: 'Foydalanuvchini saqlashda xato:', error });
        }
    });

    app.post('/payme/checkout', async (req, res) => {
        let amount
        const { plan, phone } = req.body;
        if (plan === 'basic') {
            amount = 10000
        } else if (plan === 'pro') {
            amount === 15000
        } else if (plan === 'enterprise') {
            amount = 20000
        }
        // Tranzaksiya uchun zarur bo'lgan ma'lumotlar
        const transactionData = {
            method: "CreateTransaction",
            params: {
                id: crypto.randomBytes(12).toString('hex'),
                time: Date.now(),
                amount: amount * 100,  // So'mni tiyinlarga aylantirish
                account: {
                    phone: phone,  // Foydalanuvchining telefon raqami
                },
            },
        };

        // Ma'lumotlarni Base64 formatida shifrlash
        const encodedData = base64Encode(transactionData);

        try {
            // Payme API orqali CreateTransaction so'rovini yuborish
            const response = await axios.post('https://checkout.paycom.uz/api', {
                payload: encodedData,
            }, {
                headers: {
                    'Authorization': `Bearer ${PAYME_API_TOKEN}`,  // Tokenni sarlavhaga qo'shamiz
                    'Content-Type': 'application/json',
                }
            });

            // Payme'dan qaytgan javob
            res.json({ data: response.data });
        } catch (error) {
            console.error(error);
            res.status(500).send('Payme to\'lov so\'rovini amalga oshirishda xatolik yuz berdi.');
        }
    });

    app.post('/payme/out', (req, res) => {

    })

    // ####################################################
    // KEEP RECORDING ON SERVER DIR
    // ####################################################

    app.post(['/recSync'], (req, res) => {
        // Store recording...
        if (serverRecordingEnabled) {
            //
            try {
                const { fileName } = req.query;

                if (!fileName) {
                    return res.status(400).send('Filename not provided');
                }

                if (!Validator.isValidRecFileNameFormat(fileName)) {
                    log.warn('[RecSync] - Invalid file name', fileName);
                    return res.status(400).send('Invalid file name');
                }

                const parts = fileName.split('_');
                const roomId = parts[1];

                if (!roomList.has(roomId)) {
                    log.warn('[RecSync] - RoomID not exists in filename', fileName);
                    return res.status(400).send('Invalid file name');
                }

                if (!fs.existsSync(dir.rec)) {
                    fs.mkdirSync(dir.rec, { recursive: true });
                }
                const filePath = dir.rec + fileName;
                const writeStream = fs.createWriteStream(filePath, { flags: 'a' });

                req.pipe(writeStream);

                writeStream.on('error', (err) => {
                    log.error('[RecSync] - Error writing to file:', err.message);
                    res.status(500).send('Internal Server Error');
                });

                writeStream.on('finish', () => {
                    log.debug('[RecSync] - File saved successfully:', fileName);
                    res.status(200).send('File uploaded successfully');
                });
            } catch (err) {
                log.error('[RecSync] - Error processing upload', err.message);
                res.status(500).send('Internal Server Error');
            }
        }
    });

    // ###############################################################
    // INCOMING STREAM (getUserMedia || getDisplayMedia) TO RTMP
    // ###############################################################

    function checkRTMPApiSecret(req, res, next) {
        const expectedApiSecret = rtmpCfg && rtmpCfg.apiSecret;
        const apiSecret = req.headers.authorization;

        if (!apiSecret || apiSecret !== expectedApiSecret) {
            log.warn('RTMP apiSecret Unauthorized', {
                apiSecret: apiSecret,
                expectedApiSecret: expectedApiSecret,
            });
            return res.status(401).send('Unauthorized');
        }
        next();
    }

    function checkMaxStreams(req, res, next) {
        const maxStreams = (rtmpCfg && rtmpCfg.maxStreams) || 1; // Set your maximum allowed streams here
        const activeStreams = Object.keys(streams).length;
        if (activeStreams >= maxStreams) {
            log.warn('Maximum number of streams reached', activeStreams);
            return res.status(429).send('Maximum number of streams reached, please try later!');
        }
        next();
    }

    app.get('/activeStreams', checkRTMPApiSecret, (req, res) => {
        const activeStreams = Object.keys(streams).length;
        log.info('Active Streams', activeStreams);
        res.json(activeStreams);
    });

    app.get('/rtmpEnabled', (req, res) => {
        const rtmpEnabled = rtmpCfg && rtmpCfg.enabled;
        log.debug('RTMP enabled', rtmpEnabled);
        res.json({ enabled: rtmpEnabled });
    });

    app.post('/initRTMP', checkRTMPApiSecret, checkMaxStreams, async (req, res) => {
        if (!rtmpCfg || !rtmpCfg.enabled) {
            return res.status(400).send('RTMP server is not enabled or missing the config');
        }

        const domainName = config.ngrok.enabled ? 'localhost' : req.headers.host.split(':')[0];

        const rtmpServer = rtmpCfg.server != '' ? rtmpCfg.server : false;
        const rtmpServerAppName = rtmpCfg.appName != '' ? rtmpCfg.appName : 'live';
        const rtmpStreamKey = rtmpCfg.streamKey != '' ? rtmpCfg.streamKey : uuidv4();
        const rtmpServerSecret = rtmpCfg.secret != '' ? rtmpCfg.secret : false;
        const expirationHours = rtmpCfg.expirationHours || 4;
        const rtmpServerURL = rtmpServer ? rtmpServer : `rtmp://${domainName}:1935`;
        const rtmpServerPath = '/' + rtmpServerAppName + '/' + rtmpStreamKey;

        const rtmp = rtmpServerSecret
            ? generateRTMPUrl(rtmpServerURL, rtmpServerPath, rtmpServerSecret, expirationHours)
            : rtmpServerURL + rtmpServerPath;

        log.info('initRTMP', {
            headers: req.headers,
            rtmpServer,
            rtmpServerSecret,
            rtmpServerURL,
            rtmpServerPath,
            expirationHours,
            rtmpStreamKey,
            rtmp,
        });

        const stream = new RtmpStreamer(rtmp, rtmpStreamKey);
        streams[rtmpStreamKey] = stream;

        log.info('Active RTMP Streams', Object.keys(streams).length);

        return res.json({ rtmp });
    });

    app.post('/streamRTMP', checkRTMPApiSecret, (req, res) => {
        if (!rtmpCfg || !rtmpCfg.enabled) {
            return res.status(400).send('RTMP server is not enabled');
        }
        if (!req.body || req.body.length === 0) {
            return res.status(400).send('Invalid video data');
        }

        const rtmpStreamKey = req.query.key;
        const stream = streams[rtmpStreamKey];

        if (!stream || !stream.isRunning()) {
            delete streams[rtmpStreamKey];
            log.debug('Stream not found', { rtmpStreamKey, streams: Object.keys(streams).length });
            return res.status(404).send('FFmpeg Stream not found');
        }

        log.debug('Received video data', {
            // data: req.body.slice(0, 20).toString('hex'),
            key: rtmpStreamKey,
            size: bytesToSize(req.headers['content-length']),
        });

        stream.write(Buffer.from(req.body));
        res.sendStatus(200);
    });

    app.post('/stopRTMP', checkRTMPApiSecret, (req, res) => {
        if (!rtmpCfg || !rtmpCfg.enabled) {
            return res.status(400).send('RTMP server is not enabled');
        }

        const rtmpStreamKey = req.query.key;
        const stream = streams[rtmpStreamKey];

        if (stream) {
            stream.end();
            delete streams[rtmpStreamKey];
            log.debug('Active RTMP Streams', Object.keys(streams).length);
        }

        res.sendStatus(200);
    });

    // ####################################################
    // REST API
    // ####################################################

    // request meetings list
    app.get([restApi.basePath + '/meetings'], (req, res) => {
        // Check if endpoint allowed
        if (restApi.allowed && !restApi.allowed.meetings) {
            return res.status(403).json({
                error: 'This endpoint has been disabled. Please contact the administrator for further information.',
            });
        }
        // check if user was authorized for the api call
        const { host, authorization } = req.headers;
        const api = new ServerApi(host, authorization);
        if (!api.isAuthorized()) {
            log.debug('MiroTalk get meetings - Unauthorized', {
                header: req.headers,
                body: req.body,
            });
            return res.status(403).json({ error: 'Unauthorized!' });
        }
        // Get meetings
        const meetings = api.getMeetings(roomList);
        res.json({ meetings: meetings });
        // log.debug the output if all done
        log.debug('MiroTalk get meetings - Authorized', {
            header: req.headers,
            body: req.body,
            meetings: meetings,
        });
    });

    // request meeting room endpoint
    app.post([restApi.basePath + '/meeting'], (req, res) => {
        // Check if endpoint allowed
        if (restApi.allowed && !restApi.allowed.meeting) {
            return res.status(403).json({
                error: 'This endpoint has been disabled. Please contact the administrator for further information.',
            });
        }
        // check if user was authorized for the api call
        const { host, authorization } = req.headers;
        const api = new ServerApi(host, authorization);
        if (!api.isAuthorized()) {
            log.debug('MiroTalk get meeting - Unauthorized', {
                header: req.headers,
                body: req.body,
            });
            return res.status(403).json({ error: 'Unauthorized!' });
        }
        // setup meeting URL
        const meetingURL = api.getMeetingURL();
        res.json({ meeting: meetingURL });
        // log.debug the output if all done
        log.debug('MiroTalk get meeting - Authorized', {
            header: req.headers,
            body: req.body,
            meeting: meetingURL,
        });
    });

    // request join room endpoint
    app.post([restApi.basePath + '/join'], (req, res) => {
        // Check if endpoint allowed
        if (restApi.allowed && !restApi.allowed.join) {
            return res.status(403).json({
                error: 'This endpoint has been disabled. Please contact the administrator for further information.',
            });
        }
        // check if user was authorized for the api call
        const { host, authorization } = req.headers;
        const api = new ServerApi(host, authorization);
        if (!api.isAuthorized()) {
            log.debug('MiroTalk get join - Unauthorized', {
                header: req.headers,
                body: req.body,
            });
            return res.status(403).json({ error: 'Unauthorized!' });
        }
        // setup Join URL
        const joinURL = api.getJoinURL(req.body);
        res.json({ join: joinURL });
        // log.debug the output if all done
        log.debug('MiroTalk get join - Authorized', {
            header: req.headers,
            body: req.body,
            join: joinURL,
        });
    });

    // request token endpoint
    app.post([restApi.basePath + '/token'], (req, res) => {
        // Check if endpoint allowed
        if (restApi.allowed && !restApi.allowed.token) {
            return res.status(403).json({
                error: 'This endpoint has been disabled. Please contact the administrator for further information.',
            });
        }
        // check if user was authorized for the api call
        const { host, authorization } = req.headers;
        const api = new ServerApi(host, authorization);
        if (!api.isAuthorized()) {
            log.debug('MiroTalk get token - Unauthorized', {
                header: req.headers,
                body: req.body,
            });
            return res.status(403).json({ error: 'Unauthorized!' });
        }
        // Get Token
        const token = api.getToken(req.body);
        res.json({ token: token });
        // log.debug the output if all done
        log.debug('MiroTalk get token - Authorized', {
            header: req.headers,
            body: req.body,
            token: token,
        });
    });

    // ####################################################
    // SLACK API
    // ####################################################

    app.post('/slack', (req, res) => {
        if (!slackEnabled) return res.end('`Under maintenance` - Please check back soon.');

        if (restApi.allowed && !restApi.allowed.slack) {
            return res.end(
                '`This endpoint has been disabled`. Please contact the administrator for further information.',
            );
        }

        log.debug('Slack', req.headers);

        if (!slackSigningSecret) return res.end('`Slack Signing Secret is empty!`');

        const slackSignature = req.headers['x-slack-signature'];
        const requestBody = qS.stringify(req.body, { format: 'RFC1738' });
        const timeStamp = req.headers['x-slack-request-timestamp'];
        const time = Math.floor(new Date().getTime() / 1000);

        if (Math.abs(time - timeStamp) > 300) return res.end('`Wrong timestamp` - Ignore this request.');

        const sigBaseString = 'v0:' + timeStamp + ':' + requestBody;
        const mySignature = 'v0=' + CryptoJS.HmacSHA256(sigBaseString, slackSigningSecret);

        if (mySignature == slackSignature) {
            const host = req.headers.host;
            const api = new ServerApi(host);
            const meetingURL = api.getMeetingURL();
            log.debug('Slack', { meeting: meetingURL });
            return res.end(meetingURL);
        }
        return res.end('`Wrong signature` - Verification failed!');
    });

    // not match any of page before, so 404 not found
    app.get('*', (req, res) => {
        res.status(404).sendFile(views.notFound); // 404 status va faylni birga qaytaradi
    });

    // ####################################################
    // SERVER CONFIG
    // ####################################################

    function getServerConfig(tunnel = false) {
        return {
            app_version: packageJson.version,
            node_version: process.versions.node,
            cors_options: corsOptions,
            middleware: config.middleware,
            server_listen: host,
            server_tunnel: tunnel,
            hostConfig: hostCfg,
            jwtCfg: jwtCfg,
            presenters: config.presenters,
            rest_api: restApi,
            mediasoup_worker_bin: mediasoup.workerBin,
            mediasoup_server_version: mediasoup.version,
            mediasoup_client_version: mediasoupClient.version,
            mediasoup_listenInfos: config.mediasoup.webRtcTransport.listenInfos,
            ip_lookup_enabled: config.IPLookup.enabled,
            sentry_enabled: sentryEnabled,
            redirect_enabled: config.redirect.enabled,
            slack_enabled: slackEnabled,
            chatGPT_enabled: config.chatGPT.enabled,
            configUI: config.ui,
            serverRec: config?.server?.recording,
            oidc: OIDC.enabled ? OIDC : false,
        };
    }

    // ####################################################
    // NGROK
    // ####################################################

    async function ngrokStart() {
        try {
            await ngrok.authtoken(config.ngrok.authToken);
            await ngrok.connect(config.server.listen.port);
            const api = ngrok.getApi();
            const list = await api.listTunnels();
            const tunnel = list.tunnels[0].public_url;
            log.info('Server ngrok config', tunnel); //getServerConfig(tunnel)
        } catch (err) {
            log.error('Ngrok Start error: ', err.body);
            await ngrok.kill();
            process.exit(1);
        }
    }

    // ####################################################
    // START SERVER
    // ####################################################

    httpsServer.listen(config.server.listen.port, () => {
        if (config.ngrok.enabled && config.ngrok.authToken !== '') {
            return ngrokStart();
        }
        log.info('SERVER ISHLADI', config.server.listen.port);
    });

    // ####################################################
    // SOCKET IO
    // ####################################################

    socketHandler(io)

    function generateRTMPUrl(baseURL, streamPath, secretKey, expirationHours = 4) {
        const currentTime = Math.floor(Date.now() / 1000);
        const expirationTime = currentTime + expirationHours * 3600;
        const hashValue = crypto.MD5(`${streamPath}-${expirationTime}-${secretKey}`).toString();
        const rtmpUrl = `${baseURL}${streamPath}?sign=${expirationTime}-${hashValue}`;

        log.debug('generateRTMPUrl', {
            currentTime,
            expirationTime,
            hashValue,
            rtmpUrl,
        });

        return rtmpUrl;
    }

    function bytesToSize(bytes) {
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        if (bytes == 0) return '0 Byte';
        const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
        return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
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

    function isAllowedRoomAccess(logMessage, req, hostCfg, authHost, roomList, roomId) {
        const OIDCUserAuthenticated = OIDC.enabled && req.oidc.isAuthenticated();
        const hostUserAuthenticated = hostCfg.protected && hostCfg.authenticated;
        const roomActive = authHost.isRoomActive();
        const roomExist = roomList.has(roomId);
        const roomCount = roomList.size;

        const allowRoomAccess =
            (!hostCfg.protected && !OIDC.enabled) || // No host protection and OIDC mode enabled (default)
            OIDCUserAuthenticated || // User authenticated via OIDC
            hostUserAuthenticated || // User authenticated via Login
            ((OIDCUserAuthenticated || hostUserAuthenticated) && roomCount === 0) || // User authenticated joins the first room
            roomExist; // User Or Guest join an existing Room

        log.debug(logMessage, {
            OIDCUserEnabled: OIDC.enabled,
            OIDCUserAuthenticated: OIDCUserAuthenticated,
            hostUserAuthenticated: hostUserAuthenticated,
            hostProtected: hostCfg.protected,
            hostAuthenticated: hostCfg.authenticated,
            roomActive: roomActive,
            roomExist: roomExist,
            roomCount: roomCount,
            roomId: roomId,
            allowRoomAccess: allowRoomAccess,
        });

        return allowRoomAccess;
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

    function getIP(req) {
        return req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'] || req.socket.remoteAddress || req.ip;
    }

    function getIpSocket(socket) {
        return (
            socket.handshake.headers['x-forwarded-for'] ||
            socket.handshake.headers['X-Forwarded-For'] ||
            socket.handshake.address
        );
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
}
