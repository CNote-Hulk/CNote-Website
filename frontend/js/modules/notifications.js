import { API_BASE_URL } from '../config.js';
import { AuthModule } from './auth.js?v=20261005';

let _open = false;
let _dropdown = null;
let _badge = null;
let _btn = null;
let _pollTimer = null;
let _unreadCount = 0;

export const NotificationsModule = {
    init() {
        if (!AuthModule.getCurrentUser()) return;

        _btn   = document.getElementById('navbar-notifications-btn');
        _badge = document.getElementById('navbar-notif-badge');
        if (!_btn) return;

        _btn.style.display = 'flex';
        _btn.addEventListener('click', (e) => { e.stopPropagation(); this._toggle(); });
        document.addEventListener('click', (e) => {
            if (_open && _dropdown && !_dropdown.contains(e.target) && e.target !== _btn) this._close();
        });

        this._pollCount();
        _pollTimer = setInterval(() => this._pollCount(), 60_000);

        // Live notifications via socket.io
        const waitForSocket = setInterval(() => {
            if (!window._cnNotifSocket && window.io) {
                window._cnNotifSocket = true;
                // Re-use the existing socket connection if available
                const onNotif = () => { _unreadCount++; this._setBadge(_unreadCount); };
                document.addEventListener('cn:socket-notification', onNotif);
            }
            if (window._cnNotifSocket) clearInterval(waitForSocket);
        }, 500);
    },

    async _pollCount() {
        try {
            const token = localStorage.getItem('cn_token');
            if (!token) return;
            const res = await fetch(`${API_BASE_URL}/notifications/unread-count`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!res.ok) return;
            const data = await res.json();
            _unreadCount = data.count || 0;
            this._setBadge(_unreadCount);
        } catch { /* network error */ }
    },

    _setBadge(count) {
        if (!_badge) return;
        if (count > 0) {
            _badge.textContent = count > 99 ? '99+' : String(count);
            _badge.style.display = 'flex';
        } else {
            _badge.style.display = 'none';
        }
    },

    async _toggle() {
        if (_open) { this._close(); return; }
        this._show();
    },

    async _show() {
        _open = true;
        _btn.classList.add('active');

        if (_dropdown) _dropdown.remove();
        _dropdown = document.createElement('div');
        _dropdown.className = 'notif-dropdown';
        _dropdown.innerHTML = `
            <div class="notif-dropdown__header">
                <span class="notif-dropdown__title">Notifications</span>
                <button class="notif-dropdown__read-all" id="notif-read-all-btn">Mark all read</button>
            </div>
            <div class="notif-dropdown__list" id="notif-list">
                <div class="notif-dropdown__loading">Loading…</div>
            </div>
        `;

        _btn.parentElement.style.position = 'relative';
        _btn.parentElement.appendChild(_dropdown);
        requestAnimationFrame(() => _dropdown.classList.add('notif-dropdown--open'));

        document.getElementById('notif-read-all-btn').addEventListener('click', () => this._markAllRead());

        await this._loadNotifications();
    },

    _close() {
        _open = false;
        if (_btn) _btn.classList.remove('active');
        if (_dropdown) {
            _dropdown.classList.remove('notif-dropdown--open');
            setTimeout(() => { if (_dropdown) { _dropdown.remove(); _dropdown = null; } }, 200);
        }
    },

    async _loadNotifications() {
        const list = document.getElementById('notif-list');
        if (!list) return;

        try {
            const token = localStorage.getItem('cn_token');
            const res = await fetch(`${API_BASE_URL}/notifications`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!res.ok) throw new Error();
            const data = await res.json();
            const notifs = data.notifications || [];

            if (!notifs.length) {
                list.innerHTML = '<div class="notif-dropdown__empty">No notifications yet.</div>';
                return;
            }

            list.innerHTML = '';
            notifs.forEach(n => {
                const item = document.createElement('a');
                item.className = 'notif-item' + (n.read ? '' : ' notif-item--unread');
                const resolvedLink = this._resolveLink(n.link, n.type);
                const hasLink = !!resolvedLink;
                item.href = hasLink ? resolvedLink : '#';
                item.addEventListener('click', (e) => {
                    if (!hasLink) e.preventDefault();
                    if (!n.read) this._markRead(n.id, item);
                    this._close();
                });
                item.innerHTML = `
                    <div class="notif-item__dot"></div>
                    <div class="notif-item__body">
                        <div class="notif-item__msg">${this._esc(n.message)}</div>
                        <div class="notif-item__time">${this._timeAgo(n.created_at)}</div>
                    </div>
                `;
                list.appendChild(item);
            });
        } catch {
            list.innerHTML = '<div class="notif-dropdown__empty">Could not load notifications.</div>';
        }
    },

    async _markRead(id, itemEl) {
        try {
            const token = localStorage.getItem('cn_token');
            await fetch(`${API_BASE_URL}/notifications/${id}/read`, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token }
            });
            itemEl.classList.remove('notif-item--unread');
            _unreadCount = Math.max(0, _unreadCount - 1);
            this._setBadge(_unreadCount);
        } catch { /* ignore */ }
    },

    _resolveLink(link, type) {
        if (!link || link.trim() === '' || link === '#') {
            // Old notifications with no link — infer from type
            if (type === 'friend_request' || type === 'friend_accepted') return '/html/pages/home.html#friends';
            if (type === 'new_dm') return '/html/pages/community.html#dm';
            return null;
        }
        // Remap stale links stored in DB before the fix
        if (link.includes('profil.html?view=friends') || link.includes('profil.html') && link.includes('friends')) {
            return '/html/pages/home.html#friends';
        }
        return link;
    },

    async _markAllRead() {
        try {
            const token = localStorage.getItem('cn_token');
            await fetch(`${API_BASE_URL}/notifications/read-all`, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token }
            });
            _unreadCount = 0;
            this._setBadge(0);
            document.querySelectorAll('.notif-item--unread').forEach(el => el.classList.remove('notif-item--unread'));
        } catch { /* ignore */ }
    },

    _esc(str) {
        return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    _timeAgo(dateStr) {
        const seconds = Math.floor((Date.now() - new Date(dateStr)) / 1000);
        if (seconds < 60) return 'just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.floor(hours / 24)}d ago`;
    }
};
