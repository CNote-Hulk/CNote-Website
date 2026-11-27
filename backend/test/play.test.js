'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const crypto = require('crypto');
const { installMockDb } = require('./helpers/mockDb');

const mockPool = installMockDb(async () => ({ rows: [] }));
const playRoutes = require('../routes/play');
const { buildBoards, cleanData } = playRoutes._test;

const TOKEN = 'a'.repeat(64);
const TOKEN_HASH = crypto.createHash('sha256').update(TOKEN).digest('hex');

async function withServer(fn) {
    const app = express();
    app.use(express.json());
    app.use('/api/play', playRoutes);
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    try {
        await fn(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

test('boards: versus wins, CPU fights apart, best arcade run per player', () => {
    const ev = (kind, data, p1 = 'Andrei', p2 = 'Mihai') => ({ kind, data, p1_name: p1, p2_name: p2, game: 'MK' });
    const b = buildBoards([
        ev('fight', { winner: 1 }),
        ev('fight', { winner: 2 }),
        ev('fight', { winner: 2 }),
        ev('fight', { winner: 1, vs_cpu: true }),
        ev('arcade_run', { player: 1, reached: 4 }),
        ev('arcade_run', { player: 1, reached: 2 }),
        ev('arcade_run', { player: 2, reached: 9, cleared: true }),
        ev('race', { winner: 1 }),
        ev('race', { winner: 1 }),
    ]);
    assert.deepEqual(b.races.map((r) => [r.name, r.wins, r.losses]), [['Andrei', 2, 0], ['Mihai', 0, 2]]);
    assert.deepEqual(b.versus.map((r) => [r.name, r.wins, r.losses]), [['Mihai', 2, 1], ['Andrei', 1, 2]]);
    assert.deepEqual(b.vs_cpu.map((r) => [r.name, r.wins, r.losses]), [['Andrei', 1, 0]]);
    assert.deepEqual(b.arcade.map((r) => [r.name, r.reached, r.cleared, r.runs]), [['Mihai', 9, true, 1], ['Andrei', 4, false, 2]]);
});

test('cleanData keeps only known, clamped fields', () => {
    assert.deepEqual(cleanData('fight', { winner: 7, rounds: [2, 'x'], evil: 1 }), { winner: 2, rounds: [2, 0], vs_cpu: false });
    assert.deepEqual(cleanData('arcade_run', { player: 1, reached: 500, cleared: 1 }), { player: 1, reached: 99, cleared: true });
});

test('device events: token required, batch accepted', async () => {
    const inserted = [];
    mockPool.query = async (sql, params = []) => {
        if (/UPDATE connected_consoles SET last_seen_at/.test(sql)) {
            return { rows: params[0] === TOKEN_HASH ? [{ id: 3, user_id: 7 }] : [] };
        }
        if (/INSERT INTO play_events/.test(sql)) { inserted.push(params); return { rows: [{ id: inserted.length }] }; }
        return { rows: [] };
    };
    await withServer(async (base) => {
        const body = { events: [{ id: 'e1', kind: 'fight', serial: 'SLUS_215.43', at: new Date().toISOString(), data: { winner: 1 } }, { id: 'e2', kind: 'bogus' }] };
        const noAuth = await fetch(`${base}/api/play/device/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        assert.equal(noAuth.status, 401);
        const ok = await fetch(`${base}/api/play/device/events`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': TOKEN }, body: JSON.stringify(body),
        });
        assert.equal(ok.status, 200);
        const json = await ok.json();
        assert.deepEqual(json.accepted, ['e1']);
        assert.deepEqual(json.rejected, ['e2']);
        assert.equal(inserted.length, 1);
        assert.equal(inserted[0][0], 7); // user from the device token, not from the body
        assert.equal(JSON.parse(inserted[0][6]).winner, 1);
    });
});

test('duel: a key opens only its own side; join names the side and the session', async () => {
    const { sideOf } = playRoutes._test;
    const match = { id: 5, k1: 'AAAAAAAAAAAA', k2: 'BBBBBBBBBBBB', session_id: 9, p1_name: '', p2_name: 'Old' };
    assert.equal(sideOf(match, 'AAAAAAAAAAAA'), 1);
    assert.equal(sideOf(match, 'BBBBBBBBBBBB'), 2);
    assert.equal(sideOf(match, 'CCCCCCCCCCCC'), 0);
    assert.equal(sideOf(match, ''), 0);

    const updates = [];
    mockPool.query = async (sql, params = []) => {
        if (/FROM play_matches m LEFT JOIN play_sessions/.test(sql)) return { rows: params[0] === 5 ? [match] : [] };
        if (/UPDATE play_matches SET p1_name/.test(sql) || /UPDATE play_sessions SET p1_name/.test(sql)) { updates.push([sql.split(' ')[1], params]); }
        return { rows: [] };
    };
    await withServer(async (base) => {
        const bad = await fetch(`${base}/api/play/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ m: 5, k: 'BAD-KEY-1234', name: 'X' }) });
        assert.equal(bad.status, 404);
        const ok = await fetch(`${base}/api/play/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ m: 5, k: 'AAAAAAAAAAAA', name: 'Andrei' }) });
        const json = await ok.json();
        assert.equal(json.side, 1);
        assert.equal(json.p1_name, 'Andrei');
        assert.equal(json.p2_name, 'Old');
        assert.deepEqual(updates.map((u) => u[0]), ['play_matches', 'play_sessions']);
    });
});

test('live: now state is cleaned, frames must be JPEG', async () => {
    const { cleanNow } = playRoutes._test;
    const s = cleanNow({ serial: 'slus-215.43', title: 'MK', presence: 'Arcade Mode (Match 3)', ach: [3, 118], inputs: [16, 99999999], evil: 1 });
    assert.equal(s.serial, 'SLUS21543');
    assert.deepEqual(s.ach, [3, 118]);
    assert.deepEqual(s.inputs, [16, 0xffff]);
    assert.equal(s.evil, undefined);
    const f = cleanNow({ fight: { h1: 1.7, h2: 0.3, r1: 1, c1: 'Scorpion', phase: 'FIGHT!', x: 1 } }).fight;
    assert.deepEqual(f, { h1: 1, h2: 0.3, r1: 1, c1: 'Scorpion', phase: 'FIGHT!' });

    mockPool.query = async (sql, params = []) => {
        if (/UPDATE connected_consoles SET last_seen_at/.test(sql)) return { rows: [{ id: 3, user_id: 7 }] };
        return { rows: [] };
    };
    await withServer(async (base) => {
        const notJpeg = await fetch(`${base}/api/play/device/frame`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-Device-Token': TOKEN }, body: Buffer.alloc(200, 1) });
        assert.equal(notJpeg.status, 400);
        const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(200, 1)]);
        const ok = await fetch(`${base}/api/play/device/frame`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-Device-Token': TOKEN }, body: jpeg });
        assert.equal(ok.status, 200);
    });
});

test('community: live lists only sessions with something happening, hall groups by game', async () => {
    const recent = new Date().toISOString();
    const old = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    mockPool.query = async (sql) => {
        if (/FROM play_sessions s JOIN users u/.test(sql) && /ended_at IS NULL AND s.created_at/.test(sql)) {
            return { rows: [
                { id: 1, user_id: 50, slug: 'aaaa1', title: 'MK', username: 'andrei', last_event: recent, events: 3, game_serial: 'SLUS21543', p1_name: 'A', p2_name: 'B' },
                { id: 2, user_id: 51, slug: 'bbbb2', title: 'Old', username: 'x', last_event: old, events: 1, game_serial: '' },
            ] };
        }
        if (/FROM play_events e\s+WHERE e.game <> ''/.test(sql)) {
            return { rows: [
                { game: 'MK', serial: 'SLUS21543', kind: 'fight', p1_name: 'A', p2_name: 'B', data: { winner: 1 } },
                { game: 'MK', serial: 'SLUS21543', kind: 'arcade_run', p1_name: 'A', p2_name: '', data: { player: 1, reached: 6 } },
                { game: 'NFS', serial: 'SLES52725', kind: 'race', p1_name: 'A', p2_name: 'B', data: { winner: 2 } },
            ] };
        }
        return { rows: [] };
    };
    await withServer(async (base) => {
        const live = await (await fetch(`${base}/api/play/live`)).json();
        assert.deepEqual(live.sessions.map((s) => s.slug), ['aaaa1']);
        const hall = await (await fetch(`${base}/api/play/hall`)).json();
        assert.deepEqual(hall.games.map((g) => g.game), ['MK', 'NFS']);
        assert.equal(hall.games[0].arcade[0].reached, 6);
        assert.equal(hall.games[1].races[0].name, 'B');
    });
});
