'use strict';

module.exports = class Host {
    constructor() {
        this.authorizedIPs = new Map();
        this.roomActive = false;
    }

    getIP(req) {
        return req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
    }

    getAuthorizedIPs() {
        return Object.fromEntries(this.authorizedIPs);
    }

    setAuthorizedIP(ip, authorized = true) {
        this.authorizedIPs.set(ip, authorized);
        this.updateRoomStatus();
    }

    isAuthorizedIP(ip) {
        return this.authorizedIPs.get(ip) === true; // Faqat `true` qiymatlarni ruxsat etadi
    }

    isRoomActive() {
        return this.roomActive;
    }

    setRoomActive() {
        this.roomActive = true;
    }

    setRoomDeactivate() {
        this.roomActive = false;
    }

    updateRoomStatus() {
        this.roomActive = Array.from(this.authorizedIPs.values()).includes(true);
    }

    deleteIP(ip) {
        this.authorizedIPs.delete(ip);
        this.updateRoomStatus();
        return true;
    }
};