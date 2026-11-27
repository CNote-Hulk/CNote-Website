/**
 * Community → Retro Gaming (2026-11-27): the game nights from ArmSX2's CNote Live, as part of the
 * community hub (no pages of their own — Andrei: "it belongs to the site"). Routes, all under
 * community.html#retro/…, rendered into #view-retro by renderRetro(tab, arg):
 *   live                 sessions playing right now (GET /api/play/live)
 *   hall                 Hall of Fame per game, from every session (GET /api/play/hall)
 *   mine                 my sessions, a new session, linking the emulator (GET /api/play/sessions, /api/devices)
 *   session/<slug>       one session's scoreboard: matches + tonight's numbers, the fight now live
 *                        (GET /api/play/s/:slug every 4 s + socket.io 'live:now')
 *   link/<code>          the emulator's "Sign in with CNote" lands here and confirms the pairing
 *   duel/<match>.<key>   a player's phone from the QR codes before a match (Tools → Duel): name,
 *                        then the match live — opponent on top, you below — like a DS's 2nd screen
 * Old addresses (play.html?s=…, play.html?link=…, duel.html?m=&k=) redirect here.
 * Talking happens on the Discord server, not on the site.
 * Backend: backend/routes/play.js. Texts: i18n keys retro_*.
 */
import { AuthModule } from './auth.js?v=20261005';
import { I18nModule } from './i18n.js?v=20261127r';

/** Set when the Discord server exists; no Discord button while empty. */
export const RETRO_DISCORD_URL = '';

const t = (key, vars) => {
    let s = I18nModule.t(key);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace('{' + k + '}', v);
    return s;
};

