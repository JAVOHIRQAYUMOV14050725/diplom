// src/repositories/blockedUid.repository.js

const { pool } = require("../db/pool");

async function isBlocked(uid) {
    const [rows] = await pool.query(
        'SELECT uid FROM blocked_uids WHERE uid = ?',
        [uid]
    );
    return rows.length > 0;
}

async function block(uid, reason = null) {
    await pool.query(
        `INSERT INTO blocked_uids (uid, reason)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE reason = VALUES(reason)`,
        [uid, reason]
    );
}

async function unblock(uid) {
    await pool.query(
        'DELETE FROM blocked_uids WHERE uid = ?',
        [uid]
    );
}

async function getAll() {
    const [rows] = await pool.query(
        'SELECT uid, blocked_at, reason FROM blocked_uids ORDER BY blocked_at DESC'
    );
    return rows;
}

module.exports = {
    isBlocked,
    block,
    unblock,
    getAll
};
