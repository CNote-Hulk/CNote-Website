/* ─────────────────────────────────────────
   FILE: play.js
   DESCRIPTION: CNote Play — game-night sessions with a live leaderboard.
   The account owner creates a session on the site (title + who holds
   controller 1 and controller 2). A linked console (ArmSX2 with CNote Live,
   paired through routes/devices.js) reads the game's memory and reports
   what happened — a finished fight, an arcade run that ended at fight N —
   with its device token. Events are filed under the owner's session that
   was open when they happened, so a console that was offline (queued
   events) still lands them in the right night. The session page is public
   by its slug, so friends can watch it on their phones.

     POST   /api/play/sessions            (owner) create; closes the open one
     GET    /api/play/sessions            (owner) my sessions
     PATCH  /api/play/sessions/:id        (owner) rename, swap players, end
     GET    /api/play/s/:slug             (public) session + events + boards
     GET    /api/play/device/current      (device) the open session, for the emulator's toast
     POST   /api/play/device/session      (device) a game started: open a session named after it
     POST   /api/play/device/events       (device) batch of events, idempotent by client id
   Duel (2026-11-27, Tools → Duel in ArmSX2): before each match the emulator shows two QR codes;
   each player names himself on his phone, which then works as a second screen (live health,
   rounds, fighters, result) — like a Nintendo DS.
     POST   /api/play/device/match        (device) new match → {id, k1, k2} for the QR codes
     GET    /api/play/device/match/:id    (device) the names typed so far
     POST   /api/play/device/live         (device) live state of a match → phones (socket.io)
   Live, every game (2026-11-27): what the emulator sees, with no per-game code — the game's
   save icon (from its own files), RetroAchievements rich presence and achievement count, the
   buttons held on each controller, and a frame of the picture every few seconds.
     POST   /api/play/device/now          (device) {serial,title,presence,ach,inputs} each second
     POST   /api/play/device/frame        (device) image/jpeg body, the latest picture
     GET    /api/play/icon/:serial        (public) the icon strip (PNG); 404 → the device uploads it
     PUT    /api/play/device/icon/:serial (device) image/png body, ?frames=N
     GET    /api/play/s/:slug/frame       (public) the latest picture of that session's game
   socket.io: 'live:watch' slug joins 'live:<slug>' → 'live:now', 'live:frame'.
     GET    /api/play/join?m=&k=          (public, with a key) which side, game, names
     POST   /api/play/join                (public, with a key) { m, k, name }
   socket.io: 'duel:watch' {m, k} joins the match room; the room gets 'duel:live',
   'duel:names' and 'duel:result'.
   ───────────────────────────────────────── */
/* ── REQUIRED IMPORTS — DO NOT REMOVE ──────
   If you add a new package:
     1. require() it here
     2. Add it to package.json dependencies
   ────────────────────────────────────────── */
const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

const MAX_EVENTS_PER_BATCH = 100;
const KINDS = new Set(['fight', 'arcade_run', 'race', 'score']);