function esc(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

const medal = (i) => (i < 3 ? ['🥇', '🥈', '🥉'][i] : '#' + (i + 1));
const hash = (...parts) => '#retro/' + parts.map(encodeURIComponent).join('/');
const when = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const day = (iso) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

/* ── shared: timers, socket, icons ────────── */

let timers = [];
let offs = [];          // socket listeners of the current view, removed when it goes
let root = null;
let socket = null;

function stop() {
    timers.forEach(clearInterval);
    timers = [];
    offs.forEach((f) => f());
    offs = [];
}

/** Repeat [fn] while the retro view is the one on screen. */
function every(ms, fn) {
    timers.push(setInterval(() => {
        if (!root || !root.classList.contains('hub-view--active')) { stop(); return; }
        if (!document.hidden) fn();
    }, ms));
}

/** [handlers] on the shared socket after [join] (again on every reconnect), for this view only. */
function listen(join, handlers) {
    if (!socket && typeof window.io === 'function') socket = window.io({ transports: ['websocket', 'polling'] });
    if (!socket) return;
    join(socket);
    const rejoin = () => join(socket);
    socket.on('connect', rejoin);
    offs.push(() => socket.off('connect', rejoin));
    for (const [ev, fn] of handlers) { socket.on(ev, fn); offs.push(() => socket.off(ev, fn)); }
    // Leaving the view (another sidebar item) drops the listeners.
    every(2000, () => {});
}

/** The game's own save icon (rendered by the emulator from the game's files, a turning strip);
 *  the console's photo from the encyclopedia while there is none. */
function icon(serial, big) {
    return `<span class="rh-icon${big ? ' rh-icon--big' : ''}" data-serial="${esc(serial || '')}"></span>`;
}

const iconCache = new Map();
async function fillIcons(el) {
    for (const span of el.querySelectorAll('.rh-icon[data-serial]')) {
        const serial = span.dataset.serial;
        span.removeAttribute('data-serial');
        if (!serial) continue;
        try {
            let got = iconCache.get(serial);
            if (!got) {
                const res = await fetch(`/api/play/icon/${encodeURIComponent(serial)}`);
                if (!res.ok) continue;
                got = { url: URL.createObjectURL(await res.blob()), frames: Math.max(1, parseInt(res.headers.get('X-Frames') || '1', 10)) };
                iconCache.set(serial, got);
            }
            span.classList.add('rh-icon--game');
            span.style.backgroundImage = `url(${got.url})`;
            span.style.backgroundSize = `${got.frames * 100}% 100%`;
            if (span.classList.contains('rh-icon--big') && got.frames > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
                let i = 0;
                timers.push(setInterval(() => { i = (i + 1) % got.frames; span.style.backgroundPosition = `${(i / (got.frames - 1)) * 100}% 0`; }, 1000 / 12));
            }
        } catch { /* keep the console photo */ }
    }
}

function empty(text, iconChar = '🎮') {
    return `<div class="hub-empty"><span class="hub-empty__icon">${iconChar}</span><span>${text}</span></div>`;
}

/** The emulator's phase line, in the reader's language. */
function phase(p) {
    if (!p) return 'VS';
    const r = /^(?:Runda|round:)\s*(\d+)/i.exec(p);
    if (r) return t('retro_round', { n: r[1] });
    if (/^FIGHT/i.test(p) || p === 'fight') return t('retro_fight');
    if (/^Alege|^pick/i.test(p)) return t('retro_pick');
    return p;
}

const pips = (n) => Array.from({ length: Math.max(2, n || 0) }, (_, i) => `<span class="${i < (n || 0) ? 'on' : ''}"></span>`).join('');
const pct = (v) => Math.max(0, Math.min(100, Math.round((v ?? 1) * 100)));

/* ── live now ─────────────────────────────── */

async function renderLive(body) {
    const res = await AuthModule._api('GET', '/play/live');
    const list = (res && res.sessions) || [];
    body.innerHTML = list.length ? `<div class="rh-list">${list.map((s) => {
        const f = s.fight && (s.fight.h1 != null || s.fight.h2 != null) ? s.fight : null;
        return `<a class="hub-detail-card rh-card" href="${hash('session', s.slug)}">
            ${icon(s.serial)}
            <span class="rh-card__body">
                <span class="rh-card__title">${esc(s.title)}</span>
                <span class="rh-card__meta">${s.playing ? `<span class="rh-dot"></span> ${t('retro_live')}` : t('retro_recent')} · ${esc(s.host)} · ${t('retro_matches_n', { n: s.events })}</span>
                ${s.presence ? `<span class="rh-card__presence">${esc(s.presence)}</span>` : ''}
                <span class="rh-card__vs"><b>${esc(s.p1_name || 'P1')}</b>
                    ${f ? `<span class="rh-mini"><i style="width:${pct(f.h1)}%"></i></span><span>VS</span><span class="rh-mini rh-mini--r"><i style="width:${pct(f.h2)}%"></i></span>` : '<span>vs</span>'}
                    <b>${esc(s.p2_name || '—')}</b></span>
            </span>
        </a>`;
    }).join('')}</div>` : empty(t('retro_live_empty'), '📡');
    fillIcons(body);
}

/* ── hall of fame ─────────────────────────── */

function board(title, list, fmt) {
    if (!list || !list.length) return '';
    return `<div class="rh-board"><h4>${title}</h4><ol>${list.map((r, i) =>
        `<li><span class="rh-board__rank">${medal(i)}</span><span class="rh-board__name">${esc(r.name)}</span><span class="rh-board__val">${fmt(r)}</span></li>`).join('')}</ol></div>`;
}

const wl = (r) => t('retro_wl', { w: r.wins, l: r.losses });
const arcadeVal = (r) => (r.cleared ? t('retro_cleared') : t('retro_fight_of', { n: r.reached, m: 8 })) + (r.char ? ` · ${esc(r.char)}` : '');

async function renderHall(body) {
    const res = await AuthModule._api('GET', '/play/hall');
    const games = (res && res.games) || [];
    body.innerHTML = games.length ? `<div class="rh-list">${games.map((g) => `
        <section class="hub-detail-card rh-game">
            <header class="rh-game__head">${icon(g.serial)}<span><span class="rh-card__title">${esc(g.game)}</span><span class="rh-card__meta">${t('retro_results_n', { n: g.matches })}</span></span></header>
            <div class="rh-boards">
                ${board(t('retro_board_arcade'), g.arcade, arcadeVal)}
                ${board(t('retro_board_versus'), g.versus, wl)}
                ${board(t('retro_board_races'), g.races, wl)}
                ${board(t('retro_board_cpu'), g.vs_cpu, wl)}
            </div>
        </section>`).join('')}</div>` : empty(t('retro_hall_empty'), '🏆');
    fillIcons(body);
}

/* ── my sessions + linking ────────────────── */

async function renderMine(body, linkCode) {
    if (!AuthModule.isLoggedIn()) {
        body.innerHTML = empty(`${t('retro_login_needed')}<br><a class="hub-btn hub-btn--primary rh-gap" href="login.html">${t('retro_login')}</a>`, '🔒');
        return;
    }
    const me = AuthModule.getCurrentUser();
    const [sessions, consoles] = await Promise.all([AuthModule._api('GET', '/play/sessions'), AuthModule._api('GET', '/devices')]);
    const list = (sessions && sessions.sessions) || [];
    const linked = (consoles && consoles.consoles) || [];
    body.innerHTML = `
        <div class="rh-two">
            <form class="hub-detail-card rh-form" id="rh-new">
                <h3 class="rh-h">${t('retro_new_session')}</h3>
                <div class="hub-form-group"><label class="hub-form-label" for="rh-new-title">${t('retro_session_name')}</label>
                    <input class="hub-form-input" id="rh-new-title" maxlength="80" placeholder="${esc(t('retro_session_ph'))}"></div>
                <div class="hub-form-row">
                    <div class="hub-form-group"><label class="hub-form-label" for="rh-new-p1">${t('retro_controller', { n: 1 })}</label>
                        <input class="hub-form-input" id="rh-new-p1" maxlength="30" value="${esc((me && me.username) || '')}"></div>
                    <div class="hub-form-group"><label class="hub-form-label" for="rh-new-p2">${t('retro_controller', { n: 2 })}</label>
                        <input class="hub-form-input" id="rh-new-p2" maxlength="30"></div>
                </div>
                <button type="submit" class="hub-btn hub-btn--primary">${t('retro_start')}</button>
                <p class="rh-note">${t('retro_start_note')}</p>
            </form>
            <form class="hub-detail-card rh-form" id="rh-link">
                <h3 class="rh-h">${t('retro_link_title')}</h3>
                <p class="rh-note">${t('retro_link_help')}</p>
                <div class="hub-form-row">
                    <input class="hub-form-input" id="rh-link-code" maxlength="8" placeholder="K7P-2QX" autocomplete="off" value="${esc(linkCode || '')}">
                    <button type="submit" class="hub-btn hub-btn--secondary">${t('retro_link_btn')}</button>
                </div>
                <p class="hub-form-status" id="rh-link-msg"></p>
                ${linked.length ? `<h4 class="rh-h4">${t('retro_consoles')}</h4><ul class="rh-consoles">${linked.map((c) =>
                    `<li>🕹️ ${esc(c.name || c.platform)}${c.last_seen_at ? ` <span class="rh-note">${day(c.last_seen_at)} ${when(c.last_seen_at)}</span>` : ''}</li>`).join('')}</ul>` : ''}
            </form>
        </div>
        <h3 class="rh-h">${t('retro_mine')}</h3>
        ${list.length ? `<div class="rh-list">${list.map((s) => `
            <a class="hub-detail-card rh-card" href="${hash('session', s.slug)}">${icon(s.game_serial)}
                <span class="rh-card__body"><span class="rh-card__title">${esc(s.title)}</span>
                <span class="rh-card__meta">${day(s.created_at)} · ${t('retro_results_n', { n: s.events })}${s.open ? ` · <b>${t('retro_open')}</b>` : ''}</span></span></a>`).join('')}</div>`
        : empty(t('retro_mine_empty'), '📅')}`;
    fillIcons(body);
    body.querySelector('#rh-new').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const res = await AuthModule._api('POST', '/play/sessions', {
            title: body.querySelector('#rh-new-title').value,
            p1_name: body.querySelector('#rh-new-p1').value,
            p2_name: body.querySelector('#rh-new-p2').value,
        });
        if (res.success) location.hash = hash('session', res.session.slug);
    });
    const link = async (code) => {
        const res = await AuthModule._api('POST', '/devices/pair/confirm', { user_code: code });
        body.querySelector('#rh-link-msg').textContent = res.success ? t('retro_linked') : t('retro_link_fail');
        if (res.success) body.querySelector('#rh-link-code').value = '';
    };
    body.querySelector('#rh-link').addEventListener('submit', (ev) => { ev.preventDefault(); link(body.querySelector('#rh-link-code').value); });
    if (linkCode) link(linkCode);
}

