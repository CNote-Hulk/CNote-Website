/* ─────────────────────────────────────────
   FILE: personal.js
   DESCRIPTION: Personal Routes — /api/personal
   Andrei's own Finance + Projects pages in the Android app (moved from the
   retired Mind Tree app, 2026-11-04). Owner-only: gated on the user id of
   the AndreiHulk07 account, not on role — CNote has several admins.
     - cash-flow: expenses/income in `personal_cash_flow` (RLS on, no
       policies, so the publishable key shipped in the APK can't read it;
       this route goes through the pg pool).
     - inventory: stock in `personal_inventory_items` / `personal_inventory_movements`
       (same RLS setup; quantity changes only through movements).
     - projects: the Mind Tree vault's two `_Index.md` files, fetched from
       the private GitHub repo with a server-side token and parsed into a
       plain list. One request instead of the phone walking the vault.
   ───────────────────────────────────────── */
/* ── REQUIRED IMPORTS — DO NOT REMOVE ──────
   If you add a new package:
     1. require() it here
     2. Add it to package.json dependencies
   ────────────────────────────────────────── */
const express = require('express');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// users.id of AndreiHulk07 (checked 2026-11-04). An id, not the username:
// usernames can be changed, and a freed name could be picked up by someone else.
const OWNER_USER_ID = parseInt(process.env.PERSONAL_OWNER_USER_ID, 10) || 3;

router.use(authRequired, (req, res, next) => {
    if (!req.user || req.user.id !== OWNER_USER_ID) {
        return res.status(403).json({ success: false, error: 'Acces interzis.' });
    }
    next();
});

// ── Cash flow ────────────────────────────────────────────

const TYPES = new Set(['income', 'expense']);

function toEntry(row) {
    return {
        id: row.id,
        business: row.business,
        type: row.type,
        amount_ron: Number(row.amount_ron),
        category: row.category,
        occurred_on: row.occurred_on,
        note: row.note,
        created_at: row.created_at,
    };
}

/** Returns [values, error]. occurred_on is kept as the YYYY-MM-DD string. */
function validate(body) {
    const b = body || {};
    const business = typeof b.business === 'string' ? b.business.trim() : '';
    const type = typeof b.type === 'string' ? b.type.toLowerCase() : '';
    const amount = Number(b.amount_ron);
    const category = typeof b.category === 'string' ? b.category.trim() : '';
    const occurredOn = typeof b.occurred_on === 'string' ? b.occurred_on : '';
    const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim() : null;
    if (!business || business.length > 100) return [null, 'business'];
    if (!TYPES.has(type)) return [null, 'type'];
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) return [null, 'amount_ron'];
    if (!category || category.length > 100) return [null, 'category'];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) return [null, 'occurred_on'];
    if (note && note.length > 2000) return [null, 'note'];
    return [[business, type, amount, category, occurredOn, note], null];
}

const SELECT_COLS = `id, business, type, amount_ron, category,
    to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on, note, created_at`;