(async function initPlayTables() {
    const statements = [
        `CREATE TABLE IF NOT EXISTS play_sessions (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            slug       TEXT UNIQUE NOT NULL,
            title      TEXT NOT NULL DEFAULT '',
            p1_name    TEXT NOT NULL DEFAULT '',
            p2_name    TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ended_at   TIMESTAMPTZ
        )`,
        `ALTER TABLE play_sessions ADD COLUMN IF NOT EXISTS game_serial TEXT NOT NULL DEFAULT ''`,
        `CREATE INDEX IF NOT EXISTS idx_play_sessions_user ON play_sessions(user_id, created_at DESC)`,
        `CREATE TABLE IF NOT EXISTS play_events (
            id              SERIAL PRIMARY KEY,
            session_id      INTEGER REFERENCES play_sessions(id) ON DELETE CASCADE,
            user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            console_id      INTEGER REFERENCES connected_consoles(id) ON DELETE SET NULL,
            client_id       TEXT NOT NULL,
            serial          TEXT NOT NULL DEFAULT '',
            game            TEXT NOT NULL DEFAULT '',
            kind            TEXT NOT NULL,
            p1_name         TEXT NOT NULL DEFAULT '',
            p2_name         TEXT NOT NULL DEFAULT '',
            data            JSONB NOT NULL DEFAULT '{}'::jsonb,
            occurred_at     TIMESTAMPTZ NOT NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (user_id, client_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_play_events_session ON play_events(session_id, occurred_at)`,
        // Duel (2026-11-27): one row per match the emulator announces; k1/k2 are the keys in the
        // two QR codes, so only someone who scanned P1's code can name P1.
        `CREATE TABLE IF NOT EXISTS play_matches (
            id         SERIAL PRIMARY KEY,
            session_id INTEGER REFERENCES play_sessions(id) ON DELETE CASCADE,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            k1         TEXT NOT NULL,
            k2         TEXT NOT NULL,
            p1_name    TEXT NOT NULL DEFAULT '',
            p2_name    TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        // Live (2026-11-27): a game's own save icon, rendered by the emulator from the game's files
        // (memory card / disc) as a strip of `frames` square frames turning around — the PS2 browser's
        // spinning icon. One per serial, shared by everyone.
        `CREATE TABLE IF NOT EXISTS play_icons (
            serial     TEXT PRIMARY KEY,
            frames     INTEGER NOT NULL DEFAULT 1,
            png        BYTEA NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
    ];
    for (const sql of statements) {
        try { await pool.query(sql); } catch (err) { console.error('[play] init:', err.message); }
    }
})();

function hashSecret(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function cleanText(value, max) {
    return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

function newSlug() {
    return crypto.randomBytes(6).toString('base64url');
}

function publicSession(row) {
    return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        p1_name: row.p1_name,
        p2_name: row.p2_name,
        created_at: row.created_at,
        ended_at: row.ended_at,
        open: !row.ended_at,
    };
}

function int(v, min, max) {
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n)) return null;
    return Math.min(max, Math.max(min, n));
}

/**
 * Only the fields each kind needs, clamped; anything else the console sends is dropped.
 *   fight:      winner 1|2, rounds [p1, p2], vs_cpu, p1_char, p2_char
 *   arcade_run: player 1|2, reached (fight number, 1 = lost the first fight), cleared, char
 *   race/score: player 1|2, score, position, label
 */
function cleanData(kind, d) {
    const src = d && typeof d === 'object' ? d : {};
    const out = {};
    if (kind === 'fight') {
        out.winner = int(src.winner, 1, 2);
        if (Array.isArray(src.rounds)) out.rounds = [int(src.rounds[0], 0, 9) ?? 0, int(src.rounds[1], 0, 9) ?? 0];
        out.vs_cpu = !!src.vs_cpu;
        if (src.p1_char) out.p1_char = cleanText(src.p1_char, 30);
        if (src.p2_char) out.p2_char = cleanText(src.p2_char, 30);
        if (src.mode) out.mode = cleanText(src.mode, 20);
    } else if (kind === 'arcade_run') {
        out.player = int(src.player, 1, 2) ?? 1;
        out.reached = int(src.reached, 1, 99) ?? 1;
        out.cleared = !!src.cleared;
        if (src.char) out.char = cleanText(src.char, 30);
    } else {
        if (kind === 'race' && src.winner != null) { out.winner = int(src.winner, 1, 2); return out; }
        out.player = int(src.player, 1, 2) ?? 1;
        if (src.score != null) out.score = int(src.score, 0, 2147483647);
        if (src.position != null) out.position = int(src.position, 1, 99);
        if (src.label) out.label = cleanText(src.label, 40);
    }
    return out;
}

