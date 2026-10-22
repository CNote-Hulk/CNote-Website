/* ─────────────────────────────────────────
   FILE: devices.js
   DESCRIPTION: Connected consoles — a PS2 (CNote, running under PSBBN) links
   itself to a CNote account with a pairing code, like a TV app:
     1. the console calls POST /pair/start (no account) and shows the short
        user_code on screen; it keeps the long device_code secret;
     2. the user types the user_code in the app (POST /pair/confirm, logged in);
     3. the console polls POST /pair/poll with its device_code and, once
        confirmed, receives a long-lived device token (shown exactly once);
     4. from then on it calls POST /heartbeat with that token.
   The account owner lists/unlinks consoles with GET / and DELETE /:id.
   Only hashes of device_code / device token are stored.
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

const PAIR_TTL_SECONDS = 600;
const POLL_INTERVAL_SECONDS = 5;
// No 0/O/1/I/L/U: the code is read off a TV and typed on a phone.
const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

function hashSecret(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function newUserCode() {
    const bytes = crypto.randomBytes(6);
    let code = '';
    for (let i = 0; i < 6; i++) code += USER_CODE_ALPHABET[bytes[i] % USER_CODE_ALPHABET.length];
    return code;
}

/** Accepts "k7p-2qx", "K7P 2QX", "k7p2qx" → "K7P2QX"; '' if not a plausible code. */
function normalizeUserCode(input) {
    const code = String(input || '').toUpperCase().replace(/[\s-]/g, '');
    if (code.length !== 6) return '';
    for (const ch of code) if (!USER_CODE_ALPHABET.includes(ch)) return '';
    return code;
}

/** Short, printable, length-capped string from console-reported info. */
function cleanField(value, max) {
    return String(value || '').replace(/[^\x20-\x7E]/g, '').trim().slice(0, max);
}

function consoleInfo(body) {
    const b = body || {};
    return {
        model: cleanField(b.model, 40),
        romver: cleanField(b.romver, 20),
        region: cleanField(b.region, 20),
        name: cleanField(b.name, 40),
        platform: cleanField(b.platform, 20) || 'ps2',
    };
}

/** What the account owner sees about one of their consoles. */
function publicConsole(row) {
    return {
        id: row.id,
        platform: row.platform,
        name: row.name || '',
        model: row.model || '',
        romver: row.romver || '',
        region: row.region || '',
        linked_at: row.linked_at,
        last_seen_at: row.last_seen_at,
    };
}

/**
 * POST /api/devices/pair/start — called by the console (no account yet).
 * Body: { model, romver, region, name, platform }
 */
router.post('/pair/start', async (req, res) => {
    const info = consoleInfo(req.body);
    const deviceCode = crypto.randomBytes(32).toString('hex');
    try {
        // Expired, never-confirmed attempts are dead weight.
        await pool.query(
            `DELETE FROM connected_consoles WHERE user_id IS NULL AND pair_expires_at < NOW()`
        );
        let userCode = '';
        for (let attempt = 0; attempt < 5 && !userCode; attempt++) {
            const candidate = newUserCode();
            const { rows } = await pool.query(
                `INSERT INTO connected_consoles
                    (user_code, device_code_hash, platform, model, romver, region, name, pair_expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + ($8::text || ' seconds')::interval)
                 ON CONFLICT (user_code) DO NOTHING
                 RETURNING id`,
                [candidate, hashSecret(deviceCode), info.platform, info.model, info.romver,
                    info.region, info.name, String(PAIR_TTL_SECONDS)]
            );
            if (rows.length) userCode = candidate;
        }
        if (!userCode) return res.status(503).json({ success: false, error: 'Try again', retryable: true });
        return res.json({
            success: true,
            device_code: deviceCode,
            user_code: userCode,
            expires_in: PAIR_TTL_SECONDS,
            interval: POLL_INTERVAL_SECONDS,
        });
    } catch (err) {
        console.error('[devices] pair/start:', err.message);
        return res.status(503).json({ success: false, error: 'Database unavailable', retryable: true });
    }
});

/**
 * POST /api/devices/pair/poll — called by the console until the user confirms.
 * Body: { device_code }. 202 pending, 200 linked (token returned once), 410 expired/unknown.
 */
