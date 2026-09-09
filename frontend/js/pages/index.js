/**
 * index.html — logged-out landing page.
 * Renders a small "Top Contributors" leaderboard preview (top 5 by XP).
 */
import { API_BASE_URL } from '../config.js';
import { I18nModule } from '../modules/i18n.js?v=20260909e';

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

function avatarHtml(user) {
    if (user.avatar) {
        return `<img class="idx-leaderboard__avatar" src="${escapeHtml(user.avatar)}" alt="" loading="lazy">`;
    }
    const initial = (user.username || '?').charAt(0).toUpperCase();
    return `<div class="idx-leaderboard__avatar">${escapeHtml(initial)}</div>`;
}

async function loadLeaderboardPreview() {
    const list = document.getElementById('idx-leaderboard-list');
    if (!list) return;
    try {
        const res = await fetch(`${API_BASE_URL}/leaderboard?limit=5`);
        const data = await res.json();
        if (!data.success || !data.users || data.users.length === 0) {
            list.innerHTML = `<div class="idx-leaderboard__empty">${I18nModule.t('leaderboard_empty')}</div>`;
            return;
        }
        list.innerHTML = data.users.map(u => `
            <a class="idx-leaderboard__row" href="/user/${encodeURIComponent(u.username)}">
                <span class="idx-leaderboard__rank">${u.rank <= 3 ? ['🥇', '🥈', '🥉'][u.rank - 1] : '#' + u.rank}</span>
                ${avatarHtml(u)}
                <span class="idx-leaderboard__username">${escapeHtml(u.username)}</span>
                <span class="idx-leaderboard__xp">${u.xp.toLocaleString()} XP</span>
            </a>
        `).join('');
    } catch {
        list.innerHTML = `<div class="idx-leaderboard__empty">${I18nModule.t('leaderboard_error')}</div>`;
    }
}

loadLeaderboardPreview();
