const express = require('express');
const router = express.Router();
const pool = require('../db');
const { awardXP } = require('../utils/gamification');
const { ALLOWED_LANGS } = require('../utils/languages');
const { authRequired } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminOnly');

// GET /api/consoles?lang=en  — all consoles for a language
router.get('/', async (req, res) => {
	const lang = ALLOWED_LANGS.includes(req.query.lang) ? req.query.lang : 'en';
	try {
		let result = await pool.query(
			`SELECT data FROM consoles_translations WHERE lang = $1`,
			[lang]
		);
		// Fallback to English if requested language has no data
		if (result.rows.length === 0 && lang !== 'en') {
			result = await pool.query(
				`SELECT data FROM consoles_translations WHERE lang = 'en'`
			);
		}
		res.json(result.rows.map(r => r.data));
	} catch (err) {
		console.error('GET /api/consoles error:', err);
		res.status(500).json({ error: 'Failed to load consoles' });
	}
});

// GET /api/consoles/visited — Get all visited console IDs for current user
router.get('/visited', require('../middleware/auth').authRequired, async (req, res) => {
    const userId = req.user.id;
    try {
        const result = await pool.query(
            'SELECT console_id, visited_at FROM user_console_visits WHERE user_id = $1 ORDER BY visited_at DESC',
            [userId]
        );
        res.json({ success: true, consoles: result.rows.map(r => r.console_id), visits: result.rows });
    } catch (err) {
        console.error('GET /api/consoles/visited error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch visited consoles.' });
    }
});

// GET /api/consoles/:id?lang=en  — single console by id
router.get('/:id', async (req, res) => {
	const lang = ALLOWED_LANGS.includes(req.query.lang) ? req.query.lang : 'en';
	const { id } = req.params;
	try {
		let result = await pool.query(
			`SELECT data FROM consoles_translations WHERE id = $1 AND lang = $2`,
			[id, lang]
		);
		if (result.rows.length === 0 && lang !== 'en') {
			result = await pool.query(
				`SELECT data FROM consoles_translations WHERE id = $1 AND lang = 'en'`,
				[id]
			);
		}
		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Console not found' });
		}
		res.json(result.rows[0].data);
	} catch (err) {
		console.error('GET /api/consoles/:id error:', err);
		res.status(500).json({ error: 'Failed to load console' });
	}
});

// PUT /api/consoles/:id — admin-only, full-object update of one console's EN
// data. Console encyclopedia data now lives in `consoles_translations` as the
// live source of truth (2026-09-06) — this replaces the old
// edit-JSON-file-then-reimport flow (see CLAUDE.md). Update-only: the console
// must already exist (has its own static consoles/<id>.html page — this
// route has no way to create that page, so silently allowing a brand-new id
// here would create an orphaned DB row nothing could ever display). Only the
// `en` row is editable from the site for now; other languages are reviewed
// and updated separately later (same convention as
// console_mod_tutorials_translations).
const CONSOLE_SPEC_GROUPS = ['cpu', 'gpu', 'memory', 'storage', 'output_video', 'technologies'];
router.put('/:id', authRequired, adminOnly, async (req, res) => {
	const { id } = req.params;
	const body = req.body || {};
	if (body.id && body.id !== id) {
		return res.status(400).json({ success: false, error: 'Body id does not match URL id.' });
	}
	if (!body.name || typeof body.name !== 'string') {
		return res.status(400).json({ success: false, error: 'Missing console name.' });
	}
	if (!body.manufacturer || typeof body.manufacturer !== 'string') {
		return res.status(400).json({ success: false, error: 'Missing manufacturer.' });
	}

	const data = {
		id,
		name: String(body.name).slice(0, 200),
		manufacturer: String(body.manufacturer).slice(0, 200),
		generation: Number(body.generation) || 0,
		release: Number(body.release) || 0,
		models: Array.isArray(body.models) ? body.models
			.map(m => ({
				name: String((m && m.name) || '').slice(0, 100),
				year: Number(m && m.year) || 0,
			}))
			.filter(m => m.name)
			.slice(0, 50) : [],
		image: String(body.image || '').slice(0, 500),
		advantages: Array.isArray(body.advantages) ? body.advantages.map(a => String(a).slice(0, 300)).slice(0, 20) : [],
		disadvantages: Array.isArray(body.disadvantages) ? body.disadvantages.map(a => String(a).slice(0, 300)).slice(0, 20) : [],
		history: String(body.history || '').slice(0, 20000),
	};
	CONSOLE_SPEC_GROUPS.forEach(key => {
		data[key] = (body[key] && typeof body[key] === 'object' && !Array.isArray(body[key])) ? body[key] : {};
	});

	try {
		const existing = await pool.query(`SELECT data FROM consoles_translations WHERE id = $1 AND lang = 'en'`, [id]);
		if (!existing.rows.length) {
			return res.status(404).json({ success: false, error: 'Console not found — this endpoint updates existing consoles only.' });
		}
		// Merge onto the existing row rather than replacing it outright — the
		// admin edit form doesn't have fields for everything a console object
		// can carry (e.g. the variable-shaped `dimensions` block, present on
		// only some consoles), so anything it doesn't manage must survive a
		// save untouched instead of silently disappearing.
		const merged = { ...existing.rows[0].data, ...data };
		const { rows } = await pool.query(
			`UPDATE consoles_translations SET data = $2 WHERE id = $1 AND lang = 'en' RETURNING data`,
			[id, merged]
		);
		res.json({ success: true, console: rows[0].data });
	} catch (err) {
		console.error('PUT /api/consoles/:id error:', err);
		res.status(500).json({ success: false, error: 'Could not save console.' });
	}
});

// POST /api/consoles/visit — Mark a console as visited by the current user
router.post('/visit', require('../middleware/auth').authRequired, async (req, res) => {
    const userId = req.user.id;
    const { console_id } = req.body;
    if (!console_id || typeof console_id !== 'string') {
        return res.status(400).json({ success: false, error: 'Console ID required.' });
    }
    try {
        await pool.query(
            `INSERT INTO user_console_visits (user_id, console_id) VALUES ($1, $2)
             ON CONFLICT (user_id, console_id) DO UPDATE SET visited_at = NOW()`,
            [userId, console_id.trim()]
        );
        res.json({ success: true });
        awardXP(pool, req.app.get('io'), userId, 'console_visit', console_id.trim()).catch(() => {});
    } catch (err) {
        console.error('POST /api/consoles/visit error:', err);
        res.status(500).json({ success: false, error: 'Failed to record visit.' });
    }
});

module.exports = router;
