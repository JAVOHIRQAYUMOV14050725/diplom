// src/controllers/blockedUid.controller.js
const service = require('../services/blockedUid.service');

exports.list = async (req, res) => {
    const data = await service.listBlocked();
    res.json(data);
};

exports.block = async (req, res) => {
    const { uid, reason } = req.body;
    if (!uid) {
        return res.status(400).json({ error: 'uid required' });
    }

    await service.blockUid(uid, reason);
    res.json({ success: true });
};

exports.unblock = async (req, res) => {
    const { uid } = req.body;
    if (!uid) {
        return res.status(400).json({ error: 'uid required' });
    }

    await service.unblockUid(uid);
    res.json({ success: true });
};
