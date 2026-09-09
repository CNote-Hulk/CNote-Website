'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const express = require('express');
const { installMockDb } = require('./helpers/mockDb');

const JWT_SECRET = 'test-secret-for-marketplace-sync-removal';

// Regression test for the 2026-09-09 removal of marketplace sync from
// routes/marketplace.js ("renuntam la ea, nu isi are rostu") — locks in that
// the whole OAuth-integration section (accounts/auth-url/callback/disconnect/
// sync/imported-listings) is genuinely gone (404), while ordinary listings
// CRUD around it is untouched.
const mockPool = installMockDb(async () => ({ rows: [] }));

const marketplaceRoutes = require('../routes/marketplace');

function buildApp() {
    const app = express();
    app.set('JWT_SECRET', JWT_SECRET);
    app.use(express.json());
    app.use('/api/marketplace', marketplaceRoutes);
    return app;
}

async function withServer(fn) {
    const server = buildApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();
    try {
        await fn(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

const REGULAR_USER = { id: 1, username: 'tester', role: 'user' };

function withUser(user, routeQueryImpl) {
    mockPool.query = async (sql, params) => {
        if (/FROM users WHERE id = \$1/.test(sql)) {
            return { rows: [user] };
        }
        return routeQueryImpl(sql, params);
    };
}

test('the removed marketplace-sync routes are genuinely gone (404)', async () => {
    const token = jwt.sign({ userId: REGULAR_USER.id }, JWT_SECRET);
    withUser(REGULAR_USER, async () => { throw new Error('no route query should run for a route that no longer exists'); });
    await withServer(async (base) => {
        for (const { method, path } of [
            { method: 'GET', path: '/accounts' },
            { method: 'GET', path: '/olx/auth-url' },
            { method: 'GET', path: '/ebay/callback' },
            { method: 'POST', path: '/ebay/callback' },
            { method: 'POST', path: '/olx/disconnect' },
            { method: 'POST', path: '/ebay/sync' },
            { method: 'GET', path: '/listings/marketplace/1' },
        ]) {
            const res = await fetch(`${base}/api/marketplace${path}`, {
                method,
                headers: { Authorization: `Bearer ${token}` },
            });
            assert.equal(res.status, 404, `${method} ${path} should 404 now that marketplace sync is removed`);
        }
    });
});

test('GET /api/marketplace/listings (ordinary listings CRUD) still works, untouched by the sync removal', async () => {
    const fakeListings = [{ id: 1, title: 'PS3 CECHJ', price: '100.00' }];
    mockPool.query = async () => ({ rows: fakeListings });
    await withServer(async (base) => {
        const res = await fetch(`${base}/api/marketplace/listings`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.success, true);
    });
});
