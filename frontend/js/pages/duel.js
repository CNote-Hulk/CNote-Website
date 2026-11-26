/**
 * CNote Duel — the player's phone (duel.html?m=<match>&k=<key>), reached from the QR codes ArmSX2
 * shows before each match (Tools → Duel). Step 1: type a name (no account). Step 2: the phone is a
 * second screen, DS-style — opponent on top, you at the bottom — fed live over socket.io by the
 * emulator (routes/play.js: 'duel:live', 'duel:names', 'duel:result').
 */
import { AuthModule } from '../modules/auth.js?v=20261005';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const matchId = params.get('m');
const key = params.get('k');
const NAME_KEY = 'cn_duel_name';

let side = 0;          // 1 = P1, 2 = P2
let names = { p1_name: '', p2_name: '' };
let lastResult = null;

function show(id) {
    for (const s of ['du-join', 'du-live', 'du-result', 'du-error']) $(s).hidden = s !== id;
}

function myName() { return (side === 1 ? names.p1_name : names.p2_name) || 'Tu'; }
function opName() { return (side === 1 ? names.p2_name : names.p1_name) || 'Adversar'; }

function rounds(el, n, need) {
    const total = Math.max(need || 2, n || 0);
    el.innerHTML = Array.from({ length: total }, (_, i) => `<span class="${i < n ? 'on' : ''}"></span>`).join('');
}

function renderNames() {
    $('du-me-name').textContent = myName();
    $('du-op-name').textContent = opName();
}

function renderLive(s) {
    const me = side === 1 ? 1 : 2;
    const op = 3 - me;
    const pct = (v) => Math.max(0, Math.min(100, Math.round((v ?? 1) * 100)));
    $('du-me-bar').style.width = pct(s['h' + me]) + '%';
    $('du-op-bar').style.width = pct(s['h' + op]) + '%';
    $('du-me-bar').classList.toggle('low', pct(s['h' + me]) < 25);
    $('du-me-char').textContent = s['c' + me] || '';
    $('du-op-char').textContent = s['c' + op] || '';
    rounds($('du-me-rounds'), s['r' + me] || 0, 2);
    rounds($('du-op-rounds'), s['r' + op] || 0, 2);
    $('du-fight').textContent = s.ladder ? `Arcade · lupta ${(s.fight || 0) + 1} din ${s.ladder}` : '';
    if (s.place != null) $('du-fight').textContent = `Locul ${s.place + 1}`;
    $('du-phase').textContent = s.phase || 'FIGHT!';
}

function renderResult(r) {
    lastResult = r;
    const won = r.winner === side;
    $('du-result-big').textContent = won ? 'WIN' : 'LOSE';
    $('du-result').classList.toggle('du-result--win', won);
    $('du-result-text').textContent = r.text || '';
    show('du-result');
    try { navigator.vibrate && navigator.vibrate(won ? [80, 60, 80, 60, 200] : [400]); } catch { /* no vibration */ }
}

function connect() {
    if (typeof io !== 'function') return;
    const socket = io({ transports: ['websocket', 'polling'] });
    socket.on('connect', () => socket.emit('duel:watch', { m: matchId, k: key }));
    socket.on('duel:names', (n) => { names = n; renderNames(); });
    socket.on('duel:live', (s) => { if (!$('du-live').hidden) renderLive(s); });
    socket.on('duel:result', renderResult);
}

async function join(name) {
    const res = await AuthModule._api('POST', '/play/join', { m: matchId, k: key, name });
    if (!res.success) { show('du-error'); return; }
    try { localStorage.setItem(NAME_KEY, name); } catch { /* private mode */ }
    names = { p1_name: res.p1_name, p2_name: res.p2_name };
    renderNames();
    show('du-live');
}

async function start() {
    if (!matchId || !key) { show('du-error'); return; }
    const res = await AuthModule._api('GET', `/play/join?m=${encodeURIComponent(matchId)}&k=${encodeURIComponent(key)}`);
    if (!res.success) { show('du-error'); return; }
    side = res.side;
    names = { p1_name: res.p1_name, p2_name: res.p2_name };
    document.body.classList.add('du-p' + side);
    $('du-tag').textContent = `🎮 Controller ${side}`;
    $('du-title').textContent = res.title || 'Duel';
    if (res.slug) $('du-board').href = `play.html?s=${encodeURIComponent(res.slug)}`;
    let saved = '';
    try { saved = localStorage.getItem(NAME_KEY) || ''; } catch { /* private mode */ }
    const me = AuthModule.getCurrentUser();
    $('du-name').value = saved || (me && me.username) || '';
    show('du-join');
    connect();
}

$('du-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = $('du-name').value.trim();
    if (name) join(name);
});
$('du-again').addEventListener('click', () => show('du-live'));

start();
