/* ─────────────────────────────────────────
   FILE: console-tutorials.js
   DESCRIPTION: Per-model tutorial content for console-model.html (the
   detail page linked from both console-care.html's and console-modding.html's
   model directories). Admin-only write, public read. Two independent kinds
   of content, on two separate tables:
   - Disassembly tutorial: one row per hardware model code (e.g. "SCPH-50004")
     in `console_tutorials` (title/intro/steps JSONB), keyed to the same
     `code` used in frontend/js/data/console-models.js. Untouched by the
     modding-guide selector below — cleaning doesn't depend on flash type or
     firmware.
   - Modding guide: MULTIPLE rows per model code in `console_mod_tutorials`,
     one per (flash_type, firmware_version) combination — e.g. PS3 "CECHJ"
     can have a "NOR"/"4.93" write-up completely independent from any other
     combination. console-model.html lets a visitor pick flash type then
     firmware version and shows that combination's own title/intro/steps.
     The legacy `console_tutorials.mod_title/mod_intro/mod_steps` columns
     are superseded by this table and are left in place, unused, per this
     repo's "never drop columns" migration convention.
   Step photos are uploaded separately via the existing POST /api/uploads/presign
   ('tutorial' kind).
   ───────────────────────────────────────── */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authRequired } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminOnly');

(async function initConsoleTutorialsTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS console_tutorials (
                model_code VARCHAR(60) PRIMARY KEY,
                title TEXT,
                intro TEXT,
                steps JSONB NOT NULL DEFAULT '[]',
                updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);
        // mod_title/mod_intro/mod_steps: legacy single-row modding-guide columns,
        // superseded by console_mod_tutorials (see initConsoleModTutorialsTable
        // below). Left in place unused — never drop columns, existing envs just
        // stop writing to them.
        await pool.query(`
            ALTER TABLE console_tutorials ADD COLUMN IF NOT EXISTS mod_title TEXT;
            ALTER TABLE console_tutorials ADD COLUMN IF NOT EXISTS mod_intro TEXT;
            ALTER TABLE console_tutorials ADD COLUMN IF NOT EXISTS mod_steps JSONB NOT NULL DEFAULT '[]';
        `);
    } catch (err) {
        console.error('[console-tutorials] table init error:', err.message);
    }
})();

(async function initConsoleModTutorialsTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS console_mod_tutorials (
                id SERIAL PRIMARY KEY,
                model_code VARCHAR(60) NOT NULL,
                flash_type VARCHAR(80) NOT NULL,
                firmware_version VARCHAR(40) NOT NULL,
                title TEXT,
                intro TEXT,
                steps JSONB NOT NULL DEFAULT '[]',
                updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE (model_code, flash_type, firmware_version)
            );
        `);
        // Widened from VARCHAR(40): PS2 softmod combos describe the install
        // medium in this column (e.g. "Memory Card (softmod, no disc-swap...)")
        // rather than the short NOR/NAND labels this column was designed for
        // on PS3 — see console_mod_tutorials_row_en's "flash_type" for the
        // SCPH-70004 FreeMcBoot guide. No-op once already widened.
        await pool.query(`ALTER TABLE console_mod_tutorials ALTER COLUMN flash_type TYPE VARCHAR(80);`);
    } catch (err) {
        console.error('[console-tutorials] mod-tutorials table init error:', err.message);
    }
})();

// Per-language overrides of a console_mod_tutorials row, mirroring
// lesson_translations (see db.js/courses.js): EN lives on console_mod_tutorials
// itself (the canonical row), every other language is a row here keyed by
// (lang, tutorial_id). GET /:code/mod LEFT JOINs this and COALESCEs back to
// the EN row per-field, so a combo with no translation yet just serves EN.
(async function initConsoleModTutorialsTranslationsTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS console_mod_tutorials_translations (
                tutorial_id INTEGER NOT NULL REFERENCES console_mod_tutorials(id) ON DELETE CASCADE,
                lang VARCHAR(5) NOT NULL,
                title TEXT,
                intro TEXT,
                steps JSONB NOT NULL DEFAULT '[]',
                updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                updated_at TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (lang, tutorial_id)
            );
        `);
    } catch (err) {
        console.error('[console-tutorials] mod-tutorials-translations table init error:', err.message);
    }
})();

function sanitizeSteps(input) {
    if (!Array.isArray(input)) return [];
    return input
        .slice(0, 150)
        .map(s => ({
            heading: String(s?.heading || '').slice(0, 200),
            description: String(s?.description || '').slice(0, 5000),
            image_url: String(s?.image_url || '').slice(0, 500),
        }))
        .filter(s => s.heading || s.description || s.image_url);
}

