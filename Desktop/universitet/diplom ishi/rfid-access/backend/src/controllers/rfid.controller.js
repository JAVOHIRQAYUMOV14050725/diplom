const rfidService = require('../services/rfid.service');
const sse = require('../services/sse.service');
const repo = require('../repositories/rfid.repository');
const jwt = require('jsonwebtoken');

exports.stream = (req, res) => {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
    });
    res.flushHeaders?.();

    const clientId = Date.now() + Math.random();
    sse.addClient(clientId, res);

    // remove on close
    req.on('close', () => {
        sse.removeClient(clientId);
    });
};

exports.scan = async (req, res) => {
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ ok: false, error: 'uid_required' });

    try {
        const result = await rfidService.handleScan(uid);
        if (!result.ok) return res.status(result.status || 400).json(result);
        return res.status(201).json({ ok: true, data: result.data });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ ok: false, error: 'internal_error' });
    }
};

exports.logs = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
        const logs = await repo.getLogs(limit);
        return res.json({ ok: true, data: logs });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ ok: false, error: 'internal_error' });
    }
};

// 🔢 Inside count
exports.inside = async (_, res) => {
    try {
        const inside = await repo.getInsideCount();
        return res.json({ ok: true, inside });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ ok: false, error: 'internal_error' });
    }
};

// 📊 Today entry stats
exports.todayStats = async (_, res) => {
    try {
        const stats = await repo.getTodayEntryStats();
        return res.json(stats);
    } catch (e) {
        console.error(e);
        return res.status(500).json({ ok: false, error: 'internal_error' });
    }
};
exports.statsByDate = async (req, res) => {
    try {
        const date = req.query.date;
        if (!date) return res.status(400).json({ error: 'date_required' });

        const stats = await repo.getEntryStatsByDate(date);
        return res.json(stats);
    } catch (e) {
        res.status(500).json({ error: 'internal_error' });
    }
};



exports.list = async (_, res) => {
    try {
        const blocked = await repo.getBlockedUids();
        res.json({ ok: true, data: blocked });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, error: 'internal_error' });
    }
};

exports.unblock = async (req, res) => {
    const { uid } = req.params;
    try {
        const success = await repo.unblockUid(uid);
        if (!success) return res.status(404).json({ ok: false, error: 'uid_not_blocked' });
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, error: 'internal_error' });
    }
};
// Simple admin login for the UI (uses ENV ADMIN_USER / ADMIN_PASS)
exports.login = async (req, res) => {
    const { username, password } = req.body;
    const ADMIN_USER = process.env.ADMIN_USER || 'admin';
    const ADMIN_PASS = process.env.ADMIN_PASS || 'admin';

    if (!username || !password) return res.status(400).json({ ok: false, error: 'credentials_required' });

    if (username !== ADMIN_USER || password !== ADMIN_PASS) {
        return res.status(401).json({ ok: false, error: 'invalid_credentials' });
    }

    const token = jwt.sign({ username, role: 'admin' }, process.env.JWT_SECRET || 'SECRET', { expiresIn: '12h' });
    return res.json({ ok: true, token });
};