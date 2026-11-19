/* ─────────────────────────────────────────
   FILE: fill-missing-covers.js
   DESCRIPTION: Second pass over every game_platforms row that still has no box art, on
   every console, using IGDB. Written 2026-11-19 after popular titles (Call of Duty 4 on
   PS3, Saints Row on X360...) turned out to be missing even though IGDB has them.

   Why seed-covers-igdb.js missed them: it paged IGDB without a `sort`, and IGDB's paging
   is not stable without one, so pages overlapped and whole runs of games were never seen.
   It also matched on the exact title only and was never run for the retro consoles.

   Two passes, cheapest-to-trust first:
     1. By identity: Wikidata stores each game's IGDB slug (P5794). Our rows carry the
        Wikidata Q-id, so Q-id -> slug -> IGDB cover needs no title matching at all.
     2. By title, per platform: the platform's whole IGDB list (sorted, so paging is
        stable), indexed under the main name, every alternative name and every regional
        name (PAL titles like "Conflict: Global Storm"). Roman numerals are folded to
        digits on both sides.
   Only ever writes rows whose cover_key IS NULL - never replaces a cover in place.

   Run 2026-11-19: 15,742 uncovered -> 11,186 candidates (10,470 by identity, 716 by title).
   The dry-run output (os.tmpdir()/fill-missing-covers.json) was then checked against the
   IGDB name of each cover's game: where our title and that name were < 0.6 similar, the
   match was kept only if our title is one of that game's alternative/regional names, or
   one title is the other plus a subtitle. 10,950 were applied, 4,792 rows still uncovered.
   Most of the rest are not games (series, engines, achievements, accessories - see STATUS).

   Usage: node scripts/fill-missing-covers.js [--apply] [console-slug ...]
   Needs DATABASE_URL, IGDB_CLIENT_ID, IGDB_CLIENT_SECRET in backend/.env.
   ───────────────────────────────────────── */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Our console slug -> IGDB platform name (ids resolved by name at start, never hardcoded:
// a wrong id silently files one console's covers under another).
const IGDB_NAMES = {
	'xbox-360': 'Xbox 360', 'xbox-one': 'Xbox One', 'xbox-series-x': 'Xbox Series X|S', 'xbox-series-s': 'Xbox Series X|S',
	'playstation-3': 'PlayStation 3', 'playstation-4': 'PlayStation 4', 'playstation-5': 'PlayStation 5',
	'nintendo-switch': 'Nintendo Switch', 'nintendo-switch-2': 'Nintendo Switch 2', 'nintendo-wii-u': 'Wii U',
	'nintendo-3ds': 'Nintendo 3DS', 'ps-vita': 'PlayStation Vita',
	'playstation-1': 'PlayStation', 'playstation-2': 'PlayStation 2', 'psp': 'PlayStation Portable',
	'nintendo-ds': 'Nintendo DS', 'nintendo-wii': 'Wii', 'nintendo-gamecube': 'Nintendo GameCube', 'xbox': 'Xbox',
	'nintendo-64': 'Nintendo 64', 'snes': 'Super Nintendo Entertainment System', 'nes': 'Nintendo Entertainment System',
	'famicom': 'Family Computer', 'game-boy': 'Game Boy', 'game-boy-color': 'Game Boy Color',
	'game-boy-advance': 'Game Boy Advance', 'sega-genesis': 'Sega Mega Drive/Genesis',
	'sega-master-system': 'Sega Master System/Mark III', 'sega-game-gear': 'Sega Game Gear',
	'sega-saturn': 'Sega Saturn', 'sega-dreamcast': 'Dreamcast', 'pc-engine': 'TurboGrafx-16/PC Engine',
	'neo-geo-aes': 'Neo Geo AES', 'atari-2600': 'Atari 2600', 'atari-5200': 'Atari 5200', 'atari-7800': 'Atari 7800',
	'atari-lynx': 'Atari Lynx', 'atari-jaguar': 'Atari Jaguar', '3do': '3DO Interactive Multiplayer',
	'philips-cd-i': 'Philips CD-i', 'wonderswan': 'WonderSwan', 'colecovision': 'ColecoVision',
	'intellivision': 'Intellivision', 'sega-sg-1000': 'SG-1000', 'neo-geo-pocket': 'Neo Geo Pocket',
	'neo-geo-pocket-color': 'Neo Geo Pocket Color', 'vectrex': 'Vectrex', 'magnavox-odyssey': 'Odyssey',
};

const ROMAN = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
const norm = s => String(s).toLowerCase()
	.normalize('NFKD').replace(/[̀-ͯ]/g, '')
	.replace(/[’‘`]/g, "'")
	.replace(/[·–—]/g, ' ')
	.replace(/&/g, ' and ')
	.replace(/\b(the|a|an)\b/g, ' ')
	.replace(/[^a-z0-9]+/g, ' ')
	.trim()
	.split(' ').map(w => ROMAN[w] || w).join(' ');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function token() {
	const r = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${process.env.IGDB_CLIENT_ID}` +
		`&client_secret=${process.env.IGDB_CLIENT_SECRET}&grant_type=client_credentials`, { method: 'POST' });
	if (!r.ok) throw new Error(`Twitch token failed: ${r.status}`);
	return (await r.json()).access_token;
}

let AUTH;
async function igdb(path, body) {
	for (let attempt = 0; attempt < 6; attempt++) {
		const r = await fetch(`https://api.igdb.com/v4/${path}`, {
			method: 'POST',
			headers: { 'Client-ID': process.env.IGDB_CLIENT_ID, Authorization: `Bearer ${AUTH}`, 'Content-Type': 'text/plain' },
			body,
		});
		if (r.ok) { await sleep(260); return r.json(); } // stay under 4 requests/second
		if (r.status !== 429 && r.status < 500) throw new Error(`IGDB ${path}: ${r.status} ${await r.text()}`);
		await sleep(600 * (attempt + 1));
	}
	throw new Error(`IGDB ${path}: gave up after retries`);
}

// Wikidata: Q-id -> IGDB slugs (P5794). POSTed in batches; a generic client name, no contact details.
async function wikidataSlugs(qids) {
	const out = new Map();
	for (let i = 0; i < qids.length; i += 400) {
		const batch = qids.slice(i, i + 400);
		const query = `SELECT ?item ?igdb WHERE { VALUES ?item { ${batch.map(q => 'wd:' + q).join(' ')} } ?item wdt:P5794 ?igdb . }`;
		for (let attempt = 0; attempt < 4; attempt++) {
			const r = await fetch('https://query.wikidata.org/sparql', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', 'User-Agent': 'cnote-cover-filler/1.0' },
				body: 'query=' + encodeURIComponent(query),
			});
			if (r.ok) {
				const j = await r.json();
				for (const b of j.results.bindings) {
					const q = b.item.value.split('/').pop();
					if (!out.has(q)) out.set(q, []);
					out.get(q).push(b.igdb.value);
				}
				break;
			}
			await sleep(2000 * (attempt + 1));
		}
		await sleep(300);
	}
	return out;
}

