/* ─────────────────────────────────────────
   FILE: favorites.js
   DESCRIPTION: Console favorites management. Users can
   list, check, and toggle favorite consoles.
   ───────────────────────────────────────── */
/* ── REQUIRED IMPORTS — DO NOT REMOVE ──────
   If you add a new package:
     1. require() it here
     2. Add it to package.json dependencies
   ────────────────────────────────────────── */
const express = require('express');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');
const { awardXP } = require('../utils/gamification');

const router = express.Router();

// GET /api/favorites — List all favorited console IDs for current user
router.get('/', authRequired, async (req, res) => {
    try {
        // Ranked, not chronological. Favourites are an order the user drags into place in the
        // app, and `position` is where it lives; ordering by created_at here made the home
        // page show a different order from the profile, the app and the console page for the
        // same list. NULLS LAST so a row predating the column falls in behind the ranked ones.
        const result = await pool.query(
            'SELECT console_id FROM user_favorites WHERE user_id = $1 ORDER BY position NULLS LAST, id',
            [req.user.id]
        );
        res.json({ success: true, favorites: result.rows.map(r => r.console_id) });
    } catch (err) {
        console.error('Favorites GET error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// GET /api/favorites/:consoleId — Check if a specific console is favorited
router.get('/:consoleId', authRequired, async (req, res) => {
    try {
        const { consoleId } = req.params;
        // DB: check if favorite record exists for this user + console pair
        const result = await pool.query(
            'SELECT id FROM user_favorites WHERE user_id = $1 AND console_id = $2',
            [req.user.id, consoleId]
        );
        res.json({ success: true, isFavorite: result.rows.length > 0 });
    } catch (err) {
        console.error('Favorites check error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// POST /api/favorites/:consoleId — Toggle favorite (add if missing, remove if exists)
router.post('/:consoleId', authRequired, async (req, res) => {
    try {
        const { consoleId } = req.params;
        if (!consoleId || String(consoleId).trim().length === 0) {
            return res.status(400).json({ success: false, error: 'Invalid console ID.' });
        }

        // DB: check if already favorited
        const existing = await pool.query(
            'SELECT id FROM user_favorites WHERE user_id = $1 AND console_id = $2',
            [req.user.id, consoleId]
        );

        if (existing.rows.length > 0) {
            await pool.query(
                'DELETE FROM user_favorites WHERE user_id = $1 AND console_id = $2',
                [req.user.id, consoleId]
            );
            res.json({ success: true, isFavorite: false });
        } else {
            await pool.query(
                'INSERT INTO user_favorites (user_id, console_id) VALUES ($1, $2)',
                [req.user.id, consoleId]
            );
            res.json({ success: true, isFavorite: true });
            awardXP(pool, req.app.get('io'), req.user.id, 'console_favorite', consoleId).catch(() => {});
        }
    } catch (err) {
        console.error('Favorites toggle error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

module.exports = router;
