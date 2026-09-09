'use strict';

/**
 * installMockDb
 * @description Pre-populates require.cache for '../../db' with a fake pool BEFORE
 * any route/middleware file requires it, so `require('../db')` never executes the
 * real db.js module — which opens a real Postgres connection at import time and
 * calls process.exit(1) if that connection fails (fatal for CI, where no DB is
 * reachable). Must be called before any require() of a route or middleware file.
 * @param {(sql: string, params?: any[]) => Promise<{rows: any[]}>} [queryImpl]
 * @returns {{query: Function, connect: Function}} the installed mock pool, so tests
 * can override .query (and, for routes using pool.connect() for a transaction —
 * e.g. console-models.js's PUT /:id — .connect) per-case.
 */
function installMockDb(queryImpl) {
    const dbPath = require.resolve('../../db');
    const mockPool = {
        query: queryImpl || (async () => ({ rows: [] })),
        // Default: a client whose .query just delegates to the pool's own
        // .query at call time (so overriding mockPool.query per-test still
        // works for routes that go through pool.connect() instead of a bare
        // pool.query() — BEGIN/COMMIT/ROLLBACK included, since real Postgres
        // accepts those as plain queries too). Override mockPool.connect
        // directly in a test that needs to assert something transaction-shaped
        // (e.g. a ROLLBACK happened) rather than just data in/out.
        connect: async () => ({
            query: (...args) => mockPool.query(...args),
            release: () => {},
        }),
    };
    require.cache[dbPath] = {
        id: dbPath,
        filename: dbPath,
        loaded: true,
        exports: mockPool,
    };
    return mockPool;
}

module.exports = { installMockDb };