/** The leaderboards for a list of events (oldest first). Pure: tested directly. */
function buildBoards(events) {
    const versus = new Map();   // name -> { name, wins, losses }
    const arcade = new Map();   // name -> best run
    const cpu = new Map();      // name -> { wins, losses } against the CPU outside arcade runs
    const races = new Map();    // name -> { wins, losses } in split-screen races
    const bump = (map, name) => {
        if (!map.has(name)) map.set(name, { name, wins: 0, losses: 0 });
        return map.get(name);
    };
    for (const e of events) {
        const d = e.data || {};
        if (e.kind === 'fight' && (d.winner === 1 || d.winner === 2)) {
            const p1 = e.p1_name || 'P1';
            const p2 = d.vs_cpu ? 'CPU' : (e.p2_name || 'P2');
            const winner = d.winner === 1 ? p1 : p2;
            const loser = d.winner === 1 ? p2 : p1;
            if (d.vs_cpu) {
                const human = bump(cpu, p1);
                if (d.winner === 1) human.wins++; else human.losses++;
            } else {
                bump(versus, winner).wins++;
                bump(versus, loser).losses++;
            }
        } else if (e.kind === 'race' && (d.winner === 1 || d.winner === 2)) {
            const p1 = e.p1_name || 'P1';
            const p2 = e.p2_name || 'P2';
            bump(races, d.winner === 1 ? p1 : p2).wins++;
            bump(races, d.winner === 1 ? p2 : p1).losses++;
        } else if (e.kind === 'arcade_run') {
            const name = (d.player === 2 ? e.p2_name : e.p1_name) || ('P' + (d.player || 1));
            const run = { name, reached: d.reached || 1, cleared: !!d.cleared, char: d.char || '', game: e.game, at: e.occurred_at };
            const best = arcade.get(name);
            if (!best || run.cleared > best.cleared || (run.cleared === best.cleared && run.reached > best.reached)) {
                arcade.set(name, { ...run, runs: (best ? best.runs : 0) + 1 });
            } else {
                best.runs++;
            }
        }
    }
    const byWins = (a, b) => b.wins - a.wins || a.losses - b.losses || a.name.localeCompare(b.name);
    return {
        versus: [...versus.values()].sort(byWins),
        arcade: [...arcade.values()].sort((a, b) => (b.cleared - a.cleared) || (b.reached - a.reached) || a.name.localeCompare(b.name)),
        vs_cpu: [...cpu.values()].sort(byWins),
        races: [...races.values()].sort(byWins),
    };
}

/* ── owner: sessions ─────────────────────── */

router.post('/sessions', authRequired, async (req, res) => {
    const b = req.body || {};
    const title = cleanText(b.title, 80) || 'Game night';
    const p1 = cleanText(b.p1_name, 30);
    const p2 = cleanText(b.p2_name, 30);
    try {
        await pool.query(`UPDATE play_sessions SET ended_at = NOW() WHERE user_id = $1 AND ended_at IS NULL`, [req.user.id]);
        let row = null;
        for (let attempt = 0; attempt < 5 && !row; attempt++) {
            const { rows } = await pool.query(
                `INSERT INTO play_sessions (user_id, slug, title, p1_name, p2_name)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (slug) DO NOTHING RETURNING *`,
                [req.user.id, newSlug(), title, p1, p2]
            );
            row = rows[0] || null;
        }
        if (!row) return res.status(503).json({ success: false, error: 'Try again' });
        return res.json({ success: true, session: publicSession(row) });
    } catch (err) {
        console.error('[play] create:', err.message);
        return res.status(503).json({ success: false, error: 'Database unavailable' });
    }
});

