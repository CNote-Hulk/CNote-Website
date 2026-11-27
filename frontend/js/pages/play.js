/**
 * CNote Play — game-night sessions with a live leaderboard (backend: routes/play.js).
 *   play.html          → my sessions, new session, link a console (logged in)
 *   play.html?s=<slug> → one session, public, refreshes every few seconds
 */
import { AuthModule } from '../modules/auth.js?v=20261005';

const REFRESH_MS = 4000;
const $ = (id) => document.getElementById(id);

function esc(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

function when(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function day(iso) {
    return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

const medal = (i) => (i < 3 ? ['🥇', '🥈', '🥉'][i] : '#' + (i + 1));

/* ── one session ─────────────────────────── */

let session = null;
let lastStamp = '';

function rows(list, render) {
    return list.map((r, i) => `<li class="pl-row${i < 3 ? ' pl-row--top' : ''}"><span class="pl-row__rank">${medal(i)}</span>${render(r)}</li>`).join('');
}

/** One finished match in the list: who vs who and the score, the winner lit. */
function matchRow(e) {
    const d = e.data || {};
    const n1 = e.p1_name || 'P1';
    const n2 = d.vs_cpu ? 'CPU' : (e.p2_name || 'P2');
    const time = `<span class="sb-time">${when(e.occurred_at)}</span>`;
    if ((e.kind === 'fight' || e.kind === 'race') && d.winner) {
        const sc = Array.isArray(d.rounds) ? `${d.rounds[0]}–${d.rounds[1]}` : (e.kind === 'race' ? '🏁' : '');
        const c1 = d.p1_char ? `<small>${esc(d.p1_char)}</small>` : '';
        const c2 = d.p2_char ? `<small>${esc(d.p2_char)}</small>` : '';
        return `<li class="sb-m">${time}
            <span class="sb-m__p ${d.winner === 1 ? 'win' : ''}">${esc(n1)}${c1}</span>
            <span class="sb-m__s">${sc}</span>
            <span class="sb-m__p sb-m__p--r ${d.winner === 2 ? 'win' : ''}">${esc(n2)}${c2}</span></li>`;
    }
    if (e.kind === 'arcade_run') {
        const who = (d.player === 2 ? e.p2_name : e.p1_name) || 'P1';
        return `<li class="sb-m sb-m--arcade">${time}<span class="sb-m__p win">${esc(who)}${d.char ? `<small>${esc(d.char)}</small>` : ''}</span>
            <span class="sb-m__s">${d.cleared ? '🏆' : `${d.reached}/8`}</span><span class="sb-m__p sb-m__p--r">${d.cleared ? 'Arcade terminat' : 'Arcade'}</span></li>`;
    }
    if (e.kind === 'race' && d.position) return `<li class="sb-m">${time}<span class="sb-m__p">${esc(n1)}</span><span class="sb-m__s">#${d.position}</span><span class="sb-m__p sb-m__p--r">cursă</span></li>`;
    return '';
}

function renderSession(res) {
    session = res.session;
    document.title = `${session.title} — CNote Play`;
    $('pl-title').textContent = session.title;
    $('pl-sub').textContent = `${session.host} · ${day(session.created_at)}`;
    $('pl-live').classList.toggle('pl-live--off', !session.open);
    $('pl-live-text').textContent = session.open ? 'Live' : 'Încheiată';
    $('sb-n1').textContent = session.p1_name || 'P1';
    $('sb-n2').textContent = session.p2_name || 'P2';

    const me = AuthModule.getCurrentUser();
    $('pl-owner').hidden = !(me && me.username === session.host && session.open);

    $('sb-list').innerHTML = res.events.map(matchRow).join('');
    $('pl-empty').hidden = !!res.total_events;

    const b = res.boards;
    const results = res.events.filter((e) => (e.kind === 'fight' || e.kind === 'race') && e.data && e.data.winner);
    const names = new Set();
    for (const e of res.events) { if (e.p1_name) names.add(e.p1_name); if (e.p2_name && !(e.data && e.data.vs_cpu)) names.add(e.p2_name); }
    const leader = (b.versus[0] || b.races[0] || b.vs_cpu[0]);
    $('sb-st-matches').textContent = res.total_events;
    $('sb-st-leader').textContent = leader ? `${leader.name} · ${leader.wins}V` : '—';
    $('sb-st-arcade').textContent = b.arcade[0] ? (b.arcade[0].cleared ? `${b.arcade[0].name} 🏆` : `${b.arcade[0].name} · ${b.arcade[0].reached}/8`) : '—';
    $('sb-st-players').textContent = names.size;
    void results;
    const wl = (r) => `<span class="pl-row__name">${esc(r.name)}</span><span class="pl-row__score">${r.wins}V</span><span class="pl-row__extra">${r.losses}Î</span>`;
    $('pl-board-versus').hidden = !b.versus.length;
    $('pl-versus').innerHTML = rows(b.versus, wl);
    $('pl-board-races').hidden = !(b.races && b.races.length);
    $('pl-races').innerHTML = rows(b.races || [], wl);
    $('pl-board-cpu').hidden = !b.vs_cpu.length;
    $('pl-cpu').innerHTML = rows(b.vs_cpu, wl);
    $('pl-board-arcade').hidden = !b.arcade.length;
    $('pl-arcade').innerHTML = rows(b.arcade, (r) => `<span class="pl-row__name">${esc(r.name)}${r.char ? ` <small>${esc(r.char)}</small>` : ''}</span>
        <span class="pl-row__score">${r.cleared ? '🏆' : r.reached + '/8'}</span><span class="pl-row__extra">${r.runs}×</span>`);
}

/* ── live: the game and the fight on screen ─ */

let liveWired = false;
let iconFor = '';
let iconTimer = 0;
let lastAch = null;
let fightSeen = 0;

async function showIcon(serial) {
    if (!serial || serial === iconFor) return;
    iconFor = serial;
    clearInterval(iconTimer);
    const el = $('pl-icon');
    try {
        const res = await fetch(`/api/play/icon/${encodeURIComponent(serial)}`);
        if (!res.ok) throw new Error('none');
        const frames = Math.max(1, parseInt(res.headers.get('X-Frames') || '1', 10));
        const url = URL.createObjectURL(await res.blob());
        el.classList.remove('none');
        el.style.backgroundImage = `url(${url})`;
        el.style.backgroundSize = `${frames * 100}% 100%`;
        let i = 0;
        // The PS2 browser turns every save icon; the strip is that turn, frame by frame.
        if (frames > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
            iconTimer = setInterval(() => { i = (i + 1) % frames; el.style.backgroundPosition = `${(i / (frames - 1)) * 100}% 0`; }, 1000 / 12);
        }
    } catch {
        iconFor = '';   // try again with the next update: the emulator may still be uploading it
        el.classList.add('none');
        el.style.backgroundImage = '';
    }
}

function toast(text) {
    const t = $('pl-toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
}

function pips(el, n) {
    el.innerHTML = Array.from({ length: Math.max(2, n || 0) }, (_, i) => `<span class="${i < (n || 0) ? 'on' : ''}"></span>`).join('');
}

function renderFight(f) {
    const has = f && (f.h1 != null || f.h2 != null || f.place != null);
    $('sb-fight').hidden = !has;
    $('sb-idle').hidden = !!has;
    if (!has) return;
    fightSeen = Date.now();
    for (const k of [1, 2]) {
        const h = f['h' + k];
        const bar = $('sb-h' + k);
        bar.style.width = (h == null ? 100 : Math.round(h * 100)) + '%';
        bar.classList.toggle('low', h != null && h < 0.25);
        $('sb-c' + k).textContent = f['c' + k] || '';
        pips($('sb-r' + k), f['r' + k]);
    }
    $('sb-phase').textContent = f.place != null ? `Locul ${f.place + 1}` : (f.phase || 'VS');
    const lad = $('sb-ladder');
    lad.hidden = !f.ladder;
    if (f.ladder) {
        lad.innerHTML = Array.from({ length: f.ladder }, (_, i) =>
            `<span class="${i < f.fight ? 'done' : i === f.fight ? 'cur' : ''}">${i === f.ladder - 1 ? '👑' : i + 1}</span>`).join('');
    }
}

function renderNow(n) {
    showIcon(n.serial);
    const ach = $('pl-now-ach');
    if (n.ach && n.ach[1]) {
        ach.hidden = false;
        ach.textContent = `🏆 ${n.ach[0]}/${n.ach[1]}`;
        if (lastAch !== null && n.ach[0] > lastAch) toast(n.unlocked ? `🏆 ${n.unlocked}` : '🏆 Realizare deblocată!');
        lastAch = n.ach[0];
    } else ach.hidden = true;
    $('pl-ticker').hidden = !n.presence;
    if (n.presence && $('pl-presence').textContent !== n.presence) $('pl-presence').textContent = n.presence;
    renderFight(n.fight);
}

function wireLive(slug) {
    if (liveWired || typeof io !== 'function') return;
    liveWired = true;
    const socket = io({ transports: ['websocket', 'polling'] });
    socket.on('connect', () => socket.emit('live:watch', slug));
    socket.on('live:now', renderNow);
    // No update for a while (game closed, between games): back to waiting.
    setInterval(() => { if (fightSeen && Date.now() - fightSeen > 15000) { fightSeen = 0; renderFight(null); } }, 5000);
}

async function loadSession(slug) {
    try {
        const res = await AuthModule._api('GET', `/play/s/${encodeURIComponent(slug)}`);
        if (!res.success) throw new Error(res.error);
        if (res.session.open) {
            wireLive(slug);
            if (res.now && !iconFor) renderNow(res.now);
        }
        const stamp = JSON.stringify([res.total_events, res.session]);
        if (stamp !== lastStamp) {
            lastStamp = stamp;
            renderSession(res);
        }
        $('pl-view').hidden = false;
    } catch {
        if (!session) {
            $('pl-view').hidden = false;
            $('pl-title').textContent = 'Sesiunea nu există';
        }
    }
}

async function patchSession(body) {
    const res = await AuthModule._api('PATCH', `/play/sessions/${session.id}`, body);
    if (res.success) { lastStamp = ''; await loadSession(session.slug); }
    return res;
}

function wireOwnerButtons() {
    $('pl-swap').addEventListener('click', () => patchSession({ p1_name: session.p2_name, p2_name: session.p1_name }));
    $('pl-rename').addEventListener('click', () => {
        const p1 = prompt('Controller 1', session.p1_name);
        if (p1 === null) return;
        const p2 = prompt('Controller 2', session.p2_name);
        if (p2 === null) return;
        patchSession({ p1_name: p1, p2_name: p2 });
    });
    $('pl-share').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(location.href); $('pl-share').textContent = '✓ Copied'; } catch { prompt('Link', location.href); }
    });
    $('pl-end').addEventListener('click', () => { if (confirm('End this session?')) patchSession({ end: true }); });
}

/* ── my sessions ─────────────────────────── */

async function loadHome() {
    $('pl-home').hidden = false;
    const [sessions, consoles] = await Promise.all([
        AuthModule._api('GET', '/play/sessions'),
        AuthModule._api('GET', '/devices'),
    ]);
    $('pl-sessions').innerHTML = (sessions.sessions || []).map((s) => `
        <li><a href="?s=${encodeURIComponent(s.slug)}">${esc(s.title)}</a>
            <span class="pl-dim">${day(s.created_at)} · ${s.events} result${s.events === 1 ? '' : 's'}${s.open ? ' · <b class="pl-open">open</b>' : ''}</span></li>`).join('')
        || '<li class="pl-dim">No sessions yet.</li>';
    $('pl-consoles').innerHTML = (consoles.consoles || []).map((c) => `
        <li>🕹️ ${esc(c.name || c.platform)} <span class="pl-dim">${c.last_seen_at ? 'seen ' + day(c.last_seen_at) + ' ' + when(c.last_seen_at) : ''}</span></li>`).join('');
    const me = AuthModule.getCurrentUser();
    if (me && !$('pl-new-p1').value) $('pl-new-p1').value = me.username || '';
}

$('pl-new').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const res = await AuthModule._api('POST', '/play/sessions', {
        title: $('pl-new-title').value, p1_name: $('pl-new-p1').value, p2_name: $('pl-new-p2').value,
    });
    if (res.success) location.search = '?s=' + encodeURIComponent(res.session.slug);
    else alert(res.error || 'Could not start the session');
});