// GET /api/personal/cash-flow — every entry, newest first
router.get('/cash-flow', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT ${SELECT_COLS} FROM personal_cash_flow ORDER BY occurred_on DESC, created_at DESC`
        );
        res.json({ success: true, entries: rows.map(toEntry) });
    } catch (err) {
        console.error('Personal cash-flow GET error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// POST /api/personal/cash-flow
router.post('/cash-flow', async (req, res) => {
    const [v, bad] = validate(req.body);
    if (bad) return res.status(400).json({ success: false, error: `Invalid ${bad}.` });
    try {
        const { rows } = await pool.query(
            `INSERT INTO personal_cash_flow (business, type, amount_ron, category, occurred_on, note)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${SELECT_COLS}`,
            v
        );
        res.status(201).json({ success: true, entry: toEntry(rows[0]) });
    } catch (err) {
        console.error('Personal cash-flow POST error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// PUT /api/personal/cash-flow/:id
router.put('/cash-flow/:id', async (req, res) => {
    const [v, bad] = validate(req.body);
    if (bad) return res.status(400).json({ success: false, error: `Invalid ${bad}.` });
    try {
        const { rows } = await pool.query(
            `UPDATE personal_cash_flow
             SET business = $1, type = $2, amount_ron = $3, category = $4, occurred_on = $5, note = $6
             WHERE id = $7 RETURNING ${SELECT_COLS}`,
            [...v, req.params.id]
        );
        if (!rows.length) return res.status(404).json({ success: false, error: 'Not found.' });
        res.json({ success: true, entry: toEntry(rows[0]) });
    } catch (err) {
        if (err.code === '22P02') return res.status(404).json({ success: false, error: 'Not found.' });
        console.error('Personal cash-flow PUT error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// DELETE /api/personal/cash-flow/:id
router.delete('/cash-flow/:id', async (req, res) => {
    try {
        const { rowCount } = await pool.query('DELETE FROM personal_cash_flow WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ success: false, error: 'Not found.' });
        res.json({ success: true });
    } catch (err) {
        if (err.code === '22P02') return res.status(404).json({ success: false, error: 'Not found.' });
        console.error('Personal cash-flow DELETE error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── Inventory (personal_inventory_items + personal_inventory_movements) ──
// Source of truth for stock: consoles, accessories, components, tools, cables,
// consumables. Quantity changes only through movements (a DB trigger applies
// them), so the history is kept. Same owner gate and pg pool as cash-flow.

const INV_CATEGORIES = new Set([
    'consola', 'accesoriu', 'componenta', 'unealta', 'cablu_adaptor', 'consumabil', 'de_vanzare',
]);
const INV_REASONS = new Set(['vanzare', 'achizitie', 'consum', 'corectie', 'initial']);
const INV_COLS = `id, category, name, model, quantity, unit, condition, location,
    min_quantity, vault_note, notes, created_at, updated_at`;

function optText(v, max) {
    if (v === undefined || v === null) return [null, false];
    if (typeof v !== 'string') return [null, true];
    const t = v.trim();
    if (t.length > max) return [null, true];
    return [t || null, false];
}

function toItem(row) {
    return {
        id: row.id,
        category: row.category,
        name: row.name,
        model: row.model,
        quantity: Number(row.quantity),
        unit: row.unit,
        condition: row.condition,
        location: row.location,
        min_quantity: row.min_quantity === null ? null : Number(row.min_quantity),
        vault_note: row.vault_note,
        notes: row.notes,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

/** Returns [values, error]. Quantity is not validated here: it only moves via movements. */
function validateItem(body) {
    const b = body || {};
    const category = typeof b.category === 'string' ? b.category : '';
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!INV_CATEGORIES.has(category)) return [null, 'category'];
    if (!name || name.length > 200) return [null, 'name'];
    const out = { category, name };
    for (const [key, max] of [['model', 200], ['condition', 500], ['location', 200], ['vault_note', 500], ['notes', 2000]]) {
        const [val, bad] = optText(b[key], max);
        if (bad) return [null, key];
        out[key] = val;
    }
    const [unit, badUnit] = optText(b.unit, 30);
    if (badUnit) return [null, 'unit'];
    out.unit = unit || 'buc';
    if (b.min_quantity === undefined || b.min_quantity === null || b.min_quantity === '') {
        out.min_quantity = null;
    } else {
        const m = Number(b.min_quantity);
        if (!Number.isFinite(m) || m < 0 || m > 1e9) return [null, 'min_quantity'];
        out.min_quantity = m;
    }
    return [out, null];
}

function validateMovement(body) {
    const b = body || {};
    const delta = Number(b.delta);
    const reason = typeof b.reason === 'string' ? b.reason : '';
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 1e9) return [null, 'delta'];
    if (!INV_REASONS.has(reason)) return [null, 'reason'];
    const [note, badNote] = optText(b.note, 1000);
    if (badNote) return [null, 'note'];
    let occurredOn = null;
    if (b.occurred_on !== undefined && b.occurred_on !== null) {
        if (typeof b.occurred_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.occurred_on)) return [null, 'occurred_on'];
        occurredOn = b.occurred_on;
    }
    return [{ delta, reason, note, occurredOn }, null];
}

// GET /api/personal/inventory — every item, grouped by the client via `category`
router.get('/inventory', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT ${INV_COLS} FROM personal_inventory_items ORDER BY category, name`
        );
        res.json({ success: true, items: rows.map(toItem) });
    } catch (err) {
        console.error('Personal inventory GET error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// POST /api/personal/inventory — new item; optional `quantity` is booked as an initial movement
router.post('/inventory', async (req, res) => {
    const [v, bad] = validateItem(req.body);
    if (bad) return res.status(400).json({ success: false, error: `Invalid ${bad}.` });
    const qty = req.body && req.body.quantity !== undefined ? Number(req.body.quantity) : 0;
    if (!Number.isFinite(qty) || qty < 0 || qty > 1e9) {
        return res.status(400).json({ success: false, error: 'Invalid quantity.' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            `INSERT INTO personal_inventory_items
                 (category, name, model, quantity, unit, condition, location, min_quantity, vault_note, notes)
             VALUES ($1, $2, $3, 0, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [v.category, v.name, v.model, v.unit, v.condition, v.location, v.min_quantity, v.vault_note, v.notes]
        );
        if (qty > 0) {
            await client.query(
                `INSERT INTO personal_inventory_movements (item_id, delta, reason, note)
                 VALUES ($1, $2, 'initial', NULL)`,
                [rows[0].id, qty]
            );
        }
        const { rows: item } = await client.query(
            `SELECT ${INV_COLS} FROM personal_inventory_items WHERE id = $1`, [rows[0].id]
        );
        await client.query('COMMIT');
        res.status(201).json({ success: true, item: toItem(item[0]) });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Personal inventory POST error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    } finally {
        client.release();
    }
});

// PUT /api/personal/inventory/:id — edit details (not quantity; use movements)
router.put('/inventory/:id', async (req, res) => {
    const [v, bad] = validateItem(req.body);
    if (bad) return res.status(400).json({ success: false, error: `Invalid ${bad}.` });
    try {
        const { rows } = await pool.query(
            `UPDATE personal_inventory_items
             SET category = $1, name = $2, model = $3, unit = $4, condition = $5,
                 location = $6, min_quantity = $7, vault_note = $8, notes = $9
             WHERE id = $10 RETURNING ${INV_COLS}`,
            [v.category, v.name, v.model, v.unit, v.condition, v.location, v.min_quantity, v.vault_note, v.notes, req.params.id]
        );
        if (!rows.length) return res.status(404).json({ success: false, error: 'Not found.' });
        res.json({ success: true, item: toItem(rows[0]) });
    } catch (err) {
        if (err.code === '22P02') return res.status(404).json({ success: false, error: 'Not found.' });
        console.error('Personal inventory PUT error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// DELETE /api/personal/inventory/:id — removes the item and its movements
router.delete('/inventory/:id', async (req, res) => {
    try {
        const { rowCount } = await pool.query('DELETE FROM personal_inventory_items WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ success: false, error: 'Not found.' });
        res.json({ success: true });
    } catch (err) {
        if (err.code === '22P02') return res.status(404).json({ success: false, error: 'Not found.' });
        console.error('Personal inventory DELETE error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// GET /api/personal/inventory/:id/movements — history of one item, newest first
router.get('/inventory/:id/movements', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, item_id, delta, reason, note,
                    to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on, created_at
             FROM personal_inventory_movements
             WHERE item_id = $1 ORDER BY occurred_on DESC, created_at DESC`,
            [req.params.id]
        );
        res.json({
            success: true,
            movements: rows.map((r) => ({ ...r, delta: Number(r.delta) })),
        });
    } catch (err) {
        if (err.code === '22P02') return res.status(404).json({ success: false, error: 'Not found.' });
        console.error('Personal inventory movements GET error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// POST /api/personal/inventory/:id/movements — +/- stock; the trigger updates quantity
router.post('/inventory/:id/movements', async (req, res) => {
    const [v, bad] = validateMovement(req.body);
    if (bad) return res.status(400).json({ success: false, error: `Invalid ${bad}.` });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO personal_inventory_movements (item_id, delta, reason, note, occurred_on)
             VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE))`,
            [req.params.id, v.delta, v.reason, v.note, v.occurredOn]
        );
        const { rows } = await client.query(
            `SELECT ${INV_COLS} FROM personal_inventory_items WHERE id = $1`, [req.params.id]
        );
        await client.query('COMMIT');
        res.status(201).json({ success: true, item: toItem(rows[0]) });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err.code === '22P02' || err.code === '23503') {
            return res.status(404).json({ success: false, error: 'Not found.' });
        }
        if (err.code === '23514') {
            return res.status(409).json({ success: false, error: 'Stoc insuficient.' });
        }
        console.error('Personal inventory movement POST error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    } finally {
        client.release();
    }
});

// ── Projects (from the vault's _Index.md files on GitHub) ─

const VAULT_REPO = process.env.VAULT_GITHUB_REPO || 'CNote-Hulk/Mind-Tree-Vault';
const INDEX_PATHS = { projects: '02 Proiecte/_Index.md', archive: '06 Arhivă/_Index.md' };
const CACHE_MS = 60 * 1000;
let cache = null; // { at, data }

async function fetchVaultFile(path) {
    const url = `https://api.github.com/repos/${VAULT_REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
    const resp = await fetch(url, {
        headers: {
            Accept: 'application/vnd.github.raw+json',
            Authorization: `Bearer ${process.env.VAULT_GITHUB_TOKEN}`,
            'User-Agent': 'consolenotebook-backend',
        },
    });
    if (!resp.ok) throw new Error(`GitHub ${resp.status} for ${path}`);
    return resp.text();
}

/** `[[path|alias]]` → alias, `[[a/b/Name]]` → Name. */
function linkLabel(inner) {
    const [target, alias] = inner.split('|');
    return (alias || target.split('/').pop()).trim();
}

/** Strips wikilinks/bold/code down to readable text. */
function plain(text) {
    return text
        .replace(/\[\[([^\]]+)\]\]/g, (_, inner) => linkLabel(inner))
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .trim();
}

/**
 * `## Section` headings → sections; `- [[link]] — description` bullets (any
 * indent; two spaces per level) → items. A bullet that doesn't start with a
 * link keeps its whole text as the name. Lines outside bullets are ignored.
 */
function parseIndex(md) {
    const sections = [];
    let current = null;
    for (const raw of md.replace(/\r/g, '').split('\n')) {
        const h = raw.match(/^##\s+(.+)$/);
        if (h) {
            current = { title: plain(h[1]), items: [] };
            sections.push(current);
            continue;
        }
        const b = raw.match(/^(\s*)-\s+(.+)$/);
        if (!b || !current) continue;
        const depth = Math.floor(b[1].replace(/\t/g, '  ').length / 2);
        const body = b[2];
        const link = body.match(/^\[\[([^\]]+)\]\]\s*(?:[—–-]\s*)?(.*)$/);
        if (link) {
            current.items.push({ name: linkLabel(link[1]), description: plain(link[2]) || null, depth });
        } else {
            current.items.push({ name: plain(body), description: null, depth });
        }
    }
    return sections.filter((s) => s.items.length);
}

// GET /api/personal/projects — { projects: [sections], archive: [sections] }
router.get('/projects', async (req, res) => {
    if (!process.env.VAULT_GITHUB_TOKEN) {
        return res.status(500).json({ success: false, error: 'VAULT_GITHUB_TOKEN not configured.' });
    }
    try {
        if (!cache || Date.now() - cache.at > CACHE_MS || req.query.refresh === '1') {
            const [projects, archive] = await Promise.all([
                fetchVaultFile(INDEX_PATHS.projects),
                fetchVaultFile(INDEX_PATHS.archive),
            ]);
            cache = { at: Date.now(), data: { projects: parseIndex(projects), archive: parseIndex(archive) } };
        }
        res.json({ success: true, ...cache.data });
    } catch (err) {
        console.error('Personal projects GET error:', err);
        res.status(502).json({ success: false, error: 'Could not read the vault index.' });
    }
});

module.exports = router;
module.exports._parseIndex = parseIndex; // exposed for a quick local check
