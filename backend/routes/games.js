/* ─────────────────────────────────────────
   FILE: games.js
   DESCRIPTION: The per-console games catalogue (seeded from
   Wikidata) and each user's own collection inside My Space.
   ───────────────────────────────────────── */
/* ── REQUIRED IMPORTS — DO NOT REMOVE ──────
   If you add a new package:
     1. require() it here
     2. Add it to package.json dependencies
   ────────────────────────────────────────── */
const express = require('express');
const pool = require('../db');
const { authRequired, authOptional } = require('../middleware/auth');
const { publicUrlForKey } = require('../utils/objectStorage');

const router = express.Router();

// Cover art provenance lives in the key itself rather than in a second column.
// "libretro:<path>" is a box scan served from libretro's thumbnail host, the
// same set RetroArch uses; anything else is one of our own R2 objects. Coverage
// follows what emulators support, so the retro consoles are nearly complete
// (8,500 scans for the PS2 alone) and the modern ones have almost nothing -
// which is why the app still draws a case when this comes back null.
const LIBRETRO = 'https://thumbnails.libretro.com';

function coverUrlFor(key) {
	if (!key) return null;
	if (!key.startsWith('libretro:')) return publicUrlForKey(key);
	return LIBRETRO + '/' + key.slice('libretro:'.length)
		.split('/').map(encodeURIComponent).join('/');
}

// The Switch alone has 7,600 games, so nothing here ever returns a whole
// console's catalogue. The app pages; the page size is capped server-side so a
// crafted ?limit= cannot ask for all of it at once.
const PAGE = 40;
const MAX_PAGE = 100;

// GET /api/games/:consoleId?q=&page=&limit=
//
// The catalogue for one console. Public: browsing what exists on a PS2 needs no
// account, and the collection endpoints below are where ownership comes in.
router.get('/:consoleId', async (req, res) => {
	const consoleId = String(req.params.consoleId || '').trim();
	if (!consoleId) return res.status(400).json({ success: false, error: 'Console invalid.' });

	const q = String(req.query.q || '').trim();
	const page = Math.max(0, parseInt(req.query.page, 10) || 0);
	const limit = Math.min(MAX_PAGE, Math.max(1, parseInt(req.query.limit, 10) || PAGE));

	try {
		// Two orderings, deliberately. With a search term, similarity ranks the
		// hits so "mario" puts the Mario games first instead of whatever happens
		// to be alphabetically earliest among the hundreds that merely contain
		// it. Without one, release year then title is the order a shelf is in.
		const params = [consoleId, limit, page * limit];
		let where = 'gp.console_id = $1';
		let order = 'g.release_year NULLS LAST, g.title';
		if (q) {
			params.push(q);
			where += ` AND g.title ILIKE '%' || $4 || '%'`;
			order = 'similarity(g.title, $4) DESC, g.title';
		}
		const rows = await pool.query(
			`SELECT g.id, g.wikidata_id, g.title, g.release_year, g.developer, g.publisher,
			        gp.cover_key
			   FROM games g
			   JOIN game_platforms gp ON gp.game_id = g.id
			  WHERE ${where}
			  ORDER BY ${order}
			  LIMIT $2 OFFSET $3`,
			params
		);
		res.json({
			success: true,
			games: rows.rows.map(r => ({
				id: r.id,
				wikidataId: r.wikidata_id,
				title: r.title,
				releaseYear: r.release_year,
				developer: r.developer,
				publisher: r.publisher,
				coverUrl: coverUrlFor(r.cover_key),
			})),
			// Cheaper and honest: "there is another page" is all the client needs
			// to keep scrolling, and a COUNT(*) over 7,600 rows per keystroke is
			// not worth paying for a number nobody reads.
			hasMore: rows.rowCount === limit,
		});
	} catch (err) {
		console.error('GET /api/games/:consoleId error:', err);
		res.status(500).json({ success: false, error: 'Failed to load games.' });
	}
});

// GET /api/games/:consoleId/mine?userId= — a user's collection for this console.
//
// authOptional for the same reason the rest of My Space is: the website shows
// someone's collection read-only on their profile, while the app asks about its
// own and sends no userId. Requiring auth here would 400 the app; requiring none
// would leave req.user unpopulated and do exactly the same.
router.get('/:consoleId/mine', authOptional, async (req, res) => {
	const consoleId = String(req.params.consoleId || '').trim();
	const userId = parseInt(req.query.userId, 10) || (req.user && req.user.id);
	if (!consoleId) return res.status(400).json({ success: false, error: 'Console invalid.' });
	if (!userId) return res.status(400).json({ success: false, error: 'User necunoscut.' });

	try {
		const rows = await pool.query(
			`SELECT g.id, g.wikidata_id, g.title, g.release_year, g.developer, g.publisher,
			        gp.cover_key
			   FROM user_games ug
			   JOIN games g ON g.id = ug.game_id
			   -- The box for THIS console, not whichever one happened to match first: the
			   -- same title shipped in a blue PS2 case and a green Xbox one.
			   LEFT JOIN game_platforms gp
			          ON gp.game_id = ug.game_id AND gp.console_id = ug.console_id
			  WHERE ug.user_id = $1 AND ug.console_id = $2
			  ORDER BY ug.created_at`,
			[userId, consoleId]
		);
		res.json({
			success: true,
			games: rows.rows.map(r => ({
				id: r.id,
				wikidataId: r.wikidata_id,
				title: r.title,
				releaseYear: r.release_year,
				developer: r.developer,
				publisher: r.publisher,
				coverUrl: coverUrlFor(r.cover_key),
			})),
		});
	} catch (err) {
		console.error('GET /api/games/:consoleId/mine error:', err);
		res.status(500).json({ success: false, error: 'Failed to load collection.' });
	}
});

// PUT /api/games/:consoleId/mine — add or remove one game. App-only by design,
// like the rest of My Space.
//
// One game per call as a toggle, not the whole list: two devices editing the
// same shelf then cannot overwrite each other, which sending the full set would
// guarantee.
router.put('/:consoleId/mine', authRequired, async (req, res) => {
	const consoleId = String(req.params.consoleId || '').trim();
	const gameId = parseInt(req.body.gameId, 10);
	const owned = req.body.owned !== false;
	if (!consoleId) return res.status(400).json({ success: false, error: 'Console invalid.' });
	if (!gameId) return res.status(400).json({ success: false, error: 'Joc invalid.' });

	try {
		if (owned) {
			// Checked rather than trusted: without this, a client could file any
			// game under any console and the shelf would show a PS5 title on a
			// Game Boy page.
			const ok = await pool.query(
				'SELECT 1 FROM game_platforms WHERE game_id = $1 AND console_id = $2',
				[gameId, consoleId]
			);
			if (!ok.rowCount) {
				return res.status(400).json({ success: false, error: 'Jocul nu apare pe aceasta consola.' });
			}
			await pool.query(
				'INSERT INTO user_games (user_id, game_id, console_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
				[req.user.id, gameId, consoleId]
			);
		} else {
			await pool.query(
				'DELETE FROM user_games WHERE user_id = $1 AND game_id = $2 AND console_id = $3',
				[req.user.id, gameId, consoleId]
			);
		}
		res.json({ success: true });
	} catch (err) {
		console.error('PUT /api/games/:consoleId/mine error:', err);
		res.status(500).json({ success: false, error: 'Failed to update collection.' });
	}
});

module.exports = router;
