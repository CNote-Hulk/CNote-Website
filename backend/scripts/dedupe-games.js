/* ─────────────────────────────────────────
   FILE: dedupe-games.js
   DESCRIPTION: Removes the same game listed twice on one console.

   Why: the catalogue was built from Wikidata, which often has one item for a
   work and another for one of its ports ("Army Men: Sarge's Heroes 2" twice
   on Game Boy Color), plus later TheGamesDB/IGDB additions spelled slightly
   differently ("Soul Reaver 1-2" / "1&2"). On a shelf picker that is the same
   box twice.

   Rule, per console: titles equal after normalization (seed-releases-tgdb.js's
   norm: case, accents, punctuation, "the", roman numerals) AND release years
   within 1 of each other (or unknown). Years further apart are left alone -
   they are often genuinely different games (Famicom "Star Wars" 1987 Namco vs
   1991 JVC, Airwolf JP vs US).

   Kept row, in order: owned by someone on that console, real box scan (tgdb /
   mirrored), any cover, a Wikidata Q-id, more consoles, lower id. The others
   lose that console link; their owners are moved to the kept row; a cover is
   carried over if the kept row has none; a game left with no console and no
   owner is deleted.

   Usage:
     node scripts/dedupe-games.js            # dry run, prints a sample
     node scripts/dedupe-games.js --apply    # writes a JSON backup first (BACKUP_DIR, default ~/cnote-backups)
   Needs DATABASE_URL in backend/.env.
   ───────────────────────────────────────── */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');

const rel = fs.readFileSync(path.join(__dirname, 'seed-releases-tgdb.js'), 'utf8');
const helpers = {};
new Function('module', rel.match(/const ROMAN[\s\S]*?const NOT_A_GAME[^\n]*/)[0] + ';module.exports={norm};')({ set exports(v) { Object.assign(helpers, v); } });
const { norm } = helpers;

const realScan = k => !!k && (k.startsWith('tgdb:') || k.includes('-tgdb.') || k.startsWith('libretro:') || /game-covers\/.*\.png$/.test(k));

async function main() {
	const apply = process.argv.includes('--apply');
	const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
	const { rows } = await pool.query(`
		SELECT gp.console_id, gp.cover_key, g.id, g.title, g.release_year, g.wikidata_id,
		       (SELECT count(*) FROM game_platforms x WHERE x.game_id = g.id)::int AS consoles,
		       EXISTS (SELECT 1 FROM user_games u WHERE u.game_id = g.id AND u.console_id = gp.console_id) AS owned
		FROM games g JOIN game_platforms gp ON gp.game_id = g.id`);

	const groups = new Map();
	for (const r of rows) {
		const k = r.console_id + '|' + norm(r.title);
		if (!groups.has(k)) groups.set(k, []);
		groups.get(k).push(r);
	}
	const score = r => [r.owned ? 1 : 0, realScan(r.cover_key) ? 1 : 0, r.cover_key ? 1 : 0, /^Q\d+$/.test(r.wikidata_id || '') ? 1 : 0, r.consoles, -r.id];
	const better = (a, b) => { const x = score(a), y = score(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

	const actions = []; // { console_id, keep, drop, coverFrom }
	for (const g of groups.values()) {
		if (g.length < 2) continue;
		// Clusters of rows whose years are all within 1 (unknown years join any cluster).
		const pending = [...g];
		while (pending.length) {
			const seed = pending.shift();
			const cluster = [seed];
			for (let i = pending.length - 1; i >= 0; i--) {
				const r = pending[i];
				if (cluster.every(c => c.release_year == null || r.release_year == null || Math.abs(c.release_year - r.release_year) <= 1)) {
					cluster.push(r); pending.splice(i, 1);
				}
			}
			if (cluster.length < 2) continue;
			const keep = cluster.reduce((a, b) => (better(b, a) ? b : a));
			const bestCover = cluster.filter(r => r.cover_key).reduce((a, b) => (!a || better(b, a) ? b : a), null);
			for (const r of cluster) if (r !== keep) actions.push({ console_id: r.console_id, keep, drop: r, coverFrom: !keep.cover_key && bestCover ? bestCover.cover_key : null });
		}
	}
	console.log('duplicate console links:', actions.length);
	for (const a of actions.sort(() => Math.random() - 0.5).slice(0, 25)) {
		console.log(`  ${a.console_id}: keep ${a.keep.id} "${a.keep.title}" (${a.keep.release_year}) · drop ${a.drop.id} "${a.drop.title}" (${a.drop.release_year})`);
	}
	if (!apply) { await pool.end(); return; }

	const dir = process.env.BACKUP_DIR || path.join(os.homedir(), 'cnote-backups');
	fs.mkdirSync(dir, { recursive: true });
	const touched = [...new Set(actions.flatMap(a => [a.keep.id, a.drop.id]))];
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const bk = {
			games: (await client.query('SELECT * FROM games WHERE id = ANY($1)', [touched])).rows,
			game_platforms: (await client.query('SELECT * FROM game_platforms WHERE game_id = ANY($1)', [touched])).rows,
			user_games: (await client.query('SELECT * FROM user_games WHERE game_id = ANY($1)', [touched])).rows,
		};
		const file = path.join(dir, `dedupe-games-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
		fs.writeFileSync(file, JSON.stringify(bk));
		console.log('backup →', file);
		let moved = 0;
		for (const a of actions) {
			moved += (await client.query('UPDATE user_games SET game_id = $1 WHERE game_id = $2 AND console_id = $3', [a.keep.id, a.drop.id, a.console_id])).rowCount;
			if (a.coverFrom) await client.query('UPDATE game_platforms SET cover_key = $1 WHERE game_id = $2 AND console_id = $3 AND cover_key IS NULL', [a.coverFrom, a.keep.id, a.console_id]);
			await client.query('DELETE FROM game_platforms WHERE game_id = $1 AND console_id = $2', [a.drop.id, a.console_id]);
		}
		const gone = await client.query(`DELETE FROM games g WHERE g.id = ANY($1)
			AND NOT EXISTS (SELECT 1 FROM game_platforms gp WHERE gp.game_id = g.id)
			AND NOT EXISTS (SELECT 1 FROM user_games u WHERE u.game_id = g.id)`, [[...new Set(actions.map(a => a.drop.id))]]);
		await client.query('COMMIT');
		console.log({ linksRemoved: actions.length, ownersMoved: moved, gamesDeleted: gone.rowCount });
	} catch (e) {
		await client.query('ROLLBACK');
		throw e;
	} finally {
		client.release();
	}
	await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