/* ── one session: the scoreboard ──────────── */

function matchRow(e) {
    const d = e.data || {};
    const n1 = e.p1_name || 'P1';
    const n2 = d.vs_cpu ? 'CPU' : (e.p2_name || 'P2');
    const time = `<span class="rh-m__time">${when(e.occurred_at)}</span>`;
    const ch = (c) => (c ? `<small>${esc(c)}</small>` : '');
    if ((e.kind === 'fight' || e.kind === 'race') && d.winner) {
        const sc = Array.isArray(d.rounds) ? `${d.rounds[0]}–${d.rounds[1]}` : '🏁';
        return `<li class="rh-m">${time}<span class="rh-m__p${d.winner === 1 ? ' win' : ''}">${esc(n1)}${ch(d.p1_char)}</span>
            <span class="rh-m__s">${sc}</span><span class="rh-m__p rh-m__p--r${d.winner === 2 ? ' win' : ''}">${esc(n2)}${ch(d.p2_char)}</span></li>`;
    }
    if (e.kind === 'arcade_run') {
        const who = (d.player === 2 ? e.p2_name : e.p1_name) || 'P1';
        return `<li class="rh-m">${time}<span class="rh-m__p win">${esc(who)}${ch(d.char)}</span>
            <span class="rh-m__s">${d.cleared ? '🏆' : `${d.reached}/8`}</span><span class="rh-m__p rh-m__p--r">${d.cleared ? t('retro_arcade_cleared') : 'Arcade'}</span></li>`;
    }
    if (e.kind === 'race' && d.position) {
        return `<li class="rh-m">${time}<span class="rh-m__p">${esc(n1)}</span><span class="rh-m__s">#${d.position}</span><span class="rh-m__p rh-m__p--r">${t('retro_race')}</span></li>`;
    }
    return '';
}

