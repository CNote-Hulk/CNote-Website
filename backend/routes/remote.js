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
const crypto = require('crypto');
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

/* ── Friend sharing rooms, approvals & encrypted WebSocket relay (2026-11-27) ── */

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours idle
const rooms = new Map(); // code -> Room

function cleanPort(v) {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n >= 1 && n <= 65535 ? n : 0;
}

function makeCode() {
    for (let attempt = 0; attempt < 20; attempt++) {
        let code = '';
        const bytes = crypto.randomBytes(6);
        for (let i = 0; i < 6; i++) code += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
        if (!rooms.has(code)) return code;
    }
    return crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
}

function pruneRooms() {
    const now = Date.now();
    for (const [code, room] of rooms) {
        if (now - room.lastSeen > ROOM_TTL_MS) {
            closeRoomSockets(room);
            rooms.delete(code);
        }
    }
}

function closeRoomSockets(room) {
    try { room.hostWs?.destroy(); } catch {}
    room.hostWs = null;
    for (const g of room.guests.values()) {
        try { g.ws?.destroy(); } catch {}
        g.ws = null;
    }
}

function guestSummary(g) {
    return {
        joinId: g.joinId,
        slot: g.slot,
        userId: g.userId,
        username: g.username,
        status: g.status,
        perms: g.perms,
        publicIp: g.publicIp,
        publicPort: g.publicPort,
        lanIp: g.lanIp,
        createdAt: g.createdAt,
    };
}

// GET /api/remote/friends — the user's CNote friends + whether each is currently sharing a room.
router.get('/friends', authRequired, async (req, res) => {
    pruneRooms();
    try {
        const { rows } = await pool.query(
            `SELECT u.id, u.username, u.avatar
             FROM friends f
             JOIN users u ON (
                (f.user1_id = $1 AND u.id = f.user2_id) OR
                (f.user2_id = $1 AND u.id = f.user1_id)
             )
             ORDER BY u.username ASC`,
            [req.user.id],
        );
        const activeByOwner = new Map();
        for (const room of rooms.values()) {
            const prev = activeByOwner.get(room.ownerId);
            if (!prev || room.lastSeen > prev.lastSeen) activeByOwner.set(room.ownerId, room);
        }
        const friends = rows.map((u) => {
            const r = activeByOwner.get(u.id);
            return {
                userId: u.id,
                username: u.username,
                avatar: u.avatar || '',
                sharing: !!r,
                code: r ? r.code : null,
                deviceName: r ? r.deviceName : null,
                screenW: r ? r.screenW : 0,
                screenH: r ? r.screenH : 0,
            };
        });
        friends.sort((a, b) => (b.sharing ? 1 : 0) - (a.sharing ? 1 : 0) || a.username.localeCompare(b.username));
        res.json({ success: true, friends });
    } catch (err) {
        console.error('GET /remote/friends error:', err.message);
        res.status(500).json({ success: false, error: 'Could not load friends.' });
    }
});

// POST /api/remote/rooms — host opens (or refreshes) a friend-sharing room.
router.post('/rooms', authRequired, (req, res) => {
    pruneRooms();
    const b = req.body || {};
    const deviceId = String(b.deviceId || '');
    if (!DEVICE_ID.test(deviceId)) return res.status(400).json({ success: false, error: 'Invalid device id.' });
    const deviceName = String(b.deviceName || '').trim().slice(0, 80) || 'Device';

    // Reuse an already-open room for this same user + device so toggling/re-opening keeps one code.
    for (const room of rooms.values()) {
        if (room.ownerId === req.user.id && room.deviceId === deviceId) {
            room.deviceName = deviceName;
            room.lanIp = cleanIp(b.lanIp) || room.lanIp;
            room.publicIp = cleanIp(b.publicIp) || room.publicIp;
            room.publicPort = cleanPort(b.publicPort) || room.publicPort;
            room.screenW = cleanInt(b.screenW) || room.screenW;
            room.screenH = cleanInt(b.screenH) || room.screenH;
            room.lastSeen = Date.now();
            return res.json({ success: true, code: room.code, relayToken: room.relayToken });
        }
    }

    const code = makeCode();
    const room = {
        code,
        ownerId: req.user.id,
        ownerName: req.user.username || 'Host',
        deviceId,
        deviceName,
        lanIp: cleanIp(b.lanIp),
        publicIp: cleanIp(b.publicIp),
        publicPort: cleanPort(b.publicPort),
        screenW: cleanInt(b.screenW),
        screenH: cleanInt(b.screenH),
        relayToken: crypto.randomBytes(16).toString('hex'),
        hostWs: null,
        nextSlot: 1,
        guests: new Map(), // joinId -> Guest
        lastSeen: Date.now(),
    };
    rooms.set(code, room);
    res.json({ success: true, code, relayToken: room.relayToken });
});

