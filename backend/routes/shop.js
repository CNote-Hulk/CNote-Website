/* ─────────────────────────────────────────
   FILE: shop.js
   DESCRIPTION: /api/shop — the CNote shop: consoles from CNote's own stock,
   bought by order (no messaging back and forth as on the marketplace).

   The buyer builds a package on shop.html: one console unit (each physical
   console is its own row - model code, condition, price), optionally a mod
   and a storage upgrade (paid services, one of each at most), and
   accessories with a quantity. Cables always come with the console. The
   order reserves the unit and takes the accessories off the stock in one
   transaction; cancelling it puts everything back. No payment on the site -
   it is arranged with CNote, as with marketplace orders (utils/shipping.js).

   Public:  GET  /                    consoles with units in stock (count, lowest price)
            GET  /:consoleId          what is in stock for that console
   Buyer:   POST /orders, GET /orders/mine
   Admin:   GET  /orders, PATCH /orders/:id (status), stock CRUD:
            POST/PUT/DELETE /units[/:id], POST/PUT/DELETE /extras[/:id]
            GET /:consoleId?all=1 also lists reserved/sold units, inactive extras
   Admins are "CNote": every admin sees and processes every shop order.
   ───────────────────────────────────────── */
const express = require('express');
const pool = require('../db');
const { authRequired, authOptional } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminOnly');
const { parseShipping } = require('../utils/shipping');
const { createNotification } = require('./notifications');

const router = express.Router();

const EXTRA_KINDS = ['accessory', 'mod', 'storage'];
const UNIT_STATUSES = ['available', 'reserved', 'sold', 'hidden'];
// new → confirmed → shipped, or cancelled (from new/confirmed). A cancelled
// order is final: its stock went back on the shelf and may be sold again.
const ORDER_STATUSES = ['new', 'confirmed', 'shipped', 'cancelled'];
const CONSOLE_ID = /^[a-z0-9-]{1,40}$/;

const money = v => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n < 1e7 ? Math.round(n * 100) / 100 : null;
};
const text = (v, n) => String(v ?? '').trim().slice(0, n);
const models = v => (Array.isArray(v) ? v : String(v || '').split(','))
    .map(x => text(x, 40)).filter(Boolean).slice(0, 50);

function publicUnit(u) {
    return { id: u.id, console_id: u.console_id, model_code: u.model_code, condition: u.condition, notes: u.notes, price: Number(u.price), status: u.status };
}
function publicExtra(e) {
    return { id: e.id, console_id: e.console_id, kind: e.kind, name: e.name, description: e.description, price: Number(e.price), stock: e.stock, active: e.active, sort: e.sort, models: e.models || [] };
}

async function notifyAdmins(message, req) {
    const { rows } = await pool.query("SELECT id FROM users WHERE role = 'admin'");
    for (const r of rows) await createNotification(r.id, 'shop_order', message, '/html/pages/shop.html?tab=orders', req);
}

// ── Buyer: orders ────────────────────────────────────────

