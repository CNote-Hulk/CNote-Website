/* ─────────────────────────────────────────
   FILE: server.js
   DESCRIPTION: Express application entry point. Configures
   middleware, CORS, mounts all API routes, and serves
   static frontend files. Uses PostgreSQL via Supabase.
   ───────────────────────────────────────── */

/* ── REQUIRED IMPORTS — DO NOT REMOVE ──────
   If you add a new package:
     1. require() it here
     2. Add it to package.json dependencies
   ────────────────────────────────────────── */

// Sentry must be initialised before any other require so it can instrument
// http, pg, and express automatically. DSN comes from the process environment
// (Railway injects it natively; .env is loaded on the next line).
const Sentry = require('@sentry/node');
Sentry.init({
	dsn: process.env.SENTRY_DSN_BACKEND,
	environment: process.env.NODE_ENV || 'production',
	tracesSampleRate: 0.1,
	integrations: [
		Sentry.httpIntegration(),
		Sentry.expressIntegration(),
	],
});

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const http = require('http');
const socketio = require('socket.io');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs').promises;
const app = express();

/* ── Route imports ── */
const resetProgressRoutes = require('./routes/reset-progress');
const authRoutes = require('./routes/auth');
const sessionRoutes = require('./routes/sessions');
const chatRoutes = require('./routes/chat');
const ratingRoutes = require('./routes/ratings');
const favoriteRoutes = require('./routes/favorites');
const friendRoutes = require('./routes/friends');
const userRoutes = require('./routes/users');
const contactRoutes = require('./routes/contact');
const googleAuthRoutes = require('./routes/google-auth');
const forumRoutes = require('./routes/forum');
const forumLikedRoutes = require('./routes/forum-liked');
const forumMyPostsRoutes = require('./routes/forum-my-posts');
const marketplaceRoutes = require('./routes/marketplace');
const marketplaceReviewsRoutes = require('./routes/marketplace-reviews');
const repairRoutes = require('./routes/repair');
const dmRoutes = require('./routes/dm');
const stickersRoutes = require('./routes/stickers');
const communityPhotosRoutes = require('./routes/community-photos');
const adminStatsRoutes = require('./routes/admin-stats');
const notificationRoutes = require('./routes/notifications');
const consolesRoutes = require('./routes/consoles');
const achievementsRoutes = require('./routes/achievements');
const leaderboardRoutes = require('./routes/leaderboard');

const coursesRoutes = require('./routes/courses');
const reportsRoutes = require('./routes/reports');
const ebayRoutes = require('./routes/ebay');
const uploadsRoutes = require('./routes/uploads');
const workshopRoutes = require('./routes/workshop');
const consoleTutorialsRoutes = require('./routes/console-tutorials');
const consoleModelsRoutes = require('./routes/console-models');
const articlesRoutes = require('./routes/articles');
const ordersRoutes = require('./routes/orders');

/* ── Environment validation ── */

/**
 * getMissingEnvVars
 * @description Returns names of required env vars that are empty or unset.
 */
function getMissingEnvVars(required) {
	return required.filter((name) => {
		const value = process.env[name];
		return !value || String(value).trim().length === 0;
	});
}

/**
 * normalizeOrigin
 * @description Trims and strips trailing slash from an origin URL.
 */
function normalizeOrigin(value) {
	return String(value || '').trim().replace(/\/$/, '');
}

/**
 * getOriginHost
 * @description Extracts lowercase hostname from a URL string.
 */
function getOriginHost(value) {
	try {
		return new URL(normalizeOrigin(value)).host.toLowerCase();
	} catch {
		return '';
	}
}

// Origin of our object storage's PUBLIC read URL (R2 pub-*.r2.dev, or a
// self-hosted MinIO's public origin) — lets the browser fetch/play uploaded
// images & voice messages. Empty until OBJECT_STORAGE_PUBLIC_URL is
// configured (see .env.example) — CSP directives below tolerate that.
const objectStorageOrigin = (() => {
	try { return new URL(process.env.OBJECT_STORAGE_PUBLIC_URL).origin; } catch { return null; }
})();

