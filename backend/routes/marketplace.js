/**
 * Marketplace Routes — /api/marketplace
 * Listings CRUD with search, filter, sort, pagination.
 * Uses PostgreSQL pool from db.js.
 */
const express = require('express');
const pool = require('../db');
const { authRequired, authOptional } = require('../middleware/auth');
const { awardXP } = require('../utils/gamification');
const { isMuted, mutedUntilMessage } = require('../utils/moderation');
const { publicUrlForKey } = require('../utils/objectStorage');

const router = express.Router();

/**
 * resolveImages
 * @description `listings.images` stores object-storage KEYS for photos
 * uploaded via /api/uploads/presign (kind: 'listing') since 2026-07-23 —
 * resolved to a real public URL here at read time, same indirection
 * chat.js/dm.js use for attachment_key, so switching storage provider later
 * never requires rewriting stored rows. Older rows (pre-migration) may still
 * hold a full URL directly (base64 data URL, or an eBay/OLX-synced external
 * image) — those pass through unchanged since they don't match the key prefix.
 */
function resolveImages(images) {
    if (!images) return [];
    const arr = typeof images === 'string' ? JSON.parse(images) : images;
    if (!Array.isArray(arr)) return [];
    return arr.map(v => (typeof v === 'string' && v.startsWith('marketplace/listing/')) ? (publicUrlForKey(v) || v) : v);
}

const VALID_CONDITIONS = ['new', 'like_new', 'good', 'fair', 'parts'];
const VALID_CATEGORIES = ['consoles', 'games', 'accessories', 'parts'];
const VALID_SORT = ['newest', 'oldest', 'price_asc', 'price_desc'];
const VALID_STATUSES = ['active', 'inactive', 'sold'];

/**
 * notifyListingSold
 * @description Notifies every user who favorited a listing that it was marked sold.
 */
async function notifyListingSold(req, listingId, listingTitle) {
    try {
        const { createNotification } = require('./notifications');
        const favs = await pool.query('SELECT user_id FROM listing_favorites WHERE listing_id = $1', [listingId]);
        for (const { user_id: favUserId } of favs.rows) {
            createNotification(
                favUserId, 'listing_sold',
                `A listing you favorited, "${listingTitle}", was marked as sold`,
                `/html/pages/community.html#listing-${listingId}`,
                req
            ).catch(() => {});
        }
    } catch (err) {
        console.error('notifyListingSold error:', err);
    }
}

