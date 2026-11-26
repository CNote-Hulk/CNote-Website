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
        return `<b>${esc(winner)}</b> beat ${esc(loser)}${rounds}`;
    }
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
    $('pl-empty').hidden = !!res.total_events;
    $('pl-feed').innerHTML = res.events.map((e) => `<li><span class="pl-dim">${when(e.occurred_at)}</span> ${describe(e)}${e.game ? ` <span class="pl-dim">· ${esc(e.game)}</span>` : ''}</li>`).join('');
}

async function loadSession(slug) {
    try {
        const res = await AuthModule._api('GET', `/play/s/${encodeURIComponent(slug)}`);
        if (!res.success) throw new Error(res.error);
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

const slug = new URLSearchParams(location.search).get('s');
if (slug) {
    wireOwnerButtons();
    loadSession(slug);
    setInterval(() => { if (!document.hidden && (!session || session.open)) loadSession(slug); }, REFRESH_MS);
} else if (AuthModule.isLoggedIn()) {
    loadHome();
} else {
    $('pl-login').hidden = false;
}