// POST /api/shop/orders — place an order for a package.
// Body: unit_id, mod_id?, storage_id?, accessories: [{ id, qty }], shipping fields.
router.post('/orders', authRequired, async (req, res) => {
    const unitId = parseInt(req.body?.unit_id);
    if (isNaN(unitId)) return res.status(400).json({ success: false, error: 'Choose a console.' });
    const shipping = parseShipping(req.body);
    if (shipping.error) return res.status(400).json({ success: false, error: shipping.error });
    const d = shipping.data;

    // Requested extras: one mod, one storage upgrade, accessories with a quantity.
    const wanted = new Map(); // extra id → qty
    for (const key of ['mod_id', 'storage_id']) {
        const id = parseInt(req.body?.[key]);
        if (!isNaN(id)) wanted.set(id, 1);
    }
    for (const a of Array.isArray(req.body?.accessories) ? req.body.accessories.slice(0, 30) : []) {
        const id = parseInt(a?.id), qty = parseInt(a?.qty);
        if (!isNaN(id) && qty > 0) wanted.set(id, Math.min(qty, 20));
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: units } = await client.query('SELECT * FROM shop_units WHERE id = $1 FOR UPDATE', [unitId]);
        const unit = units[0];
        if (!unit || unit.status !== 'available') {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'This console is no longer available.' });
        }

        const items = [];
        let extrasPrice = 0;
        if (wanted.size) {
            const { rows: extras } = await client.query(
                'SELECT * FROM shop_extras WHERE id = ANY($1) FOR UPDATE', [[...wanted.keys()]]);
            const seen = { mod: 0, storage: 0 };
            for (const e of extras) {
                const qty = wanted.get(e.id);
                const fail = msg => { const err = new Error(msg); err.status = 409; throw err; };
                if (!e.active || e.console_id !== unit.console_id) fail(`"${e.name}" is not available for this console.`);
                if ((e.models || []).length && !e.models.includes(unit.model_code)) fail(`"${e.name}" does not fit model ${unit.model_code}.`);
                if (e.kind !== 'accessory') {
                    if (++seen[e.kind] > 1) fail('Only one option of each kind can be chosen.');
                }
                const n = e.kind === 'accessory' ? qty : 1;
                if (e.stock !== null && e.stock < n) fail(`Only ${e.stock} × "${e.name}" left.`);
                if (e.stock !== null) await client.query('UPDATE shop_extras SET stock = stock - $1 WHERE id = $2', [n, e.id]);
                items.push({ extra_id: e.id, kind: e.kind, name: e.name, price: Number(e.price), qty: n });
                extrasPrice += Number(e.price) * n;
            }
            if (extras.length !== wanted.size) {
                await client.query('ROLLBACK');
                return res.status(409).json({ success: false, error: 'Some of the chosen items no longer exist.' });
            }
        }

        await client.query("UPDATE shop_units SET status = 'reserved', updated_at = NOW() WHERE id = $1", [unit.id]);
        const unitPrice = Number(unit.price);
        const total = unitPrice + extrasPrice + d.shipping_price;
        const { rows } = await client.query(`
            INSERT INTO shop_orders (
                buyer_id, unit_id, console_id, model_code, items, unit_price, extras_price, shipping_price, total_price,
                delivery_method, recipient_name, recipient_first_name, recipient_last_name, recipient_phone, recipient_email,
                county, city, address, address_line2, easybox_name, notes
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
            RETURNING *`, [
            req.user.id, unit.id, unit.console_id, unit.model_code, JSON.stringify(items), unitPrice, extrasPrice, d.shipping_price, total,
            d.delivery_method, d.recipient_name, d.recipient_first_name, d.recipient_last_name, d.recipient_phone, d.recipient_email,
            d.county, d.city, d.address, d.address_line2, d.easybox_name, d.notes,
        ]);
        await client.query('COMMIT');
        notifyAdmins(`New CNote shop order #${rows[0].id} from ${req.user.username}: ${unit.console_id} ${unit.model_code} — ${total} RON`, req)
            .catch(err => console.error('Shop notify error:', err.message));
        res.status(201).json({ success: true, order: rows[0] });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err.status) return res.status(err.status).json({ success: false, error: err.message });
        console.error('Shop order POST error:', err);
        res.status(500).json({ success: false, error: 'Could not place the order.' });
    } finally {
        client.release();
    }
});

// GET /api/shop/orders/mine — the buyer's own shop orders.
router.get('/orders/mine', authRequired, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM shop_orders WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
        res.json({ success: true, orders: rows });
    } catch (err) {
        console.error('Shop orders mine error:', err);
        res.status(500).json({ success: false, error: 'Could not load orders.' });
    }
});

// ── Admin: orders ────────────────────────────────────────

// GET /api/shop/orders — every shop order, open ones first.
router.get('/orders', authRequired, adminOnly, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT o.*, u.username AS buyer_name
            FROM shop_orders o JOIN users u ON u.id = o.buyer_id
            ORDER BY (o.status IN ('new', 'confirmed')) DESC, o.created_at DESC
            LIMIT 300`);
        res.json({ success: true, orders: rows });
    } catch (err) {
        console.error('Shop orders GET error:', err);
        res.status(500).json({ success: false, error: 'Could not load orders.' });
    }
});

// PATCH /api/shop/orders/:id — { status }. Shipped → the unit is sold;
// cancelled → the unit is available again and the accessories go back.
router.patch('/orders/:id', authRequired, adminOnly, async (req, res) => {
    const id = parseInt(req.params.id);
    const status = req.body?.status;
    if (isNaN(id) || !ORDER_STATUSES.includes(status)) return res.status(400).json({ success: false, error: 'Invalid status.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT * FROM shop_orders WHERE id = $1 FOR UPDATE', [id]);
        const order = rows[0];
        if (!order) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Order not found.' }); }
        if (order.status === 'cancelled') {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'A cancelled order cannot be reopened.' });
        }
        if (status === 'cancelled') {
            if (order.unit_id) await client.query("UPDATE shop_units SET status = 'available', updated_at = NOW() WHERE id = $1 AND status <> 'hidden'", [order.unit_id]);
            for (const it of order.items || []) {
                await client.query('UPDATE shop_extras SET stock = stock + $1 WHERE id = $2 AND stock IS NOT NULL', [it.qty, it.extra_id]);
            }
        } else if (order.unit_id) {
            await client.query('UPDATE shop_units SET status = $1, updated_at = NOW() WHERE id = $2',
                [status === 'shipped' ? 'sold' : 'reserved', order.unit_id]);
        }
        await client.query('UPDATE shop_orders SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);
        await client.query('COMMIT');
        if (status !== order.status) {
            createNotification(order.buyer_id, 'shop_order', `Your CNote order #${id} is now: ${status}.`, '/html/pages/shop.html?tab=mine', req)
                .catch(() => {});
        }
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Shop order PATCH error:', err);
        res.status(500).json({ success: false, error: 'Could not update the order.' });
    } finally {
        client.release();
    }
});