router.post('/pair/poll', async (req, res) => {
    const deviceCode = String((req.body && req.body.device_code) || '');
    if (!/^[0-9a-f]{64}$/.test(deviceCode)) {
        return res.status(400).json({ success: false, error: 'device_code required' });
    }
    try {
        const { rows } = await pool.query(
            `SELECT c.id, c.user_id, c.pair_expires_at, u.username, u.avatar
               FROM connected_consoles c LEFT JOIN users u ON u.id = c.user_id
              WHERE c.device_code_hash = $1`,
            [hashSecret(deviceCode)]
        );
        const row = rows[0];
        if (!row) return res.status(410).json({ success: false, status: 'expired' });
        if (!row.user_id) {
            if (new Date(row.pair_expires_at) < new Date()) {
                return res.status(410).json({ success: false, status: 'expired' });
            }
            return res.status(202).json({ success: true, status: 'pending', interval: POLL_INTERVAL_SECONDS });
        }
        // Confirmed: issue the device token and burn the device_code, in one statement
        // so two racing polls can't both get a token.
        const deviceToken = crypto.randomBytes(32).toString('hex');
        const issued = await pool.query(
            `UPDATE connected_consoles
                SET token_hash = $1, device_code_hash = NULL, last_seen_at = NOW()
              WHERE id = $2 AND device_code_hash = $3
              RETURNING id`,
            [hashSecret(deviceToken), row.id, hashSecret(deviceCode)]
        );
        if (!issued.rows.length) return res.status(410).json({ success: false, status: 'expired' });
        return res.json({
            success: true,
            status: 'linked',
            device_token: deviceToken,
            console_id: row.id,
            user: { username: row.username },
        });
    } catch (err) {
        console.error('[devices] pair/poll:', err.message);
        return res.status(503).json({ success: false, error: 'Database unavailable', retryable: true });
    }
});

/**
 * POST /api/devices/pair/confirm — the logged-in user types the code from the TV.
 * Body: { user_code }
 */
router.post('/pair/confirm', authRequired, async (req, res) => {
    const userCode = normalizeUserCode(req.body && req.body.user_code);
    if (!userCode) return res.status(400).json({ success: false, error: 'Invalid code' });
    try {
        const { rows } = await pool.query(
            `UPDATE connected_consoles
                SET user_id = $1, linked_at = NOW(), user_code = NULL
              WHERE user_code = $2 AND user_id IS NULL AND pair_expires_at > NOW()
              RETURNING *`,
            [req.user.id, userCode]
        );
        if (!rows.length) {
            return res.status(404).json({ success: false, error: 'Code not found or expired' });
        }
        return res.json({ success: true, console: publicConsole(rows[0]) });
    } catch (err) {
        console.error('[devices] pair/confirm:', err.message);
        return res.status(503).json({ success: false, error: 'Database unavailable', retryable: true });
    }
});

/** GET /api/devices — the caller's linked consoles. */
router.get('/', authRequired, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT * FROM connected_consoles
              WHERE user_id = $1 AND token_hash IS NOT NULL
              ORDER BY COALESCE(last_seen_at, linked_at) DESC`,
            [req.user.id]
        );
        return res.json({ success: true, consoles: rows.map(publicConsole) });
    } catch (err) {
        console.error('[devices] list:', err.message);
        return res.status(503).json({ success: false, error: 'Database unavailable', retryable: true });
    }
});

/** DELETE /api/devices/:id — unlink; the console's token stops working. */
router.delete('/:id', authRequired, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: 'Invalid id' });
    try {
        const { rows } = await pool.query(
            `DELETE FROM connected_consoles WHERE id = $1 AND user_id = $2 RETURNING id`,
            [id, req.user.id]
        );
        if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
        return res.json({ success: true });
    } catch (err) {
        console.error('[devices] delete:', err.message);
        return res.status(503).json({ success: false, error: 'Database unavailable', retryable: true });
    }
});

/**
 * POST /api/devices/heartbeat — the console reports in with its device token
 * (header X-Device-Token); may refresh model/romver/region/name.
 */
router.post('/heartbeat', async (req, res) => {
    const token = String(req.get('x-device-token') || '');
    if (!/^[0-9a-f]{64}$/.test(token)) return res.status(401).json({ success: false, error: 'Device token required' });
    const info = consoleInfo(req.body);
    try {
        const { rows } = await pool.query(
            `UPDATE connected_consoles c
                SET last_seen_at = NOW(),
                    model  = COALESCE(NULLIF($2, ''), c.model),
                    romver = COALESCE(NULLIF($3, ''), c.romver),
                    region = COALESCE(NULLIF($4, ''), c.region),
                    name   = COALESCE(NULLIF($5, ''), c.name)
               FROM users u
              WHERE c.token_hash = $1 AND u.id = c.user_id
              RETURNING c.id, u.username`,
            [hashSecret(token), info.model, info.romver, info.region, info.name]
        );
        if (!rows.length) return res.status(401).json({ success: false, error: 'Console not linked' });
        return res.json({ success: true, console_id: rows[0].id, user: { username: rows[0].username } });
    } catch (err) {
        console.error('[devices] heartbeat:', err.message);
        return res.status(503).json({ success: false, error: 'Database unavailable', retryable: true });
    }
});

router._test = { normalizeUserCode, newUserCode, hashSecret, USER_CODE_ALPHABET };

module.exports = router;