function fighterHtml(k) {
    return `<div class="rh-fighter rh-fighter--p${k}">
        <div class="rh-fighter__head"><span class="rh-tag">P${k}</span> <b id="rh-n${k}"></b> <span class="rh-char" id="rh-c${k}"></span></div>
        <div class="rh-bar"><i id="rh-h${k}"></i></div><div class="rh-pips" id="rh-r${k}"></div></div>`;
}

async function renderSession(body, slug) {
    let session = null;
    let lastStamp = '';
    let lastAch = null;
    let fightSeen = 0;
    let iconSerial = null;

    body.innerHTML = `
        <div class="rh-session">
            <div class="hub-detail-card rh-top">
                <span id="rh-icon-slot">${icon('', true)}</span>
                <span class="rh-top__text"><span class="rh-top__title" id="rh-title"></span>
                    <span class="rh-card__meta"><span class="rh-live" id="rh-live"><span class="rh-dot"></span> <span id="rh-live-text"></span></span> · <span id="rh-sub"></span></span>
                    <span class="rh-card__presence" id="rh-presence" hidden></span></span>
                <span class="rh-ach" id="rh-ach" hidden></span>
            </div>
            <div class="rh-owner" id="rh-owner" hidden>
                <button type="button" class="hub-btn hub-btn--secondary hub-btn--sm" id="rh-swap">${t('retro_swap')}</button>
                <button type="button" class="hub-btn hub-btn--secondary hub-btn--sm" id="rh-rename">${t('retro_players_btn')}</button>
                <button type="button" class="hub-btn hub-btn--secondary hub-btn--sm" id="rh-share">${t('retro_share')}</button>
                <button type="button" class="hub-btn hub-btn--danger hub-btn--sm" id="rh-end">${t('retro_end')}</button>
            </div>
            <div class="rh-stats">
                <div class="hub-detail-card rh-stat"><b id="rh-st-matches">0</b><span>${t('retro_stat_matches')}</span></div>
                <div class="hub-detail-card rh-stat"><b id="rh-st-leader">—</b><span>${t('retro_stat_leader')}</span></div>
                <div class="hub-detail-card rh-stat"><b id="rh-st-arcade">—</b><span>${t('retro_stat_arcade')}</span></div>
                <div class="hub-detail-card rh-stat"><b id="rh-st-players">0</b><span>${t('retro_stat_players')}</span></div>
            </div>
            <div class="rh-grid">
                <section class="hub-detail-card rh-col">
                    <h3 class="rh-h">${t('retro_matches')}</h3>
                    <ol class="rh-matches" id="rh-matches"></ol>
                    <div id="rh-no-matches" hidden>${empty(t('retro_no_matches'))}</div>
                    <div class="rh-boards" id="rh-boards"></div>
                </section>
                <section class="hub-detail-card rh-col rh-now" aria-live="polite">
                    <h3 class="rh-h">${t('retro_now')}</h3>
                    <div class="rh-fight" id="rh-fight" hidden>
                        ${fighterHtml(1)}
                        <div class="rh-vs" id="rh-phase">VS</div>
                        ${fighterHtml(2)}
                        <div class="rh-ladder" id="rh-ladder" hidden></div>
                    </div>
                    <div id="rh-idle">${empty(t('retro_waiting'), '🕹️')}</div>
                </section>
            </div>
        </div>`;
    const $ = (id) => body.querySelector('#' + id);

    const draw = (res) => {
        session = res.session;
        $('rh-title').textContent = session.title;
        $('rh-sub').textContent = `${session.host} · ${day(session.created_at)}`;
        $('rh-live').classList.toggle('rh-live--off', !session.open);
        $('rh-live-text').textContent = session.open ? t('retro_live') : t('retro_ended');
        $('rh-n1').textContent = session.p1_name || 'P1';
        $('rh-n2').textContent = session.p2_name || 'P2';
        const me = AuthModule.getCurrentUser();
        $('rh-owner').hidden = !(me && me.username === session.host && session.open);
        $('rh-matches').innerHTML = res.events.map(matchRow).join('');
        $('rh-no-matches').hidden = !!res.total_events;
        const b = res.boards;
        const names = new Set();
        for (const e of res.events) {
            if (e.p1_name) names.add(e.p1_name);
            if (e.p2_name && !(e.data && e.data.vs_cpu)) names.add(e.p2_name);
        }
        const leader = b.versus[0] || b.races[0] || b.vs_cpu[0];
        $('rh-st-matches').textContent = res.total_events;
        $('rh-st-leader').textContent = leader ? `${leader.name} · ${wl(leader)}` : '—';
        $('rh-st-arcade').textContent = b.arcade[0] ? `${b.arcade[0].name} · ${b.arcade[0].cleared ? '🏆' : b.arcade[0].reached + '/8'}` : '—';
        $('rh-st-players').textContent = names.size;
        $('rh-boards').innerHTML = board(t('retro_board_versus'), b.versus, wl) + board(t('retro_board_arcade'), b.arcade, arcadeVal)
            + board(t('retro_board_races'), b.races, wl) + board(t('retro_board_cpu'), b.vs_cpu, wl);
    };

    const fight = (f) => {
        const has = f && (f.h1 != null || f.h2 != null || f.place != null);
        $('rh-fight').hidden = !has;
        $('rh-idle').hidden = !!has;
        if (!has) return;
        fightSeen = Date.now();
        for (const k of [1, 2]) {
            const h = f['h' + k];
            $('rh-h' + k).style.width = pct(h) + '%';
            $('rh-h' + k).classList.toggle('low', h != null && h < 0.25);
            $('rh-c' + k).textContent = f['c' + k] || '';
            $('rh-r' + k).innerHTML = pips(f['r' + k]);
        }
        $('rh-phase').textContent = f.place != null ? t('retro_place', { n: f.place + 1 }) : phase(f.phase);
        $('rh-ladder').hidden = !f.ladder;
        if (f.ladder) {
            $('rh-ladder').innerHTML = Array.from({ length: f.ladder }, (_, i) =>
                `<span class="${i < f.fight ? 'done' : i === f.fight ? 'cur' : ''}">${i === f.ladder - 1 ? '👑' : i + 1}</span>`).join('');
        }
    };

    const now = (n) => {
        if (!n) return;
        if (n.serial && n.serial !== iconSerial) {
            iconSerial = n.serial;
            $('rh-icon-slot').innerHTML = icon(n.serial, true);
            fillIcons($('rh-icon-slot'));
        }
        if (n.ach && n.ach[1]) {
            $('rh-ach').hidden = false;
            $('rh-ach').textContent = `🏆 ${n.ach[0]}/${n.ach[1]}`;
            if (lastAch !== null && n.ach[0] > lastAch && typeof window.showToast === 'function') {
                window.showToast(n.unlocked ? `🏆 ${n.unlocked}` : t('retro_ach_unlocked'));
            }
            lastAch = n.ach[0];
        } else $('rh-ach').hidden = true;
        $('rh-presence').hidden = !n.presence;
        $('rh-presence').textContent = n.presence || '';
        fight(n.fight);
    };

    const load = async () => {
        const res = await AuthModule._api('GET', `/play/s/${encodeURIComponent(slug)}`);
        if (!res.success) {
            if (!session) body.innerHTML = empty(t('retro_not_found'), '❓');
            return false;
        }
        const stamp = JSON.stringify([res.total_events, res.session]);
        if (stamp !== lastStamp) { lastStamp = stamp; draw(res); }
        if (res.now && iconSerial === null) now(res.now);
        return true;
    };
    if (!(await load())) return;

    const patch = async (change) => {
        const res = await AuthModule._api('PATCH', `/play/sessions/${session.id}`, change);
        if (res.success) { lastStamp = ''; load(); }
    };
    $('rh-swap').addEventListener('click', () => patch({ p1_name: session.p2_name, p2_name: session.p1_name }));
    $('rh-rename').addEventListener('click', () => {
        const p1 = prompt(t('retro_controller', { n: 1 }), session.p1_name);
        if (p1 === null) return;
        const p2 = prompt(t('retro_controller', { n: 2 }), session.p2_name);
        if (p2 !== null) patch({ p1_name: p1, p2_name: p2 });
    });
    $('rh-share').addEventListener('click', async () => {
        const url = location.origin + '/html/pages/community.html' + hash('session', slug);
        try { await navigator.clipboard.writeText(url); $('rh-share').textContent = t('retro_copied'); } catch { prompt('Link', url); }
    });
    $('rh-end').addEventListener('click', () => { if (confirm(t('retro_end_confirm'))) patch({ end: true }); });

    if (session && session.open) {
        listen((s) => s.emit('live:watch', slug), [['live:now', now]]);
        every(4000, load);
        every(5000, () => { if (fightSeen && Date.now() - fightSeen > 15000) { fightSeen = 0; fight(null); } });
    }
}

