# CNote-Website — Status

Current-state snapshot — separate from INDEX.md (which is the complete file map). Updated whenever
the project's state changes meaningfully, not on every commit. Last updated 2026-10-09 (shared image viewer; My Space photos zoom); before that: 2026-10-08 (games catalogue + box art + My Space read-only on the site); before that: 2026-10-06 (Care Guide SCPH-70004; before that 2026-10-05 brand cleanup + generations; before that 2026-10-04 Instagram
notebook template; previous: 2026-09-23 Care Guide SCPH-39003 pass), grounded in `git log` (most recent commit `b509ede8`, 2026-09-22) and CLAUDE.md's
own notes.

## Gata (Done)

- **(2026-10-28) Certificates on the public profile and on the statistics page.** Profile: the Course Progress card shows the EARNED certificates with their date (e.g. "Console Engineering — The Basics"), translated in 6 languages; nothing is shown when there are none, and the server leaves them out when the user switched off "Show stats on profile" (the owner always sees their own). Statistics: the two certificates closest to done sit on top of Next Goals with a progress bar, and the Courses Completed card says "1 of 4 certificates earned". New/changed API (all additive): `GET /user/certificates` (login), `certificates` in `GET /user/progress/:username`, `total_lessons` + `last_lesson_course_slug` in `GET /user/stats`. Fixed on the way: the statistics page assumed the Starter Guide (lesson total "of 21", Continue-learning link to `slug=starter-guide`), and `last_lesson_id` was an unordered `LIMIT 1`. Tested: 21 end-to-end checks on PostgreSQL 16 with the real db.js schema and routes (privacy for anonymous / other user / owner, missing parts table, deterministic last lesson), and in a real browser against a stubbed API (profile in EN/RO/IT/DE, dark and light theme; statistics in EN/RO). Known and untouched: the "Show stats on profile" setting still does not hide the course progress, only the certificates.

- **(2026-10-28) Fade on the lesson sidebar's course list.** The list of modules/lessons in the lesson page's sidebar scrolls but was cut off hard at both ends. It now fades at the top once you have scrolled down and at the bottom while more items remain (mask-image toggled by `setupScrollFade()` in lesson.js; the first/last item stay fully visible at the ends). Tested in a real browser at the top, middle and bottom of the scroll, two viewport heights, no JS errors. Frontend only; Android unaffected.

- **(2026-10-28) Course parts + a certificate for "The Basics" — live on main.** Console Engineering stays ONE course (id 2) but its modules carry a `part` (`basics` = modules 1-7, 51 lessons incl. the exam placeholder; `deep-dive` = modules 8-13, 17 lessons). Each part has its own certificate, plus one for the whole course. The Basics certificate unlocks only when ALL 51 Basics lessons are completed, so nobody can earn it until those lessons are written and published (by design; the exam gate comes later). Backend: `modules.part`, table `course_part_completions`, `parts` + `course_completed_at` in the progress API, `part_completed` in the lesson-complete answer, XP `part_complete` 150; website: Certificates menu + certificate with the real date, translated in 6 languages (`cert-i18n.js`). DDL and the `part` labels were applied in Supabase BEFORE the push (same statements as the db.js migration). Tested end to end on a throwaway PostgreSQL 16 with the real `db.js` schema and the real routes (19 checks: part completes exactly once, no duplicate XP, courses without parts unchanged, reset clears it, a missing table does not break lesson completion) and in a real browser against a stubbed API (6 languages, 3 progress states). **Bug found and fixed on the way:** `diacritics.js` rewrote `si`→`și` in every language, corrupting Italian (~24 words in lesson 22), Spanish and French text; it is now Romanian-only. My earlier check of lesson 22 had read the API text, not the rendered page, and missed it. Not done: exam gate with server-side grading (the quiz still sends correct answers to the browser and accepts any score), certificate for the Android app (see handoff below).

