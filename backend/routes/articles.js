/* ─────────────────────────────────────────
   FILE: articles.js
   DESCRIPTION: Admin-written blog articles ("New" section on home.html).
   Admin-only write (create/update/delete), public read. Cover + inline
   content images are uploaded separately via the existing
   POST /api/uploads/presign ('article' kind, admin-gated there too).
   Each article has one category (CATEGORIES) and the consoles it is about
   (article_consoles); GET / filters by both, which is what the console pages
   use to list their articles.
   ───────────────────────────────────────── */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authRequired, authOptional } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminOnly');
const { publicUrlForKey } = require('../utils/objectStorage');

const CATEGORIES = ['news', 'history', 'special-editions', 'speculations', 'fun-facts'];
const pickCategory = (v, fallback) => (CATEGORIES.includes(v) ? v : fallback);

// Only ids of consoles that exist; anything else is dropped silently.
async function validConsoles(list) {
    if (!Array.isArray(list)) return null;
    const ids = [...new Set(list.filter(x => typeof x === 'string' && /^[a-z0-9-]{1,40}$/.test(x)))].slice(0, 60);
    if (!ids.length) return [];
    const { rows } = await pool.query('SELECT DISTINCT id FROM consoles_translations WHERE id = ANY($1)', [ids]);
    return rows.map(r => r.id);
}

async function setConsoles(articleId, ids) {
    await pool.query('DELETE FROM article_consoles WHERE article_id = $1', [articleId]);
    if (ids.length) {
        await pool.query(
            'INSERT INTO article_consoles (article_id, console_id) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING',
            [articleId, ids]);
    }
}

const CONSOLES_SQL = `COALESCE((SELECT array_agg(ac.console_id ORDER BY ac.console_id) FROM article_consoles ac WHERE ac.article_id = a.id), '{}') AS consoles`;

function slugify(title) {
    return String(title || '')
        .toLowerCase()
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'article';
}

async function uniqueSlug(base, excludeId) {
    let slug = base;
    let n = 2;
    while (true) {
        const { rows } = await pool.query(
            excludeId ? 'SELECT id FROM articles WHERE slug = $1 AND id != $2' : 'SELECT id FROM articles WHERE slug = $1',
            excludeId ? [slug, excludeId] : [slug]
        );
        if (!rows.length) return slug;
        slug = `${base}-${n++}`;
    }
}

function toPublic(row) {
    return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        excerpt: row.excerpt,
        content_html: row.content_html,
        cover_image_url: publicUrlForKey(row.cover_image_key),
        author_id: row.author_id,
        author_name: row.author_name,
        published: row.published,
        category: row.category,
        consoles: row.consoles || [],
        views: row.views,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

// GET /api/articles — public, list published articles (newest first).
// Optional ?category=<one of CATEGORIES> and ?console=<console id>.
router.get('/', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        const category = CATEGORIES.includes(req.query.category) ? req.query.category : null;
        const consoleId = typeof req.query.console === 'string' && /^[a-z0-9-]{1,40}$/.test(req.query.console) ? req.query.console : null;
        const { rows } = await pool.query(
            `SELECT a.*, u.username AS author_name, ${CONSOLES_SQL}
             FROM articles a JOIN users u ON u.id = a.author_id
             WHERE a.published = TRUE
               AND ($3::text IS NULL OR a.category = $3)
               AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM article_consoles ac WHERE ac.article_id = a.id AND ac.console_id = $4))
             ORDER BY a.created_at DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset, category, consoleId]
        );
        res.json({ success: true, articles: rows.map(toPublic) });
    } catch (err) {
        console.error('Articles GET error:', err.message);
        res.status(500).json({ success: false, error: 'Could not load articles.' });
    }
});

// GET /api/articles/:slug — public, single article; increments views
router.get('/:slug', authOptional, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT a.*, u.username AS author_name, ${CONSOLES_SQL}
             FROM articles a JOIN users u ON u.id = a.author_id
             WHERE a.slug = $1`,
            [req.params.slug]
        );
        if (!rows.length) return res.status(404).json({ success: false, error: 'Article not found.' });
        const row = rows[0];
        if (!row.published && (!req.user || req.user.role !== 'admin')) {
            return res.status(404).json({ success: false, error: 'Article not found.' });
        }
        pool.query('UPDATE articles SET views = views + 1 WHERE id = $1', [row.id]).catch(() => {});
        res.json({ success: true, article: toPublic(row) });
    } catch (err) {
        console.error('Article GET error:', err.message);
        res.status(500).json({ success: false, error: 'Could not load article.' });
    }
});

