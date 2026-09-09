'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const express = require('express');
const { installMockDb } = require('./helpers/mockDb');

const JWT_SECRET = 'test-secret-for-console-models';

// Must run before console-models.js (or anything it requires) ever does
// require('../db') — the module also runs a self-init CREATE TABLE/ALTER TABLE
// on load, so mockPool.query needs to tolerate those calls happening once at
// require() time regardless of what an individual test later overrides it to.
const mockPool = installMockDb(async () => ({ rows: [] }));

const consoleModelsRoutes = require('../routes/console-models');

const ADMIN_USER = { id: 1, username: 'admin', role: 'admin' };
const REGULAR_USER = { id: 2, username: 'regular', role: 'user' };

function tokenFor(user) {
    return jwt.sign({ userId: user.id }, JWT_SECRET);
}

// Wraps mockPool.query so the auth middleware's own `SELECT * FROM users
// WHERE id = $1` is answered from a fixed user, and every other query goes
// to the test's own handler — sparing every test from re-implementing the
// auth lookup branch.
function withUser(user, routeQueryImpl) {
    mockPool.query = async (sql, params) => {
        if (/FROM users WHERE id = \$1/.test(sql)) {
            return { rows: [user] };
        }
        return routeQueryImpl(sql, params);
    };
}

function buildApp() {
    const app = express();
    app.set('JWT_SECRET', JWT_SECRET);
    app.use(express.json());
    app.use('/api/console-models', consoleModelsRoutes);
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

test('GET /api/console-models is public and returns the model list ordered by id', async () => {
    const fakeModels = [{ id: 1, mfr: 'PlayStation', console: 'PS3', code: 'CECHA', note: '', date_codes: [] }];
    mockPool.query = async (sql) => {
        assert.match(sql, /SELECT id, mfr, console, code, note, date_codes FROM console_models ORDER BY id/);
        return { rows: fakeModels };
    };
    await withServer(async (base) => {
        const res = await fetch(`${base}/api/console-models`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.deepEqual(body, { success: true, models: fakeModels });
    });
});

test('POST /api/console-models rejects with 401 when not authenticated', async () => {
    mockPool.query = async () => { throw new Error('pool.query should not be called without a token'); };
    await withServer(async (base) => {
        const res = await fetch(`${base}/api/console-models`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mfr: 'X', console: 'Y', code: 'Z' }),
        });
        assert.equal(res.status, 401);
    });
});

test('POST /api/console-models rejects with 403 for a non-admin user', async () => {
    withUser(REGULAR_USER, async () => { throw new Error('route query should not run for a non-admin'); });
    await withServer(async (base) => {
        const res = await fetch(`${base}/api/console-models`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(REGULAR_USER)}` },
            body: JSON.stringify({ mfr: 'X', console: 'Y', code: 'Z' }),
        });
        assert.equal(res.status, 403);
    });
});

test('POST /api/console-models rejects with 400 when mfr/console/code are missing', async () => {
    withUser(ADMIN_USER, async () => { throw new Error('insert should not run when required fields are missing'); });
    await withServer(async (base) => {
        const res = await fetch(`${base}/api/console-models`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(ADMIN_USER)}` },
            body: JSON.stringify({ mfr: 'PlayStation' }),
        });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.success, false);
    });
});

test('POST /api/console-models adds a model as admin, sanitizing date_codes (caps at 20, drops codeless rows, trims to 40/200 chars)', async () => {
    const longCode = 'X'.repeat(60);
    const longNote = 'N'.repeat(200);
    const tooManyDateCodes = Array.from({ length: 25 }, (_, i) => ({ code: `dc${i}`, note: 'n' }));
    withUser(ADMIN_USER, async (sql, params) => {
        assert.match(sql, /INSERT INTO console_models/);
        const dateCodes = JSON.parse(params[4]);
        assert.equal(dateCodes.length, 20, 'date_codes must be capped at 20 entries');
        assert.equal(params[5], ADMIN_USER.id);
        return {
            rows: [{ id: 99, mfr: 'PlayStation', console: 'PS3', code: longCode.slice(0, 60), note: longNote.slice(0, 60), date_codes: dateCodes }],
        };
    });
    await withServer(async (base) => {
        const res = await fetch(`${base}/api/console-models`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(ADMIN_USER)}` },
            body: JSON.stringify({ mfr: 'PlayStation', console: 'PS3', code: longCode, note: longNote, date_codes: tooManyDateCodes }),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.success, true);
    });
});

test('POST /api/console-models returns 409 on a duplicate code (unique-violation from Postgres)', async () => {
    withUser(ADMIN_USER, async (sql) => {
        if (/INSERT INTO console_models/.test(sql)) {
            const err = new Error('duplicate key value violates unique constraint');
            err.code = '23505';
            throw err;
        }
        return { rows: [] };
    });
    await withServer(async (base) => {
        const res = await fetch(`${base}/api/console-models`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(ADMIN_USER)}` },
            body: JSON.stringify({ mfr: 'PlayStation', console: 'PS3', code: 'CECHA' }),
        });
        assert.equal(res.status, 409);
    });
});

