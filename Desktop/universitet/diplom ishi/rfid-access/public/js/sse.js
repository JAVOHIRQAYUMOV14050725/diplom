import { state, config } from './state.js';
import { ui, elements } from './ui.js';

/**
 * ⚡ Production-ready SSE Manager
 */
export const sse = {

    init(onChartUpdate, onRecalculateDenied, onBlockedChange) {
        this.cleanup();

        console.info('🔌 Connecting SSE...');

        const source = new EventSource(`${config.RFID_API}/stream`);
        state.sse = source;

        // 🧠 Generic safe handler wrapper
        const safe = (label, fn) => e => {
            try {
                console.log(`📡 SSE ${label}:`, e.data);
                fn(JSON.parse(e.data));
            } catch (err) {
                console.error(`❌ SSE ${label} error`, err);
            }
        };

        /* ---------------- LOG ---------------- */
        source.addEventListener('log', safe('LOG', ({ row }) => {
            ui.appendLog(row, elements.logRoleFilter.value);

            // 🔥 FAQAT BUGUNGI ENTRY BO‘LSA HISOBLAYMIZ
            if (row.status === 'ok' && row.action === 'entry') {
                const old = Number(elements.entriesCount.textContent) || 0;
                const next = old + 1;

                ui.animateValue(elements.entriesCount, old, next, 300);

                // progress bar (vizual)
                const percent = Math.min(100, next * 5);
                elements.entriesBar.style.width = `${percent}%`;
            }
        }));

        /* ---------------- INSIDE COUNT ---------------- */
        source.addEventListener('inside', safe('INSIDE', ({ delta }) => {
            const old = state.counts.inside;
            state.counts.inside += Number(delta || 0);
            ui.animateValue(elements.insideCount, old, state.counts.inside, 300);
        }));

        /* ---------------- DENIED / BLOCKED ---------------- */
        source.addEventListener('denied', safe('DENIED', ({ row }) => {
            ui.appendLog(row, elements.logRoleFilter.value);

            const isBlocked =
                row.note === 'card_not_registered_blocked' ||
                row.note === 'uid_blocked';

            if (isBlocked) {
                ui.showToast(`⛔ UID bloklandi: ${row.uid}`, 'error');

                // 🔥 BLOKLANGANLAR RO‘YXATINI YANGILASH
                onBlockedChange?.();
            } else {
                ui.showToast(`⚠️ Notanish karta! UID: ${row.uid}`, 'error');
            }

            // 🔢 DENIED COUNTER
            onRecalculateDenied?.();
        }));

        /* ---------------- CHART ---------------- */
        source.addEventListener('chart-entry', safe('CHART', ({ hour }) => {
            onChartUpdate?.(hour);
        }));

        /* ---------------- RECONNECT ---------------- */
        source.onerror = () => {
            console.warn('⚠️ SSE connection lost. Reconnecting...');
            this.cleanup();
            setTimeout(() => {
                this.init(onChartUpdate, onRecalculateDenied, onBlockedChange);
            }, 3000);
        };
    },

    cleanup() {
        if (state.sse) {
            console.info('🧹 Closing SSE connection');
            state.sse.close();
            state.sse = null;
        }
    }
};
