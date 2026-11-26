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

function describe(e) {
    const d = e.data || {};
    const p1 = e.p1_name || 'P1';
    const p2 = d.vs_cpu ? 'CPU' : (e.p2_name || 'P2');
    if (e.kind === 'fight') {
        const winner = d.winner === 1 ? p1 : p2;
        const loser = d.winner === 1 ? p2 : p1;
        const rounds = Array.isArray(d.rounds) ? ` <span class="pl-dim">${d.rounds[0]}–${d.rounds[1]}</span>` : '';
        const chars = d.p1_char && d.p2_char ? ` <span class="pl-dim">(${esc(d.p1_char)} vs ${esc(d.p2_char)})</span>` : '';
        return `<b>${esc(winner)}</b> beat ${esc(loser)}${rounds}${chars}`;
    }
    if (e.kind === 'race' && d.winner) {
        const winner = d.winner === 1 ? p1 : (e.p2_name || 'P2');
        const loser = d.winner === 1 ? (e.p2_name || 'P2') : p1;
        return `🏁 <b>${esc(winner)}</b> beat ${esc(loser)} in a race`;
    }
    if (e.kind === 'race' && d.position) return `🏁 <b>${esc(p1)}</b> finished #${d.position}`;
    if (e.kind === 'arcade_run') {
        const who = (d.player === 2 ? e.p2_name : e.p1_name) || 'P' + (d.player || 1);
        const ch = d.char ? ` <span class="pl-dim">(${esc(d.char)})</span>` : '';
        return d.cleared
            ? `<b>${esc(who)}</b>${ch} finished the arcade ladder 🏆`
            : `<b>${esc(who)}</b>${ch} fell at fight ${d.reached}`;
    }
    return `${esc(e.kind)}`;
}

function rows(list, render) {
    return list.map((r, i) => `<li class="pl-row${i < 3 ? ' pl-row--top' : ''}"><span class="pl-row__rank">${medal(i)}</span>${render(r)}</li>`).join('');
}

function renderSession(res) {
    session = res.session;
    document.title = `${session.title} — CNote Play`;
    $('pl-title').textContent = session.title;
    $('pl-sub').textContent = `${session.host} · ${day(session.created_at)}`;
    $('pl-live').classList.toggle('pl-live--off', !session.open);
    $('pl-live-text').textContent = session.open ? 'Live' : 'Ended';
    $('pl-pads').innerHTML = `
        <span class="pl-pad">🎮 1 <b>${esc(session.p1_name || '—')}</b></span>
        <span class="pl-pad">🎮 2 <b>${esc(session.p2_name || '—')}</b></span>`;

    const me = AuthModule.getCurrentUser();
    $('pl-owner').hidden = !(me && me.username === session.host && session.open);

    const b = res.boards;
    $('pl-board-arcade').hidden = !b.arcade.length;
    $('pl-arcade').innerHTML = rows(b.arcade, (r) => `
        <span class="pl-row__name">${esc(r.name)}${r.char ? ` <span class="pl-dim">${esc(r.char)}</span>` : ''}</span>
        <span class="pl-row__score">${r.cleared ? '🏆 Cleared' : 'Fight ' + r.reached}</span>
        <span class="pl-row__extra">${r.runs} run${r.runs === 1 ? '' : 's'}</span>`);
    $('pl-board-versus').hidden = !b.versus.length;
    $('pl-versus').innerHTML = rows(b.versus, (r) => `
        <span class="pl-row__name">${esc(r.name)}</span>
        <span class="pl-row__score">${r.wins} W</span>
        <span class="pl-row__extra">${r.losses} L</span>`);
    $('pl-board-cpu').hidden = !b.vs_cpu.length;
    $('pl-cpu').innerHTML = rows(b.vs_cpu, (r) => `
        <span class="pl-row__name">${esc(r.name)}</span>
        <span class="pl-row__score">${r.wins} W</span>
        <span class="pl-row__extra">${r.losses} L</span>`);
    $('pl-board-races').hidden = !(b.races && b.races.length);
    $('pl-races').innerHTML = rows(b.races || [], (r) => `
        <span class="pl-row__name">${esc(r.name)}</span>
        <span class="pl-row__score">${r.wins} W</span>
        <span class="pl-row__extra">${r.losses} L</span>`);
    $('pl-empty').hidden = !!res.total_events;
    $('pl-feed').innerHTML = res.events.map((e) => `<li><span class="pl-dim">${when(e.occurred_at)}</span> ${describe(e)}${e.game ? ` <span class="pl-dim">· ${esc(e.game)}</span>` : ''}</li>`).join('');
}

/* ── live, every game ────────────────────── */

let liveWired = false;
let iconFor = '';
let iconTimer = 0;
let lastAch = null;
let frameAt = 0;

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

function renderNow(n) {
    $('pl-tv').hidden = false;
    $('pl-now-title').textContent = n.title || 'Playing';
    $('pl-now-serial').textContent = n.serial || '';
    $('pl-tv-led').classList.toggle('on', !n.paused);
    showIcon(n.serial);
    const ach = $('pl-now-ach');
    if (n.ach && n.ach[1]) {
        ach.hidden = false;
        ach.textContent = `🏆 ${n.ach[0]}/${n.ach[1]}`;
        if (lastAch !== null && n.ach[0] > lastAch) toast(n.unlocked ? `🏆 ${n.unlocked}` : '🏆 Achievement unlocked!');
        lastAch = n.ach[0];
    } else ach.hidden = true;
    $('pl-ticker').hidden = !n.presence;
    if (n.presence && $('pl-presence').textContent !== n.presence) $('pl-presence').textContent = n.presence;
    for (const p of [1, 2]) {
        const mask = (n.inputs && n.inputs[p - 1]) || 0;
        for (const b of document.querySelectorAll(`#pl-pad${p} .b`)) b.classList.toggle('on', !!(mask & (1 << Number(b.dataset.bit))));
    }
}

function showFrame(slug) {
    const img = $('pl-tv-img');
    const next = new Image();
    next.onload = () => { img.src = next.src; $('pl-tv-nosig').hidden = true; frameAt = Date.now(); };
    next.src = `/api/play/s/${encodeURIComponent(slug)}/frame?t=${Date.now()}`;
}

function wireLive(slug) {
    if (liveWired || typeof io !== 'function') return;
    liveWired = true;
    const socket = io({ transports: ['websocket', 'polling'] });
    socket.on('connect', () => socket.emit('live:watch', slug));
    socket.on('live:now', renderNow);
    socket.on('live:frame', () => showFrame(slug));
    setInterval(() => { if (frameAt && Date.now() - frameAt > 20000) $('pl-tv-nosig').hidden = false; }, 5000);
}

async function loadSession(slug) {
    try {
        const res = await AuthModule._api('GET', `/play/s/${encodeURIComponent(slug)}`);
        if (!res.success) throw new Error(res.error);
        if (res.session.open) {
            wireLive(slug);
            if (res.now && $('pl-tv').hidden) { renderNow(res.now); showFrame(slug); }
        }
        $('pl-pad1-name').textContent = res.session.p1_name || '';
        $('pl-pad2-name').textContent = res.session.p2_name || '';
        const stamp = JSON.stringify([res.total_events, res.session]);
        if (stamp !== lastStamp) {
            lastStamp = stamp;
            renderSession(res);
        }
        $('pl-view').hidden = false;
    } catch {
        if (!session) {
            $('pl-view').hidden = false;
            $('pl-title').textContent = 'Session not found';
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