// GET /api/console-tutorials/:code — public, no auth needed
// Returns the disassembly tutorial for this model. (Modding guides live under
// GET /:code/mod — see below — since a model can have several of them.)
router.get('/:code', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT model_code, title, intro, steps, updated_at FROM console_tutorials WHERE model_code = $1',
            [req.params.code]
        );
        if (!rows.length) return res.json({ success: true, tutorial: null });
        res.json({ success: true, tutorial: rows[0] });
    } catch (err) {
        console.error('Console tutorial GET error:', err.message);
        res.status(500).json({ success: false, error: 'Could not load tutorial.' });
    }
});

// PUT /api/console-tutorials/:code — admin-only upsert of the disassembly tutorial
router.put('/:code', authRequired, adminOnly, async (req, res) => {
    try {
        const code = String(req.params.code || '').slice(0, 60);
        if (!code) return res.status(400).json({ success: false, error: 'Missing model code.' });

        const title = String(req.body?.title || '').slice(0, 200);
        const intro = String(req.body?.intro || '').slice(0, 5000);
        const steps = sanitizeSteps(req.body?.steps);

        const { rows } = await pool.query(
            `INSERT INTO console_tutorials (model_code, title, intro, steps, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (model_code) DO UPDATE
               SET title = EXCLUDED.title, intro = EXCLUDED.intro, steps = EXCLUDED.steps,
                   updated_by = EXCLUDED.updated_by, updated_at = NOW()
             RETURNING model_code, title, intro, steps, updated_at`,
            [code, title, intro, JSON.stringify(steps), req.user.id]
        );
        res.json({ success: true, tutorial: rows[0] });
    } catch (err) {
        console.error('Console tutorial PUT error:', err.message);
        res.status(500).json({ success: false, error: 'Could not save tutorial.' });
    }
});

