'use strict';

// routes/collection.js (2026-11-27): auth, validation, and that a write rebuilds the
// owned-console tables from the collection.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const express = require('express');
const { installMockDb } = require('./helpers/mockDb');

const JWT_SECRET = 'test-secret-for-collection';
const mockPool = installMockDb(async () => ({ rows: [] }));
const collectionRoutes = require('../routes/collection');

const USER = { id: 7, username: 'collector', role: 'user' };
const token = jwt.sign({ userId: USER.id }, JWT_SECRET);

function withUser(impl) {
    mockPool.query = async (sql, params) => {
        if (/FROM users WHERE id = \$1/.test(sql)) return { rows: [USER] };
        return impl(sql, params);
    };
}

async function withServer(fn) {
    const app = express();
    app.set('JWT_SECRET', JWT_SECRET);
    app.use(express.json());
    app.use('/api/collection', collectionRoutes);
    const server = app.listen(0);
    await new Promise(r => server.once('listening', r));
    try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(r => server.close(r)); }
}

const post = (base, body) => fetch(`${base}/api/collection`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
});

test('GET /api/collection needs a session', async () => {
    mockPool.query = async () => ({ rows: [] });
    await withServer(async base => {
        const res = await fetch(`${base}/api/collection`);
        assert.equal(res.status, 401);
    });
});

test('POST rejects a console row without a console, a line of another console, a bad quantity', async () => {
    withUser(async () => ({ rows: [{ n: 0 }] }));
    await withServer(async base => {
        assert.equal((await post(base, { category: 'consola', name: 'PS2' })).status, 400);
        assert.equal((await post(base, { category: 'consola', console_id: 'playstation-2', variant: 'xbox-360|Xbox 360 S', name: 'x' })).status, 400);
        assert.equal((await post(base, { category: 'controller', name: 'DualShock 2', quantity: 0 })).status, 400);
        assert.equal((await post(base, { category: 'nope', name: 'x' })).status, 400);
    });
});

test('POST a console fills in its base line and rebuilds the owned-console tables', async () => {
    const seen = [];
    withUser(async (sql, params) => {
        seen.push(sql);
        if (/COUNT\(\*\)::int AS n FROM user_collection_items/.test(sql)) return { rows: [{ n: 0 }] };
        if (/INSERT INTO user_collection_items/.test(sql)) {
            return { rows: [{ id: 1, category: 'consola', console_id: params[2], variant: params[3], name: params[5], quantity: params[6], position: 0 }] };
        }
        if (/SELECT console_id, variant, model FROM user_collection_items/.test(sql)) {
            return { rows: [{ console_id: 'playstation-2', variant: 'playstation-2|PS2', model: 'SCPH-39004' }] };
        }
        return { rows: [] };
    });
    await withServer(async base => {
        const res = await post(base, { category: 'consola', console_id: 'playstation-2', name: 'PlayStation 2', model: 'SCPH-39004' });
        assert.equal(res.status, 201);
        const body = await res.json();
        assert.equal(body.item.variant, 'playstation-2|PS2');
    });
    assert.ok(seen.some(s => /INSERT INTO user_owned_consoles/.test(s)), 'owned console added');
    assert.ok(seen.some(s => /INSERT INTO user_owned_variants/.test(s)), 'line recorded');
    assert.ok(seen.some(s => /INSERT INTO user_owned_models/.test(s)), 'revision recorded');
    assert.ok(seen.some(s => /UPDATE users SET owned_consoles/.test(s)), 'CSV mirror rebuilt');
});
