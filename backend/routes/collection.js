/* ─────────────────────────────────────────
   FILE: collection.js
   DESCRIPTION: /api/collection — a user's collection (2026-11-27, Andrei): what they
   physically own, one row per piece kind — a console (line + model, storage), a
   controller, a memory card, an accessory, a game... with a quantity, a special
   edition, a colour and a note. Edited only from the app (Personal → Collection);
   the site and the app show it on the public profile.

   The collection is the source of the "owned consoles" everything else reads
   (profile, My Space, Collection grid): after every write syncOwned() rebuilds
   user_owned_consoles (keeping the user's ranking), user_owned_variants (the
   lines), the revisions in user_owned_models and the users.owned_consoles CSV
   from the collection's console rows. My Space's "I own it" toggle and the old
   PUT /api/owned-consoles go through addConsole()/removeConsole() here.

   Auth:    GET /            my items
            POST /, PUT /:id, DELETE /:id, PUT /order {ids}
   Public:  GET /user/:username   someone's items (for the profile)
   ───────────────────────────────────────── */
const express = require('express');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');
const { awardXP } = require('../utils/gamification');
const { baseVariant, parseVariant, variantLabel } = require('../utils/consoleVariants');

const router = express.Router();

// Shown in this order on the profile and in the app.
const CATEGORIES = ['consola', 'controller', 'card_memorie', 'accesoriu', 'joc', 'altele'];
const CONSOLE_ID = /^[a-z0-9-]{1,40}$/;
const COLS = `id, category, console_id, variant, model, name, quantity, storage, edition, color, notes, position, created_at, updated_at`;
const ORDER = `array_position(ARRAY['${CATEGORIES.join("','")}']::text[], category), position NULLS LAST, id`;

function toItem(r) {
    return {
        id: r.id,
        category: r.category,
        console_id: r.console_id || null,
        variant: r.variant || null,
        model: r.model || null,
        name: r.name,
        quantity: r.quantity,
        storage: r.storage || null,
        edition: r.edition || null,
        color: r.color || null,
        notes: r.notes || null,
        position: r.position,
    };
}

/** Returns [values, errorField]. */
function validate(b = {}) {
    const text = (v, max) => {
        if (v === undefined || v === null) return [null, false];
        if (typeof v !== 'string') return [null, true];
        const t = v.trim();
        return t.length > max ? [null, true] : [t || null, false];
    };
    const out = {};
    out.category = CATEGORIES.includes(b.category) ? b.category : null;
    if (!out.category) return [null, 'category'];
    if (b.console_id === undefined || b.console_id === null || b.console_id === '') out.console_id = null;
    else if (typeof b.console_id === 'string' && CONSOLE_ID.test(b.console_id)) out.console_id = b.console_id;
    else return [null, 'console_id'];
    if (out.category === 'consola' && !out.console_id) return [null, 'console_id'];
    // A line must belong to the console; a console's own line is filled in when none is given.
    const v = b.variant ? parseVariant(b.variant) : null;
    if (b.variant && (!v || v.consoleId !== out.console_id)) return [null, 'variant'];
    out.variant = v ? v.key : (out.category === 'consola' ? baseVariant(out.console_id) : null);
    for (const [k, max] of [['model', 60], ['name', 120], ['storage', 30], ['edition', 120], ['color', 40], ['notes', 1000]]) {
        const [val, bad] = text(b[k], max);
        if (bad) return [null, k];
        out[k] = val;
    }
    if (!out.name) return [null, 'name'];
    const q = b.quantity === undefined ? 1 : Number(b.quantity);
    if (!Number.isInteger(q) || q < 1 || q > 999) return [null, 'quantity'];
    out.quantity = q;
    return [out, null];
}

/** Console name for an item created without one (My Space toggle, old clients). */
async function defaultName(consoleId, variant) {
    const label = variant ? variantLabel(variant) : null;
    if (label) return label;
    const { rows } = await pool.query(
        "SELECT data->>'name' AS name FROM consoles_translations WHERE id = $1 AND lang = 'en'", [consoleId]);
    return (rows[0] && rows[0].name) || consoleId;
}

