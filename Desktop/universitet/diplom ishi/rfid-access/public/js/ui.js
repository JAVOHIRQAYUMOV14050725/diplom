import { config } from './state.js';

/**
 * Cached DOM elements for performance
 */
export const elements = {
    usersCount: document.getElementById('stat-users-count'),
    entriesCount: document.getElementById('stat-entries-count'),
    insideCount: document.getElementById('stat-inside-count'),
    deniedCount: document.getElementById('stat-denied-count'),
    entriesBar: document.getElementById('entries-bar'),
    usersTbody: document.getElementById('users-tbody'),
    logsContainer: document.getElementById('logs-container'),
    blockedList: document.getElementById('blocked-list'),
    toastContainer: document.getElementById('toast-container'),
    roleFilter: document.getElementById('roleFilter'),
    logRoleFilter: document.getElementById('logRoleFilter'),
    selectedDate: document.getElementById('selectedDate'),
    // Form fields
    uidInp: document.getElementById('uid'),
    nameInp: document.getElementById('name'),
    roleInp: document.getElementById('role'),
    testUidInp: document.getElementById('testUid')
};

/**
 * UI Manipulation logic
 */
export const ui = {
    showToast(message, type = "success") {
        const toast = document.createElement('div');
        const bgColor = type === "success" ? "bg-emerald-500" : "bg-rose-500";

        toast.className = `${bgColor} text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-fade-in pointer-events-auto min-w-[300px] mb-2`;
        toast.innerHTML = `
            <i data-lucide="${type === 'success' ? 'check-circle' : 'alert-circle'}" class="w-5 h-5"></i>
            <span class="font-medium">${message}</span>
        `;

        elements.toastContainer.appendChild(toast);
        lucide.createIcons();

        setTimeout(() => {
            toast.classList.add('opacity-0', 'translate-x-full', 'transition-all', 'duration-500');
            setTimeout(() => toast.remove(), 500);
        }, 3000);
    },

    animateValue(element, start, end, duration) {
        if (!element) return;
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            element.innerText = Math.floor(progress * (end - start) + start);
            if (progress < 1) window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
    },

    appendLog(log, filter = '') {
        const data = log.row || log;
        if (filter && data.role !== filter) return;

        const time = new Date().toLocaleTimeString('uz-UZ', { hour12: false });
        const isDenied = data.status === 'denied';
        const isExit = data.action === 'exit';

        const logDiv = document.createElement('div');
        const statusClass = isDenied
            ? 'border-rose-500 bg-rose-500/5'
            : isExit
                ? 'border-blue-500 bg-blue-500/5'
                : 'border-emerald-500 bg-emerald-500/5';

        logDiv.className = `p-3 rounded-xl border-l-4 ${statusClass} animate-fade-in`;
        logDiv.innerHTML = `
            <div class="flex justify-between items-start">
                <div class="flex items-center gap-3">
                    <i data-lucide="${isDenied ? 'shield-alert' : isExit ? 'log-out' : 'log-in'}" 
                        class="w-4 h-4 ${isDenied ? 'text-rose-400' : isExit ? 'text-blue-400' : 'text-emerald-400'}"></i>
                    <div>
                        <h4 class="text-sm font-semibold text-slate-200">
                            ${data.name || 'Notanish'}
                            ${!isDenied ? `<span class="ml-2 text-[10px] font-bold ${isExit ? 'text-blue-400' : 'text-emerald-400'}">${isExit ? 'CHIQDI' : 'KIRDI'}</span>` : ''}
                        </h4>
                        <p class="text-[10px] text-slate-500 font-mono">UID: ${data.uid || 'noma\'lum'}</p>
                    </div>
                </div>
                <span class="text-[10px] text-slate-400">${time}</span>
            </div>
        `;

        elements.logsContainer.prepend(logDiv);
        lucide.createIcons();
        if (elements.logsContainer.children.length > 30) elements.logsContainer.lastElementChild.remove();
    },

    renderUserRow(u, i, onDelete) {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-white/5 transition-colors group opacity-0";
        tr.style.animation = `fadeIn 0.4s ease-out forwards ${i * 0.05}s`;

        const roleStyle = config.ROLE_STYLES[u.role] || 'border-slate-500 text-slate-400';

        tr.innerHTML = `
            <td class="px-6 py-4 font-mono text-xs text-slate-400 group-hover:text-white">
                <span class="bg-white/5 px-2 py-1 rounded border border-white/10">${u.uid}</span>
            </td>
            <td class="px-6 py-4 font-medium text-slate-200">${u.name || 'Noma\'lum'}</td>
            <td class="px-6 py-4">
                <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${roleStyle}">
                    ${u.role || 'GUEST'}
                </span>
            </td>
            <td class="px-6 py-4 text-right">
                <button class="btn-delete text-slate-500 hover:text-rose-500 p-2 rounded-lg group-hover:opacity-100 transition-all">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </td>
        `;

        tr.querySelector('.btn-delete').addEventListener('click', () => onDelete(u.id));
        return tr;
    }
};