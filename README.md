# CNote — Console Notebook

**CNote (Console Notebook)** is a web platform for the video game console ecosystem, with a focus on retro gaming. It brings together a console encyclopedia, repair and modding guides, learning courses and a community hub in one place.

The goal is to preserve and share knowledge about classic consoles, and to give collectors, technicians and gamers a central place to learn, compare, trade and talk about gaming hardware.

**Live site:** https://consolenotebook.com/

**Status:** Beta. Core features are live and the platform is under active development. Detailed progress is tracked in [`STATUS.md`](STATUS.md).

---

## Features

### Console Encyclopedia
* console detail pages: specifications, presentation, advantages and disadvantages
* a generation timeline (generations 1–9)
* side-by-side console comparison
* available in 6 languages: English, Romanian, Spanish, French, Italian, German

### Learning
* structured courses with modules, lessons (text, video, math via KaTeX) and quizzes
* **Console Starter Guide** — 7 modules, 21 lessons, 70 quiz questions, translated into RO, DE, ES, FR and IT
* **Console Engineering** — the electrical engineering course, in progress: *The Basics* (7 modules, with a certificate) and *Deep Dive* (advanced modules, mostly planned)
* progress tracking, comments and reactions on lessons
* XP, levels, achievements and a public leaderboard (respects each user's privacy flag)

### Repair and Modding Guides
Standalone reference guides, kept separate from the courses because they are per-model and don't need progress tracking:
* **Console Care & Cleaning Guide** — dust and vents, cartridge contacts, optical drives, controller drift, safe opening, storage, plus a searchable directory of 227 hardware models and revisions with real-photo teardown pages
* **Console Modding Guide** — softmods vs hardmods, tools, backups, warranty and ban risk, legal considerations, plus per-model write-ups selected by flash type and firmware version
* PS2 coverage includes memory-card softmods (FreeMcBoot), the OpenTuna/Fortuna route and internal-HDD methods (FreeHdBoot)
* **PS3 CFW compatibility chart** — table is live; rows are added only as combinations are personally verified

All guide content comes from hands-on testing and manual verification. Content is still being filled in model by model. See [`STATUS.md`](STATUS.md) for current coverage.

### Marketplace
* listings with condition, category, price and photos
* search, filters (category, condition, console type, country, city) and sorting
* location-aware, with built-in city data for 60+ countries
* favorites, seller reviews and similar-listing suggestions
* order checkout without on-platform payment (payment is arranged off-platform) and flat-rate Sameday shipping fees

### CNote Shop
Restored consoles sold by CNote itself, ordered directly instead of through messages:
* the buyer builds a package: the console model (each unit is a specific piece with its own cosmetic grade — Like new / Very good / Good — and price), an optional mod, a storage upgrade where offered, and accessories with a quantity; cables are always included
* stock comes from the owner's inventory: an item is sent to sale from the app, accessories follow the inventory quantity, and shipping an order books the sale back into the inventory
* only working items can be sold; orders reserve stock and are confirmed, shipped or cancelled by CNote (admins)
* a "From the CNote shelf" block on every console page; CNote's marketplace listings lead to the shop and say so when out of stock
* no on-platform payment (cash on delivery or bank transfer), Sameday shipping

### Games Catalogue
~52,000 games across 50 consoles with real box scans (TheGamesDB, libretro, IGDB): every edition, reissue, bundle, demo disc and add-on as its own entry, so a shelf can hold exactly what someone owns.

### Articles
Admin-written articles in five categories (News, History, Special Editions, Speculations, Fun Facts), tagged with the consoles they are about and listed on each console page; speculations are labelled as unconfirmed.

### Repair and Restoration Requests
* step-by-step wizard: console, model, symptoms and description
* request tracking (pending → in progress → resolved) with replies
* admin dashboard to triage and answer requests, with email notifications

### Community Hub
* forum with threads, nested replies, photos and "solved" answers
* direct messages with reactions, replies, edits, stickers and voice notes
* general chat, friends system, photo gallery
* in-app notifications and push notifications (FCM)
* console ratings

### My Space
Per-user console shelf with photos, a games shelf and drag-to-rank ordering, plus favorite and owned console tracking — down to the hardware line (PS2 / PS2 Slim, PS4 Pro, Xbox 360 S…) and the exact revision.

### Devices
* PS2 pairing with a short code
* CNote Remote device registry

### User System and Trust & Safety
* email/password and Google OAuth login, two-factor authentication, email verification, password reset
* session management with device and browser tracking
* public profiles with avatar crop tool and bio
* Cloudflare Turnstile on sign-up and contact forms, disposable-email blocking
* content reporting (DSA Article 16 notice-and-action), bans and timed mutes
* legal pages in six languages

### Admin Tools
User directory and role management, dashboard stats, articles editor, reports queue, inline editing of courses, consoles, models and guides, and the internal Workshop tool (interactive circuit boards with component maps and a repair journal for hardware diagnostics).

---

## Tech Stack

**Frontend**
* HTML, CSS and vanilla JavaScript (ES modules, no framework or bundler)
* Socket.io client (achievement and notification events)
* DOMPurify (sanitized shared navbar and footer), KaTeX (lesson math)
* i18n through a shared `MESSAGES` object for 6 languages

**Backend**
* Node.js, Express, Socket.io
* JWT auth with Passport (Google OAuth 2.0)
* Multer and Sharp (avatar processing), Helmet with per-request CSP nonces
* Resend (email), Firebase Admin / FCM (push), Sentry (error tracking)
* Node test files with a mocked database helper

**Database and storage**
* PostgreSQL on Supabase, raw `pg` driver (no ORM); schema is created and migrated at boot in `backend/db.js`
* Cloudflare R2 (S3-compatible) for uploads, via presigned PUT URLs

**Hosting and CI**
* Railway — production, auto-deploys from `main`
* GitHub Actions — `ci.yml` (install, precheck, backend tests) and `db-backup.yml` (daily encrypted `pg_dump`, kept as a 90-day artifact)

---

## Repository Structure

```
backend/     Express server, routes, middleware, services, scripts, tests
frontend/    Static site: html/pages, html/components, js, css, assets
infra/       Object-storage setup notes (R2) and an optional self-hosted MinIO path
.github/     CI and backup workflows
INDEX.md     Detailed map of the codebase
STATUS.md    Project status and roadmap
CLAUDE.md    Working notes for AI-assisted development
```

For a detailed file-by-file map of pages, routes, tables and features, see [`INDEX.md`](INDEX.md).

---

## Running Locally

1. Install dependencies: `npm install` (the root `postinstall` also installs the backend)
2. Copy `backend/.env.example` to `backend/.env` and fill in the values
3. Start the server: `npm start` — it serves the static frontend and mounts all routes
4. Run the backend tests: `npm --prefix backend test`

The app is configured entirely through environment variables. `backend/.env.example` is the full, documented list, covering server, database, auth, object storage, email, push notifications, CAPTCHA and error tracking.

---

## Related Projects

* CNote Android app (separate repository)
* CNote Remote (separate repository)

---

## Roadmap

* finish the Console Engineering course, including the final exam and server-side grading for certificates
* fill the Care and Modding guides with real per-model content (more teardown photos and step-by-step write-ups)
* verify more rows of the PS3 CFW compatibility chart
* dedicated gaming server
* grow the CNote Shop (now live) and tie it to the repair request flow — the long-term direction of the platform
* show each owned console's hardware line on public profiles

Marketplace sync with external services (eBay, OLX) was removed from the codebase.

---

## License

MIT License.

---

## Author

Created by **Andrei Halcu** — https://github.com/CNote-Hulk