router.get('/sessions', authRequired, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT s.*, (SELECT COUNT(*)::int FROM play_events e WHERE e.session_id = s.id) AS events
               FROM play_sessions s WHERE s.user_id = $1 ORDER BY s.created_at DESC LIMIT 50`,
            [req.user.id]
        );
        return res.json({ success: true, sessions: rows.map((r) => ({ ...publicSession(r), events: r.events })) });
    } catch (err) {
        console.error('[play] list:', err.message);
        return res.status(503).json({ success: false, error: 'Database unavailable' });
    }
});

router.patch('/sessions/:id', authRequired, async (req, res) => {
    const id = int(req.params.id, 1, 2147483647);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const b = req.body || {};
    const sets = [];
    const vals = [id, req.user.id];
    if (b.title !== undefined) { vals.push(cleanText(b.title, 80) || 'Game night'); sets.push(`title = $${vals.length}`); }
    if (b.p1_name !== undefined) { vals.push(cleanText(b.p1_name, 30)); sets.push(`p1_name = $${vals.length}`); }
    if (b.p2_name !== undefined) { vals.push(cleanText(b.p2_name, 30)); sets.push(`p2_name = $${vals.length}`); }
    if (b.end === true) sets.push(`ended_at = COALESCE(ended_at, NOW())`);
    if (!sets.length) return res.status(400).json({ success: false, error: 'Nothing to change' });
    try {
        const { rows } = await pool.query(
            `UPDATE play_sessions SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING *`, vals
        );
        if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
        return res.json({ success: true, session: publicSession(rows[0]) });
    } catch (err) {
        console.error('[play] patch:', err.message);
        return res.status(503).json({ success: false, error: 'Database unavailable' });
    }
});

/* ── public: one session ─────────────────── */

router.get('/s/:slug', async (req, res) => {
    const slug = String(req.params.slug || '');
    if (!/^[A-Za-z0-9_-]{4,16}$/.test(slug)) return res.status(404).json({ success: false, error: 'Not found' });
    try {
        const { rows } = await pool.query(
            `SELECT s.*, u.username FROM play_sessions s JOIN users u ON u.id = s.user_id WHERE s.slug = $1`, [slug]
        );
        if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
        const session = rows[0];
        const ev = await pool.query(
            `SELECT id, serial, game, kind, p1_name, p2_name, data, occurred_at
               FROM play_events WHERE session_id = $1 ORDER BY occurred_at, id LIMIT 2000`,
            [session.id]
        );
        return res.json({
            success: true,
            session: { ...publicSession(session), host: session.username },
            now: session.ended_at ? null : nowFor(session.user_id),
            boards: buildBoards(ev.rows),
            events: ev.rows.slice(-100).reverse(),
            total_events: ev.rows.length,
        });
    } catch (err) {
        console.error('[play] public:', err.message);
        return res.status(503).json({ success: false, error: 'Database unavailable' });
    }
});

/* ── device ──────────────────────────────── */

async function deviceAuth(req, res, next) {
    const token = String(req.get('x-device-token') || '');
    if (!/^[0-9a-f]{64}$/.test(token)) return res.status(401).json({ success: false, error: 'Device token required' });
    try {
        const { rows } = await pool.query(
            `UPDATE connected_consoles SET last_seen_at = NOW()
              WHERE token_hash = $1 AND user_id IS NOT NULL RETURNING id, user_id`,
            [hashSecret(token)]
        );
        if (!rows.length) return res.status(401).json({ success: false, error: 'Console not linked' });
        req.device = rows[0];
        return next();
    } catch (err) {
        console.error('[play] device auth:', err.message);
        return res.status(503).json({ success: false, error: 'Database unavailable', retryable: true });
    }
}

router.get('/device/current', deviceAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT * FROM play_sessions WHERE user_id = $1 AND ended_at IS NULL ORDER BY created_at DESC LIMIT 1`,
            [req.device.user_id]
        );
        return res.json({ success: true, session: rows.length ? publicSession(rows[0]) : null });
    } catch (err) {
        console.error('[play] current:', err.message);
        return res.status(503).json({ success: false, error: 'Database unavailable', retryable: true });
    }
});

/**
 * POST /api/play/device/session — a game started in the emulator: open a session named after it
 * (closing the open one), unless the open one is already this game and less than 6 h old — a
 * restart or a crash mid-night keeps the same scoreboard. Body: { game, serial }.
 */
