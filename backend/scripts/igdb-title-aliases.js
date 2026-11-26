/* ─────────────────────────────────────────
   FILE: igdb-title-aliases.js
   DESCRIPTION: Writes every name IGDB knows for the catalogue's games, per
   console: { "<console_id>|<title>": ["alt name", ...] }.

   Why: a game we list under its Wikidata name is often sold - and filed on
   TheGamesDB - under another one: the US vs PAL title, a Japanese
   romanization, a subtitle dropped. IGDB keeps those as alternative names and
   localizations. seed-covers-tgdb.js reads this file (TITLE_ALIASES=...) and
   tries the aliases when the catalogue title finds no box.

   Only rows still without a box scan are looked up (same filter as
   seed-covers-tgdb.js). An IGDB game counts only when it is on that console
   and its main or an alternative name equals our title (case-insensitive).

   Usage:
     node scripts/igdb-title-aliases.js [out.json]   → default os.tmpdir()/igdb-title-aliases.json
   Needs DATABASE_URL, IGDB_CLIENT_ID, IGDB_CLIENT_SECRET in backend/.env.
   ───────────────────────────────────────── */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');

const fill = fs.readFileSync(path.join(__dirname, 'fill-missing-covers.js'), 'utf8');
const IGDB_NAMES = eval('(' + fill.match(/const IGDB_NAMES = (\{[\s\S]*?\});/)[1] + ')');

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
const q = s => '"' + String(s).replace(/\\/g, ' ').replace(/"/g, ' ') + '"';

async function main() {
	const out = process.argv[2] || path.join(os.tmpdir(), 'igdb-title-aliases.json');
	const tok = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${process.env.IGDB_CLIENT_ID}` +
		`&client_secret=${process.env.IGDB_CLIENT_SECRET}&grant_type=client_credentials`, { method: 'POST' });
	TOKEN = (await tok.json()).access_token;
	const names = [...new Set(Object.values(IGDB_NAMES))];
	const plats = await igdb('platforms', `fields id,name; where name = (${names.map(n => JSON.stringify(n)).join(',')}); limit 100;`);
	const platId = new Map(plats.map(p => [p.name, p.id]));

	const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
	const { rows } = await pool.query(`
		SELECT DISTINCT g.title, gp.console_id
		  FROM game_platforms gp JOIN games g ON g.id = gp.game_id
		 WHERE gp.cover_key IS NULL OR gp.cover_key LIKE 'igdb:%'
		    OR (gp.cover_key LIKE 'game-covers/%.jpg' AND gp.cover_key NOT LIKE '%-tgdb.jpg')`);
	await pool.end();

	// lower title → IGDB games with that main or alternative name
	const byTitle = new Map();
	const add = (t, g) => {
		if (!g || !g.name || !t) return;
		const k = t.toLowerCase();
		if (!byTitle.has(k)) byTitle.set(k, new Map());
		byTitle.get(k).set(g.id, g);
	};
	const F = 'name,platforms,alternative_names.name,game_localizations.name';
	const titles = [...new Set(rows.map(r => r.title))];
	for (let k = 0; k < titles.length; k += 40) {
		const cond = titles.slice(k, k + 40).map(t => `name ~ ${q(t)}`).join(' | ');
		try {
			for (const g of await igdb('games', `fields ${F}; where ${cond}; limit 500;`)) add(g.name, g);
			const alts = await igdb('alternative_names', `fields name,game.id,game.${F.split(',').join(',game.')}; where ${cond}; limit 500;`);
			for (const a of alts) add(a.name, a.game);
		} catch (e) { console.error('chunk failed:', e.message); }
		if (k % 4000 === 0) console.log(k, '/', titles.length);
	}

	const aliases = {};
	for (const r of rows) {
		const pid = platId.get(IGDB_NAMES[r.console_id]);
		const games = byTitle.get(r.title.toLowerCase());
		if (!games) continue;
		const set = new Set();
		for (const g of games.values()) {
			if (pid && !(g.platforms || []).includes(pid)) continue;
			for (const n of [g.name, ...(g.alternative_names || []).map(a => a.name), ...(g.game_localizations || []).map(a => a.name)]) {
				if (n && n.toLowerCase() !== r.title.toLowerCase()) set.add(n);
			}
		}
		if (set.size) aliases[`${r.console_id}|${r.title}`] = [...set];
	}
	fs.writeFileSync(out, JSON.stringify(aliases));
	console.log({ rows: rows.length, withAliases: Object.keys(aliases).length }, '→', out);
}

main().catch(e => { console.error(e); process.exit(1); });
