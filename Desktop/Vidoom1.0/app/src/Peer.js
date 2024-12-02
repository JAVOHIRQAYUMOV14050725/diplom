'use strict';

const Logger = require('./Logger');
const log = new Logger('Peer');

module.exports = class Peer {
    constructor(socket_id, data) {
        const { peer_info } = data;

        const {
            peer_uuid,
            peer_name,
            peer_presenter,
            peer_audio,
            peer_video,
            peer_video_privacy,
            peer_recording,
            peer_hand,
        } = peer_info;

        this.id = socket_id;
        this.peer_info = peer_info;
        this.peer_uuid = peer_uuid;
        this.peer_name = peer_name;
        this.peer_presenter = peer_presenter;
        this.peer_audio = peer_audio;
        this.peer_video = peer_video;
        this.peer_video_privacy = peer_video_privacy;
        this.peer_recording = peer_recording;
        this.peer_hand = peer_hand;

        this.transports = new Map();
        this.consumers = new Map();
        this.producers = new Map();
    }

    // ####################################################
    // UPDATE PEER INFO
    // ####################################################

    updatePeerInfo(data) {
        log.debug('Update peer info', data);
        switch (data.type) {
            case 'audio':
            case 'audioType':
                this.peer_info.peer_audio = data.status;
                this.peer_audio = data.status;
                break;
            case 'video':
            case 'videoType':
                this.peer_info.peer_video = data.status;
                this.peer_video = data.status;
                if (data.status == false) {
                    this.peer_info.peer_video_privacy = data.status;
                    this.peer_video_privacy = data.status;
                }
                break;
            case 'screen':
            case 'screenType':
                this.peer_info.peer_screen = data.status;
                break;
            case 'hand':
                this.peer_info.peer_hand = data.status;
                this.peer_hand = data.status;
                break;
            case 'privacy':
                this.peer_info.peer_video_privacy = data.status;
                this.peer_video_privacy = data.status;
                break;
            case 'presenter':
                this.peer_info.peer_presenter = data.status;
                this.peer_presenter = data.status;
                break;
            case 'recording':
                this.peer_info.peer_recording = data.status;
                this.peer_recording = data.status;
                break;
            default:
                break;
        }
    }

    // ####################################################
    // TRANSPORT
    // ####################################################

    getTransports() {
        return JSON.parse(JSON.stringify([...this.transports]));
    }

    getTransport(transport_id) {
        return this.transports.get(transport_id);
    }

    delTransport(transport_id) {
        this.transports.delete(transport_id);
    }

    addTransport(transport) {
        this.transports.set(transport.id, transport);
    }

    async connectTransport(transport_id, dtlsParameters) {
        if (!this.transports.has(transport_id)) {
            return false;
        }

        await this.transports.get(transport_id).connect({
            dtlsParameters: dtlsParameters,
        });

        return true;
    }

    close() {
        this.transports.forEach((transport, transport_id) => {
            transport.close();
            this.delTransport(transport_id);
            log.debug('Closed and deleted peer transport', {
                //transport_id: transport_id,
                transportInternal: transport.internal,
                transport_closed: transport.closed,
            });
        });

        const peerTransports = this.getTransports();
        const peerProducers = this.getProducers();
        const peerConsumers = this.getConsumers();

        log.debug('CLOSE PEER - CHECK TRANSPORTS | PRODUCERS | CONSUMERS', {
            peer_id: this.id,
            peer_name: this.peer_name,
            peerTransports: peerTransports,
            peerProducers: peerProducers,
            peerConsumers: peerConsumers,
        });
    }

    // ####################################################
    // PRODUCER
    // ####################################################

    getProducers() {
        return JSON.parse(JSON.stringify([...this.producers]));
    }

    getProducer(producer_id) {
        return this.producers.get(producer_id);
    }

    delProducer(producer_id) {
        this.producers.delete(producer_id);
    }

    async createProducer(producerTransportId, producer_rtpParameters, producer_kind, producer_type) {
        log.debug('Creating producer...', {
            
            producer_rtpParameters,
            producer_kind,
            producer_type,
        });
    
        // Step 1: Check if the transport exists
        if (!this.transports.has(producerTransportId)) {
            log.warn(`Transport with ID ${producerTransportId} not found.`);
            return;
        }
        
        log.info(`Transport with ID ${producerTransportId} found.`);
    
        // Step 2: Get the transport from the map
        const producerTransport = this.transports.get(producerTransportId);
        log.debug('Transport retrieved for producer:', {
            transport_id: producerTransportId,
            transport_details: producerTransport,
        });
    
        // Step 3: Produce the producer
        const producer = await producerTransport.produce({
            kind: producer_kind,
            rtpParameters: producer_rtpParameters,
        });
    
        log.info('Producer created successfully', {
            producer_id: producer.id,
            producer_kind: producer.kind,
            producer_type: producer_type,
        });
    
        // Step 4: Extract producer details
        const { id, appData, type, kind, rtpParameters } = producer;
        appData.mediaType = producer_type;
    
        log.debug('Producer details:', {
            id,
            appData,
            type,
            kind,
            rtpParameters,
        });
    
        // Step 5: Add the producer to the map
        this.producers.set(id, producer);
        log.debug(`Producer with ID ${id} added to producers map.`);
    
        // Step 6: Check if the producer type is 'simulcast' or 'svc'
        if (['simulcast', 'svc'].includes(type)) {
            const { scalabilityMode } = rtpParameters.encodings[0];
            const spatialLayer = parseInt(scalabilityMode.substring(1, 2)); // 1/2/3
            const temporalLayer = parseInt(scalabilityMode.substring(3, 4)); // 1/2/3
            
            log.debug(`Producer [${type}-${kind}] ----->`, {
                scalabilityMode,
                spatialLayer,
                temporalLayer,
            });
        } else {
            log.debug('Producer ----->', {
                type,
                kind,
            });
        }
    
        // Step 7: Listen for 'transportclose' event and handle producer close
        producer.on('transportclose', () => {
            log.debug('Producer "transportclose" event triggered');
            this.closeProducer(id);
        });
    
        return producer;
    }
    

    closeProducer(producer_id) {
        if (!this.producers.has(producer_id)) return;

        const producer = this.getProducer(producer_id);
        const { id, kind, type, appData } = producer;

        try {
            producer.close();
        } catch (error) {
            log.warn('Close Producer', error.message);
        }

        this.delProducer(producer_id);

        log.debug('Producer closed and deleted', {
            peer_name: this.peer_name,
            kind: kind,
            type: type,
            appData: appData,
            producer_id: id,
            producer_closed: producer.closed,
        });
    }

    // ####################################################
    // CONSUMER
    // ####################################################

    getConsumers() {
        return JSON.parse(JSON.stringify([...this.consumers]));
    }

    getConsumer(consumer_id) {
        return this.consumers.get(consumer_id);
    }

    delConsumer(consumer_id) {
        this.consumers.delete(consumer_id);
    }

    async createConsumer(consumer_transport_id, producer_id, rtpCapabilities) {
        if (!this.transports.has(consumer_transport_id)) return;

        const consumerTransport = this.transports.get(consumer_transport_id);

        const consumer = await consumerTransport.consume({
            producerId: producer_id,
            rtpCapabilities,
            enableRtx: true, // Enable NACK for OPUS.
            paused: true,
            ignoreDtx: true,
        });

        const { id, type, kind, rtpParameters, producerPaused } = consumer;

        this.consumers.set(id, consumer);

        if (['simulcast', 'svc'].includes(type)) {
            // simulcast - L1T3/L2T3/L3T3 | svc - L3T3
            const { scalabilityMode } = rtpParameters.encodings[0];
            const spatialLayer = parseInt(scalabilityMode.substring(1, 2)); // 1/2/3
            const temporalLayer = parseInt(scalabilityMode.substring(3, 4)); // 1/2/3
            try {
                await consumer.setPreferredLayers({
                    spatialLayer: spatialLayer,
                    temporalLayer: temporalLayer,
                });
                log.debug(`Consumer [${type}-${kind}] ----->`, {
                    scalabilityMode,
                    spatialLayer,
                    temporalLayer,
                });
            } catch (error) {}
        } else {
            log.debug('Consumer ----->', { type: type, kind: kind });
        }

        consumer.on('transportclose', () => {
            log.debug('Consumer "transportclose" event');
            this.removeConsumer(id);
        });

        return {
            consumer: consumer,
            params: {
                producerId: producer_id,
                id: id,
                kind: kind,
                rtpParameters: rtpParameters,
                type: type,
                producerPaused: producerPaused,
            },
        };
    }
    
    removeConsumer(consumer_id) {
        // Consumer ID mavjudligini tekshirish
        if (!consumer_id) {
            log.warn('Consumer ID not provided or invalid');
            return;
        }
    
        // Consumer mavjudligini tekshirish
        const consumer = this.getConsumer(consumer_id);
        if (!consumer) {
            log.warn(`Consumer not found: ID = ${consumer_id}`);
            return;
        }
    
        const { id, kind, type } = consumer;
    
        // Consumerni yopish
        try {
            consumer.close();
            log.debug('Consumer successfully closed');
        } catch (error) {
            log.warn('Error closing Consumer', error.message);
        }
    
        // Consumerning yopilganligini tekshirish
        if (consumer.closed) {
            log.debug('Consumer is now closed');
        } else {
            log.warn('Failed to close consumer properly');
        }
    
        // Consumerni o‘chirish
        if (this.consumers.has(consumer_id)) {
            this.delConsumer(consumer_id);
            log.debug('Consumer deleted from map');
        } else {
            log.warn(`Consumer not found in map: ID = ${consumer_id}`);
        }
    
        // Loglarda aniq ma'lumot
        log.debug('Consumer closed and deleted', {
            peer_name: this.peer_name,
            kind: kind,
            type: type,
            consumer_id: id,
            consumer_closed: consumer.closed,
            consumer_status: consumer.closed ? 'closed' : 'open',
        });
    }
    
};