/* ── a player's phone (Duel) ──────────────── */

async function renderDuel(body, arg) {
    const [m, k] = String(arg || '').split('.');
    const res = m && k ? await AuthModule._api('GET', `/play/join?m=${encodeURIComponent(m)}&k=${encodeURIComponent(k)}`) : null;
    if (!res || !res.success) {
        body.innerHTML = empty(`<b>${t('retro_duel_invalid')}</b><br>${t('retro_duel_invalid_sub')}`, '❓');
        return;
    }
    const side = res.side;
    let names = { p1_name: res.p1_name, p2_name: res.p2_name };
    let saved = '';
    try { saved = localStorage.getItem('cn_duel_name') || ''; } catch { /* private mode */ }
    const me = AuthModule.getCurrentUser();
    const mine = () => (side === 1 ? names.p1_name : names.p2_name) || t('retro_duel_you');
    const theirs = () => (side === 1 ? names.p2_name : names.p1_name) || t('retro_duel_opponent');
    const q = (id) => body.querySelector('#' + id);

    const liveView = () => {
        body.innerHTML = `
            <div class="rh-ds rh-side${side}">
                <div class="hub-detail-card rh-ds__screen">
                    <div class="rh-fighter__head"><b id="rh-op">${esc(theirs())}</b> <span class="rh-char" id="rh-op-c"></span></div>
                    <div class="rh-bar"><i id="rh-op-h"></i></div><div class="rh-pips" id="rh-op-r"></div>
                </div>
                <div class="rh-vs" id="rh-ds-phase">${t('retro_duel_waiting')}</div>
                <div class="hub-detail-card rh-ds__screen rh-ds__screen--me">
                    <div class="rh-fighter__head"><span class="rh-tag">${t('retro_duel_you')}</span> <b id="rh-me">${esc(mine())}</b> <span class="rh-char" id="rh-me-c"></span></div>
                    <div class="rh-bar rh-bar--big"><i id="rh-me-h"></i></div><div class="rh-pips" id="rh-me-r"></div>
                    <p class="rh-note" id="rh-ds-arcade"></p>
                </div>
                ${res.slug ? `<a class="hub-btn hub-btn--secondary" href="${hash('session', res.slug)}">${t('retro_duel_board')}</a>` : ''}
            </div>
            <div class="hub-detail-card rh-result" id="rh-result" hidden>
                <p class="rh-result__big" id="rh-result-big"></p>
                <a class="hub-btn hub-btn--primary" href="register.html?ref=duel">${t('retro_duel_keep')}</a>
                <button type="button" class="hub-btn hub-btn--secondary" id="rh-again">${t('retro_duel_back')}</button>
            </div>`;
        q('rh-again').addEventListener('click', () => { q('rh-result').hidden = true; });
    };

    body.innerHTML = `
        <form class="hub-detail-card rh-duel-join rh-side${side}" id="rh-join">
            <span class="rh-tag">🎮 ${t('retro_controller', { n: side })}</span>
            <h3 class="rh-top__title">${esc(res.title || 'Duel')}</h3>
            <div class="hub-form-group"><label class="hub-form-label" for="rh-name">${t('retro_duel_name_q')}</label>
                <input class="hub-form-input" id="rh-name" maxlength="20" autocomplete="nickname" placeholder="${esc(t('retro_duel_name_ph'))}" value="${esc(saved || (me && me.username) || '')}" required></div>
            <button type="submit" class="hub-btn hub-btn--primary">${t('retro_duel_enter')}</button>
            <p class="rh-note">${t('retro_duel_note')}</p>
        </form>`;
    q('rh-join').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const name = q('rh-name').value.trim();
        if (!name) return;
        const r = await AuthModule._api('POST', '/play/join', { m, k, name });
        if (!r.success) { body.innerHTML = empty(t('retro_duel_invalid'), '❓'); return; }
        try { localStorage.setItem('cn_duel_name', name); } catch { /* private mode */ }
        names = { p1_name: r.p1_name, p2_name: r.p2_name };
        liveView();
    });

    const live = (s) => {
        if (!q('rh-me-h')) return;
        const a = side, o = 3 - side;
        q('rh-me-h').style.width = pct(s['h' + a]) + '%';
        q('rh-me-h').classList.toggle('low', pct(s['h' + a]) < 25);
        q('rh-op-h').style.width = pct(s['h' + o]) + '%';
        q('rh-me-c').textContent = s['c' + a] || '';
        q('rh-op-c').textContent = s['c' + o] || '';
        q('rh-me-r').innerHTML = pips(s['r' + a]);
        q('rh-op-r').innerHTML = pips(s['r' + o]);
        q('rh-ds-phase').textContent = s.place != null ? t('retro_place', { n: s.place + 1 }) : phase(s.phase);
        q('rh-ds-arcade').textContent = s.ladder ? `Arcade · ${t('retro_fight_of', { n: (s.fight || 0) + 1, m: s.ladder })}` : '';
    };
    const result = (r) => {
        if (!q('rh-result')) return;
        const won = r.winner === side;
        q('rh-result-big').textContent = won ? t('retro_duel_win') : t('retro_duel_lose');
        q('rh-result').classList.toggle('rh-result--win', won);
        q('rh-result').hidden = false;
        try { if (navigator.vibrate) navigator.vibrate(won ? [80, 60, 80, 60, 200] : [400]); } catch { /* no vibration */ }
    };
    const renamed = (n) => {
        names = n;
        if (q('rh-me')) { q('rh-me').textContent = mine(); q('rh-op').textContent = theirs(); }
    };
    listen((s) => s.emit('duel:watch', { m, k }), [['duel:live', live], ['duel:result', result], ['duel:names', renamed]]);
}