/**
 * Rebuilds the owned-console tables from the collection's console rows. Ranking
 * (user_owned_consoles.position) is kept; a new console goes to the end and earns
 * the console_owned XP once.
 */
async function syncOwned(userId, io) {
    const { rows: items } = await pool.query(
        `SELECT console_id, variant, model FROM user_collection_items
          WHERE user_id = $1 AND category = 'consola' AND console_id IS NOT NULL
          ORDER BY position NULLS LAST, id`, [userId]);
    const consoles = [...new Set(items.map(i => i.console_id))];

    const { rows: existing } = await pool.query(
        'SELECT console_id, position FROM user_owned_consoles WHERE user_id = $1', [userId]);
    const had = new Set(existing.map(r => r.console_id));
    let next = existing.reduce((m, r) => Math.max(m, Number.isInteger(r.position) ? r.position + 1 : 0), 0);

    await pool.query('DELETE FROM user_owned_consoles WHERE user_id = $1 AND NOT (console_id = ANY($2::text[]))', [userId, consoles]);
    const added = [];
    for (const c of consoles) {
        if (had.has(c)) continue;
        await pool.query(
            'INSERT INTO user_owned_consoles (user_id, console_id, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [userId, c, next++]);
        added.push(c);
    }

    await pool.query('DELETE FROM user_owned_variants WHERE user_id = $1', [userId]);
    for (const key of new Set(items.map(i => i.variant || baseVariant(i.console_id)))) {
        await pool.query(
            'INSERT INTO user_owned_variants (user_id, console_id, variant) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [userId, key.split('|')[0], key]);
    }

    // Revisions: what the collection names, plus any My Space ticked on a console still owned.
    await pool.query('DELETE FROM user_owned_models WHERE user_id = $1 AND NOT (console_id = ANY($2::text[]))', [userId, consoles]);
    for (const i of items) {
        if (!i.model) continue;
        await pool.query(
            'INSERT INTO user_owned_models (user_id, console_id, model_code) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [userId, i.console_id, i.model]);
    }

    await pool.query(
        `UPDATE users SET owned_consoles = COALESCE((
           SELECT string_agg(console_id, ',' ORDER BY position NULLS LAST, id)
             FROM user_owned_consoles WHERE user_id = $1), '') WHERE id = $1`, [userId]);

    for (const c of added) awardXP(pool, io, userId, 'console_owned', c).catch(() => {});
}

/** "I own this console" (My Space, old Settings): adds a console row unless one exists. */
async function addConsole(userId, consoleId, variant = null, model = null) {
    const { rows } = await pool.query(
        "SELECT id, model FROM user_collection_items WHERE user_id = $1 AND category = 'consola' AND console_id = $2 ORDER BY id",
        [userId, consoleId]);
    if (rows.length) {
        // A revision ticked in My Space fills the first console row that has none.
        if (model && !rows.some(r => r.model === model)) {
            const free = rows.find(r => !r.model);
            if (free) {
                await pool.query('UPDATE user_collection_items SET model = $1, variant = COALESCE($2, variant), updated_at = NOW() WHERE id = $3',
                    [model, variant, free.id]);
                return;
            }
        } else return;
    }
    const key = variant || baseVariant(consoleId);
    await pool.query(
        `INSERT INTO user_collection_items (user_id, category, console_id, variant, model, name, quantity, position)
         VALUES ($1, 'consola', $2, $3, $4, $5, 1,
                 (SELECT COALESCE(MAX(position) + 1, 0) FROM user_collection_items WHERE user_id = $1))`,
        [userId, consoleId, key, model, await defaultName(consoleId, key)]);
}

/** "I no longer own it": removes the console rows of that console (accessories stay). */
async function removeConsole(userId, consoleId) {
    await pool.query("DELETE FROM user_collection_items WHERE user_id = $1 AND category = 'consola' AND console_id = $2",
        [userId, consoleId]);
}

// ── Mine ─────────────────────────────────────────────────
router.get('/', authRequired, async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT ${COLS} FROM user_collection_items WHERE user_id = $1 ORDER BY ${ORDER}`, [req.user.id]);
        res.json({ success: true, items: rows.map(toItem) });
    } catch (err) {
        console.error('Collection GET error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

router.post('/', authRequired, async (req, res) => {
    const [v, bad] = validate(req.body);
    if (bad) return res.status(400).json({ success: false, error: `Invalid ${bad}.` });
    try {
        const { rows: cnt } = await pool.query('SELECT COUNT(*)::int AS n FROM user_collection_items WHERE user_id = $1', [req.user.id]);
        if (cnt[0].n >= 500) return res.status(400).json({ success: false, error: 'Collection limit reached (500).' });
        const { rows } = await pool.query(
            `INSERT INTO user_collection_items
                 (user_id, category, console_id, variant, model, name, quantity, storage, edition, color, notes, position)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                     (SELECT COALESCE(MAX(position) + 1, 0) FROM user_collection_items WHERE user_id = $1))
             RETURNING ${COLS}`,
            [req.user.id, v.category, v.console_id, v.variant, v.model, v.name, v.quantity, v.storage, v.edition, v.color, v.notes]);
        await syncOwned(req.user.id, req.app.get('io'));
        res.status(201).json({ success: true, item: toItem(rows[0]) });
    } catch (err) {
        console.error('Collection POST error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// Before /:id, so "order" is never read as an id.
router.put('/order', authRequired, async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
    if (!ids) return res.status(400).json({ success: false, error: 'Invalid order.' });
    try {
        await pool.query(
            `UPDATE user_collection_items t SET position = v.pos
               FROM (SELECT * FROM UNNEST($2::int[], $3::int[]) AS u(id, pos)) v
              WHERE t.user_id = $1 AND t.id = v.id`,
            [req.user.id, ids, ids.map((_, i) => i)]);
        res.json({ success: true });
    } catch (err) {
        console.error('Collection order error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

router.put('/:id', authRequired, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const [v, bad] = validate(req.body);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Invalid id.' });
    if (bad) return res.status(400).json({ success: false, error: `Invalid ${bad}.` });
    try {
        const { rows } = await pool.query(
            `UPDATE user_collection_items
                SET category = $3, console_id = $4, variant = $5, model = $6, name = $7, quantity = $8,
                    storage = $9, edition = $10, color = $11, notes = $12, updated_at = NOW()
              WHERE id = $1 AND user_id = $2 RETURNING ${COLS}`,
            [id, req.user.id, v.category, v.console_id, v.variant, v.model, v.name, v.quantity, v.storage, v.edition, v.color, v.notes]);
        if (!rows.length) return res.status(404).json({ success: false, error: 'Not found.' });
        await syncOwned(req.user.id, req.app.get('io'));
        res.json({ success: true, item: toItem(rows[0]) });
    } catch (err) {
        console.error('Collection PUT error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

router.delete('/:id', authRequired, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Invalid id.' });
    try {
        const { rowCount } = await pool.query('DELETE FROM user_collection_items WHERE id = $1 AND user_id = $2', [id, req.user.id]);
        if (!rowCount) return res.status(404).json({ success: false, error: 'Not found.' });
        await syncOwned(req.user.id, req.app.get('io'));
        res.json({ success: true });
    } catch (err) {
        console.error('Collection DELETE error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── Public ───────────────────────────────────────────────
router.get('/user/:username', async (req, res) => {
    try {
        const { rows: u } = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [String(req.params.username || '')]);
        if (!u.length) return res.status(404).json({ success: false, error: 'User not found.' });
        const { rows } = await pool.query(`SELECT ${COLS} FROM user_collection_items WHERE user_id = $1 ORDER BY ${ORDER}`, [u[0].id]);
        res.json({ success: true, items: rows.map(toItem) });
    } catch (err) {
        console.error('Collection public GET error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

module.exports = router;
module.exports.syncOwned = syncOwned;
module.exports.addConsole = addConsole;
module.exports.removeConsole = removeConsole;
module.exports.CATEGORIES = CATEGORIES;
