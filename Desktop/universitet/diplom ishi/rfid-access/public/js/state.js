/**
 * Global State Management
 * Single source of truth for dashboard data
 */
export const state = {
    counts: {
        users: 0,
        entries: 0,
        inside: 0,
        denied: 0
    },
    chart: {
        instance: null,
        data: new Array(24).fill(0)
    },
    logs: [],
    sse: null
};

export const config = {
    API_BASE: '/api',
    RFID_API: '/api/rfid',
    ROLE_STYLES: {
        admin: 'border-rose-500/30 text-rose-400 bg-rose-500/10',
        teacher: 'border-blue-500/30 text-blue-400 bg-blue-500/10',
        student: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10',
        staff: 'border-cyan-500/30 text-cyan-400 bg-cyan-500/10',
    }
};