/* ── entry ────────────────────────────────── */

const TITLES = { live: 'retro_live_now', hall: 'retro_hall', mine: 'retro_mine' };

/** Called by community.js's navigate('retro', tab, arg). */
export function renderRetro(tab, arg) {
    root = document.getElementById('view-retro');
    if (!root) return;
    stop();
    const view = ['live', 'hall', 'mine', 'session', 'link', 'duel'].includes(tab) ? tab : 'live';
    const inner = view === 'session' || view === 'duel' || view === 'link';
    const title = inner
        ? `<a class="hub-view-header__back" href="${hash(view === 'link' ? 'mine' : 'live')}">${t('retro_back')}</a>`
        : `<h2 class="hub-view-header__title">${t(TITLES[view])}</h2>`;
    const discord = RETRO_DISCORD_URL
        ? `<a class="hub-btn hub-btn--secondary hub-btn--sm" href="${esc(RETRO_DISCORD_URL)}" target="_blank" rel="noopener">💬 Discord</a>` : '';
    root.innerHTML = `<div class="hub-view-header">${title}${discord}</div><div class="rh-body" id="rh-body">${empty(t('retro_loading'), '⏳')}</div>`;
    const body = root.querySelector('#rh-body');
    const run = {
        live: () => { every(10000, () => renderLive(body).catch(() => {})); return renderLive(body); },
        hall: () => renderHall(body),
        mine: () => renderMine(body, ''),
        link: () => renderMine(body, arg),
        session: () => renderSession(body, arg),
        duel: () => renderDuel(body, arg),
    }[view];
    run().catch(() => { body.innerHTML = empty(t('retro_load_error'), '⚠️'); });
}
