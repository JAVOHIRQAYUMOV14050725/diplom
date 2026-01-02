// src/services/rfid.service.js

const repo = require('../repositories/rfid.repository');
const sse = require('./sse.service');

const DUPLICATE_INTERVAL_MS = 3000;
const MAX_ATTEMPTS = 5;

/**
 * 📡 RFID karta skan qilish (IDEAL LOGIC)
 */
async function handleScan(uid) {

    /* ======================================================
       🔒 1. ALLAQACHON BLOCKLANGAN UID
       → faqat informational (LOG YO‘Q)
    ====================================================== */
    const isBlocked = await repo.checkBlocked(uid);
    if (isBlocked) {
        return {
            ok: false,
            error: 'uid_blocked',
            status: 403
        };
    }

    /* ======================================================
       👤 2. USER TOPISH
    ====================================================== */
    const user = await repo.findUserByUid(uid);

    /* ======================================================
       ⛔ 3. NOT REGISTERED CARD (IDEAL MODEL)
    ====================================================== */
    if (!user) {
        const attempts = await repo.incrementAttempt(uid);

        // ❗ 1–4: faqat sanaymiz, LOG YO‘Q
        if (attempts < MAX_ATTEMPTS) {
            return {
                ok: false,
                error: 'card_not_registered',
                status: 403,
                attempts
            };
        }

        // 🔒 5-urinish: BLOCK + 1 TA LOG
        if (attempts === MAX_ATTEMPTS) {
            await repo.blockUid(uid);

            const inserted = await repo.insertLog({
                uid,
                userId: null,
                action: null,
                status: 'denied',
                note: 'card_not_registered_blocked'
            });

            // 🔥 ADMIN GA SIGNAL
            sse.pushEvent('denied', { row: inserted });

            return {
                ok: false,
                error: 'card_blocked',
                status: 403
            };
        }

        // 🔕 6+ urinish: jim (LOG YO‘Q)
        return {
            ok: false,
            error: 'uid_blocked',
            status: 403
        };
    }

    /* ======================================================
       ♻️ 4. REGISTERED → ATTEMPTS RESET
    ====================================================== */
    await repo.resetAttempt(uid);

    /* ======================================================
       🔄 5. LAST ACTION & NEXT ACTION
    ====================================================== */
    const last = await repo.getLastAction(uid);
    const nextAction =
        last && last.action === 'entry'
            ? 'exit'
            : 'entry';

    /* ======================================================
       🔁 6. DUPLICATE GUARD (LOG BOR)
    ====================================================== */
    if (last?.timestamp) {
        const lastTs = new Date(last.timestamp).getTime();
        const diff = Date.now() - lastTs;

        if (diff < DUPLICATE_INTERVAL_MS) {
            const inserted = await repo.insertLog({
                uid,
                userId: user.id,
                action: null,
                status: 'denied',
                note: `duplicate_${nextAction}`
            });

            sse.pushEvent('denied', { row: inserted });

            return {
                ok: false,
                error: `duplicate_${nextAction}`,
                status: 429
            };
        }
    }

    /* ======================================================
       ✅ 7. NORMAL ENTRY / EXIT
    ====================================================== */
    const inserted = await repo.insertLog({
        uid,
        userId: user.id,
        action: nextAction,
        status: 'ok',
        note: user.name
    });

    // 🔥 FRONTEND LOG
    sse.pushEvent('log', { row: inserted });

    /* ======================================================
       👥 8. INSIDE COUNT (REALTIME)
    ====================================================== */
    sse.pushEvent('inside', {
        delta: nextAction === 'entry' ? 1 : -1
    });

    /* ======================================================
       📊 9. REALTIME CHART (ENTRY ONLY)
    ====================================================== */
    if (nextAction === 'entry') {
        const hour = new Date().getHours();
        sse.pushEvent('chart-entry', { hour });
    }

    return {
        ok: true,
        data: inserted
    };
}

module.exports = { handleScan };
