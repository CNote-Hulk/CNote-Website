'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const express = require('express');
const { installMockDb } = require('./helpers/mockDb');

const JWT_SECRET = 'test-secret-for-remote';
const mockPool = installMockDb(async () => ({ rows: [] }));
const remoteRoutes = require('../routes/remote');
const { parseDevice } = remoteRoutes;

const USER = { id: 7, username: 'andrei', role: 'user' };
const OTHER = { id: 8, username: 'someone', role: 'user' };
const KEY = 'ab'.repeat(32);

function buildApp() {
    const app = express();
    app.set('JWT_SECRET', JWT_SECRET);
    app.use(express.json());
    app.use('/api/remote', remoteRoutes);
    return app;
}

async function withServer(fn) {
    const server = buildApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    try {
        await fn(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

const authFor = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id }, JWT_SECRET)}`, 'Content-Type': 'application/json' });

/** In-memory remote_devices, enough for the real upsert / list / delete queries. */
function fakeTable() {
    const rows = [];
    return async (sql, params = []) => {
        if (/FROM users WHERE id = \$1/.test(sql)) return { rows: [params[0] === OTHER.id ? OTHER : USER] };
        if (/INSERT INTO remote_devices/.test(sql)) {
            const [userId, deviceId, name, platform, hosting, hostKey, hostKeyId, lanIp, tailscaleIp, screenW, screenH] = params;
            const row = { user_id: userId, device_id: deviceId, name, platform, hosting, host_key: hostKey, host_key_id: hostKeyId,
                lan_ip: lanIp, tailscale_ip: tailscaleIp, screen_w: screenW, screen_h: screenH, last_seen_at: new Date() };
            const i = rows.findIndex((r) => r.user_id === userId && r.device_id === deviceId);
            if (i >= 0) rows[i] = row; else rows.push(row);
            return { rows: [] };
        }
        // DELETE first: its SQL also contains "FROM remote_devices WHERE user_id = $1".
        if (/DELETE FROM remote_devices/.test(sql)) {
            const i = rows.findIndex((r) => r.user_id === params[0] && r.device_id === params[1]);
            if (i >= 0) rows.splice(i, 1);
            return { rows: [] };
        }
        if (/SELECT[\s\S]*FROM remote_devices WHERE user_id = \$1/.test(sql)) return { rows: rows.filter((r) => r.user_id === params[0]) };
        return { rows: [] };
    };
}

test('parseDevice validates ids, keys and addresses', () => {
    assert.ok(parseDevice({ deviceId: 'short', name: 'x' }).error);
    assert.ok(parseDevice({ deviceId: 'tablet-0001', name: '' }).error);
    assert.ok(parseDevice({ deviceId: 'tablet-0001', name: 'Tab', hosting: true, hostKey: 'nothex', hostKeyId: 'b64fea34' }).error);
    const ok = parseDevice({ deviceId: 'tablet-0001', name: 'Tab', hosting: true, hostKey: KEY.toUpperCase(), hostKeyId: 'B64FEA34',
        lanIp: '192.168.1.130', tailscaleIp: 'not-an-ip', screenW: 2960, screenH: 1848 });
    assert.equal(ok.error, undefined);
    assert.equal(ok.value.hostKey, KEY);
    assert.equal(ok.value.lanIp, '192.168.1.130');
    assert.equal(ok.value.tailscaleIp, null);
    // A device that doesn't host never stores a key, whatever it sends.
    assert.equal(parseDevice({ deviceId: 'phone-0001', name: 'S24', hostKey: KEY, hostKeyId: 'b64fea34' }).value.hostKey, null);
});

test('devices are upserted, listed and deleted per account only', async () => {
    mockPool.query = fakeTable();
    await withServer(async (base) => {
        const unauth = await fetch(`${base}/api/remote/devices`);
        assert.equal(unauth.status, 401);

        const body = { deviceId: 'tablet-0001', name: "Andrei's Tab", platform: 'android', hosting: true,
            hostKey: KEY, hostKeyId: 'b64fea34', lanIp: '192.168.1.130', tailscaleIp: '100.64.0.2', screenW: 2960, screenH: 1848 };
        let r = await fetch(`${base}/api/remote/devices`, { method: 'POST', headers: authFor(USER), body: JSON.stringify(body) });
        assert.equal(r.status, 200);
        // Upsert, not a second row.
        r = await fetch(`${base}/api/remote/devices`, { method: 'POST', headers: authFor(USER), body: JSON.stringify({ ...body, name: 'Tab S11' }) });
        assert.equal(r.status, 200);

        r = await fetch(`${base}/api/remote/devices`, { headers: authFor(USER) });
        const mine = await r.json();
        assert.equal(mine.devices.length, 1);
        assert.equal(mine.devices[0].name, 'Tab S11');
        assert.equal(mine.devices[0].hostKey, KEY);
        assert.equal(mine.devices[0].tailscaleIp, '100.64.0.2');

        r = await fetch(`${base}/api/remote/devices`, { headers: authFor(OTHER) });
        assert.equal((await r.json()).devices.length, 0, 'another account never sees them');

        r = await fetch(`${base}/api/remote/devices/tablet-0001`, { method: 'DELETE', headers: authFor(USER) });
        assert.equal(r.status, 200);
        r = await fetch(`${base}/api/remote/devices`, { headers: authFor(USER) });
        assert.equal((await r.json()).devices.length, 0);
    });
});

test('friend sharing rooms: create, join, approve, perms, kick, close', async () => {
    mockPool.query = fakeTable();
    remoteRoutes._rooms.clear();
    await withServer(async (base) => {
        // Host opens a room
        let r = await fetch(`${base}/api/remote/rooms`, {
            method: 'POST', headers: authFor(USER),
            body: JSON.stringify({ deviceId: 'tablet-0001', deviceName: 'Tab S11', lanIp: '192.168.1.131', publicIp: '82.1.2.3', publicPort: 47800, screenW: 2960, screenH: 1848 }),
        });
        assert.equal(r.status, 200);
        const room = await r.json();
        assert.equal(room.code.length, 6);
        assert.ok(room.relayToken);

        // Friend requests to join
        r = await fetch(`${base}/api/remote/rooms/${room.code}/join`, {
            method: 'POST', headers: authFor(OTHER),
            body: JSON.stringify({ publicIp: '85.4.5.6', publicPort: 51234 }),
        });
        assert.equal(r.status, 200);
        const joined = await r.json();
        assert.ok(joined.joinId);

        // Host heartbeat sees pending request
        r = await fetch(`${base}/api/remote/rooms/${room.code}/heartbeat`, {
            method: 'POST', headers: authFor(USER), body: JSON.stringify({}),
        });
        const hb = await r.json();
        assert.equal(hb.pending.length, 1);
        assert.equal(hb.pending[0].username, 'someone');

        // Friend polls status -> still pending
        r = await fetch(`${base}/api/remote/rooms/${room.code}/status/${joined.joinId}`, { headers: authFor(OTHER) });
        assert.equal((await r.json()).status, 'pending');

        // Host approves with view-only (perms=1)
        const sessionKey = 'cd'.repeat(32);
        r = await fetch(`${base}/api/remote/rooms/${room.code}/decide`, {
            method: 'POST', headers: authFor(USER),
            body: JSON.stringify({ joinId: joined.joinId, action: 'approve', perms: 1, sessionKey }),
        });
        assert.equal(r.status, 200);

        // Friend polls status -> approved with sessionKey + host endpoints
        r = await fetch(`${base}/api/remote/rooms/${room.code}/status/${joined.joinId}`, { headers: authFor(OTHER) });
        const st = await r.json();
        assert.equal(st.status, 'approved');
        assert.equal(st.perms, 1);
        assert.equal(st.sessionKey, sessionKey);
        assert.equal(st.hostPublicIp, '82.1.2.3');
        assert.equal(st.hostPublicPort, 47800);

        // Host grants control (perms=3) then kicks
        r = await fetch(`${base}/api/remote/rooms/${room.code}/decide`, {
            method: 'POST', headers: authFor(USER),
            body: JSON.stringify({ joinId: joined.joinId, action: 'perms', perms: 3 }),
        });
        assert.equal((await r.json()).guest.perms, 3);

        r = await fetch(`${base}/api/remote/rooms/${room.code}/decide`, {
            method: 'POST', headers: authFor(USER),
            body: JSON.stringify({ joinId: joined.joinId, action: 'kick' }),
        });
        assert.equal(r.status, 200);
        r = await fetch(`${base}/api/remote/rooms/${room.code}/status/${joined.joinId}`, { headers: authFor(OTHER) });
        assert.equal((await r.json()).status, 'kicked');

        // Host closes room
        r = await fetch(`${base}/api/remote/rooms/${room.code}`, { method: 'DELETE', headers: authFor(USER) });
        assert.equal(r.status, 200);
    });
});

test('GET /api/remote/friends lists CNote friends and their live sharing rooms', async () => {
    const baseQuery = fakeTable();
    mockPool.query = async (sql, params = []) => {
        if (/FROM friends f/.test(sql)) {
            return { rows: [{ id: USER.id, username: USER.username, avatar: '' }] };
        }
        return baseQuery(sql, params);
    };
    remoteRoutes._rooms.clear();
    await withServer(async (base) => {
        // Before host shares: friend appears with sharing=false
        let r = await fetch(`${base}/api/remote/friends`, { headers: authFor(OTHER) });
        assert.equal(r.status, 200);
        let list = (await r.json()).friends;
        assert.equal(list.length, 1);
        assert.equal(list[0].username, 'andrei');
        assert.equal(list[0].sharing, false);
        assert.equal(list[0].code, null);

        // Host opens a room -> friend now sees sharing=true + room code
        r = await fetch(`${base}/api/remote/rooms`, {
            method: 'POST', headers: authFor(USER),
            body: JSON.stringify({ deviceId: 'tablet-0001', deviceName: 'Tab S11', screenW: 2960, screenH: 1848 }),
        });
        const room = await r.json();

        r = await fetch(`${base}/api/remote/friends`, { headers: authFor(OTHER) });
        list = (await r.json()).friends;
        assert.equal(list[0].sharing, true);
        assert.equal(list[0].code, room.code);
        assert.equal(list[0].deviceName, 'Tab S11');
    });
});