- **(2026-10-28, late) Console Engineering is ONE course in two parts — supersedes the "electronics-foundations" entries below.** Andrei: Console Engineering is the course; it is split into *The Basics* and *Deep Dive*. In Supabase (connector): course `console-engineering` (id 2) is published and holds 13 modules / 68 lessons — `The Basics · …` modules 1-6 (Electricity 10, Circuits and Measurement 9, Capacitors, Magnetism and AC 9, Semiconductors 6, Digital Logic 10, Power Supplies 6 = the 50 lessons of the vault Plan) + module 7 `The Basics · Final Exam` (1 placeholder), and `Deep Dive · …` modules 8-13 (AC in Depth 5, Analog Building Blocks 3, Digital Systems 3, Power Conversion in Depth 1, Inside the Console 3, Diagnostics 2 — one lesson per topic from the Plan's "Lăsat pe deep dive" list; the grouping is mine, Andrei has not split these topics into lessons yet). Module/lesson titles in all 6 languages. Only lesson 22 (M1 L1) is published; the other 67 are `is_published = FALSE` placeholders. The old `electronics-foundations` row (id 4) was empty and unpublished; **deleted from Supabase on 2026-10-28 at Andrei's call (the separate Electronics Foundations course was a mistake)** — checked first: 0 modules, 0 lessons, 0 user progress, no other table references it. Code: `GET /courses/:slug?upcoming=1` also lists unpublished lessons with `available:false` (the website asks for it, the Android app doesn't, so its list is unchanged); `course.html` shows them as greyed "Coming soon" cards and counts all lessons in its totals; `lesson.js` no longer shows "Course Complete!" after the last *written* lesson (goes back to the syllabus). Course totals in `/courses/:slug/progress`, `POST /lessons/:id/complete` and `/user/progress/:username` now count ALL lessons, so finishing lesson 1 can't complete the course / award the certificate and course XP. Learn page: one live "Console Engineering" card (the separate Electronics Foundations card and its i18n keys were removed). Still open: the exam/certificate split between the two parts (one course = one certificate today), the course page's own UI strings are English.
- **(2026-10-28, evening) Electronics Foundations Lesson 1 is live in Supabase (unpublished course).** Inserted straight into the DB through the Supabase connector (the seed script was not used: its `data/` folder is gitignored and never reached GitHub; the lesson source of truth is `M1-L1-v3.md` in the Mind Tree vault). Created: course `electronics-foundations` (`is_published = FALSE`, Beginner), module 1 "Electricity", lesson id 22 "Charge, Conductors & the Loop" (content byte-identical to the vault, 5 quiz questions), **published at 2026-10-28 evening (`is_published = TRUE`, course id 4)**: reachable at `course.html?slug=electronics-foundations` and `lesson.html?id=22`, and since 2026-10-28 evening it has its own card on the Learn page (`invata.html`, `data-course-slug="electronics-foundations"`, title/description keys `learn_course_electronics_title/_desc` in all 6 languages; "Console Engineering" stays "Coming Soon" as part 2). Like every non-starter course, `course.html`/`lesson.html` send visitors who are not logged in to the login page. Cache-busting: `i18n.js?v=20261028` (22 import sites) and `main.js?v=20261028` (113 pages) bumped. The Learn-page course cards (both) are translated in 6 languages: description, "Start Learning"/"Syllabus"/"Your progress" and the "Continue"/"Review Course" labels `invata.js` sets for users with progress (keys `learn_course_*_btn`, `learn_course_progress_label`, `learn_course_starter_desc`; cache `i18n.js`/`main.js` `?v=20261028b`, `invata.js?v=20261028b`). Still hardcoded English: the course names themselves (kept as product names) and the text inside `course.html`/`lesson.html`, not checked. **Translations (2026-10-28, inserted via the Supabase connector, own translations without native review):** Lesson 1 title + content in RO/DE/ES/FR/IT (`lesson_translations`, lesson id 22), its 5 quiz questions x 5 languages, the module title "Electricity" in 5 languages, and all 70 Starter Guide quiz questions x RO/DE/ES/FR/IT (`quiz_question_translations` now holds 375 rows = 75 questions x 5; verified: 5 languages per question, same option count as EN, no duplicates). They were written fresh from the DB's EN text, NOT from the 350 prepared translations on Andrei's machine (`data/` is gitignored) — if `insert-quiz-translations.js` is ever run it will overwrite these with the prepared ones. Course title/description have no translation table (stay EN). NOT done: modules 2-7 and the placeholder lessons (they do not exist in the DB, so nothing to translate yet). `seed-electronics-foundations.js` had a bug that would have failed on production: it inserted `courses.order_index`, a column that does not exist (fixed). Do not run that script as-is against the DB now: lesson 22 already exists, it finds modules/lessons by position and would only skip it, but it needs the `data/` folder from Andrei's machine.
- **(2026-10-28) Quiz translations — table and route are live; all my scripts are gone.** The `quiz_question_translations` table (db.js migration) and the `?lang=`-aware quiz query in `GET /lessons/:id` are on main and in use (editing a quiz through `PUT /lessons/:id/quiz` deletes and re-inserts `quiz_questions`, which cascade-deletes its translations). `seed-electronics-foundations.js` (the course it created was a mistake; it also inserted `courses.order_index`, a column production does not have), `insert-quiz-translations.js` and `lib/quiz-translations.js` were removed: their data folder `backend/scripts/data/` is gitignored, so they could never run from a clean clone — the course and the translations were put into Supabase directly.

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
- **Console hero image opens full-screen** (2026-10-09) — on the console page, in both the site
  and the app. The zoom first went on My Space photos, which was the wrong picture.
- **Shared full-screen image viewer** (2026-10-09) — `js/modules/image-viewer.js` +
  `css/components/image-viewer.css`. My Space photos now zoom; console-model.js dropped its own
  copy of the same logic rather than the site gaining a third.
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

### Android app handoff - course parts + certificates (2026-10-28)

Nothing breaks if the app stays as it is (Gson ignores unknown JSON fields; every old field is unchanged). To give the app the same certificates as the website, in the Android repo (`E:\Console-Notebook`, see its CLAUDE.md for the rules):

1. **Models** (`data/remote/model/CourseModels.kt`): `CourseModule` += `val part: String? = null`. `CourseProgressResponse` += `@SerializedName("course_completed_at") val courseCompletedAt: String? = null` and `val parts: List<CoursePartProgress> = emptyList()`, with new `data class CoursePartProgress(val part: String = "", val total: Int = 0, val done: Int = 0, val completed: Boolean = false, @SerializedName("completed_at") val completedAt: String? = null)`. Optional: the `POST /lessons/{id}/complete` answer now has `part_completed: String?` (`"basics"` the moment the last Basics lesson is done).
2. **UI** (`ui/learn/CourseScreen.kt`): `CertificateDialog` unlocks only on `progress.courseCompleted`, so for Console Engineering (68 lessons) the Basics certificate could never appear. Mirror the website: if `parts` is not empty, the certificate button opens a list - one row per part (completed: opens that certificate, titled `"<course title> - <part label>"`, with `completedAt` as the date and `total` as the lesson count; locked: `done/total` with a bar) and a last row "whole course" (unlocked by `courseCompleted`, date `courseCompletedAt`). If `parts` is empty, keep today's behaviour but print `courseCompletedAt` instead of today's date.
3. **Strings** (`assets/translations/strings-{en,ro,de,es,fr,it}.json`, EN first, real translations): the certificate texts and part names. The website wording to reuse, all six languages, is in `frontend/js/modules/cert-i18n.js` of the website repo (`cert_*` keys, `part_basics`, `part_deep_dive`). Part labels: basics = The Basics / Bazele / Grundlagen / Fundamentos / Les bases / Le basi; deep-dive = Deep Dive / Aprofundare / Vertiefung / En profundidad / Approfondissement / Approfondimento.
4. **Already works in the app, no change needed:** quizzes in the user's language (the app already sends `?lang=` to `lessons/{id}`; the server now translates quizzes - Starter Guide 70 questions + Console Engineering lesson 1), and the course/lesson titles in 6 languages.
5. **Known gap (optional):** the app does not send `?upcoming=1`, so its course screen lists only published lessons (1) while `total_lessons` is 68. The website shows the unwritten ones as locked "coming soon" rows (`available:false`).
6. **Build + install on the S24:** from the Android repo, `.\gradlew.bat :app:compileDebugKotlin` (fast check), then `.\gradlew.bat :app:installDebug` with the phone connected (USB debugging, or the wireless ADB set-up described in that repo's CLAUDE.md).
8. **Certificates on the public profile + statistics (added 2026-10-28, all additive):** `GET /user/progress/{username}` now also returns `certificates: [{kind: "part"|"course", course_slug, course_title, part: String?, completed_at}]` - earned ones only, and an empty list when that user switched off "Show stats on profile" (the server already enforces it; the app just renders what it gets). Send the token as before so the owner sees their own. `PublicProfileScreen` can show them as a strip above the course rows, named `"<course_title> - <part label>"` for a part and `<course_title>` for a whole course (same labels as step 3), with the date in the app's locale. `GET /user/certificates` (login) returns ALL certificates with `done`/`total`/`completed` for the user's own statistics screen, if the app has one. `GET /user/stats` gained `total_lessons` and `last_lesson_course_slug`.
7. **Prompt to paste into Claude Code (in the Android repo):** "Read STATUS.md of the website repo (Projects/CNote-Website), section 'Android app handoff - course parts + certificates'. Implement steps 1-3 (models, certificate list in CourseScreen, strings in all 6 translation files), compile, then installDebug on my S24. Do not commit until I say so."

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