test('PUT /api/console-models/:id returns 400 for a non-numeric id', async () => {
    withUser(ADMIN_USER, async () => { throw new Error('no query should run for a malformed id'); });
    await withServer(async (base) => {
        const res = await fetch(`${base}/api/console-models/not-a-number`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(ADMIN_USER)}` },
            body: JSON.stringify({ mfr: 'X', console: 'Y', code: 'Z' }),
        });
        assert.equal(res.status, 400);
    });
});

test('PUT /api/console-models/:id returns 404 when the id does not exist', async () => {
    withUser(ADMIN_USER, async (sql) => {
        if (/SELECT code, date_codes FROM console_models WHERE id = \$1/.test(sql)) {
            return { rows: [] };
        }
        return { rows: [] };
    });
    await withServer(async (base) => {
        const res = await fetch(`${base}/api/console-models/12345`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(ADMIN_USER)}` },
            body: JSON.stringify({ mfr: 'X', console: 'Y', code: 'Z' }),
        });
        assert.equal(res.status, 404);
    });
});

test('PUT /api/console-models/:id omitting date_codes preserves whatever is already stored, instead of wiping it', async () => {
    const existingDateCodes = [{ code: '0C', note: 'CFW-capable' }];
    let updateParams = null;
    withUser(ADMIN_USER, async (sql, params) => {
        if (/SELECT code, date_codes FROM console_models WHERE id = \$1/.test(sql)) {
            return { rows: [{ code: 'CECHA', date_codes: existingDateCodes }] };
        }
        if (/UPDATE console_models SET/.test(sql)) {
            updateParams = params;
            return { rows: [{ id: 5, mfr: 'PlayStation', console: 'PS3', code: 'CECHA', note: 'updated', date_codes: existingDateCodes }] };
        }
        return { rows: [] };
    });
    await withServer(async (base) => {
        // Note: date_codes deliberately omitted from the body.
        const res = await fetch(`${base}/api/console-models/5`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(ADMIN_USER)}` },
            body: JSON.stringify({ mfr: 'PlayStation', console: 'PS3', code: 'CECHA', note: 'updated' }),
        });
        assert.equal(res.status, 200);
        assert.ok(updateParams, 'UPDATE should have run');
        assert.deepEqual(JSON.parse(updateParams[5]), existingDateCodes);
    });
});

test('PUT /api/console-models/:id cascades a code rename into console_tutorials and console_mod_tutorials', async () => {
    const ranSql = [];
    withUser(ADMIN_USER, async (sql, params) => {
        ranSql.push(sql);
        if (/SELECT code, date_codes FROM console_models WHERE id = \$1/.test(sql)) {
            return { rows: [{ code: 'OLD-CODE', date_codes: [] }] };
        }
        if (/UPDATE console_models SET/.test(sql)) {
            return { rows: [{ id: 5, mfr: 'PlayStation', console: 'PS3', code: 'NEW-CODE', note: '', date_codes: [] }] };
        }
        return { rows: [] };
    });
    await withServer(async (base) => {
        const res = await fetch(`${base}/api/console-models/5`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(ADMIN_USER)}` },
            body: JSON.stringify({ mfr: 'PlayStation', console: 'PS3', code: 'NEW-CODE', note: '' }),
        });
        assert.equal(res.status, 200);
        assert.ok(ranSql.some(sql => /UPDATE console_tutorials SET model_code/.test(sql)), 'should rename disassembly tutorials too');
        assert.ok(ranSql.some(sql => /UPDATE console_mod_tutorials SET model_code/.test(sql)), 'should rename modding tutorials too');
        assert.ok(ranSql.some(sql => sql === 'BEGIN'), 'should run inside a transaction');
        assert.ok(ranSql.some(sql => sql === 'COMMIT'), 'should commit the transaction');
    });
});

test('PUT /api/console-models/:id does NOT rename tutorials when the code is unchanged', async () => {
    const ranSql = [];
    withUser(ADMIN_USER, async (sql) => {
        ranSql.push(sql);
        if (/SELECT code, date_codes FROM console_models WHERE id = \$1/.test(sql)) {
            return { rows: [{ code: 'SAME-CODE', date_codes: [] }] };
        }
        if (/UPDATE console_models SET/.test(sql)) {
            return { rows: [{ id: 5, mfr: 'PlayStation', console: 'PS3', code: 'SAME-CODE', note: '', date_codes: [] }] };
        }
        return { rows: [] };
    });
    await withServer(async (base) => {
        const res = await fetch(`${base}/api/console-models/5`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(ADMIN_USER)}` },
            body: JSON.stringify({ mfr: 'PlayStation', console: 'PS3', code: 'SAME-CODE', note: '' }),
        });
        assert.equal(res.status, 200);
        assert.ok(!ranSql.some(sql => /UPDATE console_tutorials SET model_code/.test(sql)));
        assert.ok(!ranSql.some(sql => /UPDATE console_mod_tutorials SET model_code/.test(sql)));
    });
});
