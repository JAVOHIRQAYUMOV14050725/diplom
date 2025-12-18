const pool = require('../db/pool');

async function findUserByUid(uid) {
    const [rows] = await pool.query(
        'SELECT id, uid, name, role FROM users WHERE uid = ? LIMIT 1',
        [uid]
    );
    return rows[0] || null;
}

// faqat entry/exit ni olamiz (denied emas)
async function getLastAction(uid) {
    const [rows] = await pool.query(
        `SELECT action, timestamp
     FROM access_logs
     WHERE uid = ?
       AND status = 'ok'
       AND action IS NOT NULL
     ORDER BY timestamp DESC
     LIMIT 1`,
        [uid]
    );

    if (!rows[0]) return null;
    return { action: rows[0].action, timestamp: rows[0].timestamp };
}

// 🔥 ASOSIY FIX SHU YERDA
async function insertLog({ uid, userId, action = null, status = 'ok', note = null }) {
    const [result] = await pool.query(
        `INSERT INTO access_logs (uid, user_id, action, status, note)
     VALUES (?, ?, ?, ?, ?)`,
        [uid, userId, action, status, note]
    );

    const insertId = result.insertId;

    const [rows] = await pool.query(
        `SELECT l.id, l.uid, l.action, l.status, l.note, l.timestamp,
            u.id AS user_id, u.name, u.role
     FROM access_logs l
     LEFT JOIN users u ON l.user_id = u.id
     WHERE l.id = ?
     LIMIT 1`,
        [insertId]
    );

    return rows[0] || null;
}

async function getLogs(limit = 100) {
    const [rows] = await pool.query(
        `SELECT l.id, l.uid, l.action, l.status, l.note, l.timestamp,
            u.name, u.role
     FROM access_logs l
     LEFT JOIN users u ON l.user_id = u.id
     ORDER BY l.timestamp DESC
     LIMIT ?`,
        [Number(limit)]
    );
    return rows;
}

module.exports = {
    findUserByUid,
    getLastAction,
    insertLog,
    getLogs
};
