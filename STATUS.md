# CNote-Website — Status

Current-state snapshot — separate from INDEX.md (which is the complete file map). Updated whenever
the project's state changes meaningfully, not on every commit. Last updated 2026-09-23 (Care Guide
SCPH-39003 pass), grounded in `git log` (most recent commit `b509ede8`, 2026-09-22) and CLAUDE.md's
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
  3 of 227 models have real teardown photos — PS2 `SCPH-77004` (2026-09-21), `SCPH-77003`
  (2026-09-22), and `SCPH-39003` (2026-09-23) — including click-to-zoom, alternating photo/text
  layout, and mobile-gap fixes shipped in the same run of commits. `SCPH-39003` is the first "Fat"
  PS2 guide — modular drive/motherboard/PSU construction, `GH-022` board with separate EE+GS chips
  and a replaceable CR2032 clock battery, and the first guide to go past a clean motherboard into a
  full optical-drive teardown down to the laser sled. 63 real photos (59 `.jpg` + 4 `.dng` — every file Andrei took, one per
  step, after he corrected an initial draft that only used 22 and then a second that skipped the
  `.dng` files), 67 steps total with the 4 closing text steps. `SCPH-77003` was also missing its 2
  `.dng` photos and is now 22 steps — required raising `console_tutorials`' step cap from 50 to 150
  (`backend/routes/console-tutorials.js`, `a6f7501e`), since the old cap was silently truncating the
  guide with no error.
- PS2 FMCB modding guides corrected against the real FMCB 1.966 package (2026-09-24): 28 FreeDVDBoot/FMCB combos rewritten (OPL is bundled/preconfigured, exFAT build, card dump, install types, recovery), 30 FHDB combos lightly fixed; the 7 OpenTuna combos untouched — see INDEX.md's console-tutorials.js entry.
- Backend hardening: Postgres pool size/timeout configuration and a boot-time hotfix so a schema-init
  DB error no longer kills the process (`0c989b15`, `65d86e6c`).
- Pre-launch SEO/social audit: fixed social-share (`og:`) tags and canonical-URL gaps (`5a07f7c5`).

## În lucru (In progress)

- Care Guide real-photo teardowns — only 3 of 227 models done; the rest still show the "not
  available yet" state. `Disassembly/<model>/` in the repo root holds Andrei's untracked source
  photos for the next ones (never `git add`ed, deliberately not gitignored either).
- PS3 CFW Compatibility Chart (`ps3-cfw-compatibility.html`) — table structure is live but almost
  entirely placeholder (`mod_compat_not_tested`); only PS3 `CECHJ`/NOR/OFW 4.93 is personally
  verified and filled in.
- INDEX.md/STATUS.md maintenance itself — this pass (2026-09-23) did a full-repo sweep against
  `git ls-files` to close individual-file gaps (see INDEX.md's own changelog-less history; check
  `git log -- INDEX.md` for prior sweeps) and split this status snapshot out of INDEX.md per the
  updated CLAUDE.md Rules.

## Următorii pași (Next)

- Keep extending Care Guide real-photo teardowns to more PS2/PS3 models as Andrei disassembles them.
- Resolve the ~15 still-unconfirmed PS2 regional model codes noted in `frontend/js/data/console-models.js`'s
  own history comment (sources conflict or are silent on exact region — psdevwiki.com/consolemods.org
  block automated fetches).
- Fill in more rows of the PS3 CFW Compatibility Chart as combinations get personally verified.
- Watch for eBay API access being revoked now that the mandatory account-deletion webhook is gone;
  no action planned unless Sony/eBay actually responds.

## Probleme deschise (Open problems)

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
