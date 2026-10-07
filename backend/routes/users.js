/* ─────────────────────────────────────────
   FILE: users.js
   DESCRIPTION: Public user profiles, user search, console
   list loading (with caching), and owned console management.
   ───────────────────────────────────────── */
/* ── REQUIRED IMPORTS — DO NOT REMOVE ──────
   If you add a new package:
     1. require() it here
     2. Add it to package.json dependencies
   ────────────────────────────────────────── */
const express = require('express');
const path = require('path');
const fs = require('fs');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');
const { awardXP, getLevelFromXP } = require('../utils/gamification');
const { publicUrlForKey } = require('../utils/objectStorage');

const router = express.Router();

// GET /api/users/count — Return total active user count (for community card)
router.get('/active-count', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT COUNT(DISTINCT user_id) 
            FROM user_sessions 
            WHERE is_active = true 
            AND last_activity > NOW() - INTERVAL '5 minutes'
        `);
        res.json({ success: true, count: parseInt(result.rows[0].count) });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// GET /api/users/search — Search users by partial username match
router.get('/users/search', authRequired, async (req, res) => {
    try {
        const query = (req.query.q || '').trim();
        if (query.length < 2) {
            return res.json({ success: true, users: [] });
        }

        // Sanitize: keep only letters, numbers, underscores, dots, hyphens, spaces
        const safeQuery = query.replace(/[^\p{L}\p{N}_.\- ]/gu, '').trim();
        if (safeQuery.length < 2) {
            return res.json({ success: true, users: [] });
        }

        const result = await pool.query(
            `SELECT id, username, avatar, bio
             FROM users
             WHERE LOWER(username) LIKE LOWER($1)
             AND id != $2
             ORDER BY username ASC
             LIMIT 20`,
            [`%${safeQuery}%`, req.user.id]
        );

        res.json({
            success: true,
            users: result.rows.map(u => ({
                id: u.id,
                username: u.username,
                avatar: u.avatar || '',
                bio: (u.bio || '').substring(0, 80)
            }))
        });
    } catch (err) {
        console.error('User search error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// GET /api/users/:username — Public user profile with favorites, owned consoles, friend count
router.get('/users/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const result = await pool.query(
            `SELECT id, username, email, bio, avatar, favorite_consoles, owned_consoles, role, created_at,
                    social_discord, social_twitter, social_youtube, social_instagram,
                    show_email, show_stats, show_friends, show_social_links, xp
             FROM users WHERE LOWER(username) = LOWER($1)`,
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Utilizatorul nu a fost gasit.' });
        }

        const user = result.rows[0];

        const favResult = await pool.query('SELECT console_id FROM user_favorites WHERE user_id = $1', [user.id]);
        const ownedResult = await pool.query('SELECT console_id FROM user_owned_consoles WHERE user_id = $1', [user.id]);
        const friendCount = await pool.query(
            'SELECT COUNT(*) AS count FROM friends WHERE user1_id = $1 OR user2_id = $1',
            [user.id]
        );
        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                email: user.show_email === true ? (user.email || '') : '',
                show_email: user.show_email === true,
                bio: user.bio || '',
                avatar: user.avatar || '',
                favorite_consoles: user.favorite_consoles || '',
                owned_consoles: user.owned_consoles || '',
                favorite_console_ids: favResult.rows.map(r => r.console_id),
                owned_console_ids: ownedResult.rows.map(r => r.console_id),
                friend_count: user.show_friends !== false ? parseInt(friendCount.rows[0].count) : null,
                role: user.role || 'user',
                created_at: user.created_at,
                social_discord: user.show_social_links !== false ? (user.social_discord || '') : '',
                social_twitter: user.show_social_links !== false ? (user.social_twitter || '') : '',
                social_youtube: user.show_social_links !== false ? (user.social_youtube || '') : '',
                social_instagram: user.show_social_links !== false ? (user.social_instagram || '') : '',
                show_stats: user.show_stats !== false,
                show_friends: user.show_friends !== false,
                show_social_links: user.show_social_links !== false,
                level: user.show_stats !== false ? getLevelFromXP(user.xp) : null
            }
        });
    } catch (err) {
        console.error('User profile error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// GET /api/users/id/:id — Minimal user profile by numeric ID
router.get('/users/id/:id', async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        const result = await pool.query(
            `SELECT id, username, bio, avatar, favorite_consoles, owned_consoles, created_at
             FROM users WHERE id = $1`,
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Utilizatorul nu a fost gasit.' });
        }

        const user = result.rows[0];
        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                bio: user.bio || '',
                avatar: user.avatar || '',
                created_at: user.created_at
            }
        });
    } catch (err) {
        console.error('User profile by ID error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// GET /api/users/:username/friends — Public friends list for a user
router.get('/users/:username/friends', async (req, res) => {
    try {
        const { username } = req.params;
        const userResult = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Utilizatorul nu a fost gasit.' });
        }

        const userId = userResult.rows[0].id;
        const result = await pool.query(
            `SELECT u.id, u.username, u.avatar
             FROM friends f
             JOIN users u ON (
                (f.user1_id = $1 AND u.id = f.user2_id) OR
                (f.user2_id = $1 AND u.id = f.user1_id)
             )
             ORDER BY f.created_at DESC`,
            [userId]
        );

        res.json({ success: true, friends: result.rows });
    } catch (err) {
        console.error('User friends error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

let _cachedConsoleList = null; // In-memory cache for console list

/**
 * loadConsoleList
 * @description Loads and parses consoles-en.json from the frontend data folder.
 *              Tries multiple candidate paths and strips UTF-8 BOM if present.
 * @returns {Array|null}
 */
function loadConsoleList() {
    const candidates = [
        path.join(__dirname, '..', '..', 'frontend', 'js', 'data', 'consoles-en.json'),
        path.resolve(__dirname, '..', '..', 'frontend', 'js', 'data', 'consoles-en.json'),
        path.resolve(process.cwd(), 'frontend', 'js', 'data', 'consoles-en.json')
    ];
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) {
                let raw = fs.readFileSync(p, 'utf8');
                // Strip UTF-8 BOM if present
                if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
                const parsed = JSON.parse(raw);
                const data = Array.isArray(parsed)
                    ? parsed
                    : (Array.isArray(parsed?.consoles) ? parsed.consoles : []);

                return data
                    .map(c => ({
                        id: String(c?.id || '').trim(),
                        name: String(c?.name || c?.nume || '').trim()
                    }))
                    .filter(c => c.id && c.name)
                    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
            }
        } catch (err) {
            console.error('Console list parse error at', p, err.message);
        }
    }
    console.warn('consoles-en.json not found. Tried:', candidates.join(', '));
    return [];
}

// GET /api/consoles/list — Return full console list (cached after first load)
router.get('/consoles/list', async (req, res) => {
    try {
        if (!_cachedConsoleList) {
            _cachedConsoleList = loadConsoleList();
        }
        res.json({ success: true, consoles: _cachedConsoleList });
    } catch (err) {
        console.error('Console list error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// GET /api/owned-consoles — Get current user’s owned console IDs
router.get('/owned-consoles', authRequired, async (req, res) => {
    try {
        const result = await pool.query('SELECT console_id FROM user_owned_consoles WHERE user_id = $1', [req.user.id]);
        res.json({ success: true, consoles: result.rows.map(r => r.console_id) });
    } catch (err) {
        console.error('Owned consoles GET error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── My Space ────────────────────────────────────────────
// The per-user half of a console page: do I own it, is it a favourite, which hardware revision is
// mine, and my own photos of it. Readable for any user (the website shows it read-only on a public
// profile); writable only by the owner, and only from the app - the website has no editor for it.

// GET /api/my-space/:consoleId — optionally ?userId= to read someone else's, read-only
router.get('/my-space/:consoleId', async (req, res) => {
    const consoleId = String(req.params.consoleId || '').trim();
    const userId = parseInt(req.query.userId, 10) || (req.user && req.user.id);
    if (!consoleId) return res.status(400).json({ success: false, error: 'Console invalid.' });
    if (!userId) return res.status(400).json({ success: false, error: 'User necunoscut.' });

    try {
        const [owned, favourite, models, photos] = await Promise.all([
            pool.query('SELECT 1 FROM user_owned_consoles WHERE user_id = $1 AND console_id = $2',
                [userId, consoleId]),
            pool.query('SELECT 1 FROM user_favorites WHERE user_id = $1 AND console_id = $2',
                [userId, consoleId]),
            pool.query('SELECT model_code FROM user_owned_models WHERE user_id = $1 AND console_id = $2 ORDER BY created_at',
                [userId, consoleId]),
            pool.query('SELECT id, image_key FROM user_console_photos WHERE user_id = $1 AND console_id = $2 ORDER BY created_at',
                [userId, consoleId]),
        ]);
        res.json({
            success: true,
            owned: owned.rowCount > 0,
            favourite: favourite.rowCount > 0,
            modelCodes: models.rows.map(r => r.model_code),
            photos: photos.rows.map(r => ({ id: r.id, url: publicUrlForKey(r.image_key) })),
        });
    } catch (err) {
        console.error('My space GET error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// PUT /api/my-space/:consoleId — owned / favourite / which revision. App-only by design.
router.put('/my-space/:consoleId', authRequired, async (req, res) => {
    const consoleId = String(req.params.consoleId || '').trim();
    if (!consoleId) return res.status(400).json({ success: false, error: 'Console invalid.' });
    const { owned, favourite, modelCode, modelOwned } = req.body;

    try {
        if (typeof owned === 'boolean') {
            if (owned) {
                await pool.query(
                    'INSERT INTO user_owned_consoles (user_id, console_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [req.user.id, consoleId]
                );
            } else {
                await pool.query('DELETE FROM user_owned_consoles WHERE user_id = $1 AND console_id = $2',
                    [req.user.id, consoleId]);
            }
        }
        if (typeof favourite === 'boolean') {
            if (favourite) {
                await pool.query(
                    'INSERT INTO user_favorites (user_id, console_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [req.user.id, consoleId]
                );
            } else {
                await pool.query('DELETE FROM user_favorites WHERE user_id = $1 AND console_id = $2',
                    [req.user.id, consoleId]);
            }
        }
        // One revision at a time, as a toggle: the client sends the chip that was tapped and
        // whether it is now on, so two devices editing different revisions cannot overwrite each
        // other the way sending the whole list would.
        if (modelCode) {
            const code = String(modelCode).trim();
            if (code && modelOwned === false) {
                await pool.query(
                    'DELETE FROM user_owned_models WHERE user_id = $1 AND console_id = $2 AND model_code = $3',
                    [req.user.id, consoleId, code]
                );
            } else if (code) {
                await pool.query(
                    'INSERT INTO user_owned_models (user_id, console_id, model_code) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                    [req.user.id, consoleId, code]
                );
            }
        }
        // Revisions only mean anything while you own the console; dropping ownership clears them
        // rather than leaving orphans that reappear if you ever tick it again.
        if (owned === false) {
            await pool.query('DELETE FROM user_owned_models WHERE user_id = $1 AND console_id = $2',
                [req.user.id, consoleId]);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('My space PUT error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// PUT /api/owned-consoles — Replace the user’s entire owned-consoles list
router.put('/owned-consoles', authRequired, async (req, res) => {
    try {
        const { consoles } = req.body;
        if (!Array.isArray(consoles)) {
            return res.status(400).json({ success: false, error: 'Format invalid.' });
        }

        // Find which consoles are newly added (not already owned), and remember which hardware
        // revision each one was marked as. This endpoint replaces the whole list by deleting and
        // re-inserting, so without carrying model_code across, editing the owned list from
        // anywhere would quietly wipe every "which model I own" the user had set in My Space.
        const existingRes = await pool.query(
            'SELECT console_id, model_code FROM user_owned_consoles WHERE user_id = $1', [req.user.id]
        );
        const existingIds = new Set(existingRes.rows.map(r => r.console_id));
        const existingModels = new Map(existingRes.rows.map(r => [r.console_id, r.model_code]));

        await pool.query('DELETE FROM user_owned_consoles WHERE user_id = $1', [req.user.id]);

        const newlyAdded = [];
        for (const consoleId of consoles) {
            const id = String(consoleId || '').trim();
            if (!id) continue;
            await pool.query(
                'INSERT INTO user_owned_consoles (user_id, console_id, model_code) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                [req.user.id, id, existingModels.get(id) || null]
            );
            if (!existingIds.has(id)) newlyAdded.push(id);
        }

        res.json({ success: true });

        // Award XP for each newly added console (fire-and-forget)
        const io = req.app.get('io');
        for (const id of newlyAdded) {
            awardXP(pool, io, req.user.id, 'console_owned', id).catch(() => {});
        }
    } catch (err) {
        console.error('Owned consoles PUT error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

module.exports = router;
