import { state } from './state.js';
import { api } from './api.js';
import { ui, elements } from './ui.js';
import { sse } from './sse.js';
import { charts } from './charts.js';

/**
 * 🧩 Application Orchestrator
 */

let chartReady = false;

/* ---------------- DATA LOADERS ---------------- */

async function loadUsers() {
    elements.usersTbody.innerHTML = `<tr><td colspan="4" class="p-12 text-center text-slate-500 animate-pulse">Yuklanmoqda...</td></tr>`;

    try {
        const payload = await api.fetchUsers();
        const users = Array.isArray(payload) ? payload : (payload?.data || []);
        const filter = elements.roleFilter.value;
        const filtered = filter ? users.filter(u => u.role === filter) : users;

        ui.animateValue(elements.usersCount, 0, users.length, 500);
        elements.usersTbody.innerHTML = '';

        if (!filtered.length) {
            elements.usersTbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-slate-600 italic">Ma'lumot topilmadi</td></tr>`;
            return;
        }

        filtered.forEach((u, i) => {
            elements.usersTbody.appendChild(ui.renderUserRow(u, i, deleteUser));
        });

        lucide.createIcons();
    } catch {
        ui.showToast("Xatolik: Yuklab bo'lmadi", "error");
    }
}

async function loadChart() {
    try {
        const payload = await api.fetchTodayStats();
        charts.init('entryChart', payload);
        chartReady = true;
    } catch (e) {
        console.error('Initial chart error', e);
    }
}

async function loadLastLogs() {
    try {
        const payload = await api.fetchLogs(15);
        const logs = payload?.ok && Array.isArray(payload.data) ? payload.data : [];
        elements.logsContainer.innerHTML = '';
        logs.reverse().forEach(log => ui.appendLog(log, elements.logRoleFilter.value));
        recalculateDeniedCount();
    } catch (e) {
        console.error('Logs load error', e);
    }
}

async function loadInsideCount() {
    try {
        const payload = await api.fetchInsideCount();
        state.counts.inside = Number(payload?.inside) || 0;
        ui.animateValue(elements.insideCount, 0, state.counts.inside, 600);
    } catch (e) {
        console.error('Inside load error', e);
    }
}

async function loadBlockedUids() {
    try {
        const payload = await api.fetchBlocked();
        if (!payload?.data?.length) {
            elements.blockedList.innerHTML = '<p class="text-slate-500 text-sm italic">Bloklangan karta yo‘q</p>';
            return;
        }

        elements.blockedList.innerHTML = payload.data.map(b => `
            <div class="flex justify-between items-center p-3 bg-rose-500/10 rounded-lg border border-rose-500/20">
                <div>
                    <div class="font-mono text-sm text-rose-400">${b.uid}</div>
                    <div class="text-xs text-slate-400">${b.attempts} urinish</div>
                </div>
                <button class="btn-unblock text-slate-400 hover:text-white p-1" data-uid="${b.uid}">
                    <i data-lucide="unlock" class="w-4 h-4"></i>
                </button>
            </div>
        `).join('');

        lucide.createIcons();

        elements.blockedList.querySelectorAll('.btn-unblock').forEach(btn => {
            btn.addEventListener('click', () => unblockUid(btn.dataset.uid));
        });

        recalculateDeniedCount();
    } catch (e) {
        console.error('Blocked load error', e);
    }
}

/* ---------------- ACTIONS ---------------- */

async function addUser() {
    const data = {
        uid: elements.uidInp.value.trim(),
        name: elements.nameInp.value.trim(),
        role: elements.roleInp.value
    };

    if (!data.uid || !data.name || !data.role) {
        return ui.showToast("Barcha maydonlarni to'ldiring", "error");
    }

    try {
        const res = await api.addUser(data);
        if (res.ok) {
            ui.showToast("Foydalanuvchi qo'shildi");
            elements.uidInp.value = '';
            elements.nameInp.value = '';
            elements.roleInp.value = '';
            loadUsers();
        } else {
            const err = await res.json();
            ui.showToast(err?.error || "Xatolik yuz berdi", "error");
        }
    } catch {
        ui.showToast("Tarmoq xatosi", "error");
    }
}

async function deleteUser(id) {
    if (!confirm("O'chirmoqchimisiz?")) return;
    try {
        const res = await api.deleteUser(id);
        if (res.ok) {
            ui.showToast("O'chirildi");
            loadUsers();
        }
    } catch {
        ui.showToast("Xatolik", "error");
    }
}

async function unblockUid(uid) {
    if (!confirm(`"${uid}" blokini olib tashlamoqchimisiz?`)) return;
    try {
        const res = await api.unblockUid(uid);
        if (res.ok) {
            ui.showToast("Blok olib tashlandi");
            loadBlockedUids();
        }
    } catch {
        ui.showToast("Xatolik", "error");
    }
}

/* ---------------- HELPERS ---------------- */

async function recalculateDeniedCount() {
    try {
        const payload = await api.fetchLogs(200);
        const logs = payload?.ok && Array.isArray(payload.data) ? payload.data : [];

        const deniedCount = logs.filter(log =>
            log.status === 'denied' &&
            log.note.includes('card_not_registered') &&
            !log.note.includes('blocked') &&
            log.blocked_at == null
        ).length;

        const old = Number(elements.deniedCount.textContent) || 0;
        if (old !== deniedCount) ui.animateValue(elements.deniedCount, old, deniedCount, 300);
    } catch (e) {
        console.error('Denied recalc error', e);
    }
}

/* ---------------- INIT ---------------- */

window.addEventListener('DOMContentLoaded', async () => {

    await Promise.all([
        loadUsers(),
        loadLastLogs(),
        loadInsideCount(),
        loadBlockedUids(),
        loadChart()
    ]);

    sse.init(
        hour => chartReady && charts.update(hour),
        recalculateDeniedCount
    );

    document.getElementById('btn-add-user').addEventListener('click', addUser);
    document.getElementById('btn-refresh-users').addEventListener('click', loadUsers);

    document.getElementById('btn-clear-logs').addEventListener('click', () => {
        elements.logsContainer.innerHTML = '';
        elements.entriesCount.textContent = '0';
        elements.deniedCount.textContent = '0';
        elements.entriesBar.style.width = '0%';
    });

    document.getElementById('btn-test-scan').addEventListener('click', async () => {
        const uid = elements.testUidInp.value.trim();
        if (!uid) return ui.showToast("UID kiriting", "error");

        try {
            const res = await api.testScan(uid);
            if (res.ok) {
                ui.showToast("Skanerlandi");
                elements.testUidInp.value = '';
            } else {
                ui.showToast("Rad etildi", "error");
            }
        } catch {
            ui.showToast("API error", "error");
        }
    });

    document.getElementById('btn-reload-chart').addEventListener('click', async () => {
        const date = elements.selectedDate.value;
        if (!date) return;

        try {
            const payload = await api.fetchStatsByDate(date);
            charts.reload(payload);
        } catch {
            ui.showToast("Sana bo'yicha yuklab bo'lmadi", "error");
        }
    });

    elements.roleFilter.addEventListener('change', loadUsers);

    lucide.createIcons();
});