// POST /api/remote/rooms/:code/heartbeat — host refreshes endpoint and reads pending/approved guests.
router.post('/rooms/:code/heartbeat', authRequired, (req, res) => {
    const code = String(req.params.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const room = rooms.get(code);
    if (!room || room.ownerId !== req.user.id) return res.status(404).json({ success: false, error: 'Room not found.' });
    const b = req.body || {};
    if (b.lanIp) room.lanIp = cleanIp(b.lanIp) || room.lanIp;
    if (b.publicIp) room.publicIp = cleanIp(b.publicIp) || room.publicIp;
    if (b.publicPort) room.publicPort = cleanPort(b.publicPort) || room.publicPort;
    room.lastSeen = Date.now();
    const pending = [];
    const guests = [];
    for (const g of room.guests.values()) {
        if (g.status === 'pending') pending.push(guestSummary(g));
        else if (g.status === 'approved') guests.push(guestSummary(g));
    }
    res.json({ success: true, code: room.code, pending, guests });
});

// DELETE /api/remote/rooms/:code — host closes the room.
router.delete('/rooms/:code', authRequired, (req, res) => {
    const code = String(req.params.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const room = rooms.get(code);
    if (!room || room.ownerId !== req.user.id) return res.status(404).json({ success: false, error: 'Room not found.' });
    closeRoomSockets(room);
    rooms.delete(code);
    res.json({ success: true });
});

// POST /api/remote/rooms/:code/join — friend requests to join a room.
router.post('/rooms/:code/join', authRequired, (req, res) => {
    pruneRooms();
    const code = String(req.params.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ success: false, error: 'Room not found or expired.' });
    if (room.guests.size >= 32) return res.status(429).json({ success: false, error: 'Room is full.' });
    const b = req.body || {};
    const joinId = crypto.randomBytes(8).toString('hex');
    const slot = room.nextSlot++;
    if (slot > 250) room.nextSlot = 1;
    const guest = {
        joinId,
        slot,
        userId: req.user.id,
        username: req.user.username || 'Friend',
        status: 'pending',
        perms: 1, // 1 = view only, 3 = view + input
        sessionKey: null,
        relayToken: crypto.randomBytes(16).toString('hex'),
        publicIp: cleanIp(b.publicIp),
        publicPort: cleanPort(b.publicPort),
        lanIp: cleanIp(b.lanIp),
        ws: null,
        createdAt: Date.now(),
    };
    room.guests.set(joinId, guest);
    room.lastSeen = Date.now();
    res.json({
        success: true,
        joinId,
        slot,
        hostName: room.ownerName,
        deviceName: room.deviceName,
    });
});

// POST /api/remote/rooms/:code/decide — host approves, denies, updates perms, or kicks a guest.
router.post('/rooms/:code/decide', authRequired, (req, res) => {
    const code = String(req.params.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const room = rooms.get(code);
    if (!room || room.ownerId !== req.user.id) return res.status(404).json({ success: false, error: 'Room not found.' });
    const b = req.body || {};
    const guest = room.guests.get(String(b.joinId || ''));
    if (!guest) return res.status(404).json({ success: false, error: 'Request not found.' });
    const action = String(b.action || '');
    if (b.publicIp) room.publicIp = cleanIp(b.publicIp) || room.publicIp;
    if (b.publicPort) room.publicPort = cleanPort(b.publicPort) || room.publicPort;
    room.lastSeen = Date.now();

    if (action === 'approve') {
        const key = String(b.sessionKey || '').toLowerCase();
        if (!HEX64.test(key)) return res.status(400).json({ success: false, error: 'Invalid session key.' });
        guest.sessionKey = key;
        guest.perms = (Number(b.perms) & 3) || 1;
        guest.status = 'approved';
    } else if (action === 'perms') {
        if (guest.status !== 'approved') return res.status(400).json({ success: false, error: 'Guest is not approved.' });
        guest.perms = (Number(b.perms) & 3) || 1;
    } else if (action === 'deny' || action === 'kick') {
        guest.status = action === 'deny' ? 'denied' : 'kicked';
        try { guest.ws?.destroy(); } catch {}
        guest.ws = null;
    } else {
        return res.status(400).json({ success: false, error: 'Invalid action.' });
    }
    res.json({ success: true, guest: guestSummary(guest) });
});

// GET /api/remote/rooms/:code/status/:joinId — friend polls approval status + connection info.
router.get('/rooms/:code/status/:joinId', authRequired, (req, res) => {
    const code = String(req.params.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const room = rooms.get(code);
    if (!room) return res.json({ success: true, status: 'closed' });
    const guest = room.guests.get(String(req.params.joinId || ''));
    if (!guest || guest.userId !== req.user.id) return res.status(404).json({ success: false, error: 'Request not found.' });
    if (guest.status !== 'approved') {
        return res.json({ success: true, status: guest.status });
    }
    res.json({
        success: true,
        status: 'approved',
        slot: guest.slot,
        perms: guest.perms,
        sessionKey: guest.sessionKey,
        relayToken: guest.relayToken,
        hostPublicIp: room.publicIp,
        hostPublicPort: room.publicPort,
        hostLanIp: room.lanIp,
        hostPort: 47800,
        hostName: room.ownerName,
        deviceName: room.deviceName,
        screenW: room.screenW,
        screenH: room.screenH,
    });
});

/* ── Minimal RFC 6455 binary WebSocket relay (zero external dependencies) ── */

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const RELAY_MAX_BUF = 512 * 1024;

function wsWriteBinary(socket, payload) {
    if (!socket || socket.destroyed || !socket.writable) return;
    if (socket.writableLength > RELAY_MAX_BUF) return; // drop stale video instead of queuing
    const len = payload.length;
    let header;
    if (len < 126) {
        header = Buffer.from([0x82, len]);
    } else if (len < 65536) {
        header = Buffer.allocUnsafe(4);
        header[0] = 0x82; header[1] = 126; header.writeUInt16BE(len, 2);
    } else {
        return; // datagrams are <= 2 KB
    }
    socket.write(Buffer.concat([header, payload]));
}

function wsAttachReader(socket, onBinary) {
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
        buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
        while (buf.length >= 2) {
            const b0 = buf[0];
            const b1 = buf[1];
            const opcode = b0 & 0x0f;
            const masked = (b1 & 0x80) !== 0;
            let len = b1 & 0x7f;
            let off = 2;
            if (len === 126) {
                if (buf.length < 4) return;
                len = buf.readUInt16BE(2);
                off = 4;
            } else if (len === 127) {
                socket.destroy(); return;
            }
            const maskOff = off;
            if (masked) off += 4;
            if (buf.length < off + len) return;
            const payload = Buffer.allocUnsafe(len);
            buf.copy(payload, 0, off, off + len);
            if (masked) {
                for (let i = 0; i < len; i++) payload[i] ^= buf[maskOff + (i & 3)];
            }
            buf = buf.subarray(off + len);
            if (opcode === 0x08) { socket.end(); return; } // close
            if (opcode === 0x09) { // ping -> pong
                const pong = Buffer.allocUnsafe(2 + Math.min(len, 125));
                pong[0] = 0x8a; pong[1] = Math.min(len, 125);
                payload.copy(pong, 2, 0, Math.min(len, 125));
                socket.write(pong);
                continue;
            }
            if (opcode === 0x02 && len > 0) onBinary(payload);
        }
    });
}

function attachRelay(httpServer) {
    httpServer.on('upgrade', (req, socket) => {
        if (!req.url || !req.url.startsWith('/api/remote/relay')) return;
        const url = new URL(req.url, 'http://localhost');
        const code = String(url.searchParams.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const role = url.searchParams.get('role');
        const token = url.searchParams.get('token') || '';
        const joinId = url.searchParams.get('joinId') || '';
        const room = rooms.get(code);
        let guest = null;
        if (!room) { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
        if (role === 'host') {
            if (token !== room.relayToken) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
        } else if (role === 'guest') {
            guest = room.guests.get(joinId);
            if (!guest || guest.status !== 'approved' || token !== guest.relayToken) {
                socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
            }
        } else {
            socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); socket.destroy(); return;
        }
        const key = req.headers['sec-websocket-key'];
        if (!key) { socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); socket.destroy(); return; }
        const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
        socket.setNoDelay(true);
        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
        );

        if (role === 'host') {
            try { room.hostWs?.destroy(); } catch {}
            room.hostWs = socket;
            socket.on('close', () => { if (room.hostWs === socket) room.hostWs = null; });
            socket.on('error', () => { if (room.hostWs === socket) room.hostWs = null; });
            wsAttachReader(socket, (payload) => {
                // Host -> guest: [u8 slot][sealed packet]
                if (payload.length < 2) return;
                const slot = payload[0];
                const body = payload.subarray(1);
                for (const g of room.guests.values()) {
                    if (g.slot === slot && g.status === 'approved' && g.ws) {
                        wsWriteBinary(g.ws, body);
                        break;
                    }
                }
            });
        } else {
            try { guest.ws?.destroy(); } catch {}
            guest.ws = socket;
            socket.on('close', () => { if (guest.ws === socket) guest.ws = null; });
            socket.on('error', () => { if (guest.ws === socket) guest.ws = null; });
            wsAttachReader(socket, (payload) => {
                // Guest -> host: prepend [u8 slot]
                if (!room.hostWs) return;
                const framed = Buffer.allocUnsafe(1 + payload.length);
                framed[0] = guest.slot & 0xff;
                payload.copy(framed, 1);
                wsWriteBinary(room.hostWs, framed);
            });
        }
    });
}

module.exports = router;
module.exports.parseDevice = parseDevice;
module.exports.attachRelay = attachRelay;
module.exports._rooms = rooms;
