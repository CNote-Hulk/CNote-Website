'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const express = require('express');
const { installMockDb } = require('./helpers/mockDb');

const JWT_SECRET = 'test-secret-for-devices';
const mockPool = installMockDb(async () => ({ rows: [] }));
const devicesRoutes = require('../routes/devices');

const USER = { id: 7, username: 'andrei', role: 'user' };

function buildApp() {
    const app = express();
    app.set('JWT_SECRET', JWT_SECRET);
    app.use(express.json());
    app.use('/api/devices', devicesRoutes);
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

function post(url, body, headers = {}) {
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body || {}),
    });
}

/**
 * A tiny in-memory stand-in for the connected_consoles table: enough to run the
 * real pairing flow (start → confirm → poll → heartbeat) through the real routes.
 */
function fakeConsolesTable() {
    const rows = [];
    let nextId = 1;
    return async (sql, params = []) => {
        if (/FROM users WHERE id = \$1/.test(sql)) return { rows: [USER] };
        if (/^\s*DELETE FROM connected_consoles WHERE user_id IS NULL/.test(sql)) return { rows: [] };
        if (/INSERT INTO connected_consoles/.test(sql)) {
            const [userCode, deviceHash, platform, model, romver, region, name, ttl] = params;
            if (rows.some((r) => r.user_code === userCode)) return { rows: [] };
            const row = {
                id: nextId++, user_id: null, user_code: userCode, device_code_hash: deviceHash,
                token_hash: null, platform, model, romver, region, name,
                pair_expires_at: new Date(Date.now() + Number(ttl) * 1000),
                linked_at: null, last_seen_at: null,
            };
            rows.push(row);
            return { rows: [{ id: row.id }] };
        }
        if (/WHERE c.device_code_hash = \$1/.test(sql)) {
            const r = rows.find((x) => x.device_code_hash === params[0]);
            return { rows: r ? [{ ...r, username: r.user_id ? USER.username : null }] : [] };
        }
        if (/SET token_hash = \$1, device_code_hash = NULL/.test(sql)) {
            const r = rows.find((x) => x.id === params[1] && x.device_code_hash === params[2]);
            if (!r) return { rows: [] };
            r.token_hash = params[0];
            r.device_code_hash = null;
            r.last_seen_at = new Date();
            return { rows: [{ id: r.id }] };
        }
        if (/SET user_id = \$1, linked_at = NOW\(\), user_code = NULL/.test(sql)) {
            const r = rows.find((x) => x.user_code === params[1] && !x.user_id && x.pair_expires_at > new Date());
            if (!r) return { rows: [] };
            r.user_id = params[0];
            r.linked_at = new Date();
            r.user_code = null;
            return { rows: [r] };
        }
        if (/SELECT \* FROM connected_consoles\s+WHERE user_id = \$1 AND token_hash IS NOT NULL/.test(sql)) {
            return { rows: rows.filter((x) => x.user_id === params[0] && x.token_hash) };
        }
        if (/SET last_seen_at = NOW\(\)/.test(sql)) {
            const r = rows.find((x) => x.token_hash === params[0] && x.user_id);
            if (!r) return { rows: [] };
            if (params[1]) r.model = params[1];
            return { rows: [{ id: r.id, username: USER.username }] };
        }
        if (/DELETE FROM connected_consoles WHERE id = \$1 AND user_id = \$2/.test(sql)) {
            const i = rows.findIndex((x) => x.id === params[0] && x.user_id === params[1]);
            if (i < 0) return { rows: [] };
            rows.splice(i, 1);
            return { rows: [{ id: params[0] }] };
        }
        throw new Error('unexpected SQL in test: ' + sql);
    };
}

test('normalizeUserCode accepts dashes/spaces/lowercase and rejects ambiguous letters', () => {
    const { normalizeUserCode } = devicesRoutes._test;
    assert.equal(normalizeUserCode('k7p-2qx'), 'K7P2QX');
    assert.equal(normalizeUserCode(' K7P 2QX '), 'K7P2QX');
    assert.equal(normalizeUserCode('K7P2Q'), '');
    assert.equal(normalizeUserCode('K7P2Q0'), ''); // 0 is not in the alphabet
    assert.equal(normalizeUserCode('O1IL0U'), '');
});

test('full pairing flow: start → pending → confirm → linked once → heartbeat → list → unlink', async () => {
    mockPool.query = fakeConsolesTable();
    const auth = { Authorization: `Bearer ${jwt.sign({ userId: USER.id }, JWT_SECRET)}` };
    await withServer(async (base) => {
        const start = await (await post(`${base}/api/devices/pair/start`,
            { model: 'SCPH-50004', romver: '0170EC20040217', region: 'Europe' })).json();
        assert.equal(start.success, true);
        assert.match(start.user_code, /^[A-Z2-9]{6}$/);
        assert.match(start.device_code, /^[0-9a-f]{64}$/);

        let poll = await post(`${base}/api/devices/pair/poll`, { device_code: start.device_code });
        assert.equal(poll.status, 202);

        // Confirm needs an account.
        assert.equal((await post(`${base}/api/devices/pair/confirm`, { user_code: start.user_code })).status, 401);
        const confirm = await post(`${base}/api/devices/pair/confirm`,
            { user_code: start.user_code.slice(0, 3) + '-' + start.user_code.slice(3).toLowerCase() }, auth);
        assert.equal(confirm.status, 200);
        assert.equal((await confirm.json()).console.model, 'SCPH-50004');

        poll = await post(`${base}/api/devices/pair/poll`, { device_code: start.device_code });
        assert.equal(poll.status, 200);
        const linked = await poll.json();
        assert.equal(linked.status, 'linked');
        assert.equal(linked.user.username, 'andrei');
        assert.match(linked.device_token, /^[0-9a-f]{64}$/);

        // The token is handed out exactly once; the device_code is burnt.
        assert.equal((await post(`${base}/api/devices/pair/poll`, { device_code: start.device_code })).status, 410);

        const hb = await post(`${base}/api/devices/heartbeat`, { model: 'SCPH-50004' },
            { 'X-Device-Token': linked.device_token });
        assert.equal(hb.status, 200);
        assert.equal((await post(`${base}/api/devices/heartbeat`, {}, { 'X-Device-Token': 'f'.repeat(64) })).status, 401);

        const list = await (await fetch(`${base}/api/devices`, { headers: auth })).json();
        assert.equal(list.consoles.length, 1);
        assert.equal(list.consoles[0].id, linked.console_id);

        const del = await fetch(`${base}/api/devices/${linked.console_id}`, { method: 'DELETE', headers: auth });
        assert.equal(del.status, 200);
        assert.equal((await post(`${base}/api/devices/heartbeat`, {}, { 'X-Device-Token': linked.device_token })).status, 401);
    });
});

test('confirm rejects an unknown or malformed code', async () => {
    mockPool.query = fakeConsolesTable();
    const auth = { Authorization: `Bearer ${jwt.sign({ userId: USER.id }, JWT_SECRET)}` };
    await withServer(async (base) => {
        assert.equal((await post(`${base}/api/devices/pair/confirm`, { user_code: 'ZZZZZZ' }, auth)).status, 404);
        assert.equal((await post(`${base}/api/devices/pair/confirm`, { user_code: '12' }, auth)).status, 400);
    });
});

test('a DB failure answers 503 (retryable), never 401', async () => {
    mockPool.query = async () => { throw new Error('pool exhausted'); };
    await withServer(async (base) => {
        const r = await post(`${base}/api/devices/pair/start`, {});
        assert.equal(r.status, 503);
        assert.equal((await r.json()).retryable, true);
    });
});
