const repo = require('../repositories/rfid.repository');
const sse = require('./sse.service');

const DUPLICATE_INTERVAL_MS = 3000;

async function handleScan(uid) {
    const user = await repo.findUserByUid(uid);

    // ⛔ NOT REGISTERED
    if (!user) {
        const inserted = await repo.insertLog({
            uid,
            userId: null,
            action: null,
            status: 'denied',
            note: 'Card not registered'
        });

        sse.pushEvent('denied', inserted);

        return { ok: false, error: 'card_not_registered', status: 403 };
    }

    const last = await repo.getLastAction(uid);
    const nextAction = last && last.action === 'entry' ? 'exit' : 'entry';

    // duplicate guard
    if (last?.timestamp) {
        const lastTs = new Date(last.timestamp).getTime();
        if (Date.now() - lastTs < DUPLICATE_INTERVAL_MS) {
            const inserted = await repo.insertLog({
                uid,
                userId: user.id,
                action: null,
                status: 'denied',
                note: `duplicate_${nextAction}`
            });

            sse.pushEvent('denied', inserted);

            return { ok: false, error: `duplicate_${nextAction}`, status: 429 };
        }
    }

    // ✅ NORMAL ENTRY / EXIT
    const inserted = await repo.insertLog({
        uid,
        userId: user.id,
        action: nextAction,
        status: 'ok',
        note: user.name
    });

    sse.pushEvent('log', inserted);

    return { ok: true, data: inserted };
}

module.exports = { handleScan };
