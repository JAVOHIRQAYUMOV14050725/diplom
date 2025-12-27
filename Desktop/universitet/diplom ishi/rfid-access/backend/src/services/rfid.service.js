// src/services/rfid.service.js

const repo = require('../repositories/rfid.repository');
const sse = require('./sse.service');

const DUPLICATE_INTERVAL_MS = 3000;
const MAX_ATTEMPTS = 5;

/**
 * 📡 RFID karta skan qilish
 */
async function handleScan(uid) {

    /* ======================================================
       🔒 1. BLOCKED UID
    ====================================================== */
    const isBlocked = await repo.checkBlocked(uid);
    if (isBlocked) {
        const inserted = await repo.insertLog({
            uid,
            userId: null,
            action: null,
            status: 'denied',
            note: 'uid_blocked'
        });

        sse.pushEvent('denied', { row: inserted });
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
       ⛔ 3. NOT REGISTERED CARD
    ====================================================== */
    if (!user) {
        console.log('🔍 NOT REGISTERED UID:', JSON.stringify(uid)); // ✅ DEBUG

        const attempts = await repo.incrementAttempt(uid);
        console.log('🔢 attempts:', attempts, 'for UID:', uid); // ✅ DEBUG

        if (attempts >= MAX_ATTEMPTS) {
            console.log('🔒 Bloklash bajarilmoqda...');

            await repo.blockUid(uid);
        }

        const inserted = await repo.insertLog({
            uid,
            userId: null,
            action: null,
            status: 'denied',
            note: attempts >= MAX_ATTEMPTS
                ? 'card_not_registered_blocked'
                : 'card_not_registered'
        });

        

        sse.pushEvent('denied', { row: inserted });

        return {
            ok: false,
            error: 'card_not_registered',
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
       🔁 6. DUPLICATE GUARD
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

    // 🔥 ASOSIY MUHIM QATOR (frontend log event)
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