$('pl-link').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const res = await AuthModule._api('POST', '/devices/pair/confirm', { user_code: $('pl-link-code').value });
    $('pl-link-msg').textContent = res.success ? '✓ Linked. The emulator picks it up in a few seconds.' : (res.error || 'Could not link');
    if (res.success) { $('pl-link-code').value = ''; loadHome(); }
});

/* ── start ───────────────────────────────── */

const params = new URLSearchParams(location.search);
const slug = params.get('s');
const linkCode = params.get('link');

/** ArmSX2 → "Sign in with CNote" opens play.html?link=<code>: confirm it with this browser's login. */
async function confirmLink(code) {
    $('pl-home').hidden = false;
    $('pl-link-code').value = code;
    const res = await AuthModule._api('POST', '/devices/pair/confirm', { user_code: code });
    $('pl-link-msg').textContent = res.success
        ? '✓ Emulator connected. Go back to ArmSX2 — a session opens by itself when you start a game.'
        : (res.error || 'Could not link') + ' — start the sign-in again in the emulator.';
    history.replaceState(null, '', location.pathname);
    loadHome();
}

if (linkCode && AuthModule.isLoggedIn()) {
    confirmLink(linkCode);
} else if (linkCode) {
    $('pl-login').hidden = false;
    $('pl-login').querySelector('.pl-header__subtitle').textContent =
        'Log in, then tap “Sign in with CNote” in the emulator again.';
} else if (slug) {
    wireOwnerButtons();
    loadSession(slug);
    setInterval(() => { if (!document.hidden && (!session || session.open)) loadSession(slug); }, REFRESH_MS);
} else if (AuthModule.isLoggedIn()) {
    loadHome();
} else {
    $('pl-login').hidden = false;
}