// ── GET /api/marketplace/listings ───────────────────────
router.get('/listings', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 12));
        const offset = (page - 1) * limit;
        const sort = VALID_SORT.includes(req.query.sort) ? req.query.sort : 'newest';
        const category = VALID_CATEGORIES.includes(req.query.category) ? req.query.category : null;
        const condition = VALID_CONDITIONS.includes(req.query.condition) ? req.query.condition : null;
        const search = req.query.search ? String(req.query.search).trim().slice(0, 100) : null;
        const console_type = req.query.console_type ? String(req.query.console_type).trim().slice(0, 100) : null;
        const country = req.query.country ? String(req.query.country).trim().slice(0, 10) : null;
        const city    = req.query.city    ? String(req.query.city).trim().slice(0, 100)   : null;

        let where = ["COALESCE(l.status, 'active') = 'active'"];
        let params = [];
        let paramIdx = 1;

        if (category) {
            where.push(`l.category = $${paramIdx++}`);
            params.push(category);
        }
        if (condition) {
            where.push(`l.condition = $${paramIdx++}`);
            params.push(condition);
        }
        if (console_type) {
            where.push(`l.console_type = $${paramIdx++}`);
            params.push(console_type);
        }
        if (search) {
            where.push(`(l.title ILIKE $${paramIdx} OR l.description ILIKE $${paramIdx})`);
            params.push(`%${search}%`);
            paramIdx++;
        }
        if (country) {
            where.push(`l.country = $${paramIdx++}`);
            params.push(country);
        }
        if (city) {
            where.push(`l.location = $${paramIdx++}`);
            params.push(city);
        }

        const whereClause = 'WHERE ' + where.join(' AND ');

        let orderBy;
        switch (sort) {
            case 'oldest':     orderBy = 'l.created_at ASC';  break;
            case 'price_asc':  orderBy = 'l.price ASC';       break;
            case 'price_desc': orderBy = 'l.price DESC';      break;
            default:           orderBy = 'l.created_at DESC';
        }

        const countResult = await pool.query(
            `SELECT COUNT(*) FROM listings l ${whereClause}`, params
        );
        const total = parseInt(countResult.rows[0].count);

        const listingsResult = await pool.query(`
            SELECT l.id, l.title, l.description, l.price, l.condition, l.category,
                   l.location, l.country, l.images, l.sold, l.status, l.views,
                   l.favorites_count, l.console_type, l.created_at,
                   u.id AS seller_id, u.username AS seller_name, u.avatar AS seller_avatar,
                   u.role = 'admin' AS seller_is_official
            FROM listings l
            JOIN users u ON u.id = l.user_id
            ${whereClause}
            ORDER BY ${orderBy}
            LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
        `, [...params, limit, offset]);

        const listings = listingsResult.rows.map(row => ({
            id: row.id,
            title: row.title,
            description: row.description,
            price: parseFloat(row.price),
            condition: row.condition,
            category: row.category,
            location: row.location,
            country: row.country || '',
            images: resolveImages(row.images),
            sold: row.sold,
            status: row.status || 'active',
            views: row.views || 0,
            favorites_count: row.favorites_count || 0,
            console_type: row.console_type || '',
            created_at: row.created_at,
            seller_id: row.seller_id,
            seller_name: row.seller_name,
            seller_avatar: row.seller_avatar || '',
            seller_is_official: !!row.seller_is_official
        }));

        res.json({ success: true, listings, total, page, totalPages: Math.ceil(total / limit) });
    } catch (err) {
        console.error('Marketplace GET error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── GET /api/marketplace/listings/mine ──────────────────
router.get('/listings/mine', authRequired, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT l.id, l.title, l.description, l.price, l.condition, l.category,
                   l.location, l.country, l.images, l.sold, l.status, l.views,
                   l.favorites_count, l.console_type, l.created_at
            FROM listings l
            WHERE l.user_id = $1
            ORDER BY l.created_at DESC
        `, [req.user.id]);

        const listings = result.rows.map(row => ({
            id: row.id,
            title: row.title,
            description: row.description,
            price: parseFloat(row.price),
            condition: row.condition,
            category: row.category,
            location: row.location,
            country: row.country || '',
            images: resolveImages(row.images),
            sold: row.sold,
            status: row.status || 'active',
            views: row.views || 0,
            favorites_count: row.favorites_count || 0,
            console_type: row.console_type || '',
            created_at: row.created_at
        }));

        res.json({ success: true, listings });
    } catch (err) {
        console.error('Marketplace mine GET error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── GET /api/marketplace/listings/user/:userId ──────────
router.get('/listings/user/:userId', async (req, res) => {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return res.status(400).json({ success: false, error: 'ID invalid.' });

    try {
        const result = await pool.query(`
            SELECT l.id, l.title, l.price, l.condition, l.category, l.location, l.country,
                   l.images, l.sold, l.status, l.console_type, l.created_at,
                   u.id AS seller_id, u.username AS seller_name, u.avatar AS seller_avatar,
                   u.role = 'admin' AS seller_is_official
            FROM listings l
            JOIN users u ON u.id = l.user_id
            WHERE l.user_id = $1 AND COALESCE(l.status, 'active') = 'active'
            ORDER BY l.created_at DESC
        `, [userId]);

        const listings = result.rows.map(row => ({
            id: row.id,
            title: row.title,
            price: parseFloat(row.price),
            condition: row.condition,
            category: row.category,
            location: row.location,
            country: row.country || '',
            images: resolveImages(row.images),
            sold: row.sold,
            status: row.status || 'active',
            console_type: row.console_type || '',
            created_at: row.created_at,
            seller_id: row.seller_id,
            seller_name: row.seller_name,
            seller_avatar: row.seller_avatar || '',
            seller_is_official: !!row.seller_is_official
        }));

        res.json({ success: true, listings });
    } catch (err) {
        console.error('Marketplace user listings GET error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── GET /api/marketplace/listings/:id ───────────────────
router.get('/listings/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID invalid.' });

    try {
        const result = await pool.query(`
            SELECT l.*, u.id AS seller_id, u.username AS seller_name,
                   u.avatar AS seller_avatar, u.role = 'admin' AS seller_is_official
            FROM listings l
            JOIN users u ON u.id = l.user_id
            WHERE l.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Listing not found.' });
        }

        const row = result.rows[0];
        res.json({
            success: true,
            listing: {
                id: row.id,
                title: row.title,
                description: row.description,
                price: parseFloat(row.price),
                condition: row.condition,
                category: row.category,
                location: row.location,
                country: row.country || '',
                phone: row.phone,
                olx_url: row.olx_url,
                images: resolveImages(row.images),
                sold: row.sold,
                status: row.status || 'active',
                views: row.views || 0,
                favorites_count: row.favorites_count || 0,
                console_type: row.console_type || '',
                created_at: row.created_at,
                seller_id: row.seller_id,
                seller_name: row.seller_name,
                seller_avatar: row.seller_avatar || '',
                seller_is_official: !!row.seller_is_official
            }
        });
    } catch (err) {
        console.error('Marketplace listing GET error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── GET /api/marketplace/listings/:id/similar ───────────
router.get('/listings/:id/similar', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID invalid.' });

    try {
        const current = await pool.query(
            'SELECT category, user_id, title FROM listings WHERE id = $1', [id]
        );
        if (current.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Listing not found.' });
        }
        const { category, user_id, title } = current.rows[0];

        const brandKeywords = ['playstation', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5',
            'xbox', 'nintendo', 'switch', 'wii', 'gamecube', 'sega',
            'gameboy', 'atari', 'dreamcast', 'neo geo', 'pc'];
        const lowerTitle = (title || '').toLowerCase();
        const detectedBrand = brandKeywords.find(b => lowerTitle.includes(b));

        let listings = [];

        if (detectedBrand) {
            const brandResult = await pool.query(`
                SELECT l.id, l.title, l.price, l.condition, l.category, l.location, l.country,
                       l.images, l.sold, l.status, l.created_at,
                       u.id AS seller_id, u.username AS seller_name, u.avatar AS seller_avatar,
                       u.role = 'admin' AS seller_is_official
                FROM listings l
                JOIN users u ON u.id = l.user_id
                WHERE l.category = $1 AND l.id != $2 AND l.user_id != $3
                  AND COALESCE(l.status, 'active') = 'active'
                  AND LOWER(l.title) LIKE $4
                ORDER BY l.created_at DESC
                LIMIT 4
            `, [category, id, user_id, '%' + detectedBrand + '%']);
            listings = brandResult.rows;
        }

        if (listings.length < 4) {
            const excludeIds = [id, ...listings.map(l => l.id)];
            const placeholders = excludeIds.map((_, i) => `$${i + 3}`).join(',');
            const fillResult = await pool.query(`
                SELECT l.id, l.title, l.price, l.condition, l.category, l.location, l.country,
                       l.images, l.sold, l.status, l.created_at,
                       u.id AS seller_id, u.username AS seller_name, u.avatar AS seller_avatar,
                       u.role = 'admin' AS seller_is_official
                FROM listings l
                JOIN users u ON u.id = l.user_id
                WHERE l.category = $1 AND l.user_id != $2
                  AND l.id NOT IN (${placeholders})
                  AND COALESCE(l.status, 'active') = 'active'
                ORDER BY l.created_at DESC
                LIMIT $${excludeIds.length + 3}
            `, [category, user_id, ...excludeIds, 4 - listings.length]);
            listings = [...listings, ...fillResult.rows];
        }

        const mapped = listings.map(row => ({
            id: row.id,
            title: row.title,
            price: parseFloat(row.price),
            condition: row.condition,
            category: row.category,
            location: row.location,
            country: row.country || '',
            images: resolveImages(row.images),
            sold: row.sold,
            status: row.status || 'active',
            created_at: row.created_at,
            seller_id: row.seller_id,
            seller_name: row.seller_name,
            seller_avatar: row.seller_avatar || '',
            seller_is_official: !!row.seller_is_official
        }));

        res.json({ success: true, listings: mapped });
    } catch (err) {
        console.error('Marketplace similar GET error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── POST /api/marketplace/listings ──────────────────────
router.post('/listings', authRequired, async (req, res) => {
    if (isMuted(req.user)) {
        return res.status(403).json({ success: false, error: mutedUntilMessage(req.user.muted_until) });
    }
    const { title, description, price, condition, category, location, country, phone, olx_url, images, console_type } = req.body;

    if (!title || !description || price == null) {
        return res.status(400).json({ success: false, error: 'Title, description, and price are required.' });
    }

    const safeTitle       = String(title).trim().slice(0, 100);
    const safeDesc        = String(description).trim().slice(0, 3000);
    const safePrice       = Math.max(0, parseFloat(price) || 0);
    const safeCond        = VALID_CONDITIONS.includes(condition) ? condition : 'good';
    const safeCat         = VALID_CATEGORIES.includes(category) ? category : 'consoles';
    const safeLocation    = String(location || '').trim().slice(0, 100);
    const safeCountry     = String(country || '').trim().slice(0, 10);
    const safePhone       = String(phone || '').trim().slice(0, 30);
    const rawOlx = String(olx_url || '').trim();
    const safeOlx = (rawOlx === '' || rawOlx.startsWith('https://') || rawOlx.startsWith('http://')) ? rawOlx.slice(0, 500) : '';
    const safeImages      = JSON.stringify(Array.isArray(images) ? images.slice(0, 8).map(u => String(u).slice(0, 500)) : []);
    const safeConsoleType = String(console_type || '').trim().slice(0, 100);

    try {
        const result = await pool.query(`
            INSERT INTO listings (user_id, title, description, price, condition, category, location, country, phone, olx_url, images, console_type)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id, title, price, condition, category, created_at
        `, [req.user.id, safeTitle, safeDesc, safePrice, safeCond, safeCat, safeLocation, safeCountry, safePhone, safeOlx, safeImages, safeConsoleType]);

        const listing = result.rows[0];
        listing.seller_name = req.user.username;

        res.status(201).json({ success: true, listing });
        awardXP(pool, req.app.get('io'), req.user.id, 'marketplace_listing', listing.id.toString()).catch(() => {});
    } catch (err) {
        console.error('Marketplace POST error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── PUT /api/marketplace/listings/:id ────────────────────
router.put('/listings/:id', authRequired, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID invalid.' });

    try {
        const check = await pool.query('SELECT user_id FROM listings WHERE id = $1', [id]);
        if (check.rows.length === 0) return res.status(404).json({ success: false, error: 'Listing not found.' });
        if (check.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, error: 'You do not have permission.' });

        const { title, description, price, condition, category, location, country, phone, olx_url, images, console_type } = req.body;

        const sets = [];
        const params = [];
        let idx = 1;

        if (title !== undefined)       { sets.push(`title = $${idx++}`);        params.push(String(title).trim().slice(0, 100)); }
        if (description !== undefined) { sets.push(`description = $${idx++}`);  params.push(String(description).trim().slice(0, 3000)); }
        if (price !== undefined)       { sets.push(`price = $${idx++}`);        params.push(Math.max(0, parseFloat(price) || 0)); }
        if (condition !== undefined && VALID_CONDITIONS.includes(condition)) { sets.push(`condition = $${idx++}`); params.push(condition); }
        if (category !== undefined && VALID_CATEGORIES.includes(category))   { sets.push(`category = $${idx++}`);  params.push(category); }
        if (location !== undefined)    { sets.push(`location = $${idx++}`);     params.push(String(location).trim().slice(0, 100)); }
        if (country !== undefined)     { sets.push(`country = $${idx++}`);      params.push(String(country).trim().slice(0, 10)); }
        if (phone !== undefined)       { sets.push(`phone = $${idx++}`);        params.push(String(phone).trim().slice(0, 30)); }
        if (olx_url !== undefined)     { const u = String(olx_url).trim(); sets.push(`olx_url = $${idx++}`); params.push((u === '' || u.startsWith('https://') || u.startsWith('http://')) ? u.slice(0, 500) : ''); }
        if (console_type !== undefined){ sets.push(`console_type = $${idx++}`); params.push(String(console_type).trim().slice(0, 100)); }
        if (images !== undefined && Array.isArray(images)) {
            sets.push(`images = $${idx++}`);
            params.push(JSON.stringify(images.slice(0, 8).map(u => String(u).slice(0, 500))));
        }

        if (sets.length === 0) return res.status(400).json({ success: false, error: 'Nothing to update.' });

        params.push(id);
        const result = await pool.query(
            `UPDATE listings SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
            params
        );

        res.json({ success: true, listing: result.rows[0] });
    } catch (err) {
        console.error('Marketplace PUT error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── PATCH /api/marketplace/listings/:id/sold ────────────
router.patch('/listings/:id/sold', authRequired, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID invalid.' });

    try {
        const check = await pool.query('SELECT user_id, title FROM listings WHERE id = $1', [id]);
        if (check.rows.length === 0) return res.status(404).json({ success: false, error: 'Listing not found.' });
        if (check.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, error: 'You do not have permission.' });

        await pool.query("UPDATE listings SET sold = TRUE, status = 'sold' WHERE id = $1", [id]);
        res.json({ success: true });
        notifyListingSold(req, id, check.rows[0].title);
    } catch (err) {
        console.error('Marketplace sold PATCH error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── PATCH /api/marketplace/listings/:id/status ──────────
router.patch('/listings/:id/status', authRequired, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID invalid.' });

    const { status } = req.body;
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ success: false, error: 'Status invalid.' });

    try {
        const check = await pool.query('SELECT user_id, title FROM listings WHERE id = $1', [id]);
        if (check.rows.length === 0) return res.status(404).json({ success: false, error: 'Listing not found.' });
        if (check.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, error: 'You do not have permission.' });

        const sold = status === 'sold';
        await pool.query('UPDATE listings SET status = $1, sold = $2 WHERE id = $3', [status, sold, id]);
        res.json({ success: true });
        if (sold) notifyListingSold(req, id, check.rows[0].title);
    } catch (err) {
        console.error('Marketplace status PATCH error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── PATCH /api/marketplace/listings/:id/view ────────────
router.patch('/listings/:id/view', authOptional, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID invalid.' });

    try {
        const check = await pool.query('SELECT user_id FROM listings WHERE id = $1', [id]);
        if (check.rows.length === 0) return res.status(404).json({ success: false, error: 'Listing not found.' });

        if (req.user && check.rows[0].user_id === req.user.id) {
            return res.json({ success: true, counted: false });
        }

        await pool.query('UPDATE listings SET views = COALESCE(views, 0) + 1 WHERE id = $1', [id]);
        res.json({ success: true, counted: true });
    } catch (err) {
        console.error('Marketplace view PATCH error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── POST /api/marketplace/listings/:id/favorite ─────────
router.post('/listings/:id/favorite', authRequired, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID invalid.' });

    try {
        const check = await pool.query('SELECT id, user_id, title FROM listings WHERE id = $1', [id]);
        if (check.rows.length === 0) return res.status(404).json({ success: false, error: 'Listing not found.' });

        const existing = await pool.query(
            'SELECT id FROM listing_favorites WHERE user_id = $1 AND listing_id = $2',
            [req.user.id, id]
        );

        if (existing.rows.length > 0) {
            await pool.query('DELETE FROM listing_favorites WHERE user_id = $1 AND listing_id = $2', [req.user.id, id]);
            await pool.query('UPDATE listings SET favorites_count = GREATEST(COALESCE(favorites_count, 0) - 1, 0) WHERE id = $1', [id]);
            res.json({ success: true, favorited: false });
        } else {
            await pool.query('INSERT INTO listing_favorites (user_id, listing_id) VALUES ($1, $2)', [req.user.id, id]);
            await pool.query('UPDATE listings SET favorites_count = COALESCE(favorites_count, 0) + 1 WHERE id = $1', [id]);
            res.json({ success: true, favorited: true });
            const owner = check.rows[0];
            if (owner.user_id !== req.user.id) {
                const { createNotification } = require('./notifications');
                createNotification(
                    owner.user_id, 'listing_interest',
                    `${req.user.username} favorited your listing "${owner.title}"`,
                    `/html/pages/community.html#listing-${id}`,
                    req
                ).catch(() => {});
            }
        }
    } catch (err) {
        console.error('Marketplace favorite POST error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── GET /api/marketplace/favorites ──────────────────────
router.get('/favorites', authRequired, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT l.id, l.title, l.price, l.condition, l.category, l.location, l.country,
                   l.images, l.sold, l.status, l.views, l.favorites_count, l.created_at,
                   u.id AS seller_id, u.username AS seller_name, u.avatar AS seller_avatar,
                   u.role = 'admin' AS seller_is_official
            FROM listing_favorites lf
            JOIN listings l ON l.id = lf.listing_id
            JOIN users u ON u.id = l.user_id
            WHERE lf.user_id = $1
            ORDER BY lf.created_at DESC
        `, [req.user.id]);

        const listings = result.rows.map(row => ({
            id: row.id,
            title: row.title,
            price: parseFloat(row.price),
            condition: row.condition,
            category: row.category,
            location: row.location,
            country: row.country || '',
            images: resolveImages(row.images),
            sold: row.sold,
            status: row.status || 'active',
            created_at: row.created_at,
            seller_id: row.seller_id,
            seller_name: row.seller_name,
            seller_avatar: row.seller_avatar || '',
            seller_is_official: !!row.seller_is_official
        }));

        res.json({ success: true, listings });
    } catch (err) {
        console.error('Marketplace favorites GET error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── GET /api/marketplace/favorites/ids ──────────────────
router.get('/favorites/ids', authRequired, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT listing_id FROM listing_favorites WHERE user_id = $1',
            [req.user.id]
        );
        res.json({ success: true, ids: result.rows.map(r => r.listing_id) });
    } catch (err) {
        console.error('Marketplace favorite IDs GET error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── DELETE /api/marketplace/listings/:id ─────────────────
router.delete('/listings/:id', authRequired, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID invalid.' });

    try {
        const check = await pool.query('SELECT user_id FROM listings WHERE id = $1', [id]);
        if (check.rows.length === 0) return res.status(404).json({ success: false, error: 'Listing not found.' });
        if (check.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, error: 'You do not have permission.' });

        await pool.query('DELETE FROM listings WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Marketplace DELETE error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// GET /api/marketplace/my-listings — alias pentru listings/mine
router.get('/my-listings', authRequired, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, title, price, condition, category, location,
                    images, sold, status, views, console_type, created_at
             FROM listings
             WHERE user_id = $1
             ORDER BY created_at DESC`,
            [req.user.id]
        );
        const listings = result.rows.map(row => ({
            ...row,
            price: parseFloat(row.price),
            images: resolveImages(row.images),
            status: row.status || 'active',
        }));
        res.json({ success: true, listings });
    } catch (e) {
        res.json({ success: true, listings: [] });
    }
});

module.exports = router;