/* ─────────────────────────────────────────
   FILE: remote.js
   DESCRIPTION: CNote Remote (the screen-streaming app, repo CNote-Hulk/CNote-Remote) — the
   account's own devices find each other here, so the app needs no host key typed by hand
   and can connect from anywhere over Tailscale:
     - every signed-in device upserts itself (POST /api/remote/devices): name, platform,
       addresses (LAN + Tailscale), screen size, and — when it hosts — its host key;
     - the app lists the account's devices (GET /api/remote/devices) and connects to a host
       with that host's key; DELETE /api/remote/devices/:deviceId forgets one.
   Only the owner ever sees a row (every query is scoped by req.user.id). The host key is the
   secret both ends use for AES-GCM on the stream: storing it here means trusting this server
   with it (fine for Andrei's own devices; a key exchange that keeps it off the server can
   replace this later without changing the routes' shape).
   ───────────────────────────────────────── */
/* ── REQUIRED IMPORTS — DO NOT REMOVE ──────
   If you add a new package:
     1. require() it here
     2. Add it to package.json dependencies
   ────────────────────────────────────────── */
const express = require('express');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

(async function initRemoteDevicesTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS remote_devices (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                device_id VARCHAR(64) NOT NULL,
                name VARCHAR(80) NOT NULL,
                platform VARCHAR(40) DEFAULT '',
                hosting BOOLEAN DEFAULT FALSE,
                host_key CHAR(64),
                host_key_id CHAR(8),
                lan_ip VARCHAR(45),
                tailscale_ip VARCHAR(45),
                screen_w INTEGER DEFAULT 0,
                screen_h INTEGER DEFAULT 0,
                last_seen_at TIMESTAMP DEFAULT NOW(),
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE (user_id, device_id)
            );
        `);
    } catch (err) {
        console.error('[remote] table init error:', err.message);
    }
})();

const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX8 = /^[0-9a-f]{8}$/;
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

function cleanIp(v) {
    const s = String(v || '').trim();
    return IPV4.test(s) ? s : null;
}

function cleanInt(v) {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 && n <= 20000 ? n : 0;
}

/** Validates the body of POST /devices. Returns { error } or { value }. */
function parseDevice(body) {
    const b = body || {};
    const deviceId = String(b.deviceId || '');
    if (!DEVICE_ID.test(deviceId)) return { error: 'Invalid device id.' };
    const name = String(b.name || '').trim().slice(0, 80);
    if (!name) return { error: 'Missing device name.' };
    const hosting = b.hosting === true;
    let hostKey = null;
    let hostKeyId = null;
    if (hosting) {
        hostKey = String(b.hostKey || '').toLowerCase();
        hostKeyId = String(b.hostKeyId || '').toLowerCase();
        if (!HEX64.test(hostKey) || !HEX8.test(hostKeyId)) return { error: 'Invalid host key.' };
    }
    return {
        value: {
            deviceId, name, hosting, hostKey, hostKeyId,
            platform: String(b.platform || '').slice(0, 40),
            lanIp: cleanIp(b.lanIp),
            tailscaleIp: cleanIp(b.tailscaleIp),
            screenW: cleanInt(b.screenW),
            screenH: cleanInt(b.screenH),
        },
    };
}

// POST /api/remote/devices — this device, as it is now (called on sign-in and every few minutes).
router.post('/devices', authRequired, async (req, res) => {
    const parsed = parseDevice(req.body);
    if (parsed.error) return res.status(400).json({ success: false, error: parsed.error });
    const d = parsed.value;
    try {
        await pool.query(
            `INSERT INTO remote_devices (user_id, device_id, name, platform, hosting, host_key, host_key_id,
                                         lan_ip, tailscale_ip, screen_w, screen_h, last_seen_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
             ON CONFLICT (user_id, device_id) DO UPDATE SET
                name = EXCLUDED.name, platform = EXCLUDED.platform, hosting = EXCLUDED.hosting,
                host_key = EXCLUDED.host_key, host_key_id = EXCLUDED.host_key_id,
                lan_ip = EXCLUDED.lan_ip, tailscale_ip = EXCLUDED.tailscale_ip,
                screen_w = EXCLUDED.screen_w, screen_h = EXCLUDED.screen_h, last_seen_at = NOW()`,
            [req.user.id, d.deviceId, d.name, d.platform, d.hosting, d.hostKey, d.hostKeyId,
                d.lanIp, d.tailscaleIp, d.screenW, d.screenH],
        );
        res.json({ success: true });
    } catch (err) {
        console.error('POST /remote/devices error:', err.message);
        res.status(500).json({ success: false, error: 'Could not save the device.' });
    }
});

// GET /api/remote/devices — the account's devices, most recently seen first.
router.get('/devices', authRequired, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT device_id, name, platform, hosting, host_key, host_key_id, lan_ip, tailscale_ip,
                    screen_w, screen_h, last_seen_at
             FROM remote_devices WHERE user_id = $1 ORDER BY last_seen_at DESC`,
            [req.user.id],
        );
        res.json({
            success: true,
            devices: rows.map((r) => ({
                deviceId: r.device_id, name: r.name, platform: r.platform, hosting: r.hosting,
                hostKey: r.host_key, hostKeyId: r.host_key_id, lanIp: r.lan_ip, tailscaleIp: r.tailscale_ip,
                screenW: r.screen_w, screenH: r.screen_h, lastSeenAt: r.last_seen_at,
            })),
        });
    } catch (err) {
        console.error('GET /remote/devices error:', err.message);
        res.status(500).json({ success: false, error: 'Could not load devices.' });
    }
});

// DELETE /api/remote/devices/:deviceId — forget one of your devices.
router.delete('/devices/:deviceId', authRequired, async (req, res) => {
    const deviceId = String(req.params.deviceId || '');
    if (!DEVICE_ID.test(deviceId)) return res.status(400).json({ success: false, error: 'Invalid device id.' });
    try {
        await pool.query('DELETE FROM remote_devices WHERE user_id = $1 AND device_id = $2', [req.user.id, deviceId]);
        res.json({ success: true });
    } catch (err) {
        console.error('DELETE /remote/devices error:', err.message);
        res.status(500).json({ success: false, error: 'Could not remove the device.' });
    }
});

module.exports = router;
module.exports.parseDevice = parseDevice;
