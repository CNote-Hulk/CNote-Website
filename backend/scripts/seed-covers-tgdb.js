/* ─────────────────────────────────────────
   FILE: seed-covers-tgdb.js
   DESCRIPTION: Replaces IGDB key art with real box scans from TheGamesDB, so a
   console's shelf shows the boxes as they were sold (PS3 band, Xbox 360 green
   header...) instead of a mix of box scans and platform-less artwork.

   Why: IGDB has one cover per game, shared by every platform, and it is usually
   the poster art, not a box. libretro has real boxes but almost nothing for the
   modern consoles. TheGamesDB keeps one entry per platform release, each with
   its own front box scan, and publishes its whole database as one JSON file.

   Touches only rows whose cover is missing or came from IGDB (`igdb:` keys, or
   the `.jpg` objects those were mirrored to). libretro boxes are left alone -
   they already are box scans. Writes `tgdb:<file>`; routes/games.js mirrors it
   into R2 under a separate name on first view.

   Matching is per platform and on the normalized title (or one of TheGamesDB's
   alternate titles). When the same title exists more than once on a platform,
   the release year decides. Region preference: USA (the same as the libretro
   boxes already on the site), then PAL, then the rest.

   Usage:
     curl -o db.json https://cdn.thegamesdb.net/json/database-latest.json
     node scripts/seed-covers-tgdb.js db.json            # dry run → os.tmpdir()/seed-covers-tgdb.json
     node scripts/seed-covers-tgdb.js db.json --apply
   Optional TGDB_DIMS=dims.json ({"<file>": [w, h]}): on the store-era consoles only
   portrait scans (h/w >= 1.15, 1.08 for the ~1.14 Blu-ray boxes) are used - TheGamesDB stores the wide store banner as "front boxart" for some
   digital-only games, which looks worse on a shelf than IGDB's poster. Files
   without known size are listed in os.tmpdir()/seed-covers-tgdb-need-dims.json.
   Needs DATABASE_URL in backend/.env.
   ───────────────────────────────────────── */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');

// TheGamesDB platform id(s) for each console id of ours.
const TGDB_PLATFORMS = {
	'xbox-360': [15], 'xbox-one': [4920], 'xbox-series-x': [4981], 'xbox-series-s': [4981],
	'playstation-3': [12], 'playstation-4': [4919], 'playstation-5': [4980],
	'nintendo-switch': [4971], 'nintendo-switch-2': [5021], 'nintendo-wii-u': [38],
	'nintendo-3ds': [4912], 'ps-vita': [39], 'playstation-1': [10], 'playstation-2': [11],
	'psp': [13], 'nintendo-ds': [8], 'nintendo-wii': [9], 'nintendo-gamecube': [2], 'xbox': [14],
	'nintendo-64': [3], 'snes': [6], 'nes': [7], 'game-boy': [4], 'game-boy-color': [41],
	'game-boy-advance': [5], 'sega-genesis': [18, 36], 'sega-master-system': [35],
	'sega-game-gear': [20], 'sega-saturn': [17], 'sega-dreamcast': [16], 'pc-engine': [34],
	'neo-geo-aes': [24], 'atari-2600': [22], 'atari-5200': [26], 'atari-7800': [27],
	'atari-lynx': [4924], 'atari-jaguar': [28], '3do': [25], 'philips-cd-i': [4917],
	'wonderswan': [4925], 'colecovision': [31], 'intellivision': [32], 'sega-sg-1000': [4949],
	'neo-geo-pocket-color': [4923], 'vectrex': [4939],
};

