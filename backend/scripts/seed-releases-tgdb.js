/* ─────────────────────────────────────────
   FILE: seed-releases-tgdb.js
   DESCRIPTION: Adds the boxed releases the Wikidata catalogue does not have -
   editions (Platinum / Greatest Hits / Classics / Essentials, Game of the Year,
   Collector's, Limited, Steelbook), map and track packs, bonus discs, bundles,
   compilations - and any plain game missing on a console, from TheGamesDB.

   Why: a shelf holds what was sold, and a "Halo 2 Multiplayer Map Pack" or a
   "GTA: San Andreas [Platinum Hits]" is its own box with its own cover.
   Wikidata models works, not releases, so it has none of these.

   What it does, per console:
     - TheGamesDB releases with a front scan (portrait on the store-era consoles,
       TGDB_DIMS - see seed-covers-tgdb.js) are grouped by normalized title, so the US, PAL and
       German copies of one edition become one entry;
     - a group is skipped when the console already has that title (also
       compared without "Tom Clancy's" / "Disney's"-style prefixes, and against
       TheGamesDB's alternate titles), so nothing already listed is duplicated;
     - the rest is added: linked to an existing `games` row when exactly one
       game has that title (it then just gains this console), otherwise as a new
       row with wikidata_id "tgdb:<id>" - so everything this script created can
       be found, and removed, with `wikidata_id LIKE 'tgdb:%'`.
   Cover: the same region preference as seed-covers-tgdb.js (USA, PAL, rest).

   Usage:
     TGDB_DIMS=dims.json node scripts/seed-releases-tgdb.js db.json           # dry run → os.tmpdir()/seed-releases-tgdb.json
     TGDB_DIMS=dims.json node scripts/seed-releases-tgdb.js db.json --apply
     [TGDB_DUMP=db.json] node scripts/seed-releases-tgdb.js - --apply --plan <plan.json>   # apply a saved/deduped plan (TGDB_DUMP re-checks it for unofficial releases)
   Needs DATABASE_URL in backend/.env.
   ───────────────────────────────────────── */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');

const covers = fs.readFileSync(path.join(__dirname, 'seed-covers-tgdb.js'), 'utf8');
// One table of platform ids, kept in seed-covers-tgdb.js.
const TGDB_PLATFORMS = eval('(' + covers.match(/const TGDB_PLATFORMS = (\{[\s\S]*?\});/)[1] + ')');

const ROMAN = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
const unescape = s => String(s)
	.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
	.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
	.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
	.replace(/&amp;/g, '&');
