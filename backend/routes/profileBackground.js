/* ─────────────────────────────────────────
   FILE: profileBackground.js
   DESCRIPTION: The profile background (2026-11-26): a full-page image behind a
   user's profile, chosen from game artwork only (IGDB covers, artworks, screenshots).
   Shown on the public profile page (site) and the profile screen (app), nowhere else.
   Two slots: `desktop` (landscape, the site on a wide screen) and `mobile` (portrait,
   the app and the site on a narrow/upright screen). One set alone serves both.

     GET  /api/profile-background/search?q=   games with artwork (auth, rate-limited)
     GET  /api/me/profile-background          { background (desktop), mobile } of the signed-in user
     PUT  /api/me/profile-background          { slot: desktop|mobile, imageId, game, focus } | imageId null/"" removes that slot

   Only an image id is stored (users.profile_background*) - an IGDB image id, or
   "tgdb:<fanart|screenshot(s)>/<n>-<n>.jpg" for TheGamesDB fanart/screenshots
   (table tgdb_artwork, scripts/seed-tgdb-artwork.js) - and the URL is always built
   here, so a stored value can only point at images.igdb.com or cdn.thegamesdb.net.
   Answers 503 when the server has no IGDB credentials (utils/igdb.js).
   ───────────────────────────────────────── */
const express = require('express');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');
const { configured, igdb, imageUrl, IMAGE_ID } = require('../utils/igdb');
const { titleNorm } = require('../utils/titleNorm');

const TGDB_ID = /^tgdb:(fanart|screenshots?)\/\d+-\d+\.(jpg|png)$/;
const validId = id => IMAGE_ID.test(id) || TGDB_ID.test(id);
const urlOf = (id, size = 't_1080p') => (TGDB_ID.test(id)
    ? `https://cdn.thegamesdb.net/images/${size === 't_1080p' ? 'original' : 'thumb'}/${id.slice(5)}`
    : imageUrl(id, size));

const router = express.Router();

const quote = s => '"' + String(s).replace(/[\\"]/g, ' ') + '"';
// focus (2026-11-26): 0-100, which part of the image stays in view when it is cropped -
// left/right for a landscape image on a portrait phone, top/bottom for a portrait one on a
// wide screen; used as both background-position percentages / Compose alignment biases.
const focusOf = v => (Number.isInteger(v) && v >= 0 && v <= 100 ? v : 50);
const slotOf = (row, prefix) => (row && row[prefix] && validId(row[prefix])
    ? { imageId: row[prefix], url: urlOf(row[prefix]), game: row[prefix + '_game'] || '', focus: focusOf(row[prefix + '_focus']) }
    : null);
// Desktop slot; the mobile one is mobileOf(). Each is null when unset.
const toPublic = row => slotOf(row, 'profile_background');
const mobileOf = row => slotOf(row, 'profile_background_mobile');
const COLS = `profile_background, profile_background_game, profile_background_focus,
    profile_background_mobile, profile_background_mobile_game, profile_background_mobile_focus`;

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
            `search ${quote(q)}; fields name,first_release_date,total_rating_count,cover.image_id,artworks.image_id,screenshots.image_id;
             where artworks != null | screenshots != null | cover != null; limit 20;`);
        // The game people mean first: search relevance alone puts mods and bundles ahead of it.
        rows.sort((a, b) => (b.total_rating_count || 0) - (a.total_rating_count || 0));
        // TheGamesDB fanart + screenshots for the same titles: IGDB often has only a couple of
        // landscape images, TheGamesDB has fanart for ~13,600 games.
        const norms = [...new Set(rows.map(g => titleNorm(g.name)).filter(Boolean))];
        const tg = new Map();
        if (norms.length) {
            const { rows: art } = await pool.query(
                `SELECT title_norm, file FROM tgdb_artwork WHERE title_norm = ANY($1) ORDER BY (kind = 'fanart') DESC, file`, [norms]);
            for (const a of art) {
                if (!tg.has(a.title_norm)) tg.set(a.title_norm, []);
                tg.get(a.title_norm).push('tgdb:' + a.file);
            }
        }
        const games = rows.slice(0, 12).map(g => {
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
                    ...[...ids.slice(0, 18), ...(tg.get(titleNorm(g.name)) || [])].slice(0, 30)
                        .map(id => ({ imageId: id, thumb: urlOf(id, 't_screenshot_med'), url: urlOf(id), portrait: false })),
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
        const { rows } = await pool.query(`SELECT ${COLS} FROM users WHERE id = $1`, [req.user.id]);
        res.json({ success: true, background: toPublic(rows[0]), mobile: mobileOf(rows[0]) });
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
    if (imageId !== null && !validId(imageId)) {
        return res.status(400).json({ success: false, error: 'Invalid image.' });
    }
    try {
        // Column names come from this fixed choice, never from the request.
        const prefix = req.body?.slot === 'mobile' ? 'profile_background_mobile' : 'profile_background';
        const { rows } = await pool.query(
            `UPDATE users SET ${prefix} = $1, ${prefix}_game = $2, ${prefix}_focus = $3 WHERE id = $4
             RETURNING ${COLS}`,
            [imageId, imageId ? game : null, focus, req.user.id]);
        res.json({ success: true, background: toPublic(rows[0]), mobile: mobileOf(rows[0]) });
    } catch (err) {
        console.error('Profile background PUT error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

module.exports = router;
module.exports.toPublic = toPublic;
module.exports.mobileOf = mobileOf;
