/**
 * Community → Retro Gaming (2026-11-27): the game nights from CNote Live / ArmSX2, inside the hub.
 *   live — sessions playing right now (GET /api/play/live), each opening its scoreboard (play.html?s=)
 *   hall — Hall of Fame per game, from every session (GET /api/play/hall)
 *   mine — my sessions + linking the emulator (play.html)
 * Talking happens on the Discord server, not here (Andrei: no retro chat on the site).
 */
import { AuthModule } from './auth.js?v=20261005';

/** Set when the Discord server exists; the sidebar link stays hidden while empty. */
export const RETRO_DISCORD_URL = '';

const REFRESH_MS = 10000;
let timer = 0;

function esc(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

const medal = (i) => (i < 3 ? ['🥇', '🥈', '🥉'][i] : '#' + (i + 1));
const play = (slug) => `play.html?s=${encodeURIComponent(slug)}`;

/** The game's own save icon (rendered by the emulator from the game's files), first frame. */
function icon(serial) {
    if (!serial) return '<span class="rh-icon rh-icon--none">🎮</span>';
    return `<span class="rh-icon" data-serial="${esc(serial)}"></span>`;
}

async function fillIcons(root) {
    for (const el of root.querySelectorAll('.rh-icon[data-serial]')) {
        const serial = el.dataset.serial;
        try {
            const res = await fetch(`/api/play/icon/${encodeURIComponent(serial)}`);
            if (!res.ok) throw new Error('none');
            const frames = Math.max(1, parseInt(res.headers.get('X-Frames') || '1', 10));
            el.style.backgroundImage = `url(${URL.createObjectURL(await res.blob())})`;
            el.style.backgroundSize = `${frames * 100}% 100%`;
        } catch {
            el.classList.add('rh-icon--none');
            el.textContent = '🎮';
        }
    }
}

function bar(h) {
    return `<span class="rh-bar"><i style="width:${h == null ? 100 : Math.round(h * 100)}%"></i></span>`;
}

async function renderLive(root) {
    const res = await AuthModule._api('GET', '/play/live');
    const list = (res && res.sessions) || [];
    root.querySelector('.rh-body').innerHTML = list.length ? list.map((s) => {
        const f = s.fight;
        const fight = f && (f.h1 != null || f.h2 != null)
            ? `<div class="rh-fight"><b>${esc(s.p1_name || 'P1')}</b>${bar(f.h1)}<em>VS</em>${bar(f.h2)}<b>${esc(s.p2_name || 'P2')}</b></div>`
            : `<div class="rh-vs">${esc(s.p1_name || 'P1')} <em>vs</em> ${esc(s.p2_name || '—')}</div>`;
        return `<a class="rh-card" href="${play(s.slug)}">
            ${icon(s.serial)}
            <span class="rh-card__body">
                <span class="rh-card__title">${esc(s.title)}</span>
                <span class="rh-card__meta">${s.playing ? '<span class="rh-dot"></span> LIVE' : 'recent'} · ${esc(s.host)} · ${s.events} meciuri</span>
                ${s.presence ? `<span class="rh-card__presence">${esc(s.presence)}</span>` : ''}
                ${fight}
            </span>
        </a>`;
    }).join('') : '<p class="rh-empty">Nimeni nu joacă acum. Pornește un joc în ArmSX2 cu CNote Live și apari aici.</p>';
    fillIcons(root);
}

function board(title, list, fmt) {
    if (!list || !list.length) return '';
    return `<div class="rh-board"><h4>${title}</h4><ol>${list.map((r, i) => `<li><span>${medal(i)}</span><b>${esc(r.name)}</b><span>${fmt(r)}</span></li>`).join('')}</ol></div>`;
}

async function renderHall(root) {
    const res = await AuthModule._api('GET', '/play/hall');
    const games = (res && res.games) || [];
    root.querySelector('.rh-body').innerHTML = games.length ? games.map((g) => `
        <section class="rh-game">
            <header class="rh-game__head">${icon(g.serial)}<span><span class="rh-card__title">${esc(g.game)}</span><span class="rh-card__meta">${g.matches} rezultate</span></span></header>
            <div class="rh-boards">
                ${board('🏆 Arcade', g.arcade, (r) => (r.cleared ? 'terminat' : `lupta ${r.reached}/8`) + (r.char ? ` · ${esc(r.char)}` : ''))}
                ${board('⚔️ Versus', g.versus, (r) => `${r.wins}V ${r.losses}Î`)}
                ${board('🎮 Curse', g.races, (r) => `${r.wins}V ${r.losses}Î`)}
                ${board('🕹️ Contra CPU', g.vs_cpu, (r) => `${r.wins}V ${r.losses}Î`)}
            </div>
        </section>`).join('') : '<p class="rh-empty">Hall of Fame se umple după primele meciuri.</p>';
    fillIcons(root);
}

async function renderMine(root) {
    const body = root.querySelector('.rh-body');
    if (!AuthModule.isLoggedIn()) {
        body.innerHTML = '<p class="rh-empty">Intră în cont ca să-ți vezi sesiunile și să legi emulatorul.</p><a class="rh-btn" href="login.html">Log in</a>';
        return;
    }
    const res = await AuthModule._api('GET', '/play/sessions');
    const list = (res && res.sessions) || [];
    body.innerHTML = `<a class="rh-btn" href="play.html">🎮 Leagă emulatorul / sesiune nouă</a>` + (list.length ? list.map((s) => `
        <a class="rh-card" href="${play(s.slug)}">${icon(s.game_serial || '')}
            <span class="rh-card__body"><span class="rh-card__title">${esc(s.title)}</span>
            <span class="rh-card__meta">${new Date(s.created_at).toLocaleDateString()} · ${s.events} rezultate${s.open ? ' · <b>deschisă</b>' : ''}</span></span></a>`).join('')
        : '<p class="rh-empty">Nicio sesiune încă.</p>');
    fillIcons(root);
}

const TITLES = { live: '📡 Live acum', hall: '🏆 Hall of Fame', mine: '📅 Sesiunile mele' };

/** Called by community.js's navigate('retro', null, category). */
export function renderRetro(category) {
    const root = document.getElementById('view-retro');
    if (!root) return;
    const tab = TITLES[category] ? category : 'live';
    clearInterval(timer);
    root.innerHTML = `<div class="rh"><header class="rh-head"><h2>${TITLES[tab]}</h2>
        ${RETRO_DISCORD_URL ? `<a class="rh-btn rh-btn--discord" href="${esc(RETRO_DISCORD_URL)}" target="_blank" rel="noopener">💬 Discord</a>` : ''}</header>
        <div class="rh-body"><p class="rh-empty">Se încarcă…</p></div></div>`;
    const run = { live: renderLive, hall: renderHall, mine: renderMine }[tab];
    run(root).catch(() => { root.querySelector('.rh-body').innerHTML = '<p class="rh-empty">Nu s-a putut încărca.</p>'; });
    if (tab === 'live') {
        timer = setInterval(() => {
            if (!root.classList.contains('hub-view--active')) { clearInterval(timer); return; }
            if (!document.hidden) renderLive(root).catch(() => {});
        }, REFRESH_MS);
    }
}
