/* ─────────────────────────────────────────
   FILE: seed-games.js
   DESCRIPTION: Loads the Wikidata-derived games catalogue
   (games.jsonl) into `games` + `game_platforms`.

   Usage: node scripts/seed-games.js path/to/games.jsonl
   ───────────────────────────────────────── */
require('dotenv').config();
const fs = require('fs');
const readline = require('readline');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Wikidata's Q-id is the natural key, so a re-run updates titles and dates in
// place rather than growing a second copy of the catalogue. Nothing here is
// user data: a later run is always allowed to overwrite an earlier one.
const UPSERT_GAME = `
	INSERT INTO games (wikidata_id, title, release_year, developer, publisher)
	SELECT * FROM UNNEST($1::text[], $2::text[], $3::int[], $4::text[], $5::text[])
	ON CONFLICT (wikidata_id) DO UPDATE SET
		title        = EXCLUDED.title,
		release_year = EXCLUDED.release_year,
		developer    = EXCLUDED.developer,
		publisher    = EXCLUDED.publisher
	RETURNING id, wikidata_id`;

const LINK = `
	INSERT INTO game_platforms (game_id, console_id)
	SELECT * FROM UNNEST($1::int[], $2::text[])
	ON CONFLICT DO NOTHING`;

// Big enough that 40k games is a few hundred round trips, small enough to stay
// well under Postgres' 65535 bound parameters per statement (5 arrays here).
const BATCH = 500;

async function flush(rows) {
	if (!rows.length) return 0;
	const ids = await pool.query(UPSERT_GAME, [
		rows.map(r => r.wikidata_id),
		rows.map(r => r.title),
		rows.map(r => r.release_year ?? null),
		rows.map(r => r.developer ?? null),
		rows.map(r => r.publisher ?? null),
	]);

	// RETURNING comes back in whatever order the upsert chose, so the links are
	// keyed off wikidata_id rather than off the row's position in the batch.
	const byQid = new Map(ids.rows.map(r => [r.wikidata_id, r.id]));
	const gameIds = [];
	const consoleIds = [];
	for (const r of rows) {
		const id = byQid.get(r.wikidata_id);
		if (!id) continue;
		for (const c of r.consoles) { gameIds.push(id); consoleIds.push(c); }
	}
	if (gameIds.length) await pool.query(LINK, [gameIds, consoleIds]);
	return rows.length;
}

(async () => {
	const file = process.argv[2];
	if (!file || !fs.existsSync(file)) {
		console.error('Usage: node scripts/seed-games.js path/to/games.jsonl');
		process.exit(1);
	}

	let batch = [];
	let done = 0;
	const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
	for await (const line of rl) {
		if (!line.trim()) continue;
		batch.push(JSON.parse(line));
		if (batch.length >= BATCH) {
			done += await flush(batch);
			batch = [];
			process.stdout.write(`\r${done} games`);
		}
	}
	done += await flush(batch);

	const [games, links] = await Promise.all([
		pool.query('SELECT COUNT(*)::int AS n FROM games'),
		pool.query('SELECT COUNT(*)::int AS n FROM game_platforms'),
	]);
	console.log(`\nloaded ${done} rows -> ${games.rows[0].n} games, ${links.rows[0].n} platform links`);
	await pool.end();
})().catch(err => { console.error(err); process.exit(1); });