// Origin(s) of the object storage's S3 API endpoint (OBJECT_STORAGE_ENDPOINT)
// — this is what the browser PUTs the file bytes to directly via a presigned
// URL, and it's a DIFFERENT host from the public read URL above. R2 with
// FORCE_PATH_STYLE=false (virtual-hosted-style, our default) prefixes the
// bucket name onto the endpoint's hostname for actual requests (e.g.
// "mybucket.<account>.r2.cloudflarestorage.com"), so the bare endpoint origin
// alone doesn't match — a wildcard covers that subdomain along with the bare
// host (which path-style setups, or providers that don't rewrite the host,
// still need). Without this, every direct-to-storage upload is silently
// blocked by CSP's connect-src with a generic "Failed to fetch" in the
// browser — no server-side log at all, since the browser never sends the
// request.
const objectStorageUploadOrigins = (() => {
	try {
		const u = new URL(process.env.OBJECT_STORAGE_ENDPOINT);
		return [u.origin, `${u.protocol}//*.${u.host}`];
	} catch { return []; }
})();

const requiredEnv = ['DATABASE_URL', 'JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

const missingEnv = getMissingEnvVars(requiredEnv);
if (missingEnv.length > 0) {
	console.error('Missing required environment variables: ' + missingEnv.join(', '));
	process.exit(1);
}

app.set('JWT_SECRET', process.env.JWT_SECRET);

// Warn about missing optional vars
const optionalEnv = ['NODE_ENV', 'FRONTEND_URL', 'BASE_URL'];
optionalEnv.forEach(name => {
	if (!process.env[name]) console.warn(`Warning: ${name} is not set — using default.`);
});

app.set('trust proxy', 1);

// Canonicalize both protocol (http -> https) and host (www. -> apex) in one
// pass. Without this, www.consolenotebook.com serves the exact same content
// as the apex domain with no redirect between them — two fully independent,
// crawlable copies of the entire site, which is a major contributor to the
// duplicate-content noise Search Console reports (Page Indexing: "Page with
// redirect" / "Alternate page with proper canonical tag" both included
// www.* examples).
app.use((req, res, next) => {
  if (req.path === '/api/health') return next();
  const isHttps = req.headers['x-forwarded-proto'] === 'https';
  const host = req.hostname;
  const isWww = host.startsWith('www.');
  if (!isHttps || isWww) {
    const targetHost = isWww ? host.slice(4) : host;
    return res.redirect(301, `https://${targetHost}${req.url}`);
  }
  next();
});

// ── CSP nonce — generate a fresh nonce for every request ─────────────────
// Must run BEFORE helmet so the nonce is in res.locals when helmet builds
// the CSP header via the scriptSrc function below.
app.use((req, res, next) => {
	res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
	next();
});

app.use(helmet({
	// ── Content-Security-Policy ────────────────────────────────────────────
	// Enforced (reportOnly: false) — violations still flow to the sink below
	// for monitoring, but the browser blocks anything not explicitly allowed.
	//
	// External origins inventoried from the frontend (2026-05-06):
	//   cdn.socket.io          – Socket.IO client script
	//   cdn.jsdelivr.net       – DOMPurify + Supabase JS client (ESM)
	//   www.googletagmanager.com – GA4 loader script
	//   www.google-analytics.com – GA4 data collection (connect + script)
	//   fonts.googleapis.com   – Google Fonts CSS
	//   fonts.gstatic.com      – Google Fonts actual font files
	//   www.youtube.com        – YouTube iframe embeds (consent-gated)
	//   www.youtube-nocookie.com – YouTube privacy-enhanced variant
	//   *.googleusercontent.com / *.ggpht.com – Google user avatars (img)
	//   *.supabase.co          – Supabase auth & realtime (connect)
	contentSecurityPolicy: {
		reportOnly: false, // enforcing — flipped from report-only after log validation
		directives: {
			defaultSrc:      ["'self'"],

			scriptSrc: [
				"'self'",
				(req, res) => `'nonce-${res.locals.cspNonce}'`, // per-request nonce for inline scripts
				'https://cdn.socket.io',           // Socket.IO client
				'https://cdn.jsdelivr.net',         // DOMPurify, Supabase ESM
				'https://www.googletagmanager.com', // GA4 loader
				'https://*.google-analytics.com',  // GA4 secondary scripts
				'https://browser.sentry-cdn.com',  // Sentry browser SDK
				'https://challenges.cloudflare.com', // Turnstile (CAPTCHA) widget script
			],

			styleSrc: [
				"'self'",
				"'unsafe-inline'",                  // Inline styles used throughout UI
				'https://fonts.googleapis.com',     // Google Fonts CSS
			],

			fontSrc: [
				"'self'",
				'data:',
				'https://fonts.gstatic.com',        // Google Fonts font files
			],

			imgSrc: [
				"'self'",
				'data:',
				'blob:',
				'https:',                           // Covers *.googleusercontent.com,
				                                    // *.ggpht.com user avatars, and
				                                    // any other HTTPS image
			],

			// Voice messages play via <audio src="..."> — falls back to default-src
			// without this, which would block our self-hosted storage origin.
			mediaSrc: [
				"'self'",
				'blob:',
				...(objectStorageOrigin ? [objectStorageOrigin] : []),
			],

			connectSrc: [
				"'self'",                             // API calls + same-origin WebSocket (Socket.IO)
				'https://*.google-analytics.com',     // GA4 beacon / collect (covers region1, region2, www)
				'https://*.analytics.google.com',     // GA4 alternative collection endpoint
				'https://www.googletagmanager.com',   // GA4 config fetch
				'https://*.supabase.co',              // Supabase auth & realtime
				'https://*.sentry.io',                // Sentry error reporting
				'https://*.ingest.sentry.io',         // Sentry ingest endpoint
				'https://challenges.cloudflare.com',  // Turnstile (CAPTCHA) verification calls
				...(objectStorageOrigin ? [objectStorageOrigin] : []), // object storage public read URL (img/audio fetch)
				...objectStorageUploadOrigins,         // object storage S3 API endpoint (direct browser PUT upload)
			],

			frameSrc: [
				'https://www.youtube.com',          // YouTube embeds (consent-gated)
				'https://www.youtube-nocookie.com', // YouTube privacy-enhanced mode
				'https://challenges.cloudflare.com', // Turnstile (CAPTCHA) widget iframe
			],

			frameAncestors: ["'self'"],             // Clickjacking protection

			objectSrc:  ["'none'"],                 // No Flash / plugins
			baseUri:    ["'self'"],                 // Prevent base-tag hijacking
			formAction: ["'self'"],                 // Google OAuth is server-side redirect

			upgradeInsecureRequests: [],            // Auto-upgrade HTTP sub-resources

			reportUri: ['/api/csp-report'],         // Violation sink (report-only mode)
		},
	},

	// ── HSTS ──────────────────────────────────────────────────────────────
	// 1-year max-age. preload: false until we are certain all subdomains
	// are HTTPS-only and we are ready for the public preload list.
	strictTransportSecurity: {
		maxAge: 31536000,        // 1 year
		includeSubDomains: true,
		preload: false,
	},

	// crossOriginEmbedderPolicy must stay false — Socket.IO needs it
	crossOriginEmbedderPolicy: false,
	referrerPolicy: { policy: 'no-referrer-when-downgrade' },
}));

/* ── CORS configuration ── */

const allowedOrigins = [
	normalizeOrigin(process.env.FRONTEND_URL),
	normalizeOrigin(process.env.BASE_URL)
].filter(Boolean);
if (process.env.NODE_ENV !== 'production') {
	allowedOrigins.push('http://localhost:3000', 'http://localhost:5173');
}

const allowedOriginHosts = allowedOrigins.map(getOriginHost).filter(Boolean);

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieParser());
app.use(passport.initialize());

