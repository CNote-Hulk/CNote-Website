/* ─────────────────────────────────────────
   FILE: personal.js
   DESCRIPTION: Personal Routes — /api/personal
   Andrei's own Finance + Projects pages in the Android app (moved from the
   retired Mind Tree app, 2026-11-04). Owner-only: gated on the user id of
   the AndreiHulk07 account, not on role — CNote has several admins.
     - cash-flow: expenses/income in `personal_cash_flow` (RLS on, no
       policies, so the publishable key shipped in the APK can't read it;
       this route goes through the pg pool).
     - projects: the Mind Tree vault's two `_Index.md` files, fetched from
       the private GitHub repo with a server-side token and parsed into a
       plain list. One request instead of the phone walking the vault.
   ───────────────────────────────────────── */
/* ── REQUIRED IMPORTS — DO NOT REMOVE ──────
   If you add a new package:
     1. require() it here
     2. Add it to package.json dependencies
   ────────────────────────────────────────── */
const express = require('express');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// users.id of AndreiHulk07 (checked 2026-11-04). An id, not the username:
// usernames can be changed, and a freed name could be picked up by someone else.
const OWNER_USER_ID = parseInt(process.env.PERSONAL_OWNER_USER_ID, 10) || 3;

router.use(authRequired, (req, res, next) => {
    if (!req.user || req.user.id !== OWNER_USER_ID) {
        return res.status(403).json({ success: false, error: 'Acces interzis.' });
    }
    next();
});

// ── Cash flow ────────────────────────────────────────────

const TYPES = new Set(['income', 'expense']);

function toEntry(row) {
    return {
        id: row.id,
        business: row.business,
        type: row.type,
        amount_ron: Number(row.amount_ron),
        category: row.category,
        occurred_on: row.occurred_on,
        note: row.note,
        created_at: row.created_at,
    };
}

/** Returns [values, error]. occurred_on is kept as the YYYY-MM-DD string. */
function validate(body) {
    const b = body || {};
    const business = typeof b.business === 'string' ? b.business.trim() : '';
    const type = typeof b.type === 'string' ? b.type.toLowerCase() : '';
    const amount = Number(b.amount_ron);
    const category = typeof b.category === 'string' ? b.category.trim() : '';
    const occurredOn = typeof b.occurred_on === 'string' ? b.occurred_on : '';
    const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim() : null;
    if (!business || business.length > 100) return [null, 'business'];
    if (!TYPES.has(type)) return [null, 'type'];
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) return [null, 'amount_ron'];
    if (!category || category.length > 100) return [null, 'category'];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) return [null, 'occurred_on'];
    if (note && note.length > 2000) return [null, 'note'];
    return [[business, type, amount, category, occurredOn, note], null];
}

const SELECT_COLS = `id, business, type, amount_ron, category,
    to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on, note, created_at`;