// ── Admin: stock ─────────────────────────────────────────

function unitFields(b, existing = {}) {
    const consoleId = b.console_id ?? existing.console_id;
    const price = b.price !== undefined ? money(b.price) : Number(existing.price);
    if (!CONSOLE_ID.test(consoleId || '')) return { error: 'Invalid console.' };
    if (price === null || Number.isNaN(price)) return { error: 'Invalid price.' };
    const status = b.status ?? existing.status ?? 'available';
    if (!UNIT_STATUSES.includes(status)) return { error: 'Invalid status.' };
    return {
        console_id: consoleId,
        model_code: text(b.model_code ?? existing.model_code, 40),
        condition: text(b.condition ?? existing.condition, 120),
        notes: text(b.notes ?? existing.notes, 500),
        price, status,
    };
}

router.post('/units', authRequired, adminOnly, async (req, res) => {
    const f = unitFields(req.body || {});
    if (f.error) return res.status(400).json({ success: false, error: f.error });
    try {
        const { rows } = await pool.query(
            `INSERT INTO shop_units (console_id, model_code, condition, notes, price, status)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [f.console_id, f.model_code, f.condition, f.notes, f.price, f.status]);
        res.status(201).json({ success: true, unit: publicUnit(rows[0]) });
    } catch (err) {
        console.error('Shop unit POST error:', err);
        res.status(500).json({ success: false, error: 'Could not save.' });
    }
});

router.put('/units/:id', authRequired, adminOnly, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id.' });
    try {
        const { rows: cur } = await pool.query('SELECT * FROM shop_units WHERE id = $1', [id]);
        if (!cur.length) return res.status(404).json({ success: false, error: 'Not found.' });
        const f = unitFields(req.body || {}, cur[0]);
        if (f.error) return res.status(400).json({ success: false, error: f.error });
        const { rows } = await pool.query(
            `UPDATE shop_units SET console_id = $1, model_code = $2, condition = $3, notes = $4, price = $5, status = $6, updated_at = NOW()
             WHERE id = $7 RETURNING *`,
            [f.console_id, f.model_code, f.condition, f.notes, f.price, f.status, id]);
        res.json({ success: true, unit: publicUnit(rows[0]) });
    } catch (err) {
        console.error('Shop unit PUT error:', err);
        res.status(500).json({ success: false, error: 'Could not save.' });
    }
});

router.delete('/units/:id', authRequired, adminOnly, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id.' });
    try {
        // A unit in an open order stays: cancel or ship the order first.
        const { rows } = await pool.query(
            "SELECT 1 FROM shop_orders WHERE unit_id = $1 AND status IN ('new', 'confirmed')", [id]);
        if (rows.length) return res.status(409).json({ success: false, error: 'This console is in an open order.' });
        await pool.query('DELETE FROM shop_units WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Shop unit DELETE error:', err);
        res.status(500).json({ success: false, error: 'Could not delete.' });
    }
});

function extraFields(b, existing = {}) {
    const consoleId = b.console_id ?? existing.console_id;
    const kind = b.kind ?? existing.kind;
    const name = text(b.name ?? existing.name, 120);
    const price = b.price !== undefined ? money(b.price) : Number(existing.price ?? 0);
    if (!CONSOLE_ID.test(consoleId || '')) return { error: 'Invalid console.' };
    if (!EXTRA_KINDS.includes(kind)) return { error: 'Invalid kind.' };
    if (!name) return { error: 'Name is required.' };
    if (price === null || Number.isNaN(price)) return { error: 'Invalid price.' };
    let stock = b.stock !== undefined ? b.stock : existing.stock;
    stock = stock === null || stock === '' || stock === undefined ? null : parseInt(stock);
    if (stock !== null && (isNaN(stock) || stock < 0)) return { error: 'Invalid stock.' };
    return {
        console_id: consoleId, kind, name, price, stock,
        description: text(b.description ?? existing.description, 500),
        active: typeof b.active === 'boolean' ? b.active : (existing.active ?? true),
        sort: parseInt(b.sort ?? existing.sort ?? 0) || 0,
        models: b.models !== undefined ? models(b.models) : (existing.models || []),
    };
}

router.post('/extras', authRequired, adminOnly, async (req, res) => {
    const f = extraFields(req.body || {});
    if (f.error) return res.status(400).json({ success: false, error: f.error });
    try {
        const { rows } = await pool.query(
            `INSERT INTO shop_extras (console_id, kind, name, description, price, stock, active, sort, models)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [f.console_id, f.kind, f.name, f.description, f.price, f.stock, f.active, f.sort, f.models]);
        res.status(201).json({ success: true, extra: publicExtra(rows[0]) });
    } catch (err) {
        console.error('Shop extra POST error:', err);
        res.status(500).json({ success: false, error: 'Could not save.' });
    }
});