const norm = s => unescape(s).toLowerCase()
	.normalize('NFKD').replace(/[̀-ͯ]/g, '')
	.replace(/[’‘`]/g, "'")
	.replace(/[·–—]/g, ' ')
	.replace(/&/g, ' and ')
	.replace(/\b(the|a|an)\b/g, ' ')
	.replace(/[^a-z0-9]+/g, ' ')
	.trim()
	.split(' ').map(w => ROMAN[w] || w).join(' ');
// Looser key, only for "is this already listed?": drops brand prefixes that one
// source writes and the other does not.
const PREFIX = /^(tom clancy s|sid meier s|disney pixar|disney s|disney|marvel s|dreamworks|nickelodeon|clive barker s|american mcgee s|james cameron s|peter jackson s|robert ludlum s|bram stoker s|tim burton s) /;
const loose = s => norm(s).replace(PREFIX, '').replace(/ (video game|game)$/, '')
	.replace(/^fifa (soccer|football) /, 'fifa ');

// "Title [Platinum Hits] " → "Title (Platinum Hits)"; region tags go - the
// region is a property of the box, not part of the game's name.
const REGION_TAG = /\s*-?\s*[([](PAL|NTSC(-[UJ])?|USA|US|EU|EUR|Europe|UK|JP|JPN|Japan)[)\]]/gi;
const display = s => unescape(s).replace(REGION_TAG, '')
	.replace(/\s*\[([^\]]+)\]\s*/g, ' ($1)').replace(/\s+/g, ' ').replace(/\s*-\s*$/, '').trim();
// Films on UMD / Game Boy Advance cartridges: physical, but not games.
const NOT_A_GAME = /^(umd video|game boy advance video)\b/i;
// Fan-made ROM hacks / translations / homebrew: TheGamesDB lists them with
// fan art, but there is no retail box (".hack//" games are kept).
const FAN_MADE = /(?<![.\w])hack\b|rom ?hack|\b(fan|english) translation|\(homebrew\)|^homebrew\b/i;
// TheGamesDB genre 28 = hacks, bootlegs and other unofficial releases; genre
// 29 = films/video (UMD Video, GBA Video) - not games. Hacks
// it did not tag still give themselves away: no publisher, no developer, and
// the name of a franchise people hack.
const HACKED_FRANCHISE = /^(pok[eé]mon|mario|super mario|sonic|zelda|the legend of zelda|mega ?man|rockman|fire emblem|final fantasy|kirby|metroid|donkey kong|street fighter|castlevania)\b/i;
const unofficial = g => (g.genres || []).includes(28) || (g.genres || []).includes(29) ||
	(!(g.publishers || []).length && !(g.developers || []).length && HACKED_FRANCHISE.test(display(g.game_title)));

function regionRank(g) {
	if ((g.region_id === 1 || g.region_id === 2) && (g.country_id === 50 || g.country_id === 0)) return 0;
	if (g.region_id === 1 || g.region_id === 2) return 3;
	if (g.region_id === 6 && g.country_id === 0) return 1;
	if (g.region_id === 6 || g.region_id === 8) return 2;
	if (g.region_id === 0) return 4;
	if (g.region_id === 4) return 6;
	return 5;
}
// 1970-01-01 is TheGamesDB's "unknown date".
const yearOf = g => {
	const y = g.release_date ? parseInt(g.release_date.slice(0, 4), 10) : null;
	return y && y > 1971 ? y : null;
};

async function main() {
	const [dumpPath, ...flags] = process.argv.slice(2);
	const apply = flags.includes('--apply');
	const planArg = flags.includes('--plan') ? flags[flags.indexOf('--plan') + 1] : null;
	if (planArg) return applyPlan(JSON.parse(fs.readFileSync(planArg, 'utf8')), apply);
	if (!dumpPath || !process.env.TGDB_DIMS) {
		console.error('Usage: TGDB_DIMS=dims.json node scripts/seed-releases-tgdb.js db.json [--apply]');
		process.exit(1);
	}
	const DIMS = JSON.parse(fs.readFileSync(process.env.TGDB_DIMS, 'utf8'));
	const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
	const boxart = dump.include.boxart.data;
	const STORE_ERA = new Set([15, 4920, 4981, 12, 4919, 4980, 4971, 5021, 38, 4912, 39, 9, 13]);
// Blu-ray cases (PS3/PS4/PS5) are only ~1.14 tall; everything else with a store is >= 1.15.
const BLU_RAY = new Set([12, 4919, 4980]);
	const portraitFront = (id, platform) => {
		const b = (boxart[String(id)] || []).find(x => x.type === 'boxart' && x.side === 'front');
		const d = b && DIMS[b.filename];
		if (!d) return null;
		return !STORE_ERA.has(platform) || d[1] / d[0] >= (BLU_RAY.has(platform) ? 1.08 : 1.15) ? b.filename : null;
	};

	const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
	const { rows: ours } = await pool.query(
		'SELECT g.id, g.title, gp.console_id FROM games g LEFT JOIN game_platforms gp ON gp.game_id = g.id');
	const listed = new Map(); // console → Set(norm + loose titles)
	const gamesByTitle = new Map(); // norm title → Set(game id)
	for (const r of ours) {
		const n = norm(r.title);
		if (!gamesByTitle.has(n)) gamesByTitle.set(n, new Set());
		gamesByTitle.get(n).add(r.id);
		if (!r.console_id) continue;
		if (!listed.has(r.console_id)) listed.set(r.console_id, new Set());
		listed.get(r.console_id).add(n).add(loose(r.title));
	}

	// norm title → { title, year, tgdbIds, platforms: { console: release } }
	const additions = new Map();
	const consoleOf = new Map();
	for (const [consoleId, plats] of Object.entries(TGDB_PLATFORMS)) for (const p of plats) {
		if (!consoleOf.has(p)) consoleOf.set(p, []);
		consoleOf.get(p).push(consoleId);
	}
	for (const g of dump.data.games) {
		const consoles = consoleOf.get(g.platform);
		if (!consoles) continue;
		const file = portraitFront(g.id, g.platform);
		if (!file) continue;
		const title = display(g.game_title);
		const key = norm(title);
		if (!key || NOT_A_GAME.test(title) || FAN_MADE.test(title) || unofficial(g)) continue;
		const names = [title, ...(g.alternates || [])];
		for (const consoleId of consoles) {
			const have = listed.get(consoleId) || new Set();
			if (names.some(n => have.has(norm(n)) || have.has(loose(n)))) continue;
			if (!additions.has(key)) additions.set(key, { title, year: null, tgdbIds: [], platforms: {} });
			const a = additions.get(key);
			const y = yearOf(g);
			if (y && (!a.year || y < a.year)) a.year = y;
			a.tgdbIds.push(g.id);
			const cur = a.platforms[consoleId];
			if (!cur || regionRank(g) < regionRank(cur) || (regionRank(g) === regionRank(cur) && g.id < cur.id)) {
				a.platforms[consoleId] = { id: g.id, region_id: g.region_id, country_id: g.country_id, file };
				// the display title follows the preferred region's spelling
				if (!cur || regionRank(g) < regionRank(cur)) a.title = title;
			}
		}
	}

	const plan = [];
	for (const [key, a] of additions) {
		const existing = gamesByTitle.get(key);
		plan.push({
			title: a.title, year: a.year,
			link: existing && existing.size === 1 ? [...existing][0] : null,
			wikidata_id: 'tgdb:' + Math.min(...a.tgdbIds),
			platforms: Object.entries(a.platforms).map(([console_id, r]) => ({ console_id, key: 'tgdb:' + path.basename(r.file), tgdb_id: r.id })),
		});
	}
	const rowsTotal = plan.reduce((n, p) => n + p.platforms.length, 0);
	const out = path.join(os.tmpdir(), 'seed-releases-tgdb.json');
	fs.writeFileSync(out, JSON.stringify(plan, null, 1));
	console.log({ newGames: plan.filter(p => !p.link).length, linkedToExisting: plan.filter(p => p.link).length, platformRows: rowsTotal }, '→', out);
	await pool.end();
	return applyPlan(plan, apply);
}

// A plan is what the dry run writes (optionally filtered by dedupe-releases-igdb.js).
async function applyPlan(plan, apply) {
	// Plans written before a filter existed: re-check them against the dump when it is at hand.
	if (process.env.TGDB_DUMP) {
		const byId = new Map(JSON.parse(fs.readFileSync(process.env.TGDB_DUMP, 'utf8')).data.games.map(g => [g.id, g]));
		plan = plan.map(p => ({ ...p, platforms: p.platforms.filter(pl => !byId.has(pl.tgdb_id) || !unofficial(byId.get(pl.tgdb_id))) }))
			.filter(p => p.platforms.length);
	}
	const fan = plan.filter(p => FAN_MADE.test(p.title));
	if (fan.length) console.log('skipping', fan.length, 'fan-made entries, e.g.', fan.slice(0, 5).map(p => p.title));
	plan = plan.filter(p => !FAN_MADE.test(p.title));
	const rowsTotal = plan.reduce((n, p) => n + p.platforms.length, 0);
	console.log('plan:', plan.length, 'entries,', rowsTotal, 'platform rows', apply ? '' : '(dry run)');
	if (!apply) return;
	const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
	{
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			// Bulk, in chunks: one round trip per 2000 rows instead of one per row.
			const idOf = new Map();
			const fresh = plan.filter(p => !p.link);
			for (let k = 0; k < fresh.length; k += 2000) {
				const c = fresh.slice(k, k + 2000);
				const r = await client.query(
					`INSERT INTO games (wikidata_id, title, release_year)
					 SELECT * FROM unnest($1::text[], $2::text[], $3::int[])
					 ON CONFLICT (wikidata_id) DO UPDATE SET title = EXCLUDED.title RETURNING id, wikidata_id`,
					[c.map(p => p.wikidata_id), c.map(p => p.title), c.map(p => p.year)]);
				for (const row of r.rows) idOf.set(row.wikidata_id, row.id);
			}
			const rows = plan.flatMap(p => p.platforms.map(pl => [p.link || idOf.get(p.wikidata_id), pl.console_id, pl.key]));
			for (let k = 0; k < rows.length; k += 2000) {
				const c = rows.slice(k, k + 2000);
				await client.query(
					`INSERT INTO game_platforms (game_id, console_id, cover_key)
					 SELECT * FROM unnest($1::int[], $2::text[], $3::text[])
					 ON CONFLICT (game_id, console_id) DO NOTHING`,
					[c.map(x => x[0]), c.map(x => x[1]), c.map(x => x[2])]);
			}
			await client.query('COMMIT');
			console.log('applied', plan.length, 'entries,', rowsTotal, 'platform rows');
		} catch (e) {
			await client.query('ROLLBACK');
			throw e;
		} finally {
			client.release();
		}
	}
	await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