router.post('/device/session', deviceAuth, async (req, res) => {
    const game = cleanText(req.body && req.body.game, 60) || 'Game night';
    const serial = cleanText(req.body && req.body.serial, 20);
    try {
        const open = await pool.query(
            `SELECT s.* FROM play_sessions s
              WHERE s.user_id = $1 AND s.ended_at IS NULL ORDER BY s.created_at DESC LIMIT 1`,
            [req.device.user_id]
        );
        const cur = open.rows[0];
        if (cur && cur.game_serial === serial && serial && Date.now() - new Date(cur.created_at).getTime() < 6 * 3600 * 1000) {
            return res.json({ success: true, session: publicSession(cur), reused: true });
        }
        const user = await pool.query(`SELECT username FROM users WHERE id = $1`, [req.device.user_id]);
        const p1 = cur ? cur.p1_name : ((user.rows[0] && user.rows[0].username) || '');
        const p2 = cur ? cur.p2_name : '';
        await pool.query(`UPDATE play_sessions SET ended_at = NOW() WHERE user_id = $1 AND ended_at IS NULL`, [req.device.user_id]);
        let row = null;
        for (let attempt = 0; attempt < 5 && !row; attempt++) {
            const { rows } = await pool.query(
                `INSERT INTO play_sessions (user_id, slug, title, p1_name, p2_name, game_serial)
                 VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (slug) DO NOTHING RETURNING *`,
                [req.device.user_id, newSlug(), game, p1, p2, serial]
            );
            row = rows[0] || null;
        }
        if (!row) return res.status(503).json({ success: false, error: 'Try again', retryable: true });
        return res.json({ success: true, session: publicSession(row) });
    } catch (err) {
        console.error('[play] device session:', err.message);
        return res.status(503).json({ success: false, error: 'Database unavailable', retryable: true });
    }
});

router.post('/device/events', deviceAuth, async (req, res) => {
    const list = Array.isArray(req.body && req.body.events) ? req.body.events.slice(0, MAX_EVENTS_PER_BATCH) : [];
    if (!list.length) return res.status(400).json({ success: false, error: 'events required' });
    const accepted = [];
    const rejected = [];
    const now = Date.now();
    try {
        for (const raw of list) {
            const clientId = cleanText(raw && raw.id, 64);
            const kind = cleanText(raw && raw.kind, 20);
            if (!clientId || !KINDS.has(kind)) { if (clientId) rejected.push(clientId); continue; }
            let at = Date.parse(raw.at);
            // A tablet clock is good, but never trust a future or prehistoric timestamp.
            if (!Number.isFinite(at) || at > now + 5 * 60 * 1000 || at < now - 30 * 24 * 3600 * 1000) at = now;
            const occurred = new Date(at).toISOString();
            const { rows } = await pool.query(
                `INSERT INTO play_events
                    (session_id, user_id, console_id, client_id, serial, game, kind, p1_name, p2_name, data, occurred_at)
                 SELECT s.id, $1, $2, $3, $4, $5, $6, COALESCE(s.p1_name, ''), COALESCE(s.p2_name, ''), $7::jsonb, $8
                   FROM (SELECT 1) one
                   LEFT JOIN LATERAL (
                        SELECT id, p1_name, p2_name FROM play_sessions
                         WHERE user_id = $1 AND created_at <= $8 AND (ended_at IS NULL OR ended_at > $8)
                         ORDER BY created_at DESC LIMIT 1) s ON TRUE
                 ON CONFLICT (user_id, client_id) DO NOTHING
                 RETURNING id`,
                [req.device.user_id, req.device.id, clientId, cleanText(raw.serial, 20), cleanText(raw.game, 60),
                    kind, JSON.stringify(cleanData(kind, raw.data)), occurred]
            );
            // Already stored (a retry after a lost response) counts as accepted too.
            accepted.push(clientId);
            void rows;
        }
        return res.json({ success: true, accepted, rejected });
    } catch (err) {
        console.error('[play] events:', err.message);
        return res.status(503).json({ success: false, error: 'Database unavailable', retryable: true, accepted });
    }
});

/* ── duel ────────────────────────────────── */

