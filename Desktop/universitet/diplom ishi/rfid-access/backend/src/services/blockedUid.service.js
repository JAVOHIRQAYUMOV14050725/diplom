// src/services/blockedUid.service.js
const repo = require('../repositories/blockedUid.repository');

async function blockUid(uid, reason) {
    await repo.block(uid, reason);
}

async function unblockUid(uid) {
    await repo.unblock(uid);
}

async function isUidBlocked(uid) {
    return await repo.isBlocked(uid);
}

async function listBlocked() {
    return await repo.getAll();
}

module.exports = {
    blockUid,
    unblockUid,
    isUidBlocked,
    listBlocked
};