// GET /api/personal/cash-flow — every entry, newest first
router.get('/cash-flow', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT ${SELECT_COLS} FROM personal_cash_flow ORDER BY occurred_on DESC, created_at DESC`
        );
        res.json({ success: true, entries: rows.map(toEntry) });
    } catch (err) {
        console.error('Personal cash-flow GET error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// POST /api/personal/cash-flow
router.post('/cash-flow', async (req, res) => {
    const [v, bad] = validate(req.body);
    if (bad) return res.status(400).json({ success: false, error: `Invalid ${bad}.` });
    try {
        const { rows } = await pool.query(
            `INSERT INTO personal_cash_flow (business, type, amount_ron, category, occurred_on, note)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${SELECT_COLS}`,
            v
        );
        res.status(201).json({ success: true, entry: toEntry(rows[0]) });
    } catch (err) {
        console.error('Personal cash-flow POST error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// PUT /api/personal/cash-flow/:id
router.put('/cash-flow/:id', async (req, res) => {
    const [v, bad] = validate(req.body);
    if (bad) return res.status(400).json({ success: false, error: `Invalid ${bad}.` });
    try {
        const { rows } = await pool.query(
            `UPDATE personal_cash_flow
             SET business = $1, type = $2, amount_ron = $3, category = $4, occurred_on = $5, note = $6
             WHERE id = $7 RETURNING ${SELECT_COLS}`,
            [...v, req.params.id]
        );
        if (!rows.length) return res.status(404).json({ success: false, error: 'Not found.' });
        res.json({ success: true, entry: toEntry(rows[0]) });
    } catch (err) {
        if (err.code === '22P02') return res.status(404).json({ success: false, error: 'Not found.' });
        console.error('Personal cash-flow PUT error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// DELETE /api/personal/cash-flow/:id
router.delete('/cash-flow/:id', async (req, res) => {
    try {
        const { rowCount } = await pool.query('DELETE FROM personal_cash_flow WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ success: false, error: 'Not found.' });
        res.json({ success: true });
    } catch (err) {
        if (err.code === '22P02') return res.status(404).json({ success: false, error: 'Not found.' });
        console.error('Personal cash-flow DELETE error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── Projects (from the vault's _Index.md files on GitHub) ─

const VAULT_REPO = process.env.VAULT_GITHUB_REPO || 'CNote-Hulk/Mind-Tree-Vault';
const INDEX_PATHS = { projects: '02 Proiecte/_Index.md', archive: '06 Arhivă/_Index.md' };
const CACHE_MS = 60 * 1000;
let cache = null; // { at, data }

async function fetchVaultFile(path) {
    const url = `https://api.github.com/repos/${VAULT_REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
    const resp = await fetch(url, {
        headers: {
            Accept: 'application/vnd.github.raw+json',
            Authorization: `Bearer ${process.env.VAULT_GITHUB_TOKEN}`,
            'User-Agent': 'consolenotebook-backend',
        },
    });
    if (!resp.ok) throw new Error(`GitHub ${resp.status} for ${path}`);
    return resp.text();
}

/** `[[path|alias]]` → alias, `[[a/b/Name]]` → Name. */
function linkLabel(inner) {
    const [target, alias] = inner.split('|');
    return (alias || target.split('/').pop()).trim();
}

/** Strips wikilinks/bold/code down to readable text. */
function plain(text) {
    return text
        .replace(/\[\[([^\]]+)\]\]/g, (_, inner) => linkLabel(inner))
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .trim();
}

/**
 * `## Section` headings → sections; `- [[link]] — description` bullets (any
 * indent; two spaces per level) → items. A bullet that doesn't start with a
 * link keeps its whole text as the name. Lines outside bullets are ignored.
 */
function parseIndex(md) {
    const sections = [];
    let current = null;
    for (const raw of md.replace(/\r/g, '').split('\n')) {
        const h = raw.match(/^##\s+(.+)$/);
        if (h) {
            current = { title: plain(h[1]), items: [] };
            sections.push(current);
            continue;
        }
        const b = raw.match(/^(\s*)-\s+(.+)$/);
        if (!b || !current) continue;
        const depth = Math.floor(b[1].replace(/\t/g, '  ').length / 2);
        const body = b[2];
        const link = body.match(/^\[\[([^\]]+)\]\]\s*(?:[—–-]\s*)?(.*)$/);
        if (link) {
            current.items.push({ name: linkLabel(link[1]), description: plain(link[2]) || null, depth });
        } else {
            current.items.push({ name: plain(body), description: null, depth });
        }
    }
    return sections.filter((s) => s.items.length);
}

// GET /api/personal/projects — { projects: [sections], archive: [sections] }
router.get('/projects', async (req, res) => {
    if (!process.env.VAULT_GITHUB_TOKEN) {
        return res.status(500).json({ success: false, error: 'VAULT_GITHUB_TOKEN not configured.' });
    }
    try {
        if (!cache || Date.now() - cache.at > CACHE_MS || req.query.refresh === '1') {
            const [projects, archive] = await Promise.all([
                fetchVaultFile(INDEX_PATHS.projects),
                fetchVaultFile(INDEX_PATHS.archive),
            ]);
            cache = { at: Date.now(), data: { projects: parseIndex(projects), archive: parseIndex(archive) } };
        }
        res.json({ success: true, ...cache.data });
    } catch (err) {
        console.error('Personal projects GET error:', err);
        res.status(502).json({ success: false, error: 'Could not read the vault index.' });
    }
});

module.exports = router;
module.exports._parseIndex = parseIndex; // exposed for a quick local check
