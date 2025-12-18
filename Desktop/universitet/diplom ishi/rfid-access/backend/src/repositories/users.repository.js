const pool = require('../db/pool');

async function getUsers() {
    const [rows] = await pool.query(
        'SELECT id, uid, name, role, created_at FROM users ORDER BY id DESC'
    );
    return rows;
}

async function createUser({ uid, name, role }) {
    const [result] = await pool.query(
        'INSERT INTO users (uid, name, role, created_at) VALUES (?, ?, ?, NOW())',
        [uid, name, role]
    );
    const insertId = result.insertId;
    const [rows] = await pool.query('SELECT id, uid, name, role, created_at FROM users WHERE id = ?', [insertId]);
    return rows[0] || null;
}

async function deleteUser(id) {
    await pool.query('DELETE FROM users WHERE id = ?', [id]);
}

module.exports = { getUsers, createUser, deleteUser };