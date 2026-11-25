/* ─────────────────────────────────────────
   FILE: dedupe-releases-igdb.js
   DESCRIPTION: Second opinion on seed-releases-tgdb.js's plan: drops the
   "new" releases that are really a game we already list under another name.

   Why: TheGamesDB titles follow the box (US "FIFA Soccer 09", PAL "FIFA 09",
   a Japanese romanization...), the catalogue follows Wikidata. A title
   comparison alone adds the same game twice. IGDB keeps every regional and
   alternative name of a game, so for each planned (title, console) it is
   asked which game that is; when any of that game's names is already on the
   console, the entry is dropped.

   Editions are not dropped by this: "MotorStorm (Platinum)" is not a name of
   MotorStorm, so IGDB's names never match it.

   Usage (after a dry run of seed-releases-tgdb.js):
     node scripts/dedupe-releases-igdb.js [plan.json]   → os.tmpdir()/seed-releases-tgdb.deduped.json
     TGDB_DIMS=... node scripts/seed-releases-tgdb.js db.json --apply --plan <deduped.json>
   Needs DATABASE_URL, IGDB_CLIENT_ID, IGDB_CLIENT_SECRET in backend/.env.
   ───────────────────────────────────────── */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');

const fill = fs.readFileSync(path.join(__dirname, 'fill-missing-covers.js'), 'utf8');
const IGDB_NAMES = eval('(' + fill.match(/const IGDB_NAMES = (\{[\s\S]*?\});/)[1] + ')');
const rel = fs.readFileSync(path.join(__dirname, 'seed-releases-tgdb.js'), 'utf8');
const helpers = {};
new Function('module', rel.match(/const ROMAN[\s\S]*?const NOT_A_GAME[^\n]*/)[0] + ';module.exports={norm,loose};')({ set exports(v) { Object.assign(helpers, v); } });
const { norm, loose } = helpers;

const sleep = ms => new Promise(r => setTimeout(r, ms));
let TOKEN;
async function igdb(endpoint, body) {
	for (let attempt = 0; attempt < 6; attempt++) {
		const r = await fetch('https://api.igdb.com/v4/' + endpoint, {
			method: 'POST',
			headers: { 'Client-ID': process.env.IGDB_CLIENT_ID, Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'text/plain' },
			body,
		});
		if (r.status === 429) { await sleep(1500); continue; }
		if (!r.ok) throw new Error(`${endpoint} ${r.status} ${await r.text()}`);
		await sleep(260);
		return r.json();
	}
	throw new Error('IGDB kept rate-limiting');
}

// Titles may contain anything; IGDB's query language only needs quotes escaped.
const q = s => '"' + String(s).replace(/\\/g, ' ').replace(/"/g, ' ') + '"';

async function main() {
	const planPath = process.argv[2] || path.join(os.tmpdir(), 'seed-releases-tgdb.json');
	const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

	const tok = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${process.env.IGDB_CLIENT_ID}` +
		`&client_secret=${process.env.IGDB_CLIENT_SECRET}&grant_type=client_credentials`, { method: 'POST' });
	TOKEN = (await tok.json()).access_token;
	const names = [...new Set(Object.values(IGDB_NAMES))];
	const plats = await igdb('platforms', `fields id,name; where name = (${names.map(n => JSON.stringify(n)).join(',')}); limit 100;`);
	const platId = new Map(plats.map(p => [p.name, p.id]));

	const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
	const { rows } = await pool.query('SELECT g.title, gp.console_id FROM games g JOIN game_platforms gp ON gp.game_id = g.id');
	await pool.end();
	const listed = new Map();
	for (const r of rows) {
		if (!listed.has(r.console_id)) listed.set(r.console_id, new Set());
		listed.get(r.console_id).add(norm(r.title)).add(loose(r.title));
	}

	// One IGDB lookup per (title, console); multiquery takes 10 at a time.
	const jobs = [];
	plan.forEach((p, i) => p.platforms.forEach((pl, j) => {
		const pid = platId.get(IGDB_NAMES[pl.console_id]);
		if (pid) jobs.push({ i, j, title: p.title, console: pl.console_id, pid });
	}));
	const drop = new Set();
	let done = 0;
	for (let k = 0; k < jobs.length; k += 10) {
		const batch = jobs.slice(k, k + 10);
		const body = batch.map((b, n) =>
			`query games "q${n}" { search ${q(b.title)}; fields name,alternative_names.name,game_localizations.name; where platforms = (${b.pid}); limit 5; };`
		).join('\n');
		let res;
		try { res = await igdb('multiquery', body); } catch (e) { console.error('batch failed, kept as is:', e.message); continue; }
		for (const r of res) {
			const b = batch[parseInt(r.name.slice(1), 10)];
			const want = norm(b.title);
			const have = listed.get(b.console) || new Set();
			for (const g of r.result || []) {
				const gn = [g.name, ...(g.alternative_names || []).map(a => a.name), ...(g.game_localizations || []).map(a => a.name)].filter(Boolean);
				// Same work as the planned title, and known to us under one of its names.
				if (!gn.some(n => norm(n) === want || loose(n) === loose(b.title))) continue;
				if (gn.some(n => have.has(norm(n)) || have.has(loose(n)))) { drop.add(`${b.i}|${b.j}`); break; }
			}
		}
		done += batch.length;
		if (done % 2000 < 10) console.log(done, '/', jobs.length, 'dropped', drop.size);
	}

	const out = [];
	for (const [i, p] of plan.entries()) {
		const platforms = p.platforms.filter((_, j) => !drop.has(`${i}|${j}`));
		if (platforms.length) out.push({ ...p, platforms });
	}
	const outPath = planPath.replace(/\.json$/, '') + '.deduped.json';
	fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
	console.log({ before: jobs.length, dropped: drop.size, entries: out.length }, '→', outPath);
}

main().catch(e => { console.error(e); process.exit(1); });