// POST /api/articles — admin-only create
router.post('/', authRequired, adminOnly, async (req, res) => {
    try {
        const title = String(req.body?.title || '').trim().slice(0, 200);
        const excerpt = String(req.body?.excerpt || '').trim().slice(0, 400);
        const contentHtml = String(req.body?.content_html || '').trim().slice(0, 50000);
        const coverImageKey = typeof req.body?.cover_image_key === 'string' && req.body.cover_image_key.startsWith(`articles/image/${req.user.id}/`)
            ? req.body.cover_image_key.slice(0, 300) : null;
        const published = req.body?.published !== false;
        const category = pickCategory(req.body?.category, 'news');
        const consoles = (await validConsoles(req.body?.consoles)) || [];

        if (!title || !contentHtml) {
            return res.status(400).json({ success: false, error: 'Title and content are required.' });
        }

        const slug = await uniqueSlug(slugify(title));
        const { rows } = await pool.query(
            `INSERT INTO articles (slug, title, excerpt, content_html, cover_image_key, author_id, published, category)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [slug, title, excerpt, contentHtml, coverImageKey, req.user.id, published, category]
        );
        await setConsoles(rows[0].id, consoles);
        res.status(201).json({ success: true, article: toPublic({ ...rows[0], consoles, author_name: req.user.username }) });
    } catch (err) {
        console.error('Article POST error:', err.message);
        res.status(500).json({ success: false, error: 'Could not create article.' });
    }
});

// PUT /api/articles/:id — admin-only update
router.put('/:id', authRequired, adminOnly, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid article id.' });

        const { rows: existingRows } = await pool.query('SELECT * FROM articles WHERE id = $1', [id]);
        if (!existingRows.length) return res.status(404).json({ success: false, error: 'Article not found.' });
        const existing = existingRows[0];

        const title = String(req.body?.title ?? existing.title).trim().slice(0, 200);
        const excerpt = String(req.body?.excerpt ?? existing.excerpt).trim().slice(0, 400);
        const contentHtml = String(req.body?.content_html ?? existing.content_html).trim().slice(0, 50000);
        const coverImageKey = typeof req.body?.cover_image_key === 'string'
            ? (req.body.cover_image_key.startsWith(`articles/image/${req.user.id}/`) ? req.body.cover_image_key.slice(0, 300) : existing.cover_image_key)
            : existing.cover_image_key;
        const published = typeof req.body?.published === 'boolean' ? req.body.published : existing.published;
        const category = pickCategory(req.body?.category, existing.category);
        const consoles = await validConsoles(req.body?.consoles); // null = not sent, keep as is

        if (!title || !contentHtml) {
            return res.status(400).json({ success: false, error: 'Title and content are required.' });
        }

        let slug = existing.slug;
        if (req.body?.title && slugify(req.body.title) !== existing.slug) {
            slug = await uniqueSlug(slugify(title), id);
        }

        const { rows } = await pool.query(
            `UPDATE articles SET slug = $1, title = $2, excerpt = $3, content_html = $4,
                cover_image_key = $5, published = $6, category = $7, updated_at = NOW()
             WHERE id = $8
             RETURNING *`,
            [slug, title, excerpt, contentHtml, coverImageKey, published, category, id]
        );
        if (consoles) await setConsoles(id, consoles);
        const { rows: extra } = await pool.query(
            `SELECT (SELECT username FROM users WHERE id = $1) AS author_name,
                    COALESCE((SELECT array_agg(console_id ORDER BY console_id) FROM article_consoles WHERE article_id = $2), '{}') AS consoles`,
            [existing.author_id, id]);
        res.json({ success: true, article: toPublic({ ...rows[0], ...extra[0] }) });
    } catch (err) {
        console.error('Article PUT error:', err.message);
        res.status(500).json({ success: false, error: 'Could not update article.' });
    }
});

// DELETE /api/articles/:id — admin-only
router.delete('/:id', authRequired, adminOnly, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid article id.' });
        await pool.query('DELETE FROM articles WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Article DELETE error:', err.message);
        res.status(500).json({ success: false, error: 'Could not delete article.' });
    }
});

module.exports = router;
