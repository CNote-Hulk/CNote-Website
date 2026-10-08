/* ─────────────────────────────────────────
   FILE: seed-covers-igdb.js
   DESCRIPTION: Fills box art for the consoles libretro does not
   cover (the modern ones), using IGDB.

   Needs IGDB_CLIENT_ID and IGDB_CLIENT_SECRET in .env — a Twitch
   application, created at https://dev.twitch.tv/console/apps.

   Usage: node scripts/seed-covers-igdb.js [--apply] [console-slug ...]
   ───────────────────────────────────────── */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// The ones libretro leaves empty: it mirrors what emulators support, so it has 8,500 scans for the
// PS2 and twelve for the whole Xbox 360. IGDB is the other way round.
const DEFAULT_CONSOLES = [
	'xbox-360', 'xbox-one', 'xbox-series-x', 'xbox-series-s',
	'playstation-3', 'playstation-4', 'playstation-5',
	'nintendo-switch', 'nintendo-switch-2', 'nintendo-wii-u', 'nintendo-3ds', 'ps-vita',
];

// What IGDB calls each one. Only the names - the numeric ids are looked up below rather than
// hardcoded, because a wrong platform id silently fills a console's shelf with another console's
// covers and nothing about the result looks broken.
const IGDB_NAMES = {
	'xbox-360': 'Xbox 360',
	'xbox-one': 'Xbox One',
	'xbox-series-x': 'Xbox Series X|S',
	'xbox-series-s': 'Xbox Series X|S',
	'playstation-3': 'PlayStation 3',
	'playstation-4': 'PlayStation 4',
	'playstation-5': 'PlayStation 5',
	'nintendo-switch': 'Nintendo Switch',
	'nintendo-switch-2': 'Nintendo Switch 2',
	'nintendo-wii-u': 'Wii U',
	'nintendo-3ds': 'Nintendo 3DS',
	'ps-vita': 'PlayStation Vita',
};

const norm = s => String(s).toLowerCase()
	.replace(/[·–—]/g, ' ')
	.replace(/&/g, ' and ')
	.replace(/\b(the|a|an)\b/g, ' ')
	.replace(/[^a-z0-9]+/g, ' ')
	.trim();

async function token() {
	const id = process.env.IGDB_CLIENT_ID;
	const secret = process.env.IGDB_CLIENT_SECRET;
	if (!id || !secret) {
		console.error(
			'Missing IGDB_CLIENT_ID / IGDB_CLIENT_SECRET.\n' +
			'Create a Twitch application at https://dev.twitch.tv/console/apps, then put its\n' +
			'Client ID and Client Secret in backend/.env. Nothing else is needed.'
		);
		process.exit(1);
	}
	const r = await fetch(
		`https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`,
		{ method: 'POST' }
	);
	if (!r.ok) throw new Error(`Twitch token failed: ${r.status} ${await r.text()}`);
	return (await r.json()).access_token;
}

async function igdb(path, body, auth) {
	for (let attempt = 0; attempt < 5; attempt++) {
		const r = await fetch(`https://api.igdb.com/v4/${path}`, {
			method: 'POST',
			headers: {
				'Client-ID': process.env.IGDB_CLIENT_ID,
				Authorization: `Bearer ${auth}`,
				'Content-Type': 'text/plain',
			},
			body,
		});
		if (r.ok) return r.json();
		// 429 is the documented rate limit (4 requests/second); back off rather than give up.
		if (r.status !== 429 && r.status < 500) throw new Error(`IGDB ${path}: ${r.status} ${await r.text()}`);
		await new Promise(res => setTimeout(res, 500 * (attempt + 1)));
	}
	throw new Error(`IGDB ${path}: gave up after retries`);
}

(async () => {
	const apply = process.argv.includes('--apply');
	const wanted = process.argv.slice(2).filter(a => !a.startsWith('--'));
	const consoles = wanted.length ? wanted : DEFAULT_CONSOLES;
	const auth = await token();

	// Resolve the ids once, by name.
	const names = [...new Set(consoles.map(c => IGDB_NAMES[c]).filter(Boolean))];
	const platforms = await igdb('platforms',
		`fields id,name; where name = (${names.map(n => `"${n}"`).join(',')}); limit 100;`, auth);
	const byName = new Map(platforms.map(p => [p.name, p.id]));
	for (const n of names) {
		if (!byName.has(n)) console.warn(`  ! IGDB has no platform called "${n}" - skipping`);
	}

	let filled = 0;
	for (const consoleId of consoles) {
		const platformId = byName.get(IGDB_NAMES[consoleId]);
		if (!platformId) continue;

		// Everything IGDB has for this platform that actually has a cover, paged. Pulled whole and
		// matched locally for the same reason the Wikidata seed does: one query per title would be
		// thousands of round trips against a 4-per-second limit.
		const covers = new Map();
		for (let offset = 0; ; offset += 500) {
			const page = await igdb('games',
				`fields name,cover.image_id; where platforms = (${platformId}) & cover != null; ` +
				`limit 500; offset ${offset};`, auth);
			for (const g of page) {
				if (!g.cover || !g.cover.image_id) continue;
				const k = norm(g.name);
				if (!covers.has(k)) covers.set(k, g.cover.image_id);
			}
			if (page.length < 500) break;
			await new Promise(res => setTimeout(res, 300));
		}

		// Only rows that still have no cover at all - never overwrite a scan already in place.
		const rows = await pool.query(
			`SELECT g.id, g.title FROM game_platforms gp JOIN games g ON g.id = gp.game_id
			  WHERE gp.console_id = $1 AND gp.cover_key IS NULL`, [consoleId]);

		const ids = [], keys = [];
		for (const r of rows.rows) {
			const hit = covers.get(norm(r.title));
			if (!hit) continue;
			ids.push(r.id);
			keys.push('igdb:' + hit);
		}
		if (apply && ids.length) {
			await pool.query(
				`UPDATE game_platforms gp SET cover_key = v.key
				   FROM (SELECT * FROM UNNEST($1::int[], $2::text[]) AS t(game_id, key)) v
				  WHERE gp.game_id = v.game_id AND gp.console_id = $3`,
				[ids, keys, consoleId]);
		}
		filled += ids.length;
		console.log(`${consoleId.padEnd(20)} igdb has ${String(covers.size).padStart(5)}  ` +
			`uncovered ${String(rows.rowCount).padStart(5)}  matched ${String(ids.length).padStart(5)}`);
	}

	console.log(`\n${apply ? 'filled' : 'would fill'} ${filled} covers`);
	await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
