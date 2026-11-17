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
