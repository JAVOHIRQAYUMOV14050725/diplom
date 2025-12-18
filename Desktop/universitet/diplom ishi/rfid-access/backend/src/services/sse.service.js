let clients = new Map(); // key: id, value: { res, interval }

function addClient(id, res) {
    // store response (controller already set headers)
    // add periodic ping to keep connection alive (every 25s)
    const interval = setInterval(() => {
        try {
            res.write(`:\n\n`); // comment ping (SSE)
        } catch (e) {
            // ignore write errors; controller will handle close
        }
    }, 25000);

    clients.set(id, { res, interval });
}

function removeClient(id) {
    const client = clients.get(id);
    if (!client) return;
    clearInterval(client.interval);
    try { client.res.end(); } catch (e) { }
    clients.delete(id);
}

function pushEvent(type, row) {
    // 'row' must be object; frontend expects JSON.parse(e.data) -> { row }
    for (const { res } of clients.values()) {
        try {
            res.write(
                `event: ${type}\n` +
                `data: ${JSON.stringify({ row })}\n\n`
            );
        } catch (e) {
            // ignore per-client write errors
        }
    }
}

module.exports = { addClient, removeClient, pushEvent };