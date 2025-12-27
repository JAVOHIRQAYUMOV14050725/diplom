import { state } from './state.js';

/**
 * 📊 Charting logic
 * Single Source of Truth = state
 * Optimized for real-time updates
 */
export const charts = {

    /**
     * 🧱 Initialize chart with API payload
     */
    init(canvasId, payload) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !payload) return;

        const ctx = canvas.getContext('2d');

        // 🧹 Destroy old chart if exists
        if (state.chart.instance) {
            state.chart.instance.destroy();
            state.chart.instance = null;
        }

        // 🧠 Normalize & bind to state
        state.chart.labels = [...payload.labels];
        state.chart.data = [...payload.data];

        // 🧬 Create new chart with clean references
        state.chart.instance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [...state.chart.labels],
                datasets: [{
                    label: 'Kirishlar',
                    data: [...state.chart.data],
                    tension: 0.4,
                    fill: true,
                    borderColor: '#34d399',
                    backgroundColor: 'rgba(52,211,153,0.15)',
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#34d399'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false, // ⚡ real-time
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: '#94a3b8',
                            font: { size: 10 }
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: {
                            color: '#94a3b8',
                            font: { size: 10 },
                            precision: 0
                        }
                    }
                }
            }
        });
    },

    /**
     * ⚡ Real-time update (SSE event)
     */
    update(hour) {
        const chart = state.chart.instance;
        if (!chart) return;

        const h = Number(hour);
        if (!Number.isInteger(h) || h < 0 || h > 23) return;

        // 🧠 Update both state & chart dataset safely
        state.chart.data[h] = (state.chart.data[h] || 0) + 1;

        const dataset = chart.data.datasets[0].data;
        dataset[h] = state.chart.data[h];

        chart.update('none'); // no animation, instant
    },

    /**
     * 🔄 Reload chart completely (date change, refresh)
     */
    reload(payload) {
        const chart = state.chart.instance;
        if (!chart || !payload) return;

        state.chart.labels = [...payload.labels];
        state.chart.data = [...payload.data];

        chart.data.labels = [...state.chart.labels];
        chart.data.datasets[0].data = [...state.chart.data];

        chart.update();
    }
};
