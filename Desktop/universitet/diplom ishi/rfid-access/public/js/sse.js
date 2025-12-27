import { state, config } from './state.js';
import { ui, elements } from './ui.js';

/**
 * ⚡ Production-ready SSE Manager
 */
export const sse = {

    init(onChartUpdate, onRecalculateDenied) {
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

        source.addEventListener('log', safe('LOG', ({ row }) => {
            ui.appendLog(row, elements.logRoleFilter.value);
        }));

        source.addEventListener('inside', safe('INSIDE', ({ delta }) => {
            const old = state.counts.inside;
            state.counts.inside += Number(delta || 0);
            ui.animateValue(elements.insideCount, old, state.counts.inside, 300);
        }));

        source.addEventListener('denied', safe('DENIED', ({ row }) => {
            row.status = 'denied';
            ui.appendLog(row, elements.logRoleFilter.value);
            ui.showToast(`OGOHLANTIRISH: Notanish karta! UID: ${row.uid}`, "error");
            onRecalculateDenied();
        }));

        source.addEventListener('chart-entry', safe('CHART', ({ hour }) => {
            console.log('📊 Chart update triggered:', hour);
            onChartUpdate(hour);
        }));

        source.onerror = () => {
            console.warn('⚠️ SSE connection lost. Reconnecting...');
            this.cleanup();
            setTimeout(() => this.init(onChartUpdate, onRecalculateDenied), 3000);
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