// CORS middleware: allow same-host, configured origins, and localhost dev
app.use('/api', (req, res, next) => {
	const requestHost = String(req.get('host') || '').toLowerCase();
	return cors({
		origin: function(origin, callback) {
			const normalizedOrigin = normalizeOrigin(origin);
			const originHost = getOriginHost(origin);
			if (!origin || normalizedOrigin === normalizeOrigin(process.env.BASE_URL) || normalizedOrigin === normalizeOrigin(process.env.FRONTEND_URL) || originHost === requestHost || allowedOrigins.includes(normalizedOrigin) || allowedOriginHosts.includes(originHost)) {
				callback(null, true);
			} else {
				callback(null, false);
			}
		},
		credentials: true
	})(req, res, next);
});

/* ── Rate limiters ── */
const authLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 15,
	standardHeaders: true,
	legacyHeaders: false,
	message: { success: false, error: 'Too many attempts, please try again later.' }
});

const twoFactorLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 10,
	standardHeaders: true,
	legacyHeaders: false,
	message: { success: false, error: 'Too many 2FA attempts, please try again later.' }
});

const registerLimiter = rateLimit({
	windowMs: 60 * 60 * 1000,
	max: 5,
	standardHeaders: true,
	legacyHeaders: false,
	message: { success: false, error: 'Prea multe înregistrări de pe acest IP. Încearcă mai târziu.' }
});

const avatarLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 20,
	standardHeaders: true,
	legacyHeaders: false,
	message: { success: false, error: 'Too many avatar changes, please try again later.' }
});

const uploadLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 60,
	standardHeaders: true,
	legacyHeaders: false,
	message: { success: false, error: 'Too many uploads, please try again later.' }
});

const contactLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 10,
	standardHeaders: true,
	legacyHeaders: false,
	message: { success: false, error: 'Too many messages sent, please try again later.' }
});

const friendRequestLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 30,
	standardHeaders: true,
	legacyHeaders: false,
	message: { success: false, error: 'Too many friend requests, please try again later.' }
});

const marketplaceListingLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 20,
	standardHeaders: true,
	legacyHeaders: false,
	message: { success: false, error: 'Too many listings created, please try again later.' }
});

app.post('/api/login', authLimiter);
app.post('/api/register', registerLimiter);
app.post('/api/request-reset', authLimiter);
app.post('/api/reset-password', authLimiter);
app.post('/api/2fa/verify', twoFactorLimiter);
app.post('/api/2fa/email-fallback', twoFactorLimiter);
app.post('/api/me/avatar', avatarLimiter);
app.delete('/api/me/avatar', avatarLimiter);
app.post('/api/contact', contactLimiter);
app.post('/api/uploads/presign', uploadLimiter);
app.post('/api/friends/request/:userId', friendRequestLimiter);
app.post('/api/marketplace/listings', marketplaceListingLimiter);

/* ── Request sanitize logger — scrubs sensitive fields before logging ─────
   Only active in development (NODE_ENV !== 'production').
   Must run after express.json() so req.body is parsed.
   ──────────────────────────────────────────────────────────────────────── */
app.use((req, res, next) => {
	if (req.path.startsWith('/api/') && req.method !== 'GET') {
		const sanitized = { ...req.body };
		['password', 'newPassword', 'currentPassword', 'token',
		 'secret', 'code', 'backup_code'].forEach(k => {
			if (sanitized[k]) sanitized[k] = '[REDACTED]';
		});
		if (process.env.NODE_ENV !== 'production') {
			console.log(`${req.method} ${req.path}`, sanitized);
		}
	}
	next();
});

/* ── CSP violation report sink ───────────────────────────────────────────
   Intentionally NOT rate-limited so violations are never silently dropped.
   Browsers send Content-Type: application/csp-report (old) or
   application/reports+json (Reporting API v1). Both are handled here.
   In production, forward violations to Sentry or a log aggregator.
   ─────────────────────────────────────────────────────────────────────── */
app.post(
	'/api/csp-report',
	express.text({ type: ['application/csp-report', 'application/reports+json'], limit: '50kb' }),
	(req, res) => {
		try {
			const raw = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

			// Reporting API v1 sends an array of report objects
			const reports = Array.isArray(raw) ? raw : [raw];

			reports.forEach((report) => {
				// CSP Level 2 shape: { "csp-report": { ... } }
				// Reporting API v1 shape: { "type": "csp-violation", "body": { ... } }
				const violation = report['csp-report'] || report.body || report;
				console.warn('[CSP Violation]', JSON.stringify({
					documentUri:       violation['document-uri']        || violation.documentURL,
					blockedUri:        violation['blocked-uri']         || violation.blockedURL,
					violatedDirective: violation['violated-directive']  || violation.effectiveDirective,
					originalPolicy:    violation['original-policy']     || violation.originalPolicy,
					sourceFile:        violation['source-file']         || violation.sourceFile,
					lineNumber:        violation['line-number']         || violation.lineNumber,
					columnNumber:      violation['column-number']       || violation.columnNumber,
					disposition:       violation.disposition,
					referrer:          violation.referrer               || violation['referrer'],
					timestamp:         new Date().toISOString(),
				}));
			});
		} catch (err) {
			console.warn('[CSP Violation] Failed to parse report body:', err.message);
		}
		res.status(204).end();
	}
);