function newKey() {
    return crypto.randomBytes(9).toString('base64url');
}

/** Which side a key opens (1 / 2), or 0. */
function sideOf(match, key) {
    const k = String(key || '');
    if (!match || k.length < 8) return 0;
    if (crypto.timingSafeEqual(Buffer.from(match.k1.padEnd(32)), Buffer.from(k.padEnd(32).slice(0, 32)))) return 1;
    if (crypto.timingSafeEqual(Buffer.from(match.k2.padEnd(32)), Buffer.from(k.padEnd(32).slice(0, 32)))) return 2;
    return 0;
}

async function loadMatch(id) {
    const m = int(id, 1, 2147483647);
    if (!m) return null;
    const { rows } = await pool.query(
        `SELECT m.*, s.title, s.slug, s.p1_name AS s_p1, s.p2_name AS s_p2
           FROM play_matches m LEFT JOIN play_sessions s ON s.id = m.session_id WHERE m.id = $1`, [m]
    );
    return rows[0] || null;
}

router.post('/device/match', deviceAuth, async (req, res) => {
    try {
        const open = await pool.query(
            `SELECT id, p1_name, p2_name FROM play_sessions WHERE user_id = $1 AND ended_at IS NULL
              ORDER BY created_at DESC LIMIT 1`, [req.device.user_id]
        );
        const s = open.rows[0] || null;
        const { rows } = await pool.query(
            `INSERT INTO play_matches (session_id, user_id, k1, k2, p1_name, p2_name)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, k1, k2`,
            [s ? s.id : null, req.device.user_id, newKey(), newKey(), s ? s.p1_name : '', s ? s.p2_name : '']
        );
        return res.json({ success: true, match: rows[0] });
    } catch (err) {
        console.error('[play] match:', err.message);
        return res.status(503).json({ success: false, error: 'Database unavailable', retryable: true });
    }
});

router.get('/device/match/:id', deviceAuth, async (req, res) => {
    try {
        const m = await loadMatch(req.params.id);
        if (!m || m.user_id !== req.device.user_id) return res.status(404).json({ success: false, error: 'Not found' });
        return res.json({ success: true, p1_name: m.p1_name, p2_name: m.p2_name });
    } catch (err) {
        return res.status(503).json({ success: false, error: 'Database unavailable', retryable: true });
    }
});

/** Live state from the emulator, a few times a second: only relayed, never stored. */
const LIVE_FIELDS = ['h1', 'h2', 'r1', 'r2', 'c1', 'c2', 'fight', 'ladder', 'mode', 'phase', 'place', 'game'];
router.post('/device/live', deviceAuth, async (req, res) => {
    const b = req.body || {};
    const id = int(b.match, 1, 2147483647);
    if (!id) return res.status(400).json({ success: false });
    const state = {};
    for (const k of LIVE_FIELDS) {
        const v = b.state && b.state[k];
        if (typeof v === 'number' && Number.isFinite(v)) state[k] = v;
        else if (typeof v === 'string') state[k] = cleanText(v, 40);
    }
    const io = req.app.get('io');
    if (io) {
        if (b.result && typeof b.result === 'object') {
            io.to('duel:' + id).emit('duel:result', { winner: int(b.result.winner, 1, 2), text: cleanText(b.result.text, 80) });
        } else {
            io.to('duel:' + id).volatile.emit('duel:live', state);
        }
    }
    return res.json({ success: true });
});

router.get('/join', async (req, res) => {
    try {
        const m = await loadMatch(req.query.m);
        const side = sideOf(m, req.query.k);
        if (!side) return res.status(404).json({ success: false, error: 'This code is no longer valid' });
        return res.json({
            success: true, side, match: m.id, title: m.title || '', slug: m.slug || '',
            p1_name: m.p1_name, p2_name: m.p2_name,
        });
    } catch (err) {
        return res.status(503).json({ success: false, error: 'Database unavailable' });
    }
});

