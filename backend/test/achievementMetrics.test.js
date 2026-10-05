'use strict';

// (2026-10-05) getAchievementMetrics replaced a 14-query Promise.all fan-out
// (in GET /api/achievements, GET /api/achievements/user/:username and
// checkAchievements) that, against Supabase's Session pooler (pool_size 15),
// let one or two concurrent profile views exhaust every DB connection. These
// tests pin the "one query per call" contract and the metric mapping.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getAchievementMetrics } = require('../utils/gamification');

const ROW = {
    id: 3, created_at: new Date(Date.now() - 10 * 86400000).toISOString(), avatar: 'a.webp', bio: 'hi',
    consoles_visited: 30, friends_count: 4, consoles_favorited: 5, consoles_owned: 3,
    lessons_completed: 8, courses_completed: 0, perfect_quizzes: 7, forum_posts: 1,
    dms_sent: 102, upvotes_received: '6', listings_created: 2, ebay_accounts: 1,
};

test('getAchievementMetrics: exactly one query, all counters mapped', async () => {
    const calls = [];
    const pool = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [ROW] }; } };
    const m = await getAchievementMetrics(pool, 3);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params, [3]);
    assert.equal(m.consoles_visited, 30);
    assert.equal(m.dms_sent, 102);
    assert.equal(m.upvotes_received, 6);       // SUM() comes back as a string
    assert.equal(m.ebay_connected, 1);
    assert.equal(m.profile_complete, 1);
    assert.equal(m.days_member, 10);
    assert.equal(m.user_id_value, 3);
});

test('getAchievementMetrics: unknown user returns null', async () => {
    const pool = { query: async () => ({ rows: [] }) };
    assert.equal(await getAchievementMetrics(pool, 999), null);
});

test('getAchievementMetrics: no avatar or bio means profile not complete', async () => {
    const pool = { query: async () => ({ rows: [{ ...ROW, avatar: '', bio: null, ebay_accounts: 0 }] }) };
    const m = await getAchievementMetrics(pool, 3);
    assert.equal(m.profile_complete, 0);
    assert.equal(m.ebay_connected, 0);
});
