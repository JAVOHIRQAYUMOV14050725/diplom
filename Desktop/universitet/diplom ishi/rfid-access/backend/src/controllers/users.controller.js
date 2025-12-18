const repo = require('../repositories/users.repository');

exports.list = async (_, res) => {
    try {
        const users = await repo.getUsers();
        res.json({ ok: true, data: users });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, error: 'internal_error' });
    }
};

exports.create = async (req, res) => {
    try {
        const { uid, name, role } = req.body;
        if (!uid) return res.status(400).json({ ok: false, error: 'uid_required' });

        const created = await repo.createUser({ uid, name, role });
        return res.status(201).json({ ok: true, data: created });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, error: 'internal_error' });
    }
};

exports.remove = async (req, res) => {
    try {
        await repo.deleteUser(req.params.id);
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, error: 'internal_error' });
    }
};