router.put('/extras/:id', authRequired, adminOnly, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id.' });
    try {
        const { rows: cur } = await pool.query('SELECT * FROM shop_extras WHERE id = $1', [id]);
        if (!cur.length) return res.status(404).json({ success: false, error: 'Not found.' });
        const f = extraFields(req.body || {}, cur[0]);
        if (f.error) return res.status(400).json({ success: false, error: f.error });
        const { rows } = await pool.query(
            `UPDATE shop_extras SET console_id = $1, kind = $2, name = $3, description = $4, price = $5, stock = $6,
                active = $7, sort = $8, models = $9 WHERE id = $10 RETURNING *`,
            [f.console_id, f.kind, f.name, f.description, f.price, f.stock, f.active, f.sort, f.models, id]);
        res.json({ success: true, extra: publicExtra(rows[0]) });
    } catch (err) {
        console.error('Shop extra PUT error:', err);
        res.status(500).json({ success: false, error: 'Could not save.' });
    }
});

// Orders keep their own copy of name/price (items JSON), so deleting is safe.
router.delete('/extras/:id', authRequired, adminOnly, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id.' });
    try {
        await pool.query('DELETE FROM shop_extras WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Shop extra DELETE error:', err);
        res.status(500).json({ success: false, error: 'Could not delete.' });
    }
});

// ── Public: what is in stock ─────────────────────────────
// GET /api/shop — per console: available units and the cheapest one
// (the shop's landing list, and the console pages' "from CNote stock" line).
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT console_id, COUNT(*)::int AS units, MIN(price) AS from_price
            FROM shop_units WHERE status = 'available'
            GROUP BY console_id ORDER BY console_id`);
        res.json({ success: true, consoles: rows.map(r => ({ ...r, from_price: Number(r.from_price) })) });
    } catch (err) {
        console.error('Shop overview error:', err);
        res.status(500).json({ success: false, error: 'Could not load the shop.' });
    }
});

// ── Public: stock of one console ─────────────────────────
// Last, so /orders* is never read as a console id.
router.get('/:consoleId', authOptional, async (req, res) => {
    const consoleId = req.params.consoleId;
    if (!CONSOLE_ID.test(consoleId)) return res.status(400).json({ success: false, error: 'Invalid console.' });
    try {
        // authOptional does not load the role; only an admin may see the whole stock.
        let all = false;
        if (req.query.all === '1' && req.user) {
            const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
            all = rows[0]?.role === 'admin';
        }
        const { rows: units } = await pool.query(
            `SELECT * FROM shop_units WHERE console_id = $1 ${all ? '' : "AND status = 'available'"}
             ORDER BY model_code, price, id`, [consoleId]);
        const { rows: extras } = await pool.query(
            `SELECT * FROM shop_extras WHERE console_id = $1 ${all ? '' : 'AND active AND (stock IS NULL OR stock > 0)'}
             ORDER BY kind, sort, price, id`, [consoleId]);
        res.json({ success: true, units: units.map(publicUnit), extras: extras.map(publicExtra) });
    } catch (err) {
        console.error('Shop GET error:', err);
        res.status(500).json({ success: false, error: 'Could not load the shop.' });
    }
});

module.exports = router;
