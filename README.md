# CNote — Console Notebook

**CNote (Console Notebook)** is a web platform dedicated to the ecosystem of video game consoles.

The project aims to create a central hub where console enthusiasts, collectors, technicians and gamers can explore console history, compare hardware specifications, learn repair techniques and interact with a community passionate about gaming hardware.

CNote focuses especially on the retro gaming world and aims to preserve and share knowledge about classic video game consoles.

---

## Project Status

This project is currently in **beta stage**.
Core features are implemented, but the platform is still under active development and improvements are being made continuously.

---

## Live Website

https://consolenotebook.com/
---

## Current Features

### Console Encyclopedia

A catalog of video game consoles including:

* hardware specifications
* console presentation
* advantages and disadvantages
* available in 6 languages (English, Spanish, French, Italian, German, Romanian)

---

### Console Comparison System

Users can compare consoles side-by-side to better understand hardware differences between gaming platforms.

---

### Console Repair Course

The platform includes a learning section focused on console repair and hardware understanding.

Features include:

* structured courses, modules and lessons (video, text, and quizzes) — the Console Starter Guide (7 modules, 21 lessons) is fully live; Console Engineering is planned but not yet populated
* progress tracking per user
* comments and reactions on lessons
* XP, levels and an achievements system, with real-time unlock notifications

Alongside the structured course, two standalone reference guides cover practical, per-model content that doesn't need progress tracking:

* **Console Care & Cleaning Guide** — maintenance topics (dust/vents, cartridge contacts, optical drives, controller drift, safe opening, storage) plus a searchable directory of 194 real hardware models/revisions, each with its own disassembly tutorial page (photos, step-by-step)
* **Console Modding Guide** — softmods vs hardmods, tools, backups, warranty/ban risk, staying legal, plus the same per-model directory linking to a written modding guide for each model

---

### Marketplace

A buy/sell marketplace for consoles, games, accessories, and parts:

* listings with condition (new / like new / good / fair / parts-only), category, price, and photos
* search, filter (category, condition, console type, country, city) and sort (newest, oldest, price)
* location-aware: buyer/seller country and city, with built-in city data for 60+ countries
* favorites, view counts, "similar listings" suggestions
* eBay account sync (OAuth, import your eBay listings) — fully built and integrated, but **deactivated in the UI** as of 2026-07-23 (the connect flow still works server-side, just not exposed to users right now)
* OLX sync — integration built (OAuth flow, provider adapter), **not yet live** — OLX's API requires a registered business account to issue real credentials, which is still pending

---

### Repair & Restoration Requests

A guided request flow inside the Community hub, so anyone can get their hardware looked at:

* step-by-step wizard: pick your console (Xbox / PlayStation / Nintendo / PC / other), model, symptoms from a curated per-console list (or describe your own), and a free-text description
* track your own requests and their status (pending → in progress → resolved), with replies
* admin dashboard to triage, reply to, and update the status of every incoming request, with email notifications both ways

---

### Community Hub

* discussion forum: threads, replies, and upvotes
* direct messages between users, with push notifications
* global community chat — **built but not yet live** (UI still shows "Coming Soon")
* friends system (requests, accept/reject, friends list)
* console rating system
* in-app notifications for replies, DMs and marketplace activity

---

### Workshop (internal tool)

An admin-only hardware-diagnostics tool: interactive circuit boards (real scanned photos with an overlaid component/pin map), a per-board repair journal, and draggable component positioning for building out new boards. Not user-facing — used internally for repair/restoration diagnostics.

---

### Timeline

A short historical timeline showing important moments in the evolution of video game consoles.

---

### User System

The platform includes an authentication system with:

* user registration and login (email/password, Google OAuth)
* two-factor authentication (2FA)
* email verification and password reset
* session management with device/browser tracking
* personal, public user profiles

Users can customize their profiles with:

* profile picture (with an in-browser crop tool)
* personal bio

---

### Console Tracking

Users can manage their console collections:

* favorite consoles
* owned consoles
* console ratings

---

### Trust & Safety

* content reporting flow (notice-and-action, DSA Article 16 compliant)
* honeypot-protected contact form

---

### Contact Page

Users can send messages through a contact form available on the platform.

---

## Tech Stack

Frontend

* HTML, CSS, vanilla JavaScript (ES modules, no framework/bundler)
* Socket.io client (real-time achievement/notification toasts)
* DOMPurify (sanitized shared navbar/footer injection)
* KaTeX (math rendering in course lessons)

Backend

* Node.js, Express.js
* Socket.io (real-time notifications)
* Passport.js (Google OAuth 2.0)
* Multer + Sharp (avatar upload processing)
* Resend (transactional email)
* Firebase Admin / FCM (push notifications for direct messages)
* Sentry (error tracking, frontend + backend)

Database & Storage

* PostgreSQL (hosted on Supabase, raw `pg` driver — no ORM)
* Supabase Storage (avatar images)
* Self-hosted MinIO behind Caddy (chat image/voice attachments)

Hosting

* Railway (application hosting)
* Supabase (database + avatar storage)
* Self-hosted VPS (chat attachment storage)

---

## Environment Variables

The application is configured entirely through environment variables — see `backend/.env.example` for the full, documented list. Key groups:

* **Server** — `PORT`, `NODE_ENV`, `BASE_URL`, `FRONTEND_URL`, `API_BASE_URL`
* **Database** — `DATABASE_URL`
* **Auth** — `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
* **Supabase Storage** — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
* **Chat attachment storage (MinIO)** — `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_PUBLIC_URL`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_FORCE_PATH_STYLE`
* **Email** — `EMAIL_USER`, `EMAIL_PASS`, `RESEND_API_KEY`, `CONTACT_RECEIVER_EMAIL`, `ADMIN_EMAIL`
* **Marketplace sync** — `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RU_NAME`, `EBAY_REDIRECT_URI`, `EBAY_VERIFICATION_TOKEN`, `EBAY_DELETION_ENDPOINT_URL`, `OLX_CLIENT_ID`, `OLX_CLIENT_SECRET`, `OLX_REDIRECT_URI`
* **Push notifications** — `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
* **Error tracking** — `SENTRY_DSN_BACKEND`, `SENTRY_DSN_FRONTEND`

---

## Version

Current version:

v0.1.0 (Beta)

---

## Roadmap

Planned improvements include:

* advanced repair lessons (Console Engineering course)
* populating the Console Care and Console Modding guides with real per-model content (photos, step-by-step write-ups)
* dedicated gaming server
* launching global community chat (already built, not yet enabled)
* going live with OLX marketplace sync, once a registered business account makes real API credentials possible
* re-enabling eBay marketplace sync in the UI (temporarily deactivated 2026-07-23; the integration itself is untouched)
* growing the marketplace into a dedicated storefront for restored/refurbished consoles (not just peer-to-peer listings), tightly integrated with the repair/restoration request flow — the long-term direction for the whole platform

---

## License

This project is licensed under the MIT License.

---

## Author

Created by **Andrei Halcu**
GitHub: https://github.com/CNote-Hulk