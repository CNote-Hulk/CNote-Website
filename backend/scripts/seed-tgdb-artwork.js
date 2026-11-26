/* ─────────────────────────────────────────
   FILE: seed-tgdb-artwork.js
   DESCRIPTION: Loads TheGamesDB's fanart and screenshots into `tgdb_artwork`
   (normalized title -> image file), so the profile-background search
   (routes/profileBackground.js) can offer them next to IGDB's artwork - IGDB often
   has only one or two landscape images for a game, TheGamesDB has fanart for
   ~13,600 games and screenshots for ~37,000.
   Replaces the table's contents (one transaction).

   Usage:
     curl -o db.json https://cdn.thegamesdb.net/json/database-latest.json
     node scripts/seed-tgdb-artwork.js db.json
   Needs DATABASE_URL in backend/.env.
   ───────────────────────────────────────── */
require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const { titleNorm } = require('../utils/titleNorm');

async function main() {
    const dumpPath = process.argv[2];
    if (!dumpPath) { console.error('Usage: node scripts/seed-tgdb-artwork.js db.json'); process.exit(1); }
    const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
    const boxart = dump.include.boxart.data;
    const rows = [];
    const seen = new Set();
    for (const g of dump.data.games) {
        const imgs = (boxart[String(g.id)] || []).filter(b => b.type === 'fanart' || b.type === 'screenshot');
        if (!imgs.length) continue;
        const norm = titleNorm(g.game_title);
        if (!norm) continue;
        for (const b of imgs) {
            if (!/^(fanart|screenshots?)\/\d+-\d+\.(jpg|png)$/.test(b.filename) || seen.has(b.filename)) continue;
            seen.add(b.filename);
            rows.push([norm, b.filename, b.type === 'fanart' ? 'fanart' : 'screenshot']);
        }
    }
    console.log('images', rows.length);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
    const c = await pool.connect();
    try {
        await c.query('BEGIN');
        await c.query(`CREATE TABLE IF NOT EXISTS tgdb_artwork (
            title_norm TEXT NOT NULL, file TEXT PRIMARY KEY, kind TEXT NOT NULL)`);
        await c.query('CREATE INDEX IF NOT EXISTS idx_tgdb_artwork_title ON tgdb_artwork(title_norm)');
        await c.query('DELETE FROM tgdb_artwork');
        for (let i = 0; i < rows.length; i += 5000) {
            const ch = rows.slice(i, i + 5000);
            await c.query(
                `INSERT INTO tgdb_artwork (title_norm, file, kind)
                 SELECT * FROM unnest($1::text[], $2::text[], $3::text[]) ON CONFLICT (file) DO NOTHING`,
                [ch.map(r => r[0]), ch.map(r => r[1]), ch.map(r => r[2])]);
        }
        await c.query('COMMIT');
        const { rows: n } = await c.query('SELECT COUNT(*)::int n, COUNT(DISTINCT title_norm)::int t FROM tgdb_artwork');
        console.log('loaded', n[0]);
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