/* ── Route mounting ── */
app.use('/api', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api', userRoutes);
app.use('/api', contactRoutes);
app.use('/api/auth', googleAuthRoutes);
app.use('/api/forum', forumRoutes);
app.use('/api/forum/liked', forumLikedRoutes);
app.use('/api/forum/my-posts', forumMyPostsRoutes);
app.use('/api/marketplace', express.json({ limit: '10mb' }), marketplaceRoutes);
app.use('/api/marketplace', marketplaceReviewsRoutes);
app.use('/api/repair', repairRoutes);
app.use('/api/dm', dmRoutes);
app.use('/api/stickers', stickersRoutes);
app.use('/api/community', communityPhotosRoutes);
app.use('/api/admin', adminStatsRoutes);
app.use('/api/notifications', notificationRoutes);

app.use('/api', resetProgressRoutes);

app.use('/api/consoles', consolesRoutes);
app.use('/api/achievements', achievementsRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api', coursesRoutes);
app.use('/api', reportsRoutes);
app.use('/api/ebay', ebayRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/api/workshop', workshopRoutes);
app.use('/api/console-tutorials', consoleTutorialsRoutes);
app.use('/api/console-models', consoleModelsRoutes);
app.use('/api/articles', articlesRoutes);
app.use('/api/orders', ordersRoutes);

/* ── Static files & redirects ── */

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Legacy /src/* redirect for old bookmark support
app.get('/src/*', (req, res) => {
	const target = req.originalUrl.replace(/^\/src\//, '/');
	res.redirect(301, target);
});

// Legacy/guessed URLs still showing up as 404s in Search Console — terms/
// privacy/cookies moved into the "legal files" subfolder, and marketplace/
// repair were never standalone pages (they're deep-linked panels inside
// community.html). Redirect instead of letting them 404.
const LEGACY_REDIRECTS = {
	'/html/pages/terms.html': '/html/pages/legal%20files/terms.html',
	'/html/pages/privacy.html': '/html/pages/legal%20files/privacy.html',
	'/html/pages/cookies.html': '/html/pages/legal%20files/cookies.html',
	'/html/pages/marketplace.html': '/html/pages/community.html#marketplace',
	'/html/pages/repair.html': '/html/pages/community.html#repair',
};
app.get(Object.keys(LEGACY_REDIRECTS), (req, res) => {
	res.redirect(301, LEGACY_REDIRECTS[req.path]);
});

const FRONTEND_ROOT = path.join(__dirname, '..', 'frontend');

/* ── HTML nonce-injection middleware ──────────────────────────────────────
   Intercepts GET requests for .html files BEFORE express.static handles
   them. Reads the file from disk, injects nonce="<nonce>" into every
   inline <script> tag (those without src= or nonce= attributes), then
   sends the modified HTML. Falls through to next() on read error so
   express.static can serve a proper 404.
   No caching intentionally — nonce must be unique per request.
   ─────────────────────────────────────────────────────────────────────── */
async function serveHTMLWithNonce(req, res, next, filePath, statusCode) {
	try {
		let html = await fs.readFile(filePath, 'utf8');
		const nonce = res.locals.cspNonce;

		// Inject the frontend Sentry DSN as a global variable so sentry-init.js
		// can read it at runtime without committing the value to source control.
		// The script tag carries the per-request nonce — CSP-compliant.
		const frontendDsn = process.env.SENTRY_DSN_FRONTEND || '';
		// Same pattern for the Turnstile (CAPTCHA) site key — public by design,
		// but still kept out of source control so envs can swap keys freely.
		const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY || '';
		html = html.replace(
			'</head>',
			`<script nonce="${nonce}">window.SENTRY_DSN_FRONTEND = ${JSON.stringify(frontendDsn)};window.TURNSTILE_SITE_KEY = ${JSON.stringify(turnstileSiteKey)};</script>\n</head>`
		);

		// Inject nonce into inline <script> tags.
		// Negative lookahead skips any tag that already has src= or nonce=.
		// Covers:  <script>, <script defer>, <script type="module">,
		//          <script type="application/ld+json">
		// Skips:   <script src="...">, <script nonce="...">, external modules
		html = html.replace(
			/<script(?![^>]*\b(?:src|nonce)=)([^>]*)>/g,
			`<script nonce="${nonce}"$1>`
		);
		res.status(statusCode || 200).type('html').send(html);
	} catch {
		next();
	}
}

app.use(async (req, res, next) => {
	if (req.method !== 'GET') return next();
	if (!req.path.endsWith('.html')) return next();
	const decodedPath = decodeURIComponent(req.path);
	const filePath = path.join(FRONTEND_ROOT, decodedPath);
	// Path traversal guard: resolved path must stay inside FRONTEND_ROOT
	if (!filePath.startsWith(FRONTEND_ROOT + path.sep)) return next();
	await serveHTMLWithNonce(req, res, next, filePath);
});

app.use(express.static(FRONTEND_ROOT));

app.get('/', (req, res) => {
	res.redirect(302, '/html/pages/index.html');
});

// Catch-all for /user/:username → serve user-profile.html (SPA-style route)
app.get('/user/:username', (req, res, next) => {
	// Use nonce-injecting helper — same as .html middleware above
	serveHTMLWithNonce(req, res, next, path.join(FRONTEND_ROOT, 'html', 'pages', 'user-profile.html'));
});

// ── 404 fallbacks — nothing above matched ──────────────────────────────────
// API requests get a JSON 404; everything else gets the branded 404 page.
app.use('/api', (req, res) => {
	res.status(404).json({ success: false, error: 'Not found' });
});

app.use(async (req, res, next) => {
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		return res.status(404).end();
	}
	await serveHTMLWithNonce(req, res, next, path.join(FRONTEND_ROOT, 'html', 'pages', '404.html'), 404);
});

// Sentry must capture the error before the generic handler sends the response
app.use(Sentry.expressErrorHandler());

// Global error handler
app.use((err, req, res, next) => {
	Sentry.captureException(err);
	console.error('Unhandled server error:', err);
	res.status(500).json({ error: 'Internal server error' });
});

// === SOCKET.IO SETUP (pentru notificări real-time) ===
const httpServer = http.createServer(app);
const io = socketio(httpServer, { cors: { origin: allowedOrigins, credentials: true } });
app.set('io', io);

const { authRequired: _authReq } = require('./middleware/auth');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { checkAchievements, ACHIEVEMENTS } = require('./utils/gamification');

io.on('connection', (socket) => {
  socket.on('register', async (token) => {
    if (!token || typeof token !== 'string') return;
    try {
      const JWT_SECRET = app.get('JWT_SECRET');
      let userId;
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded.userId;
      } catch {
        const { createHash } = require('crypto');
        const result = await pool.query(
          'SELECT user_id FROM user_sessions WHERE session_token = $1 AND is_active = true',
          [createHash('sha256').update(token).digest('hex')]
        );
        if (!result.rows[0]) return;
        userId = result.rows[0].user_id;
      }
      if (!userId) return;

      socket.join(String(userId));

      // Deliver any achievements that were earned but not yet notified
      // (socket was offline / in wrong room when they fired)
      const pending = await pool.query(
        `SELECT badge_id FROM user_achievements WHERE user_id = $1 AND notified_at IS NULL`,
        [userId]
      );
      if (pending.rows.length > 0) {
        const pendingIds = pending.rows.map(r => r.badge_id);
        const pendingAchs = ACHIEVEMENTS.filter(a => pendingIds.includes(a.id));
        socket.emit('achievement_unlocked', {
          awardedIds: pendingIds,
          achievements: pendingAchs.map(a => ({
            id: a.id, name: a.name, emoji: a.emoji,
            category: a.category, description: a.description, xpReward: a.xpReward,
          })),
        });
        await pool.query(
          `UPDATE user_achievements SET notified_at = NOW()
           WHERE user_id = $1 AND notified_at IS NULL`,
          [userId]
        );
      }
    } catch {}
  });
});

// === PORNEȘTE SERVERUL PE httpServer, NU pe app direct ===
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server + Socket.io running on port ${PORT}`);
});

// Marketplace sync (OLX/eBay) removed entirely 2026-09-09 — Andrei: "renuntam
// la ea, nu isi are rostu" (dropping it, doesn't make sense). This periodic
// resync job, backend/services/marketplace-sync.js, and backend/providers/
// (MarketplaceProvider.js/EbayProvider.js/OlxProvider.js) are all gone —
// routes/ebay.js now only keeps the mandatory account-deletion webhook (see
// that file's own comment for why that one specifically survives).