async function update(pairs) {
	// pairs: [{game_id, console_id, key}]
	for (let i = 0; i < pairs.length; i += 2000) {
		const b = pairs.slice(i, i + 2000);
		await pool.query(
			`UPDATE game_platforms gp SET cover_key = v.key
			   FROM UNNEST($1::int[], $2::text[], $3::text[]) AS v(game_id, console_id, key)
			  WHERE gp.game_id = v.game_id AND gp.console_id = v.console_id AND gp.cover_key IS NULL`,
			[b.map(p => p.game_id), b.map(p => p.console_id), b.map(p => p.key)]);
	}
}

(async () => {
	const apply = process.argv.includes('--apply');
	const wanted = process.argv.slice(2).filter(a => !a.startsWith('--'));
	AUTH = await token();

	const { rows } = await pool.query(
		`SELECT gp.game_id, gp.console_id, g.title, g.wikidata_id FROM game_platforms gp
		   JOIN games g ON g.id = gp.game_id
		  WHERE gp.cover_key IS NULL ${wanted.length ? 'AND gp.console_id = ANY($1)' : ''}`,
		wanted.length ? [wanted] : []);
	console.log(`uncovered rows: ${rows.length}`);
	const filled = [];
	const done = new Set();
	const k = r => r.game_id + '|' + r.console_id;

	// ── Pass 1: by identity (Wikidata P5794) ──
	const qids = [...new Set(rows.map(r => r.wikidata_id).filter(q => /^Q\d+$/.test(q)))];
	const slugs = await wikidataSlugs(qids);
	console.log(`pass 1: ${slugs.size} of ${qids.length} Q-ids have an IGDB slug on Wikidata`);
	const allSlugs = [...new Set([...slugs.values()].flat())];
	const coverBySlug = new Map();
	for (let i = 0; i < allSlugs.length; i += 400) {
		const b = allSlugs.slice(i, i + 400);
		const page = await igdb('games',
			`fields slug,cover.image_id; where slug = (${b.map(s => JSON.stringify(s)).join(',')}) & cover != null; limit 500;`);
		for (const g of page) if (g.cover && g.cover.image_id) coverBySlug.set(g.slug, g.cover.image_id);
	}
	for (const r of rows) {
		const s = (slugs.get(r.wikidata_id) || []).find(x => coverBySlug.has(x));
		if (s) { filled.push({ game_id: r.game_id, console_id: r.console_id, key: 'igdb:' + coverBySlug.get(s), via: 'wikidata' }); done.add(k(r)); }
	}
	console.log(`pass 1 matched ${filled.length}`);

	// ── Pass 2: by title, per platform ──
	const left = rows.filter(r => !done.has(k(r)));
	const consoles = [...new Set(left.map(r => r.console_id))].filter(c => IGDB_NAMES[c]);
	const names = [...new Set(consoles.map(c => IGDB_NAMES[c]))];
	const plats = await igdb('platforms', `fields id,name; where name = (${names.map(n => JSON.stringify(n)).join(',')}); limit 100;`);
	const platId = new Map(plats.map(p => [p.name, p.id]));
	for (const n of names) if (!platId.has(n)) console.warn(`  ! IGDB has no platform "${n}"`);

	const listCache = new Map();
	for (const consoleId of consoles) {
		const pid = platId.get(IGDB_NAMES[consoleId]);
		if (!pid) continue;
		let index = listCache.get(pid);
		if (!index) {
			index = new Map();
			const add = (name, cover) => { const n = norm(name); if (n && cover && !index.has(n)) index.set(n, cover); };
			for (let last = 0; ;) {
				// keyset paging on id: stable, unlike offset without a sort
				const page = await igdb('games',
					`fields name,cover.image_id,alternative_names.name,game_localizations.name,game_localizations.cover.image_id; ` +
					`where platforms = (${pid}) & id > ${last}; sort id asc; limit 500;`);
				for (const g of page) {
					const main = g.cover && g.cover.image_id;
					add(g.name, main);
					for (const loc of g.game_localizations || []) add(loc.name || '', (loc.cover && loc.cover.image_id) || main);
					for (const a of g.alternative_names || []) add(a.name || '', main);
					last = g.id;
				}
				if (page.length < 500) break;
			}
			listCache.set(pid, index);
		}
		let n = 0;
		for (const r of left.filter(x => x.console_id === consoleId)) {
			const hit = index.get(norm(r.title));
			if (hit) { filled.push({ game_id: r.game_id, console_id: r.console_id, key: 'igdb:' + hit, via: 'title' }); n++; }
		}
		console.log(`pass 2 ${consoleId.padEnd(22)} igdb names ${String(index.size).padStart(6)}  uncovered ${String(left.filter(x => x.console_id === consoleId).length).padStart(5)}  matched ${String(n).padStart(5)}`);
	}

	console.log(`\n${apply ? 'filling' : 'would fill'} ${filled.length} of ${rows.length}`);
	require('fs').writeFileSync(require('path').join(require('os').tmpdir(), 'fill-missing-covers.json'), JSON.stringify(filled));
	if (apply) await update(filled);
	await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
