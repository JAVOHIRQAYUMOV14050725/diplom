const pool = require('../db/pool');

/* ======================================================
   👤 USERS
====================================================== */

/**
 * 🔍 UID bo‘yicha user topish
 */
async function findUserByUid(uid) {
    const [rows] = await pool.query(
        'SELECT id, uid, name, role FROM users WHERE uid = ? LIMIT 1',
        [uid]
    );
    return rows[0] || null;
}

/**
 * ⏮ Oxirgi entry/exit amalini olish (denied emas)
 */
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
    return {
        action: rows[0].action,
        timestamp: rows[0].timestamp
    };
}

/* ======================================================
   📝 LOGS
====================================================== */

/**
 * 📝 Log qo‘shish (entry / exit / denied)
 * → SSE uchun FULL row qaytaradi
 */
async function insertLog({
    uid,
    userId = null,
    action = null,
    status = 'ok',
    note = null
}) {
    const [result] = await pool.query(
        `INSERT INTO access_logs (uid, user_id, action, status, note)
         VALUES (?, ?, ?, ?, ?)`,
        [uid, userId, action, status, note]
    );

    const insertId = result.insertId;

    const [rows] = await pool.query(
        `SELECT 
            l.id,
            l.uid,
            l.action,
            l.status,
            l.note,
            l.timestamp,
            u.id   AS user_id,
            u.name,
            u.role
         FROM access_logs l
         LEFT JOIN users u ON l.user_id = u.id
         WHERE l.id = ?
         LIMIT 1`,
        [insertId]
    );

    return rows[0] || null;
}

/**
 * 📜 Oxirgi loglar (dashboard refresh uchun)
 */
async function getLogs(limit = 100) {
    const [rows] = await pool.query(
        `SELECT 
            l.id,
            l.uid,
            l.action,
            l.status,
            l.note,
            l.timestamp,
            u.name,
            u.role,
            b.blocked_at
         FROM access_logs l
         LEFT JOIN users u ON l.user_id = u.id
         LEFT JOIN blocked_uids b ON l.uid = b.uid
         ORDER BY l.timestamp DESC
         LIMIT ?`,
        [Number(limit)]
    );
    return rows;
}

/* ======================================================
   👥 INSIDE COUNT
====================================================== */

/**
 * 🔢 Hozir ichkarida nechta odam bor
 */
async function getInsideCount() {
    const [rows] = await pool.query(`
        SELECT 
          COALESCE(SUM(
            CASE
              WHEN action = 'entry' THEN 1
              WHEN action = 'exit' THEN -1
              ELSE 0
            END
          ), 0) AS inside
        FROM access_logs
        WHERE status = 'ok'
    `);

    return rows[0].inside;
}

/* ======================================================
   📊 STATS
====================================================== */

/**
 * 📊 Bugungi entry statistika (Chart.js uchun)
 */
async function getTodayEntryStats() {
    const [rows] = await pool.query(`
        SELECT 
          DATE_FORMAT(timestamp, '%H') AS hour,
          COUNT(*) AS cnt
        FROM access_logs
        WHERE status = 'ok'
          AND action = 'entry'
          AND DATE(timestamp) = CURDATE()
        GROUP BY hour
        ORDER BY hour
    `);

    const labels = [];
    const data = [];

    for (let h = 0; h < 24; h++) {
        const hh = h.toString().padStart(2, '0');
        labels.push(hh);
        const row = rows.find(r => r.hour === hh);
        data.push(row ? row.cnt : 0);
    }

    return { labels, data };
}

/**
 * 📊 Sana bo‘yicha entry statistika
 */
async function getEntryStatsByDate(date) {
    const [rows] = await pool.query(`
        SELECT 
          DATE_FORMAT(timestamp, '%H') AS hour,
          COUNT(*) AS cnt
        FROM access_logs
        WHERE status = 'ok'
          AND action = 'entry'
          AND DATE(timestamp) = ?
        GROUP BY hour
        ORDER BY hour
    `, [date]);

    const labels = [];
    const data = [];

    for (let h = 0; h < 24; h++) {
        const hh = h.toString().padStart(2, '0');
        labels.push(hh);
        const row = rows.find(r => r.hour === hh);
        data.push(row ? row.cnt : 0);
    }

    return { labels, data };
}

/* ======================================================
   🚫 BLOCKED UID (SECURITY)
====================================================== */

/**
 * 🔒 UID blocklanganmi?
 */
async function checkBlocked(uid) {
    const [rows] = await pool.query(
        `SELECT uid FROM blocked_uids WHERE uid = ? AND blocked_at IS NOT NULL`,
        [uid]
    );
    return rows.length > 0;
}

/**
 * ❗ Not registered urinishni oshirish
 */
async function incrementAttempt(uid) {
    await pool.query(`
        INSERT INTO blocked_uids (uid, attempts)
        VALUES (?, 1)
        ON DUPLICATE KEY UPDATE attempts = attempts + 1
    `, [uid]);

    const [rows] = await pool.query(
        `SELECT attempts FROM blocked_uids WHERE uid = ?`,
        [uid]
    );

    return rows[0]?.attempts || 1;
}

/**
 * ♻️ To‘g‘ri karta bo‘lsa reset
 */
async function resetAttempt(uid) {
    await pool.query(
        `DELETE FROM blocked_uids WHERE uid = ?`,
        [uid]
    );
}

/**
 * ⛔ UID ni block qilish — agar yo'q bo'lsa, yaratadi ham
 */
async function blockUid(uid) {
    console.log('🔍 blockUid chaqirildi, UID:', uid);
    try {
        // Avval `uid` mavjudligini tekshiramiz
        const [rows] = await pool.query(
            `SELECT uid FROM blocked_uids WHERE uid = ?`,
            [uid]
        );

        if (rows.length > 0) {
            // Mavjud bo'lsa — UPDATE qilamiz
            const [upd] = await pool.query(
                `UPDATE blocked_uids 
                 SET attempts = 5, blocked_at = NOW() 
                 WHERE uid = ?`,
                [uid]
            );
            console.log('✅ UPDATE qilindi:', upd.affectedRows);
        } else {
            // Mavjud bo'lmasa — INSERT qilamiz
            const [ins] = await pool.query(
                `INSERT INTO blocked_uids (uid, attempts, blocked_at) 
                 VALUES (?, 5, NOW())`,
                [uid]
            );
            console.log('✅ INSERT qilindi:', ins.affectedRows);
        }
    } catch (err) {
        console.error('❌ blockUid xatosi:', err);
        throw err;
    }
}


// Barcha bloklangan UIDlarni olish
async function getBlockedUids() {
    const [rows] = await pool.query(
        `SELECT uid, attempts, blocked_at FROM blocked_uids`
    );
    return rows;
}

// UIDni blokdan chiqarish (admin o'chirganda)
async function unblockUid(uid) {
    const [result] = await pool.query(
        `DELETE FROM blocked_uids WHERE uid = ?`,
        [uid]
    );
    return result.affectedRows > 0;
}
/* ======================================================
   📦 EXPORT
====================================================== */

module.exports = {
    findUserByUid,
    getLastAction,
    insertLog,
    getLogs,
    getInsideCount,
    getTodayEntryStats,
    getEntryStatsByDate,

    // 🔐 security
    checkBlocked,
    incrementAttempt,
    resetAttempt,
    blockUid,
    getBlockedUids,
    unblockUid
};
