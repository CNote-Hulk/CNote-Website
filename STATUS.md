# CNote-Website — Status

Current-state snapshot — separate from INDEX.md (which is the complete file map). Updated whenever
the project's state changes meaningfully, not on every commit. Last updated 2026-10-08 (games catalogue + box art + My Space read-only on the site); before that: 2026-10-06 (Care Guide SCPH-70004; before that 2026-10-05 brand cleanup + generations; before that 2026-10-04 Instagram
notebook template; previous: 2026-09-23 Care Guide SCPH-39003 pass), grounded in `git log` (most recent commit `b509ede8`, 2026-09-22) and CLAUDE.md's
own notes.

## Gata (Done)

- Core platform live in beta at consolenotebook.com: console encyclopedia, hardware comparison tool,
  repair course with progress tracking, marketplace (no-payment checkout via `routes/orders.js`),
  forums, DMs, friends, gamification (XP/levels/achievements).
- Admin Users dashboard (`routes/admin-stats.js`, `profil.html`'s Users tab) — full user directory,
  role toggle, ban/mute, shipped 2026-09-09.
- Marketplace sync with OLX/eBay removed entirely (2026-09-09, Andrei's call) — `backend/providers/`
  and `marketplace-sync.js` deleted, backend test suite grown 39→57 to lock in the removal.
- eBay account-deletion compliance webhook (`routes/ebay.js`) removed 2026-09-22 — explicit,
  accepted risk that eBay could revoke the developer app's API access for no longer answering that
  mandatory call (see CLAUDE.md's "What this is" section for the full reasoning).
- Per-model hardware directory (`console_models` table, 227 models) with real modding-method
  selectors researched and populated for Xbox 360, original Xbox, PS1/PSone, PS Vita, PS4, PS5,
  Switch, GameCube, Wii U, Wii, and the DS/3DS family.
- PS2 modding-guide content: 56 model codes covered across 3 flash-type families (FreeHdBoot /
  FreeDVDBoot / OpenTuna-Fortuna), cross-referenced against multiple sources after a correction pass.
- "Care Guide" (real-photo disassembly tutorials, renamed from "Disassembly Tutorial" 2026-09-09):
  4 of 227 models have real teardown photos — PS2 `SCPH-77004` (2026-09-21), `SCPH-77003`
  (2026-09-22), `SCPH-39003` (2026-09-23), and `SCPH-70004` (2026-10-06: 18 photos incl. 1 `.dng`, 22 steps, live) — including click-to-zoom, alternating photo/text
  layout, and mobile-gap fixes shipped in the same run of commits. `SCPH-39003` is the first "Fat"
  PS2 guide — modular drive/motherboard/PSU construction, `GH-022` board with separate EE+GS chips
  and a replaceable CR2032 clock battery, and the first guide to go past a clean motherboard into a
  full optical-drive teardown down to the laser sled. 63 real photos (59 `.jpg` + 4 `.dng` — every file Andrei took, one per
  step, after he corrected an initial draft that only used 22 and then a second that skipped the
  `.dng` files), 67 steps total with the 4 closing text steps. `SCPH-77003` was also missing its 2
  `.dng` photos and is now 22 steps — required raising `console_tutorials`' step cap from 50 to 150
  (`backend/routes/console-tutorials.js`, `a6f7501e`), since the old cap was silently truncating the
  guide with no error.
- Backend hardening: Postgres pool size/timeout configuration and a boot-time hotfix so a schema-init
  DB error no longer kills the process (`0c989b15`, `65d86e6c`).
- Pre-launch SEO/social audit: fixed social-share (`og:`) tags and canonical-URL gaps (`5a07f7c5`).
- Pixel-art landing page prototype (2026-10-05): `/html/pages/index-pixel.html` — the full home page
  redone in retro pixel style, separate from the real `index.html` so Andrei can judge it live. Shapes
  keep the site's rounded corners/pills/circles, drawn as pixel staircases (not square frames). Next:
  decide which parts (if any) move into the real site / which other pages get the same treatment.
- Pixel-art UI icons (2026-10-05): all 478 inline line-icon SVGs on the site (93 distinct icons) were
  replaced by their Pixelarticons equivalents, plus the CSS select arrows/checkmark; pixel emoji were
  resized to emoji size (1.2em, were ≥24px and looked too big). Left as-is: progress rings, dashed
  connector lines, Google logo, KaTeX.
  Then the same day: chat icons too (back/attach/send/play/pause/stop, context-menu actions — they
  were text symbols, now pixel icons when icon-only), pixel icons never under 16px, and a
  **Settings → Appearance → Pixel art** on/off switch (per device; off restores the original line icons
  and native emoji). Andrei plans to build a bigger idea on top of this switch — ask what it is before
  changing how it works (e.g. syncing it to the account or the Android app).
- Pixel-art emoji (2026-10-05, stage 1 of 3): the site's emoji now render as retro pixel icons
  (Pixelarticons, MIT) site-wide via `pixel-emoji.js`; user-written text keeps native emoji. Next:
  stage 2 = pixel versions of the 6 chat quick reactions are already covered by the same map
  (👍❤️😂😮😢🔥 → thumbs-up/heart/laugh/meh/frown/fire); stage 3 = 41 custom pixel badges for
  levels/achievements (currently generic Pixelarticons icons) — undecided who draws them. The Android
  app still shows native emoji.
- Login/DB stability fix (2026-10-05): "logged out on every reload" + 500s on achievements/articles/
  marketplace. Root causes: pool `max` 20 above the Supabase Session pooler's limit of 15
  (EMAXCONNSESSION), 13–14 parallel queries per achievements call, the auth middleware turning a DB
  error on a valid JWT into a 401, and the frontend logging out on any failure / on 403. All four
  fixed, 6 regression tests added (58/58).
- Brand + data cleanup (2026-10-05): the name "Cnote Bakery" removed from everything user-facing —
  site is "CNote" only (titles/meta, i18n in all 6 languages, legal terms, emails, 2FA issuer,
  README/LICENSE). Console generations corrected to the standard classification for 7 consoles
  (Atari 2600/Odyssey²/Intellivision → Gen 2, Famicom/SG-1000 → Gen 3, 3DO/Jaguar → Gen 5): live DB
  rows updated directly (already live), JSON seed + `consoles-data.js` + Evolution page regrouped in
  the repo (needs merge + deploy).
- Instagram post template (2026-10-04): `frontend/html/tools/notebook-template.html` — a plain HTML
  copy of the landing-page notebook only; Andrei edits text + picture (in the file or by clicking in
  the browser), screenshots it, then does the pixel-art pass. The notebook-with-pixel-art look is the
  chosen direction for the @consolenotebook Instagram.
- Care Guide real-photo teardowns — only 4 of 227 models done; the rest still show the "not
  available yet" state. `Disassembly/<model>/` in the repo root holds Andrei's untracked source
  photos for the next ones (never `git add`ed, deliberately not gitignored either).
- PS3 CFW Compatibility Chart (`ps3-cfw-compatibility.html`) — table structure is live but almost
  entirely placeholder (`mod_compat_not_tested`); only PS3 `CECHJ`/NOR/OFW 4.93 is personally
  verified and filled in.
- INDEX.md/STATUS.md maintenance itself — this pass (2026-09-23) did a full-repo sweep against
  `git ls-files` to close individual-file gaps (see INDEX.md's own changelog-less history; check
  `git log -- INDEX.md` for prior sweeps) and split this status snapshot out of INDEX.md per the
  updated CLAUDE.md Rules.

- **Games catalogue** (2026-10-07/08) — 30,963 games and 62,757 game↔console links, seeded from
  Wikidata (CC0) rather than from a ROM site, whose listing is a by-product of distribution with no
  licence, no stable identifiers and no metadata past a title. `routes/games.js` serves it paged and
  searchable; `user_games` holds each person's shelf, scoped to the console page it was added from,
  so a cross-platform title can sit on the PS2 shelf and the Xbox shelf separately.
- **Box art** (2026-10-08) — 46,456 of 62,757 releases (74%), from two sources because they cover
  different eras: libretro mirrors what emulators support (8,500 scans for the PS2, **twelve** for
  the whole Xbox 360), IGDB is the other way round. `game_platforms.cover_key` carries provenance
  (`libretro:`/`igdb:`/an R2 key of our own) and lives per-platform, not per-game: the same title
  shipped in a blue PS2 case and a green Xbox one, and a shelf showing the wrong box stops being a
  shelf you can read at a glance. Covers mirror themselves into R2 on first request rather than by
  bulk copy — several GB most of which nobody would open.
- **Profile console lists are a ranking** (2026-10-08) — favourites and owned show their
  position and each one links into that user's My Space for the console. The page had been merging
  the server's ranked ids with the legacy CSV column through a `Set`, which appended unranked
  leftovers and quietly broke the order dragged into place in the app.
- **My Space** (2026-10-06/08) — the per-user half of a console page: owned/favourite, which hardware
  revision you own, your own photos, your games. Writable only from the app, by design. On the site
  it is an About | My Space tab pair in the console hero, strictly read-only (`js/modules/my-space.js`).
- **Two owned-consoles bugs** (2026-10-08) — Settings wrote `users.owned_consoles` (a text column)
  while everything else read `user_owned_consoles` (the table); they had diverged, five entries
  against six. The column is now derived from the table on every write. Fixing that exposed the
  second: `PUT /api/owned-consoles` had been 500ing since `owned_console_models_many` dropped the
  `model_code` column it still referenced — unnoticed because nothing called it.

## Următorii pași (Next)

- Instagram: produce posts with the notebook template (needs this branch merged + deployed to be
  reachable at `/html/tools/notebook-template.html`); always proofread AI-redrawn text before posting.
- Keep extending Care Guide real-photo teardowns to more PS2/PS3 models as Andrei disassembles them.
- Resolve the ~15 still-unconfirmed PS2 regional model codes noted in `frontend/js/data/console-models.js`'s
  own history comment (sources conflict or are silent on exact region — psdevwiki.com/consolemods.org
  block automated fetches).
- Fill in more rows of the PS3 CFW Compatibility Chart as combinations get personally verified.
- Watch for eBay API access being revoked now that the mandatory account-deletion webhook is gone;
  no action planned unless Sony/eBay actually responds.

## Probleme deschise (Open problems)

- **Box art for the modern consoles leans entirely on IGDB**, which needs a Twitch application's
  `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET`. Those are in `backend/.env` locally; production has its own.
- **Wikidata still costs us titles**: 1,268 ids carry no English label and no enwiki article, so they
  are skipped rather than named by guesswork.
- **R2 mirroring is lazy**, so `cover_key` stays `libretro:`/`igdb:` until someone opens that cover.
  Nothing to run — just worth watching that the share of un-mirrored keys falls over time.

- **Cache-busting discipline is a recurring bug class** (see CLAUDE.md Gotchas): most JS/CSS files
  still have no `?v=` param at all; every file that gets bumped to fix a caching bug is one-off, not
  systemic — a change to any un-bumped file can silently not reach returning visitors. `main.js`/`main.css`
  and `i18n.js` were the two worst/most-recently-fixed offenders; nothing prevents the next file from
  having the same problem.
- **Test coverage is still far from full route coverage** (per CLAUDE.md's Commands section) — the 52
  backend tests (as of 2026-09-22) are a regression net for specific modules (gamification,
  passwordPolicy, languages, device, auth middleware, forum search, console models, marketplace-sync
  removal) plus CI wiring, not a substitute for manual testing of the rest.
- **eBay compliance webhook removal is an accepted, not resolved, risk** — no fallback plan exists if
  eBay does revoke API credentials for the developer app.