const ROMAN = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
const norm = s => String(s).toLowerCase()
	.replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&')
	.normalize('NFKD').replace(/[̀-ͯ]/g, '')
	.replace(/[’‘`]/g, "'")
	.replace(/[·–—]/g, ' ')
	.replace(/&/g, ' and ')
	.replace(/\b(the|a|an)\b/g, ' ')
	.replace(/[^a-z0-9]+/g, ' ')
	.trim()
	.split(' ').map(w => ROMAN[w] || w).join(' ');

// Lower is better. USA first (same as the libretro boxes), generic PAL next,
// country-specific PAL, unknown region, Japan last.
function regionRank(g) {
	if ((g.region_id === 1 || g.region_id === 2) && (g.country_id === 50 || g.country_id === 0)) return 0;
	if (g.region_id === 1 || g.region_id === 2) return 3;
	if (g.region_id === 6 && g.country_id === 0) return 1;
	if (g.region_id === 6 || g.region_id === 8) return 2;
	if (g.region_id === 0) return 4;
	if (g.region_id === 4) return 6;
	return 5;
}

const DIMS = process.env.TGDB_DIMS ? JSON.parse(fs.readFileSync(process.env.TGDB_DIMS, 'utf8')) : null;
// Only the consoles with a digital store get banner-shaped "boxart"; SNES, N64,
// Game Boy and GBA boxes are genuinely wide or square, so they are not filtered.
const STORE_ERA = new Set([15, 4920, 4981, 12, 4919, 4980, 4971, 5021, 38, 4912, 39, 9, 13]);
// Blu-ray cases (PS3/PS4/PS5) are only ~1.14 tall; everything else with a store is >= 1.15.
const BLU_RAY = new Set([12, 4919, 4980]);
const isPortrait = (file, platform) => {
	const d = DIMS && DIMS[file];
	if (!d) return false;
	return !STORE_ERA.has(platform) || d[1] / d[0] >= (BLU_RAY.has(platform) ? 1.08 : 1.15);
};

const yearOf = g => (g.release_date ? parseInt(g.release_date.slice(0, 4), 10) : null);

async function main() {
	const [dumpPath, flag] = process.argv.slice(2);
	if (!dumpPath) { console.error('Usage: node scripts/seed-covers-tgdb.js db.json [--apply]'); process.exit(1); }
	const apply = flag === '--apply';

	const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
	const boxart = dump.include.boxart.data;
	const front = id => {
		const b = (boxart[String(id)] || []).find(x => x.type === 'boxart' && x.side === 'front');
		return b ? b.filename : null;
	};

	// platform id → normalized title → [releases with a front scan]
	const index = new Map();
	for (const g of dump.data.games) {
		const file = front(g.id);
		if (!file) continue;
		if (!index.has(g.platform)) index.set(g.platform, new Map());
		const byTitle = index.get(g.platform);
		const titles = new Set([norm(g.game_title), ...(g.alternates || []).map(norm)]);
		for (const t of titles) {
			if (!t) continue;
			if (!byTitle.has(t)) byTitle.set(t, []);
			byTitle.get(t).push({ ...g, file });
		}
	}

	const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
	const { rows } = await pool.query(`
		SELECT gp.game_id, gp.console_id, gp.cover_key, g.title, g.release_year
		  FROM game_platforms gp JOIN games g ON g.id = gp.game_id
		 WHERE gp.cover_key IS NULL
		    OR gp.cover_key LIKE 'igdb:%'
		    OR (gp.cover_key LIKE 'game-covers/%.jpg' AND gp.cover_key NOT LIKE '%-tgdb.jpg')`);

	const matches = [];
	const needDims = new Set();
	const stats = { candidates: rows.length, matched: 0, ambiguous: 0, noPlatform: 0 };
	for (const r of rows) {
		const plats = TGDB_PLATFORMS[r.console_id];
		if (!plats) { stats.noPlatform++; continue; }
		const t = norm(r.title);
		let hits = [];
		for (const p of plats) hits.push(...((index.get(p) && index.get(p).get(t)) || []));
		if (!hits.length) continue;
		if (DIMS) {
			for (const h of hits) if (!DIMS[h.file]) needDims.add(h.file);
			hits = hits.filter(h => isPortrait(h.file, h.platform));
			if (!hits.length) continue;
		} else {
			for (const h of hits) needDims.add(h.file);
		}

		// Same title, several different games on one platform (Doom 1993 vs Doom 2016):
		// keep the ones released within a year of ours. Re-releases come out years
		// later, so a single cluster of years is accepted even when it is far off.
		if (r.release_year) {
			const near = hits.filter(h => yearOf(h) && Math.abs(yearOf(h) - r.release_year) <= 1);
			if (near.length) hits = near;
			else {
				const ys = hits.map(yearOf).filter(Boolean);
				if (ys.length && Math.max(...ys) - Math.min(...ys) > 2) { stats.ambiguous++; continue; }
			}
		}
		hits.sort((a, b) => regionRank(a) - regionRank(b) || a.id - b.id);
		const best = hits[0];
		matches.push({
			game_id: r.game_id, console_id: r.console_id, title: r.title, old: r.cover_key,
			tgdb_id: best.id, tgdb_title: best.game_title, region: best.region_id,
			key: 'tgdb:' + path.basename(best.file),
		});
	}
	stats.matched = matches.length;
	const out = path.join(os.tmpdir(), 'seed-covers-tgdb.json');
	fs.writeFileSync(out, JSON.stringify(matches, null, 1));
	console.log(stats, '→', out);
	fs.writeFileSync(path.join(os.tmpdir(), 'seed-covers-tgdb-need-dims.json'), JSON.stringify([...needDims]));
	console.log('files without known size:', needDims.size);

	if (apply) {
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			for (const m of matches) {
				await client.query(
					'UPDATE game_platforms SET cover_key = $1 WHERE game_id = $2 AND console_id = $3',
					[m.key, m.game_id, m.console_id]);
			}
			await client.query('COMMIT');
			console.log('applied', matches.length);
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
