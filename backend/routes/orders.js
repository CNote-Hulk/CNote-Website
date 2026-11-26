/**
 * Orders Routes — /api/orders
 * No-payment checkout for marketplace listings: the buyer submits Sameday
 * shipping data (delivery to an address, or to an Easybox locker) and sees
 * a fixed total (listing price + flat shipping fee); the seller sees their
 * own queue of orders to process and copies the data straight into Sameday
 * when creating the actual AWB — no Sameday API integration, no payment
 * gateway. Payment itself stays off-platform, arranged directly between
 * buyer and seller (COD via Sameday ramburs, bank transfer, etc.).
 */
const express = require('express');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');
// Shipping fields + flat Sameday fee, shared with the CNote shop (routes/shop.js).
const { parseShipping } = require('../utils/shipping');

const router = express.Router();

const VALID_STATUSES = ['new', 'shipped'];

// ── POST /api/orders ─────────────────────────────────────
// Buyer places an order on a listing. Marks the listing sold immediately so
// it can't be bought twice — if the order falls through, the seller can
// revert it with the existing sold/active toggle (PATCH listings/:id/status).
router.post('/', authRequired, async (req, res) => {
    const listingId = parseInt(req.body.listing_id);
    if (isNaN(listingId)) return res.status(400).json({ success: false, error: 'Invalid listing.' });
    const shipping = parseShipping(req.body);
    if (shipping.error) return res.status(400).json({ success: false, error: shipping.error });
    const d = shipping.data;

    try {
        const listingRes = await pool.query('SELECT id, title, price, user_id, sold, status FROM listings WHERE id = $1', [listingId]);
        if (listingRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Listing not found.' });
        const listing = listingRes.rows[0];

        if (listing.user_id === req.user.id) {
            return res.status(400).json({ success: false, error: 'You cannot buy your own listing.' });
        }
        if (listing.sold || listing.status === 'sold') {
            return res.status(409).json({ success: false, error: 'This listing was already sold.' });
        }

        const productPrice = parseFloat(listing.price);
        const shippingPrice = d.shipping_price;
        const totalPrice = productPrice + shippingPrice;

        const result = await pool.query(`
            INSERT INTO orders (
                listing_id, listing_title, buyer_id, seller_id, delivery_method,
                recipient_name, recipient_first_name, recipient_last_name, recipient_phone,
                recipient_email, county, city, address, address_line2, easybox_name, notes,
                product_price, shipping_price, total_price
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
            RETURNING id, listing_id, listing_title, delivery_method, recipient_name,
                      recipient_first_name, recipient_last_name, recipient_phone, recipient_email,
                      county, city, address, address_line2, easybox_name, notes, product_price,
                      shipping_price, total_price, status, created_at
        `, [
            listingId, listing.title, req.user.id, listing.user_id, d.delivery_method,
            d.recipient_name, d.recipient_first_name, d.recipient_last_name, d.recipient_phone, d.recipient_email,
            d.county, d.city, d.address, d.address_line2, d.easybox_name, d.notes,
            productPrice, shippingPrice, totalPrice
        ]);

        // A listing is a single physical item — lock it the moment an order lands.
        await pool.query(`UPDATE listings SET sold = TRUE, status = 'sold' WHERE id = $1`, [listingId]);

        res.status(201).json({ success: true, order: result.rows[0] });
    } catch (err) {
        console.error('Orders POST error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── GET /api/orders/mine ─────────────────────────────────
// Seller's processing queue — everything they need to create the Sameday
// AWB, plus who bought it. 'new' orders float to the top.
router.get('/mine', authRequired, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT o.*, u.username AS buyer_name
            FROM orders o
            JOIN users u ON u.id = o.buyer_id
            WHERE o.seller_id = $1
            ORDER BY (o.status = 'new') DESC, o.created_at DESC
        `, [req.user.id]);
        res.json({ success: true, orders: result.rows });
    } catch (err) {
        console.error('Orders GET /mine error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── PATCH /api/orders/:id/status ─────────────────────────
// Seller marks an order shipped once the Sameday AWB is created (or reverts
// it back to 'new' by mistake-proofing the same toggle).
router.patch('/:id/status', authRequired, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id.' });
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ success: false, error: 'Invalid status.' });

    try {
        const check = await pool.query('SELECT seller_id FROM orders WHERE id = $1', [id]);
        if (check.rows.length === 0) return res.status(404).json({ success: false, error: 'Order not found.' });
        if (check.rows[0].seller_id !== req.user.id) {
            return res.status(403).json({ success: false, error: 'You do not have permission.' });
        }

        await pool.query(
            `UPDATE orders SET status = $1, shipped_at = ${status === 'shipped' ? 'NOW()' : 'NULL'} WHERE id = $2`,
            [status, id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Orders PATCH error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

module.exports = router;