router.post('/join', async (req, res) => {
    const b = req.body || {};
    const name = cleanText(b.name, 20);
    if (!name) return res.status(400).json({ success: false, error: 'Name required' });
    try {
        const m = await loadMatch(b.m);
        const side = sideOf(m, b.k);
        if (!side) return res.status(404).json({ success: false, error: 'This code is no longer valid' });
        const col = side === 1 ? 'p1_name' : 'p2_name';
        await pool.query(`UPDATE play_matches SET ${col} = $1 WHERE id = $2`, [name, m.id]);
        // The session's names follow the latest match, so results land under the right player.
        if (m.session_id) await pool.query(`UPDATE play_sessions SET ${col} = $1 WHERE id = $2`, [name, m.session_id]);
        const io = req.app.get('io');
        const names = { p1_name: side === 1 ? name : m.p1_name, p2_name: side === 2 ? name : m.p2_name };
        if (io) io.to('duel:' + m.id).emit('duel:names', names);
        return res.json({ success: true, side, ...names });
    } catch (err) {
        console.error('[play] join:', err.message);
        return res.status(503).json({ success: false, error: 'Database unavailable' });
    }
});

/** socket.io: a phone that scanned a code watches its match. Called once from server.js. */
function attachSockets(io) {
    io.on('connection', (socket) => {
        socket.on('live:watch', (slug) => {
            if (typeof slug !== 'string' || !/^[A-Za-z0-9_-]{4,16}$/.test(slug)) return;
            for (const room of socket.rooms) if (room.startsWith('live:')) socket.leave(room);
            socket.join('live:' + slug);
        });
        socket.on('duel:watch', async (msg) => {
            try {
                const m = await loadMatch(msg && msg.m);
                if (!sideOf(m, msg && msg.k)) return;
                for (const room of socket.rooms) if (room.startsWith('duel:')) socket.leave(room);
                socket.join('duel:' + m.id);
            } catch { /* a bad watch request just does nothing */ }
        });
    });
}

/* ── live, every game ────────────────────── */

const liveNow = new Map();      // user_id -> { state, at }
const liveFrame = new Map();    // user_id -> { jpeg, at }
const openSlug = new Map();     // user_id -> { slug, at } (open session, cached 20 s)

async function slugFor(userId) {
    const c = openSlug.get(userId);
    if (c && Date.now() - c.at < 20000) return c.slug;
    const { rows } = await pool.query(
        `SELECT slug FROM play_sessions WHERE user_id = $1 AND ended_at IS NULL ORDER BY created_at DESC LIMIT 1`, [userId]
    );
    const slug = rows[0] ? rows[0].slug : '';
    openSlug.set(userId, { slug, at: Date.now() });
    return slug;
}

function cleanNow(b) {
    const s = {
        serial: cleanText(b.serial, 20).toUpperCase().replace(/[^A-Z0-9]/g, ''),
        title: cleanText(b.title, 80),
        presence: cleanText(b.presence, 200),
        ach: Array.isArray(b.ach) ? [int(b.ach[0], 0, 9999) ?? 0, int(b.ach[1], 0, 9999) ?? 0] : null,
        inputs: Array.isArray(b.inputs) ? [int(b.inputs[0], 0, 0xffff) ?? 0, int(b.inputs[1], 0, 0xffff) ?? 0] : [0, 0],
        paused: !!b.paused,
    };
    if (b.unlocked && typeof b.unlocked === 'string') s.unlocked = cleanText(b.unlocked, 80);
    // The fight on screen right now (fighting games the emulator knows): health 0..1, rounds,
    // fighters, arcade fight / ladder, phase; a race: place.
    if (b.fight && typeof b.fight === 'object') {
        const f = {};
        for (const k of ['h1', 'h2']) if (typeof b.fight[k] === 'number' && Number.isFinite(b.fight[k])) f[k] = Math.max(0, Math.min(1, b.fight[k]));
        for (const k of ['r1', 'r2', 'fight', 'ladder', 'place']) { const v = int(b.fight[k], 0, 99); if (v !== null) f[k] = v; }
        for (const k of ['c1', 'c2', 'phase']) if (typeof b.fight[k] === 'string') f[k] = cleanText(b.fight[k], 30);
        s.fight = f;
    }
    return s;
}

