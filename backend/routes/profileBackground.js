/* ─────────────────────────────────────────
   FILE: profileBackground.js
   DESCRIPTION: The profile background (2026-11-26): a full-page image behind a
   user's profile, chosen from game artwork only (IGDB artworks and screenshots).
   Shown on the public profile page (site) and the profile screen (app), nowhere else.

     GET  /api/profile-background/search?q=   games with artwork (auth, rate-limited)
     GET  /api/me/profile-background          what the signed-in user has chosen
     PUT  /api/me/profile-background          { imageId, game, focus } | { imageId: null or "" } to remove

   Only the IGDB image id is stored (users.profile_background) - the URL is always
   built here, so a stored value can never point anywhere but images.igdb.com.
   Answers 503 when the server has no IGDB credentials (utils/igdb.js).
   ───────────────────────────────────────── */
const express = require('express');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');
const { configured, igdb, imageUrl, IMAGE_ID } = require('../utils/igdb');

const router = express.Router();

const quote = s => '"' + String(s).replace(/[\\"]/g, ' ') + '"';
// focus (2026-11-26): 0-100, which part of the image stays in view when it is cropped -
// left/right for a landscape image on a portrait phone, top/bottom for a portrait one on a
// wide screen; used as both background-position percentages / Compose alignment biases.
const focusOf = v => (Number.isInteger(v) && v >= 0 && v <= 100 ? v : 50);
const toPublic = row => (row && row.profile_background && IMAGE_ID.test(row.profile_background)
    ? { imageId: row.profile_background, url: imageUrl(row.profile_background), game: row.profile_background_game || '',
        focus: focusOf(row.profile_background_focus) }
    : null);

// Search results stay the same for a while; one IGDB call per distinct query per hour.
const cache = new Map();

router.get('/profile-background/search', authRequired, async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (q.length < 2) return res.json({ success: true, games: [] });
    if (!configured()) return res.status(503).json({ success: false, error: 'Artwork search is not configured.' });
    const key = q.toLowerCase();
    const hit = cache.get(key);
    if (hit && hit.at > Date.now() - 3600e3) return res.json({ success: true, games: hit.games });
    try {
        const rows = await igdb('games',
            `search ${quote(q)}; fields name,first_release_date,cover.image_id,artworks.image_id,screenshots.image_id;
             where artworks != null | screenshots != null; limit 12;`);
        const games = rows.map(g => {
            // The cover (key art) first - it is the portrait one, made for a phone held upright;
            // then artworks (made to be shown big), then screenshots. All landscape but the cover.
            const ids = [...(g.artworks || []), ...(g.screenshots || [])].map(a => a.image_id).filter(id => IMAGE_ID.test(id || ''));
            const cover = g.cover && IMAGE_ID.test(g.cover.image_id || '') ? g.cover.image_id : null;
            return {
                igdbId: g.id,
                name: g.name,
                year: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
                cover: g.cover && IMAGE_ID.test(g.cover.image_id || '') ? imageUrl(g.cover.image_id, 't_cover_small') : null,
                images: [
                    ...(cover ? [{ imageId: cover, thumb: imageUrl(cover, 't_cover_big'), url: imageUrl(cover), portrait: true }] : []),
                    ...ids.slice(0, 18).map(id => ({ imageId: id, thumb: imageUrl(id, 't_screenshot_med'), url: imageUrl(id), portrait: false })),
                ],
            };
        }).filter(g => g.images.length);
        cache.set(key, { at: Date.now(), games });
        if (cache.size > 500) cache.delete(cache.keys().next().value);
        res.json({ success: true, games });
    } catch (err) {
        console.error('Profile background search error:', err.message);
        res.status(502).json({ success: false, error: 'Artwork search failed.' });
    }
});

router.get('/me/profile-background', authRequired, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT profile_background, profile_background_game, profile_background_focus FROM users WHERE id = $1', [req.user.id]);
        res.json({ success: true, background: toPublic(rows[0]) });
    } catch (err) {
        console.error('Profile background GET error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

router.put('/me/profile-background', authRequired, async (req, res) => {
    // null, "" or a missing field all mean "remove" (the app's Gson drops nulls).
    const raw = req.body?.imageId;
    const imageId = raw === undefined || raw === null || raw === '' ? null : String(raw);
    const game = String(req.body?.game || '').trim().slice(0, 200);
    const focus = focusOf(parseInt(req.body?.focus, 10));
    if (imageId !== null && !IMAGE_ID.test(imageId)) {
        return res.status(400).json({ success: false, error: 'Invalid image.' });
    }
    try {
        const { rows } = await pool.query(
            `UPDATE users SET profile_background = $1, profile_background_game = $2, profile_background_focus = $3 WHERE id = $4
             RETURNING profile_background, profile_background_game, profile_background_focus`,
            [imageId, imageId ? game : null, focus, req.user.id]);
        res.json({ success: true, background: toPublic(rows[0]) });
    } catch (err) {
        console.error('Profile background PUT error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

module.exports = router;
module.exports.toPublic = toPublic;
