'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { installMockDb } = require('./helpers/mockDb');

// Regression test for the 2026-09-09 removal of marketplace sync ("renuntam
// la ea, nu isi are rostu") — locks in that routes/ebay.js keeps ONLY the
// mandatory eBay account-deletion compliance webhook (see that file's own
// comment for why it survives) and that the OAuth connect/callback/status/
// disconnect/listings-import routes it used to expose are genuinely gone,
// not just unlinked from the frontend.
const mockPool = installMockDb(async () => ({ rows: [] }));

const ebayRoutes = require('../routes/ebay');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/ebay', ebayRoutes);
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

test('the removed OAuth/sync routes are genuinely gone (404), not just hidden from the UI', async () => {
    mockPool.query = async () => { throw new Error('pool.query should not be called for a route that no longer exists'); };
    await withServer(async (base) => {
        for (const { method, path } of [
            { method: 'GET', path: '/connect' },
            { method: 'GET', path: '/callback' },
            { method: 'GET', path: '/status' },
            { method: 'DELETE', path: '/disconnect' },
            { method: 'GET', path: '/listings/import' },
        ]) {
            const res = await fetch(`${base}/api/ebay${path}`, { method });
            assert.equal(res.status, 404, `${method} ${path} should 404 now that OAuth/sync is removed`);
        }
    });
});

test('GET /api/ebay/account-deletion still answers the verification challenge (mandatory eBay compliance)', async () => {
    const oldToken = process.env.EBAY_VERIFICATION_TOKEN;
    const oldUrl = process.env.EBAY_DELETION_ENDPOINT_URL;
    process.env.EBAY_VERIFICATION_TOKEN = 'test-verification-token';
    process.env.EBAY_DELETION_ENDPOINT_URL = 'https://consolenotebook.com/api/ebay/account-deletion';
    try {
        await withServer(async (base) => {
            const challengeCode = 'abc123';
            const res = await fetch(`${base}/api/ebay/account-deletion?challenge_code=${challengeCode}`);
            assert.equal(res.status, 200);
            const body = await res.json();
            const expectedHash = crypto
                .createHash('sha256')
                .update(challengeCode + process.env.EBAY_VERIFICATION_TOKEN + process.env.EBAY_DELETION_ENDPOINT_URL)
                .digest('hex');
            assert.equal(body.challengeResponse, expectedHash);
        });
    } finally {
        process.env.EBAY_VERIFICATION_TOKEN = oldToken;
        process.env.EBAY_DELETION_ENDPOINT_URL = oldUrl;
    }
});

test('GET /api/ebay/account-deletion without challenge_code returns 400', async () => {
    await withServer(async (base) => {
        const res = await fetch(`${base}/api/ebay/account-deletion`);
        assert.equal(res.status, 400);
    });
});

test('POST /api/ebay/account-deletion deletes the matching marketplace_accounts row and always acknowledges', async () => {
    let deleteParams = null;
    mockPool.query = async (sql, params) => {
        assert.match(sql, /DELETE FROM marketplace_accounts WHERE provider = 'ebay' AND provider_user_id = \$1/);
        deleteParams = params;
        return { rows: [] };
    };
    await withServer(async (base) => {
        const res = await fetch(`${base}/api/ebay/account-deletion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notification: { data: { userId: 'ebay-user-1', username: 'someone' } } }),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.acknowledged, true);
        assert.deepEqual(deleteParams, ['ebay-user-1']);
    });
});

test('POST /api/ebay/account-deletion still acknowledges (200) even if the DB delete throws — eBay retries on 5xx', async () => {
    mockPool.query = async () => { throw new Error('db unavailable'); };
    await withServer(async (base) => {
        const res = await fetch(`${base}/api/ebay/account-deletion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notification: { data: { userId: 'ebay-user-2' } } }),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.acknowledged, true);
    });
});