router.post('/device/now', deviceAuth, async (req, res) => {
    const state = cleanNow(req.body || {});
    liveNow.set(req.device.user_id, { state, at: Date.now() });
    try {
        const slug = await slugFor(req.device.user_id);
        const io = req.app.get('io');
        if (io && slug) io.to('live:' + slug).volatile.emit('live:now', state);
        return res.json({ success: true });
    } catch (err) {
        return res.status(503).json({ success: false, retryable: true });
    }
});

router.post('/device/frame', express.raw({ type: 'image/jpeg', limit: '400kb' }), deviceAuth, async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 100 || req.body[0] !== 0xff || req.body[1] !== 0xd8) {
        return res.status(400).json({ success: false, error: 'JPEG body required' });
    }
    liveFrame.set(req.device.user_id, { jpeg: req.body, at: Date.now() });
    try {
        const slug = await slugFor(req.device.user_id);
        const io = req.app.get('io');
        if (io && slug) io.to('live:' + slug).volatile.emit('live:frame', { t: Date.now() });
        return res.json({ success: true });
    } catch (err) {
        return res.status(503).json({ success: false, retryable: true });
    }
});

router.put('/device/icon/:serial', express.raw({ type: 'image/png', limit: '1mb' }), deviceAuth, async (req, res) => {
    const serial = String(req.params.serial || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
    const frames = int(req.query.frames, 1, 64) ?? 1;
    if (!serial || !Buffer.isBuffer(req.body) || req.body.length < 8 || req.body.readUInt32BE(0) !== 0x89504e47) {
        return res.status(400).json({ success: false, error: 'PNG body and serial required' });
    }
    try {
        await pool.query(
            `INSERT INTO play_icons (serial, frames, png) VALUES ($1, $2, $3)
             ON CONFLICT (serial) DO UPDATE SET frames = $2, png = $3, updated_at = NOW()`,
            [serial, frames, req.body]
        );
        return res.json({ success: true });
    } catch (err) {
        console.error('[play] icon:', err.message);
        return res.status(503).json({ success: false, retryable: true });
    }
});

router.get('/icon/:serial', async (req, res) => {
    const serial = String(req.params.serial || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
    try {
        const { rows } = await pool.query(`SELECT frames, png FROM play_icons WHERE serial = $1`, [serial]);
        if (!rows.length) return res.status(404).json({ success: false });
        res.set('Content-Type', 'image/png');
        res.set('X-Frames', String(rows[0].frames));
        res.set('Cache-Control', 'public, max-age=3600');
        return res.send(rows[0].png);
    } catch (err) {
        return res.status(503).json({ success: false });
    }
});

router.get('/s/:slug/frame', async (req, res) => {
    const slug = String(req.params.slug || '');
    if (!/^[A-Za-z0-9_-]{4,16}$/.test(slug)) return res.status(404).end();
    try {
        const { rows } = await pool.query(`SELECT user_id, ended_at FROM play_sessions WHERE slug = $1`, [slug]);
        const f = rows[0] && !rows[0].ended_at ? liveFrame.get(rows[0].user_id) : null;
        if (!f || Date.now() - f.at > 5 * 60 * 1000) return res.status(404).end();
        res.set('Content-Type', 'image/jpeg');
        res.set('Cache-Control', 'no-store');
        return res.send(f.jpeg);
    } catch (err) {
        return res.status(503).end();
    }
});

/** The latest live state of a session's game, for the first paint of play.html (null if stale). */
function nowFor(userId) {
    const n = liveNow.get(userId);
    return n && Date.now() - n.at < 30000 ? n.state : null;
}

router._test = { buildBoards, cleanData, sideOf, cleanNow };
router.attachSockets = attachSockets;

module.exports = router;