// DELETE /api/console-tutorials/:code — admin-only, revert disassembly tutorial to "Coming soon"
router.delete('/:code', authRequired, adminOnly, async (req, res) => {
    try {
        await pool.query(
            `UPDATE console_tutorials SET title = NULL, intro = NULL, steps = '[]' WHERE model_code = $1`,
            [req.params.code]
        );
        await pool.query(
            `DELETE FROM console_tutorials WHERE model_code = $1 AND mod_title IS NULL AND mod_intro IS NULL AND mod_steps = '[]'`,
            [req.params.code]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Console tutorial DELETE error:', err.message);
        res.status(500).json({ success: false, error: 'Could not delete tutorial.' });
    }
});

// GET /api/console-tutorials/:code/mod?lang= — public, no auth needed
// Returns EVERY (flash_type, firmware_version) modding-guide combination for
// this model, full content included, so the frontend can populate both
// selector dropdowns and switch between combinations client-side with no
// further round-trips. `lang` (default 'en') pulls per-field overrides from
// console_mod_tutorials_translations, falling back to the EN canonical row
// wherever a translation is missing or hasn't been written yet. `has_translation`
// tells the admin editor (console-model.js) whether the fields shown are a real
// translation for `lang` or just the EN fallback, so it can label its "Edit"
// button "Add translation" vs "Edit translation" without a second round-trip.
router.get('/:code/mod', async (req, res) => {
    try {
        const lang = String(req.query.lang || 'en').trim().slice(0, 5).toLowerCase() || 'en';
        const { rows } = await pool.query(
            `SELECT cmt.id, cmt.flash_type, cmt.firmware_version,
                    COALESCE(t.title, cmt.title) AS title,
                    COALESCE(t.intro, cmt.intro) AS intro,
                    COALESCE(t.steps, cmt.steps) AS steps,
                    cmt.updated_at,
                    (t.tutorial_id IS NOT NULL) AS has_translation
             FROM console_mod_tutorials cmt
             LEFT JOIN console_mod_tutorials_translations t
               ON t.tutorial_id = cmt.id AND t.lang = $2
             WHERE cmt.model_code = $1
             ORDER BY cmt.flash_type, cmt.firmware_version`,
            [req.params.code, lang]
        );
        res.json({ success: true, tutorials: rows });
    } catch (err) {
        console.error('Console mod-tutorials GET error:', err.message);
        res.status(500).json({ success: false, error: 'Could not load modding guides.' });
    }
});

// PUT /api/console-tutorials/:code/mod/:flashType/:version — admin-only upsert
// of a single (flash_type, firmware_version) modding guide. Used both to add
// a brand-new combination and to edit an existing one.
router.put('/:code/mod/:flashType/:version', authRequired, adminOnly, async (req, res) => {
    try {
        const code = String(req.params.code || '').slice(0, 60);
        const flashType = String(req.params.flashType || '').trim().slice(0, 40).toUpperCase();
        const version = String(req.params.version || '').trim().slice(0, 40);
        if (!code || !flashType || !version) {
            return res.status(400).json({ success: false, error: 'Missing model code, flash type, or firmware version.' });
        }

        const title = String(req.body?.title || '').slice(0, 200);
        const intro = String(req.body?.intro || '').slice(0, 5000);
        const steps = sanitizeSteps(req.body?.steps);

        const { rows } = await pool.query(
            `INSERT INTO console_mod_tutorials (model_code, flash_type, firmware_version, title, intro, steps, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (model_code, flash_type, firmware_version) DO UPDATE
               SET title = EXCLUDED.title, intro = EXCLUDED.intro, steps = EXCLUDED.steps,
                   updated_by = EXCLUDED.updated_by, updated_at = NOW()
             RETURNING flash_type, firmware_version, title, intro, steps, updated_at`,
            [code, flashType, version, title, intro, JSON.stringify(steps), req.user.id]
        );
        res.json({ success: true, tutorial: rows[0] });
    } catch (err) {
        console.error('Console mod-tutorial PUT error:', err.message);
        res.status(500).json({ success: false, error: 'Could not save modding guide.' });
    }
});

// DELETE /api/console-tutorials/:code/mod/:flashType/:version — admin-only,
// removes a single combination. If it was the last one for the model, the
// model naturally falls back to the "coming soon" state.
router.delete('/:code/mod/:flashType/:version', authRequired, adminOnly, async (req, res) => {
    try {
        const flashType = String(req.params.flashType || '').trim().slice(0, 40).toUpperCase();
        const version = String(req.params.version || '').trim().slice(0, 40);
        await pool.query(
            `DELETE FROM console_mod_tutorials WHERE model_code = $1 AND flash_type = $2 AND firmware_version = $3`,
            [req.params.code, flashType, version]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Console mod-tutorial DELETE error:', err.message);
        res.status(500).json({ success: false, error: 'Could not delete modding guide.' });
    }
});

// PUT /api/console-tutorials/:code/mod/:flashType/:version/translations/:lang
// admin-only upsert of one language's override for one existing modding-guide
// combo. Requires the EN combo to already exist (translations hang off its id).
router.put('/:code/mod/:flashType/:version/translations/:lang', authRequired, adminOnly, async (req, res) => {
    try {
        const flashType = String(req.params.flashType || '').trim().slice(0, 40).toUpperCase();
        const version = String(req.params.version || '').trim().slice(0, 40);
        const lang = String(req.params.lang || '').trim().slice(0, 5).toLowerCase();
        if (!flashType || !version || !lang) {
            return res.status(400).json({ success: false, error: 'Missing flash type, firmware version, or language.' });
        }

        const tutorialRes = await pool.query(
            `SELECT id FROM console_mod_tutorials WHERE model_code = $1 AND flash_type = $2 AND firmware_version = $3`,
            [req.params.code, flashType, version]
        );
        if (!tutorialRes.rows.length) {
            return res.status(404).json({ success: false, error: 'Base modding guide not found for this combination.' });
        }
        const tutorialId = tutorialRes.rows[0].id;

        const title = String(req.body?.title || '').slice(0, 200);
        const intro = String(req.body?.intro || '').slice(0, 5000);
        const steps = sanitizeSteps(req.body?.steps);

        const { rows } = await pool.query(
            `INSERT INTO console_mod_tutorials_translations (tutorial_id, lang, title, intro, steps, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (lang, tutorial_id) DO UPDATE
               SET title = EXCLUDED.title, intro = EXCLUDED.intro, steps = EXCLUDED.steps,
                   updated_by = EXCLUDED.updated_by, updated_at = NOW()
             RETURNING tutorial_id, lang, title, intro, steps, updated_at`,
            [tutorialId, lang, title, intro, JSON.stringify(steps), req.user.id]
        );
        res.json({ success: true, translation: rows[0] });
    } catch (err) {
        console.error('Console mod-tutorial translation PUT error:', err.message);
        res.status(500).json({ success: false, error: 'Could not save translation.' });
    }
});

// DELETE .../translations/:lang — admin-only, drops one language's override so
// that combo falls back to serving the EN canonical content for that language.
router.delete('/:code/mod/:flashType/:version/translations/:lang', authRequired, adminOnly, async (req, res) => {
    try {
        const flashType = String(req.params.flashType || '').trim().slice(0, 40).toUpperCase();
        const version = String(req.params.version || '').trim().slice(0, 40);
        const lang = String(req.params.lang || '').trim().slice(0, 5).toLowerCase();
        await pool.query(
            `DELETE FROM console_mod_tutorials_translations t
             USING console_mod_tutorials cmt
             WHERE t.tutorial_id = cmt.id AND cmt.model_code = $1 AND cmt.flash_type = $2
               AND cmt.firmware_version = $3 AND t.lang = $4`,
            [req.params.code, flashType, version, lang]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Console mod-tutorial translation DELETE error:', err.message);
        res.status(500).json({ success: false, error: 'Could not delete translation.' });
    }
});

module.exports = router;
