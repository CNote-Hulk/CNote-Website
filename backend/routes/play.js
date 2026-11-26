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
     POST   /api/play/device/events       (device) batch of events, idempotent by client id
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

router._test = { buildBoards, cleanData };

module.exports = router;
