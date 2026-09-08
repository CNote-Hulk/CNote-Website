/**
 * Leaderboard page — fetches and renders the public XP ranking.
 */
import { AuthModule } from '../modules/auth.js';
import { I18nModule } from '../modules/i18n.js?v=20260909';

const PAGE_SIZE = 50;

const listEl = document.getElementById('lb-list');
const loadingEl = document.getElementById('lb-loading');
const emptyEl = document.getElementById('lb-empty');
const loadMoreBtn = document.getElementById('lb-load-more');
const youEl = document.getElementById('lb-you');
const youRankEl = document.getElementById('lb-you-rank');
const youXpEl = document.getElementById('lb-you-xp');

let offset = 0;
let total = 0;

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

function avatarHtml(user) {
    if (user.avatar) {
        return `<img class="lb-row__avatar" src="${escapeHtml(user.avatar)}" alt="" loading="lazy">`;
    }
    const initial = (user.username || '?').charAt(0).toUpperCase();
    return `<div class="lb-row__avatar">${escapeHtml(initial)}</div>`;
}

function renderRow(user) {
    const row = document.createElement('a');
    row.href = `/user/${encodeURIComponent(user.username)}`;
    row.className = 'lb-row' + (user.rank <= 3 ? ' lb-row--top3' : '');
    const levelName = I18nModule.t('level_name_' + user.level.level) || user.level.name;
    row.innerHTML = `
        <span class="lb-row__rank">${user.rank <= 3 ? ['🥇', '🥈', '🥉'][user.rank - 1] : '#' + user.rank}</span>
        ${avatarHtml(user)}
        <span class="lb-row__body">
            <span class="lb-row__username">${escapeHtml(user.username)}</span>
            <span class="level-badge level-${user.level.level}">${user.level.emoji} ${escapeHtml(levelName)}</span>
        </span>
        <span class="lb-row__xp">${user.xp.toLocaleString()} XP</span>
    `;
    return row;
}

async function loadPage() {
    loadingEl.hidden = false;
    loadMoreBtn.hidden = true;
    try {
        const res = await AuthModule._api('GET', `/leaderboard?limit=${PAGE_SIZE}&offset=${offset}`);
        if (!res.success) throw new Error(res.error || 'failed');

        if (offset === 0 && res.users.length === 0) {
            emptyEl.hidden = false;
            loadingEl.hidden = true;
            return;
        }

        for (const user of res.users) {
            listEl.appendChild(renderRow(user));
        }

        total = res.total;
        offset += res.users.length;

        if (res.you) {
            youEl.hidden = false;
            youRankEl.textContent = '#' + res.you.rank;
            youXpEl.textContent = `${res.you.xp.toLocaleString()} XP`;
        }

        loadMoreBtn.hidden = offset >= total;
    } catch {
        listEl.innerHTML = '';
        emptyEl.hidden = false;
        emptyEl.textContent = I18nModule.t('leaderboard_error') || 'Could not load the leaderboard.';
    } finally {
        loadingEl.hidden = true;
    }
}

loadMoreBtn.addEventListener('click', loadPage);
loadPage();
