import { config } from './state.js';

/**
 * Handles all network requests
 */
export const api = {
    async fetchUsers() {
        const response = await fetch(`${config.API_BASE}/users`);
        return response.json();
    },

    async addUser(userData) {
        const response = await fetch(`${config.API_BASE}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData)
        });
        return response;
    },

    async deleteUser(id) {
        return fetch(`${config.API_BASE}/users/${id}`, { method: 'DELETE' });
    },

    async fetchLogs(limit = 15) {
        const response = await fetch(`${config.RFID_API}/logs?limit=${limit}`);
        return response.json();
    },

    async fetchInsideCount() {
        const response = await fetch(`${config.RFID_API}/inside`);
        return response.json();
    },

    async fetchTodayStats() {
        const response = await fetch(`${config.RFID_API}/stats/today`);
        return response.json();
    },

    async fetchStatsByDate(date) {
        const response = await fetch(`${config.RFID_API}/stats/by-date?date=${date}`);
        return response.json();
    },

    async fetchBlocked() {
        const response = await fetch(`${config.RFID_API}/blocked`);
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`fetchBlocked failed: ${text}`);
        }
        return response.json();
    },

async unblockUid(uid) {
        return fetch(`${config.RFID_API}/blocked/${uid}`, {
            method: 'DELETE'
        });
    },


    async testScan(uid) {
        const res = await fetch(`${config.RFID_API}`, { // 👈 /api/rfid
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid })
        });

        if (!res.ok) throw new Error('Scan failed');
        return res.json();
    }

};