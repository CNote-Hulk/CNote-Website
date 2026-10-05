/* ─────────────────────────────────────────
   FILE: auth.js
   DESCRIPTION: Core authentication routes. Registration,
   login (with 2FA support), email verification, password
   reset, profile management, and two-factor setup.
   ───────────────────────────────────────── */
/* ── REQUIRED IMPORTS — DO NOT REMOVE ──────
   If you add a new package:
     1. require() it here
     2. Add it to package.json dependencies
   ────────────────────────────────────────── */
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const sharp = require('sharp');
const pool = require('../db');
const { authRequired, isActivelyBanned, liftExpiredBan } = require('../middleware/auth');
const { parseDevice } = require('../utils/device');
const emailService = require('../services/email');
const { validatePassword } = require('../utils/passwordPolicy');
const { getLevelFromXP, awardXP } = require('../utils/gamification');
const { uploadBuffer, deleteAttachment } = require('../utils/objectStorage');
const { ALLOWED_LANGS } = require('../utils/languages');
const { verifyTurnstileToken } = require('../utils/turnstile');
const { isDisposableEmail } = require('../utils/disposableEmail');

const router = express.Router();

const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

/**
 * Checks the actual file signature (magic bytes) for JPEG/PNG/WebP/GIF.
 * Rejects anything else — including SVG, which `sharp` would otherwise
 * rasterize via librsvg instead of erroring, letting untrusted markup
 * (script tags, external entity/XXE references) reach an XML parser.
 */
function isRasterImage(buffer) {
    if (!buffer || buffer.length < 12) return false;
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return true; // JPEG
    if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return true; // PNG
    if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return true; // WebP
    if (buffer.slice(0, 6).toString('ascii') === 'GIF87a' || buffer.slice(0, 6).toString('ascii') === 'GIF89a') return true; // GIF
    return false;
}

const BCRYPT_ROUNDS = 12;
const TOKEN_EXPIRY_HOURS = 24;
const PASSWORD_RESET_EXPIRY_HOURS = 1;

/* ── Helper functions ── */

/** Generate a random 64-char hex token */
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * findOrCreateSession
 * @description Finds an existing active session for the same user + stable browser + stable OS + device type.
 *              If found, reuses it (updates last_activity + metadata). Otherwise creates a new one.
 * @returns {string} session_token
 */
/** SHA-256 hash a session token for safe DB storage */
function hashSessionToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

async function findOrCreateSession(userId, deviceInfo) {
    const existing = await pool.query(
        `SELECT id FROM user_sessions
         WHERE user_id = $1
           AND device_type = $2
           AND browser ILIKE ($3 || '%')
           AND operating_system ILIKE ($4 || '%')
           AND is_active = true
         ORDER BY last_activity DESC NULLS LAST
         LIMIT 1`,
        [
            userId,
            deviceInfo.deviceType,
            deviceInfo.browserStable || deviceInfo.browser || 'Unknown',
            deviceInfo.osStable || deviceInfo.os || 'Unknown'
        ]
    );

    const rawToken = generateToken();
    const tokenHash = hashSessionToken(rawToken);

    if (existing.rows.length > 0) {
        // Reuse session but rotate the token for security
        await pool.query(
            `UPDATE user_sessions
             SET last_activity = NOW(),
                 session_token = $2,
                 browser = $3,
                 operating_system = $4,
                 ip_address = $5
             WHERE id = $1`,
            [existing.rows[0].id, tokenHash, deviceInfo.browser, deviceInfo.os, deviceInfo.ip]
        );
        return rawToken;
    }

    // No matching session — create a new one
    await pool.query(
        'INSERT INTO user_sessions (user_id, session_token, device_type, browser, operating_system, ip_address) VALUES ($1, $2, $3, $4, $5, $6)',
        [userId, tokenHash, deviceInfo.deviceType, deviceInfo.browser, deviceInfo.os, deviceInfo.ip]
    );
    return rawToken;
}

/** Calculate expiry date N hours from now */
function expiresAt(hours = TOKEN_EXPIRY_HOURS) {
    const d = new Date();
    d.setHours(d.getHours() + hours);
    return d.toISOString();
}

/* ── Trusted Device helpers ── */
const TRUSTED_DEVICE_DAYS = 30;

/** Build a SHA-256 hash from browser name + OS name + device type + IP.
 *  Browser/OS versions are ignored so auto-updates do not force new 2FA,
 *  while IP remains part of the trust decision as requested. */
function buildDeviceHash(deviceInfo) {
    const raw = [
        deviceInfo.browserStable || deviceInfo.browser,
        deviceInfo.osStable || deviceInfo.os,
        deviceInfo.deviceType || 'desktop',
        deviceInfo.ip || ''
    ].join('|');
    return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Check if a device is trusted for a given user (not expired) */
async function isDeviceTrusted(userId, deviceInfo) {
    const hash = buildDeviceHash(deviceInfo);
    const result = await pool.query(
        `SELECT id FROM trusted_devices
         WHERE user_id = $1 AND device_hash = $2 AND expires_at > NOW()
         LIMIT 1`,
        [userId, hash]
    );
    if (result.rows.length > 0) {
        // Update last_used
        await pool.query('UPDATE trusted_devices SET last_used = NOW() WHERE id = $1', [result.rows[0].id]);
        return true;
    }
    return false;
}

/** Save a device as trusted for a user */
async function trustDevice(userId, deviceInfo) {
    const hash = buildDeviceHash(deviceInfo);
    const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await pool.query(
        `INSERT INTO trusted_devices (user_id, device_hash, browser, operating_system, ip_address, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, device_hash) DO UPDATE SET last_used = NOW(), expires_at = $6`,
        [userId, hash, deviceInfo.browser, deviceInfo.os, deviceInfo.ip, expiresAt]
    );
}

/** Set HttpOnly session cookie (secure in production) */
function setSessionCookie(res, token) {
    const isProd = process.env.NODE_ENV === 'production' || String(process.env.BASE_URL || '').startsWith('https://');
    res.cookie('cn_session_token', token, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: '/'
    });
}

/** Clear session cookie on logout */
function clearSessionCookie(res) {
    const isProd = process.env.NODE_ENV === 'production' || String(process.env.BASE_URL || '').startsWith('https://');
    res.clearCookie('cn_session_token', {
        path: '/',
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax'
    });
}

/** Return user object safe for API responses (no password hash) */
function sanitizeUser(user) {
    const rawAvatarUrl = typeof user.avatar_url === 'string' ? user.avatar_url.trim() : '';
    const safeAvatarUrl = /googleusercontent\.com|ggpht\.com/i.test(rawAvatarUrl) ? '' : rawAvatarUrl;
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        bio: user.bio || '',
        avatar: user.avatar || '',
        avatar_url: safeAvatarUrl,
        favorite_consoles: user.favorite_consoles || '',
        owned_consoles: user.owned_consoles || '',
        email_verified: !!user.email_verified,
        two_factor_enabled: !!user.two_factor_enabled,
        two_factor_method: user.two_factor_method || null,
        two_factor_totp_enabled: !!user.two_factor_totp_enabled,
        two_factor_email_enabled: !!user.two_factor_email_enabled,
        google_linked: !!user.google_id,
        has_password: !!user.password_hash,
        role: user.role || 'user',
        username_chosen: user.username_chosen !== false,
        created_at: user.created_at,
        notify_new_friend: user.notify_new_friend !== false,
        notify_new_message: user.notify_new_message !== false,
        notify_repair_reply: user.notify_repair_reply !== false,
        social_discord: user.social_discord || '',
        social_twitter: user.social_twitter || '',
        social_youtube: user.social_youtube || '',
        social_instagram: user.social_instagram || '',
        show_email: !!user.show_email,
        show_stats: user.show_stats !== false,
        show_friends: user.show_friends !== false,
        show_social_links: user.show_social_links !== false,
        nickname: user.nickname || '',
        username_changed_at: user.username_changed_at || null,
        birth_date: user.birth_date || null,
        language: user.language || 'en',
        // (2026-09-01) own mute state, surfaced to self only — used by the app to disable
        // the chat composer with "muted until X" instead of letting a send silently fail
        // against forum.js/marketplace.js/dm.js's existing 403 enforcement. Not privacy-
        // sensitive: this is the user's own account, same as is_banned already implicitly is.
        muted_until: user.muted_until || null
    };
}

/* ── Routes ── */

// GET /api/check-username — Check if a username is available
router.get('/check-username', async (req, res) => {
    try {
        const username = String(req.query.username || '').trim();
        if (username.length < 3) {
            return res.json({ available: false });
        }
        const result = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
        res.json({ available: !result.rows[0] });
    } catch (err) {
        console.error('Check username error:', err.message);
        res.status(500).json({ available: false });
    }
});

// POST /api/setup-username — First-time username selection (e.g. after Google OAuth)
router.post('/setup-username', authRequired, async (req, res) => {
    try {
        const username = String(req.body.username || '').trim();

        if (username.length < 3 || username.length > 20) {
            return res.status(400).json({ success: false, error: 'Username must be between 3 and 20 characters.' });
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return res.status(400).json({ success: false, error: 'Username can only contain letters, numbers, and underscores.' });
        }

        // Check current user hasn't already chosen a username
        const current = await pool.query('SELECT username_chosen FROM users WHERE id = $1', [req.user.id]);
        if (current.rows[0]?.username_chosen) {
            return res.status(400).json({ success: false, error: 'Username already set.' });
        }

        // Check uniqueness
        const existing = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2', [username, req.user.id]);
        if (existing.rows[0]) {
            return res.status(409).json({ success: false, error: 'Username is already taken. Choose another one.' });
        }

        // Determine role: admin if username or email matches
        const isAdmin = username === 'AndreiHulk07' || (req.user.email && ['console.notebook.app@gmail.com', 'andreihlc2007@gmail.com'].includes(req.user.email.toLowerCase()));
        const role = isAdmin ? 'admin' : 'user';

        const result = await pool.query(
            'UPDATE users SET username = $1, username_chosen = TRUE, role = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
            [username, role, req.user.id]
        );

        res.json({ success: true, user: sanitizeUser(result.rows[0]) });
    } catch (err) {
        console.error('Setup username error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// POST /api/register — Create new account with email verification
router.post('/register', async (req, res) => {
    try {
        const { username, email, password, terms_accepted, privacy_accepted, turnstileToken } = req.body;

        const captcha = await verifyTurnstileToken(turnstileToken, parseDevice(req).ip);
        if (!captcha.success) {
            return res.status(400).json({ success: false, error: captcha.error });
        }

        if (!terms_accepted || !privacy_accepted) {
            return res.status(400).json({ success: false, error: 'You must accept the Terms & Conditions and Privacy Policy.' });
        }

        // Username validation
        const usernameTrimmed = String(username || '').trim();
        if (usernameTrimmed.length < 3 || usernameTrimmed.length > 20) {
            return res.status(400).json({ success: false, error: 'Username must be between 3 and 20 characters.' });
        }
        if (!/^[a-zA-Z0-9_]+$/.test(usernameTrimmed)) {
            return res.status(400).json({ success: false, error: 'Username can only contain letters, numbers, and underscores.' });
        }

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ success: false, error: 'Email address is not valid.' });
        }
        if (isDisposableEmail(email)) {
            return res.status(400).json({ success: false, error: 'Disposable/temporary email addresses are not allowed. Please use a real email address.' });
        }

        // Password strength — validated via shared policy (backend/utils/passwordPolicy.js)
        const pwdCheck = validatePassword(String(password || ''), { email, username: usernameTrimmed });
        if (!pwdCheck.valid) {
            return res.status(400).json({ success: false, error: pwdCheck.error });
        }

        // Birth date — optional field, minimum age 16 (Law 190/2018 Art. 5)
        const { birth_date } = req.body;
        if (birth_date !== undefined && birth_date !== null && birth_date !== '') {
            const dob = new Date(birth_date);
            if (isNaN(dob.getTime())) {
                return res.status(400).json({ success: false, error: 'Invalid birth date format.' });
            }
            const today = new Date();
            let age = today.getFullYear() - dob.getFullYear();
            const monthDiff = today.getMonth() - dob.getMonth();
            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
                age--;
            }
            if (age < 16) {
                return res.status(400).json({ success: false, error: 'Trebuie să ai cel puțin 16 ani pentru a te înregistra.' });
            }
        }

        const usernameCheck = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [usernameTrimmed]);
        if (usernameCheck.rows[0]) {
            return res.status(409).json({ success: false, error: 'Username is already taken. Choose another one.' });
        }

        const emailLower = email.toLowerCase().trim();
        const existingResult = await pool.query('SELECT id FROM users WHERE email = $1', [emailLower]);
        if (existingResult.rows[0]) {
            return res.status(409).json({ success: false, error: 'An account with this email already exists.' });
        }

        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const verificationToken = generateToken();
        const verificationExpiry = expiresAt();
        // birth_date column added via: ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
        // Graceful fallback: if the column doesn't exist yet (error code 42703),
        // fall back to the INSERT without it so registration keeps working.
        const safeBirthDate = (birth_date !== undefined && birth_date !== null && birth_date !== '') ? birth_date : null;
        let insertResult;
        try {
            insertResult = await pool.query(
                'INSERT INTO users (username, email, password_hash, email_verified, birth_date) VALUES ($1, $2, $3, FALSE, $4) RETURNING *',
                [usernameTrimmed, emailLower, passwordHash, safeBirthDate]
            );
        } catch (insertErr) {
            if (insertErr.code === '42703') {
                // Column not yet added — fall back to INSERT without birth_date
                insertResult = await pool.query(
                    'INSERT INTO users (username, email, password_hash, email_verified) VALUES ($1, $2, $3, FALSE) RETURNING *',
                    [usernameTrimmed, emailLower, passwordHash]
                );
            } else {
                throw insertErr;
            }
        }

        const user = insertResult.rows[0];
        await pool.query(
            'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
            [user.id, verificationToken, verificationExpiry]
        );

        const emailResult = await emailService.sendVerificationEmail(user.email, verificationToken, process.env.BASE_URL);
        const emailSent = emailResult.success;

        res.status(201).json({
            success: true,
            user: sanitizeUser(user),
            emailSent,
            message: emailSent
                ? 'Account created successfully! Check your email to activate your account.'
                : 'Account created, but the verification email could not be sent at this time.'
        });
        awardXP(pool, null, user.id, 'welcome_bonus', 'signup').catch(() => {});
    } catch (err) {
        console.error('Register error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error. Please try again.' });
    }
});

// POST /api/login — Authenticate user (supports 2FA: TOTP and email methods)
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Please fill in all fields.' });
        }

        const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
        const user = userResult.rows[0];
        if (!user) {
            return res.status(401).json({ success: false, error: 'Incorrect email or password.' });
        }

        if (!user.email_verified && !user.google_id) {
            return res.status(403).json({ success: false, error: 'email_not_verified' });
        }

        if (!user.password_hash) {
            return res.status(401).json({ success: false, error: 'This account uses Google for authentication.' });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ success: false, error: 'Incorrect email or password.' });
        }

        if (isActivelyBanned(user)) {
            const reasonSuffix = user.banned_reason ? ` Reason: ${user.banned_reason}` : '';
            const untilSuffix = user.banned_until ? ` Until: ${new Date(user.banned_until).toISOString()}` : '';
            return res.status(403).json({ success: false, error: `Your account has been suspended.${reasonSuffix}${untilSuffix}` });
        }
        if (user.is_banned) liftExpiredBan(user.id);

        // Check 2FA
        if (user.two_factor_enabled) {
            // Skip 2FA if this device is already trusted
            const deviceInfo = parseDevice(req);
            const trusted = await isDeviceTrusted(user.id, deviceInfo);
            if (trusted) {
                // Device is trusted — skip 2FA, create session directly
                const sessionToken = await findOrCreateSession(user.id, deviceInfo);
                setSessionCookie(res, sessionToken);
                const JWT_SECRET = req.app.get('JWT_SECRET');
                const jwtToken = jwt.sign(
                    { userId: user.id, email: user.email },
                    JWT_SECRET,
                    { expiresIn: '7d' }
                );
                return res.json({
                    success: true,
                    user: sanitizeUser(user),
                    token: jwtToken,
                    session_token: sessionToken
                });
            }

            const JWT_SECRET = req.app.get('JWT_SECRET');
            const tempToken = jwt.sign(
                { userId: user.id, twoFactorPending: true },
                JWT_SECRET,
                { expiresIn: '10m' }
            );

            // Determine primary method: TOTP is primary if enabled, else email
            let method;
            let canFallbackToEmail = false;
            if (user.two_factor_totp_enabled) {
                method = 'totp';
                canFallbackToEmail = !!user.two_factor_email_enabled;
            } else if (user.two_factor_email_enabled) {
                method = 'email';
            } else {
                // Legacy fallback: use two_factor_method
                method = user.two_factor_method || 'email';
            }

            if (method === 'email') {
                const code = String(crypto.randomInt(100000, 999999));
                const codeExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
                await pool.query('DELETE FROM two_factor_codes WHERE user_id = $1', [user.id]);
                await pool.query(
                    'INSERT INTO two_factor_codes (user_id, code, expires_at) VALUES ($1, $2, $3)',
                    [user.id, code, codeExpiry]
                );
                const emailResult = await emailService.sendTwoFactorEmail(user.email, code);
                if (!emailResult.success) console.error('2FA email error:', emailResult.error);
            }

            return res.json({
                success: true,
                twoFactorRequired: true,
                method,
                canFallbackToEmail,
                tempToken
            });
        }

        const deviceInfo = parseDevice(req);
        const sessionToken = await findOrCreateSession(user.id, deviceInfo);

        setSessionCookie(res, sessionToken);

        const JWT_SECRET = req.app.get('JWT_SECRET');
        const jwtToken = jwt.sign(
            { userId: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            user: sanitizeUser(user),
            token: jwtToken,
            session_token: sessionToken
        });
    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error. Please try again.' });
    }
});

// GET /api/profile — Get current user profile (from auth middleware)
router.get('/profile', authRequired, (req, res) => {
    res.json({ success: true, message: 'User authenticated', user: sanitizeUser(req.user) });
});

// POST /api/logout — Deactivate current session and clear cookie
router.post('/logout', authRequired, async (req, res) => {
    if (req.sessionId) {
        await pool.query('UPDATE user_sessions SET is_active = false WHERE id = $1', [req.sessionId]);
    }
    clearSessionCookie(res);
    res.json({ success: true });
});

// GET /api/verify-email — Verify email via token link (from email)
router.get('/verify-email', async (req, res) => {
    try {
        const token = String(req.query.token || '').trim();
        if (!token) {
            return res.status(400).json({ success: false, error: 'Invalid or expired token.' });
        }

        const rowResult = await pool.query(
            'SELECT * FROM email_verification_tokens WHERE token = $1 AND expires_at > NOW()',
            [token]
        );
        const row = rowResult.rows[0];
        if (!row) {
            return res.status(400).json({ success: false, error: 'Invalid or expired token.' });
        }

        await pool.query('UPDATE users SET email_verified = TRUE, updated_at = NOW() WHERE id = $1', [row.user_id]);
        await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [row.user_id]);

        return res.json({ success: true, message: 'Email verified successfully! You can now log in.' });
    } catch (err) {
        console.error('Verify email error:', err.message);
        return res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// POST /api/resend-verification — Resend verification email (authenticated)
router.post('/resend-verification', authRequired, async (req, res) => {
    try {
        const userResult = await pool.query('SELECT id, email, email_verified FROM users WHERE id = $1', [req.user.id]);
        const user = userResult.rows[0];
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found.' });
        }
        if (user.email_verified) {
            return res.json({ success: true, message: 'Email is already verified.', emailSent: false });
        }

        await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [user.id]);

        const token = generateToken();
        await pool.query(
            'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
            [user.id, token, expiresAt()]
        );

        const emailResult = await emailService.sendVerificationEmail(user.email, token, process.env.BASE_URL);
        if (!emailResult.success) {
            return res.status(500).json({ success: false, error: 'Could not send verification email.' });
        }
        return res.json({ success: true, emailSent: true, message: 'Verification email has been resent.' });
    } catch (err) {
        console.error('Resend verification error:', err.message);
        return res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// POST /api/resend-verification-public — Resend verification email (unauthenticated, by email)
router.post('/resend-verification-public', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required.' });
        }

        const userResult = await pool.query(
            'SELECT id, email, email_verified FROM users WHERE email = $1',
            [email]
        );
        const user = userResult.rows[0];

        if (!user || user.email_verified) {
            return res.json({ success: true, message: 'If an unverified account with this email exists, we have resent the link.' });
        }

        await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [user.id]);
        const token = generateToken();
        await pool.query(
            'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
            [user.id, token, expiresAt()]
        );

        await emailService.sendVerificationEmail(user.email, token, process.env.BASE_URL);
        return res.json({ success: true, message: 'If an unverified account with this email exists, we have resent the link.' });
    } catch (err) {
        console.error('Public resend verification error:', err.message);
        // Still return success to avoid leaking account existence
        return res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// GET /api/me — Get current user data (sanitized)
router.get('/me', authRequired, (req, res) => {
    res.json({ success: true, user: sanitizeUser(req.user) });
});

// GET /api/me/level — XP-based level system (10 levels)
router.get('/me/level', authRequired, async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await pool.query('SELECT COALESCE(xp, 0)::int AS xp FROM users WHERE id = $1', [userId]);
        const xp = result.rows[0]?.xp ?? 0;
        const levelData = getLevelFromXP(xp);
        res.json({
            success: true,
            xp,
            level: levelData.level,
            name: levelData.name,
            emoji: levelData.emoji,
            xpForCurrent: levelData.xpRequired,
            xpForNext: levelData.xpForNext,
            nextLevelName: levelData.nextLevelName,
            nextLevelEmoji: levelData.nextLevelEmoji,
            progressPercent: levelData.progressPercent,
            isMaxLevel: levelData.isMaxLevel,
        });
    } catch (err) {
        console.error('GET /me/level error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error' });
    }
});

// GET /api/me/quick-start-status — Newcomer onboarding checklist (level 1 only)
router.get('/me/quick-start-status', authRequired, async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await pool.query(
            `SELECT
               u.xp,
               (u.avatar IS NOT NULL AND u.avatar != '' AND u.bio IS NOT NULL AND u.bio != '') AS profile_complete,
               EXISTS(SELECT 1 FROM user_lessons
                 WHERE user_id = u.id AND completed = true) AS lesson_complete,
               EXISTS(SELECT 1 FROM user_achievements
                 WHERE user_id = u.id AND badge_id = 'console_3') AS console_3,
               EXISTS(SELECT 1 FROM user_achievements
                 WHERE user_id = u.id AND badge_id = 'first_favorite') AS first_favorite,
               EXISTS(SELECT 1 FROM messages
                 WHERE user_id = u.id) AS first_chat_message,
               EXISTS(SELECT 1 FROM user_achievements
                 WHERE user_id = u.id AND badge_id = 'first_post') AS first_post
             FROM users u WHERE u.id = $1`,
            [userId]
        );

        if (!result.rows.length) return res.status(404).json({ success: false });

        const row = result.rows[0];
        const xp = parseInt(row.xp, 10) || 0;
        const XP_WATCHER = 150;

        const tasks = {
            registered: true,
            profile_complete: row.profile_complete,
            lesson_complete: row.lesson_complete,
            console_3: row.console_3,
            first_favorite: row.first_favorite,
            first_chat_message: row.first_chat_message,
            first_post: row.first_post,
        };

        const allDone = Object.values(tasks).every(Boolean);

        res.json({
            success: true,
            show: !allDone,
            xp,
            xpNeeded: XP_WATCHER,
            progressPercent: Math.min(100, Math.round((xp / XP_WATCHER) * 100)),
            tasks,
        });
    } catch (err) {
        console.error('GET /me/quick-start-status error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error' });
    }
});

const USERNAME_COOLDOWN_DAYS = 7;

// PUT /api/me — Update profile (username, bio, avatar, favorite_consoles)
router.put('/me', authRequired, async (req, res) => {
    const { username, bio, favorite_consoles, owned_consoles, notify_new_friend, notify_new_message, notify_repair_reply, social_discord, social_twitter, social_youtube, social_instagram, show_email, show_stats, show_friends, show_social_links, nickname, birth_date, language } = req.body;
    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (username !== undefined) {
        const trimmed = String(username).trim();
        if (trimmed.length < 3 || trimmed.length > 20) {
            return res.status(400).json({ success: false, error: 'Username must be 3–20 characters.' });
        }
        if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
            return res.status(400).json({ success: false, error: 'Username may only contain letters, numbers and underscores.' });
        }
        // Check if username is actually changing
        const currentResult = await pool.query('SELECT username, username_changed_at FROM users WHERE id = $1', [req.user.id]);
        const current = currentResult.rows[0];
        const usernameChanging = current && current.username.toLowerCase() !== trimmed.toLowerCase();
        if (usernameChanging) {
            if (current.username_changed_at) {
                const daysSince = (Date.now() - new Date(current.username_changed_at).getTime()) / (1000 * 60 * 60 * 24);
                if (daysSince < USERNAME_COOLDOWN_DAYS) {
                    const nextChange = new Date(new Date(current.username_changed_at).getTime() + USERNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
                    return res.status(429).json({ success: false, error: `You can change your username again on ${nextChange.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.` });
                }
            }
            const dup = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2', [trimmed, req.user.id]);
            if (dup.rows.length > 0) {
                return res.status(400).json({ success: false, error: 'Username is already taken.' });
            }
            updates.push(`username_changed_at = NOW()`);
        }
        updates.push(`username = $${paramIndex++}`);
        params.push(trimmed);
    }
    if (bio !== undefined) {
        updates.push(`bio = $${paramIndex++}`);
        params.push(String(bio).trim().slice(0, 500));
    }
    if (favorite_consoles !== undefined) {
        updates.push(`favorite_consoles = $${paramIndex++}`);
        params.push(String(favorite_consoles));
    }
    if (owned_consoles !== undefined) {
        updates.push(`owned_consoles = $${paramIndex++}`);
        params.push(String(owned_consoles));
    }
    if (notify_new_friend !== undefined) {
        updates.push(`notify_new_friend = $${paramIndex++}`);
        params.push(!!notify_new_friend);
    }
    if (notify_new_message !== undefined) {
        updates.push(`notify_new_message = $${paramIndex++}`);
        params.push(!!notify_new_message);
    }
    if (notify_repair_reply !== undefined) {
        updates.push(`notify_repair_reply = $${paramIndex++}`);
        params.push(!!notify_repair_reply);
    }
    if (social_discord !== undefined) {
        updates.push(`social_discord = $${paramIndex++}`);
        params.push(String(social_discord));
    }
    if (social_twitter !== undefined) {
        updates.push(`social_twitter = $${paramIndex++}`);
        params.push(String(social_twitter));
    }
    if (social_youtube !== undefined) {
        updates.push(`social_youtube = $${paramIndex++}`);
        params.push(String(social_youtube));
    }
    if (social_instagram !== undefined) {
        updates.push(`social_instagram = $${paramIndex++}`);
        params.push(String(social_instagram));
    }
    if (show_email !== undefined) {
        updates.push(`show_email = $${paramIndex++}`);
        params.push(!!show_email);
    }
    if (show_stats !== undefined) {
        updates.push(`show_stats = $${paramIndex++}`);
        params.push(!!show_stats);
    }
    if (show_friends !== undefined) {
        updates.push(`show_friends = $${paramIndex++}`);
        params.push(!!show_friends);
    }
    if (show_social_links !== undefined) {
        updates.push(`show_social_links = $${paramIndex++}`);
        params.push(!!show_social_links);
    }
    if (nickname !== undefined) {
        updates.push(`nickname = $${paramIndex++}`);
        params.push(String(nickname).trim().slice(0, 50));
    }
    if (birth_date !== undefined) {
        if (birth_date === null || birth_date === '') {
            updates.push(`birth_date = NULL`);
        } else {
            const dob = new Date(birth_date);
            if (isNaN(dob.getTime())) {
                return res.status(400).json({ success: false, error: 'Invalid birth date format.' });
            }
            const minAge = new Date();
            minAge.setFullYear(minAge.getFullYear() - 13);
            if (dob > minAge) {
                return res.status(400).json({ success: false, error: 'You must be at least 13 years old.' });
            }
            updates.push(`birth_date = $${paramIndex++}`);
            params.push(birth_date);
        }
    }
    if (language !== undefined) {
        if (!ALLOWED_LANGS.includes(language)) {
            return res.status(400).json({ success: false, error: 'Unsupported language.' });
        }
        updates.push(`language = $${paramIndex++}`);
        params.push(language);
    }

    if (updates.length === 0) {
        return res.status(400).json({ success: false, error: 'Nothing to update.' });
    }

    updates.push('updated_at = NOW()');
    params.push(req.user.id);

    try {
        await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`, params);
        const updatedResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        const updatedUser = updatedResult.rows[0];
        res.json({ success: true, user: sanitizeUser(updatedUser) });
        if (updatedUser.avatar && updatedUser.bio) {
            awardXP(pool, req.app.get('io'), req.user.id, 'profile_complete', 'done').catch(() => {});
        }
    } catch (err) {
        console.error('Update profile error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// POST /api/me/avatar — Upload a new profile picture
router.post('/me/avatar', authRequired, (req, res) => {
    avatarUpload.single('avatar')(req, res, async (err) => {
        if (err) {
            const message = err.code === 'LIMIT_FILE_SIZE'
                ? 'Image must be smaller than 5MB.'
                : 'Could not process upload.';
            return res.status(400).json({ success: false, error: message });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No image provided.' });
        }
        if (!isRasterImage(req.file.buffer)) {
            return res.status(400).json({ success: false, error: 'Invalid image file.' });
        }

        let processed;
        try {
            processed = await sharp(req.file.buffer)
                .rotate()
                .resize(512, 512, { fit: 'cover' })
                .webp({ quality: 85 })
                .toBuffer();
        } catch {
            return res.status(400).json({ success: false, error: 'Invalid image file.' });
        }

        const objectPath = `avatars/${req.user.id}.webp`; // fixed key — overwritten on every re-upload, no orphaned old avatars
        try {
            const publicUrl = await uploadBuffer(objectPath, processed, 'image/webp');
            const avatarUrl = `${publicUrl}?v=${Date.now()}`;

            await pool.query('UPDATE users SET avatar = $1, updated_at = NOW() WHERE id = $2', [avatarUrl, req.user.id]);
            const updatedResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
            const updatedUser = updatedResult.rows[0];
            res.json({ success: true, user: sanitizeUser(updatedUser) });
            if (updatedUser.avatar && updatedUser.bio) {
                awardXP(pool, req.app.get('io'), req.user.id, 'profile_complete', 'done').catch(() => {});
            }
        } catch (uploadErr) {
            console.error('Avatar upload error:', uploadErr.message);
            res.status(503).json({ success: false, error: 'Avatar storage is not available — try again shortly.' });
        }
    });
});

// DELETE /api/me/avatar — Remove the current profile picture
router.delete('/me/avatar', authRequired, async (req, res) => {
    try {
        await deleteAttachment(`avatars/${req.user.id}.webp`);
        await pool.query('UPDATE users SET avatar = $1, updated_at = NOW() WHERE id = $2', ['', req.user.id]);
        const updatedResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        res.json({ success: true, user: sanitizeUser(updatedResult.rows[0]) });
    } catch (err) {
        console.error('Avatar remove error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// PUT /api/me/email — Change email address (requires current password)
router.put('/me/email', authRequired, async (req, res) => {
    try {
        const { newEmail, currentPassword } = req.body;

        if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
            return res.status(400).json({ success: false, error: 'Email address is not valid.' });
        }
        if (!currentPassword) {
            return res.status(400).json({ success: false, error: 'Enter your current password to change your email.' });
        }

        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        const user = userResult.rows[0];
        const valid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!valid) {
            return res.status(403).json({ success: false, error: 'Current password is incorrect.' });
        }

        const emailLower = newEmail.toLowerCase().trim();
        if (emailLower === user.email) {
            return res.status(400).json({ success: false, error: 'New email is the same as the current one.' });
        }

        const dupResult = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [emailLower, req.user.id]);
        if (dupResult.rows[0]) {
            return res.status(409).json({ success: false, error: 'An account with this email already exists.' });
        }

        await pool.query('UPDATE users SET email = $1, email_verified = FALSE, updated_at = NOW() WHERE id = $2', [emailLower, req.user.id]);

        // Send verification email for the new address
        await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [req.user.id]);
        const verificationToken = generateToken();
        await pool.query(
            'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
            [req.user.id, verificationToken, expiresAt()]
        );
        const vResult = await emailService.sendVerificationEmail(emailLower, verificationToken, process.env.BASE_URL);
        if (!vResult.success) console.error('Verification email after email change failed:', vResult.error);

        const updatedResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        res.json({ success: true, user: sanitizeUser(updatedResult.rows[0]), message: 'Email changed. Check the new email to confirm it.' });
    } catch (err) {
        console.error('Update email error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// PUT /api/me/password — Change password (requires current password)
router.put('/me/password', authRequired, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        // Full policy check — applies to both Google-only and normal-password paths
        const pwdCheck = validatePassword(String(newPassword || ''));
        if (!pwdCheck.valid) {
            return res.status(400).json({ success: false, error: pwdCheck.error });
        }

        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        const user = userResult.rows[0];

        // Google-only users can set initial password without current password
        if (!user.password_hash) {
            const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
            await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.user.id]);
            return res.json({ success: true, message: 'Password has been set.' });
        }

        if (!currentPassword) {
            return res.status(400).json({ success: false, error: 'Enter your current password.' });
        }

        const valid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!valid) {
            return res.status(403).json({ success: false, error: 'Current password is incorrect.' });
        }

        const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
        await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.user.id]);

        res.json({ success: true });
    } catch (err) {
        console.error('Update password error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// POST /api/account/set-password — Set initial password (for Google-only accounts)
router.post('/account/set-password', authRequired, async (req, res) => {
    try {
        const { password, confirmPassword } = req.body || {};

        const userResult = await pool.query('SELECT id, password_hash FROM users WHERE id = $1', [req.user.id]);
        const user = userResult.rows[0];
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found.' });
        }

        if (user.password_hash) {
            return res.status(400).json({ success: false, error: 'You already have a password set. Use the change password option.' });
        }

        const pwdCheck = validatePassword(String(password || ''));
        if (!pwdCheck.valid) {
            return res.status(400).json({ success: false, error: pwdCheck.error });
        }
        if (password !== confirmPassword) {
            return res.status(400).json({ success: false, error: 'Passwords do not match.' });
        }

        const hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
        await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.user.id]);

        res.json({ success: true, message: 'Password has been set successfully.' });
    } catch (err) {
        console.error('Set password error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// DELETE /api/account — Permanently delete account and all related data
router.delete('/account', authRequired, async (req, res) => {
    const client = await pool.connect();
    try {
        const { password, confirmText } = req.body || {};

        const userResult = await client.query('SELECT id, password_hash FROM users WHERE id = $1', [req.user.id]);
        const user = userResult.rows[0];
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found.' });
        }

        if (user.password_hash) {
            if (!password) {
                return res.status(400).json({ success: false, error: 'Password is required.' });
            }
            const valid = await bcrypt.compare(String(password), user.password_hash);
            if (!valid) {
                return res.status(401).json({ success: false, error: 'Incorrect password.' });
            }
        } else {
            if (confirmText !== 'DELETE' && confirmText !== 'STERGE') {
                return res.status(400).json({ success: false, error: 'Type DELETE to confirm.' });
            }
        }

        await client.query('BEGIN');

        // Ordered cleanup to avoid FK errors.
        await client.query('DELETE FROM user_sessions WHERE user_id = $1', [req.user.id]);
        await client.query('DELETE FROM user_favorites WHERE user_id = $1', [req.user.id]);
        await client.query('DELETE FROM user_owned_consoles WHERE user_id = $1', [req.user.id]);
        await client.query('DELETE FROM friends WHERE user1_id = $1 OR user2_id = $1', [req.user.id]);
        await client.query('DELETE FROM friend_requests WHERE sender_id = $1 OR receiver_id = $1', [req.user.id]);
        await client.query('DELETE FROM console_ratings WHERE user_id = $1', [req.user.id]);
        await client.query('DELETE FROM messages WHERE user_id = $1', [req.user.id]);
        await client.query('DELETE FROM two_factor_codes WHERE user_id = $1', [req.user.id]);
        await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [req.user.id]);
        await client.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [req.user.id]);
        await client.query('DELETE FROM users WHERE id = $1', [req.user.id]);

        await client.query('COMMIT');
        clearSessionCookie(res);
        return res.json({ success: true });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch { }
        console.error('Delete account error:', err.message);
        return res.status(500).json({ success: false, error: 'Internal error.' });
    } finally {
        client.release();
    }
});

// GET /api/check-reset-token — Validate a reset token without consuming it
router.get('/check-reset-token', async (req, res) => {
    const token = String(req.query.token || '').trim();
    if (!token) return res.status(400).json({ valid: false, error: 'Missing token.' });
    try {
        const result = await pool.query(
            'SELECT id FROM password_reset_tokens WHERE token = $1 AND expires_at > NOW()',
            [token]
        );
        if (!result.rows[0]) return res.status(400).json({ valid: false, error: 'Invalid or expired token.' });
        res.json({ valid: true });
    } catch (err) {
        console.error('check-reset-token error:', err.message);
        res.status(500).json({ valid: false, error: 'Internal error.' });
    }
});

// POST /api/request-reset — Request password reset (sends email with token)
router.post('/request-reset', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, error: 'Email is required.' });

        const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
        const user = userResult.rows[0];

        if (!user) {
            return res.json({ success: true, message: 'If an account with this email exists, you will receive a reset link.' });
        }

        await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);

        const token = generateToken();
        await pool.query('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)', [user.id, token, expiresAt(PASSWORD_RESET_EXPIRY_HOURS)]);

        emailService.sendPasswordResetEmail(user.email, token, process.env.BASE_URL).then(result => {
            if (!result.success) console.error('Failed to send reset email:', result.error);
        });

        res.json({ success: true, message: 'If an account with this email exists, you will receive a reset link.' });
    } catch (err) {
        console.error('Request reset error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// POST /api/reset-password — Reset password using token from email
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        if (!token) return res.status(400).json({ success: false, error: 'Missing token.' });
        const pwdCheck = validatePassword(String(newPassword || ''));
        if (!pwdCheck.valid) {
            return res.status(400).json({ success: false, error: pwdCheck.error });
        }

        const rowResult = await pool.query(
            'SELECT * FROM password_reset_tokens WHERE token = $1 AND expires_at > NOW()',
            [token]
        );
        const row = rowResult.rows[0];
        if (!row) {
            return res.status(400).json({ success: false, error: 'Invalid or expired token.' });
        }

        const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
        await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, row.user_id]);

        await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [row.user_id]);
        await pool.query('UPDATE user_sessions SET is_active = false WHERE user_id = $1', [row.user_id]);

        res.json({ success: true, message: 'Password has been reset. You can now log in with your new password.' });
    } catch (err) {
        console.error('Reset password error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ─── Two-Factor Authentication Routes ───────────────────

/* ── Two-Factor Authentication (2FA) ── */

// POST /api/2fa/verify — Verify 2FA code during login (TOTP or email)
router.post('/2fa/verify', async (req, res) => {
    try {
        // Accept tempToken from Authorization header OR request body
        const authHeader = req.headers.authorization;
        const tempToken = (authHeader && authHeader.startsWith('Bearer '))
            ? authHeader.slice(7)
            : req.body?.tempToken;

        if (!tempToken) {
            return res.status(401).json({ success: false, error: 'Missing token.' });
        }
        const JWT_SECRET = req.app.get('JWT_SECRET');

        let decoded;
        try {
            decoded = jwt.verify(tempToken, JWT_SECRET);
        } catch {
            return res.status(401).json({ success: false, error: 'Session has expired. Please log in again.' });
        }

        if (!decoded.twoFactorPending) {
            return res.status(400).json({ success: false, error: 'Token invalid.' });
        }

        const { code, method: requestedMethod } = req.body || {};
        const codeStr = String(code || '').trim();
        if (!codeStr || (requestedMethod === 'backup' ? codeStr.length !== 8 : codeStr.length !== 6)) {
            return res.status(400).json({ success: false, error: requestedMethod === 'backup' ? 'Backup code must be 8 characters.' : 'Code must be 6 digits.' });
        }

        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
        const user = userResult.rows[0];
        if (!user) {
            return res.status(401).json({ success: false, error: 'User not found.' });
        }

        const cleanCode = codeStr;

        // Determine which method to verify: use requested method if valid, else detect
        let verifyMethod = requestedMethod;
        if (!verifyMethod || (verifyMethod !== 'email' && verifyMethod !== 'totp' && verifyMethod !== 'backup')) {
            // Auto-detect: if user has totp enabled and no explicit email request, use totp
            if (user.two_factor_totp_enabled) {
                verifyMethod = 'totp';
            } else if (user.two_factor_email_enabled) {
                verifyMethod = 'email';
            } else {
                // Legacy fallback
                verifyMethod = user.two_factor_method || 'email';
            }
        }

        if (verifyMethod === 'email') {
            const codeResult = await pool.query(
                'SELECT * FROM two_factor_codes WHERE user_id = $1 AND code = $2 AND used = FALSE AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
                [user.id, cleanCode]
            );
            if (!codeResult.rows[0]) {
                return res.status(401).json({ success: false, error: 'Invalid or expired code.' });
            }
            await pool.query('UPDATE two_factor_codes SET used = TRUE WHERE id = $1', [codeResult.rows[0].id]);
        } else if (verifyMethod === 'totp') {
            const speakeasy = require('speakeasy');
            const isValid = speakeasy.totp.verify({
                secret: user.two_factor_secret,
                encoding: 'base32',
                token: cleanCode,
                window: 1
            });
            if (!isValid) {
                return res.status(401).json({ success: false, error: 'Invalid code.' });
            }
        } else if (verifyMethod === 'backup') {
            // Backup codes are 8-char alphanumeric, stored as SHA-256 hashes
            const codeHash = crypto.createHash('sha256').update(cleanCode.toLowerCase()).digest('hex');
            const backupResult = await pool.query(
                'SELECT id FROM two_factor_backup_codes WHERE user_id = $1 AND code_hash = $2 AND used = FALSE LIMIT 1',
                [user.id, codeHash]
            );
            if (!backupResult.rows[0]) {
                return res.status(401).json({ success: false, error: 'Invalid backup code.' });
            }
            await pool.query('UPDATE two_factor_backup_codes SET used = TRUE, used_at = NOW() WHERE id = $1', [backupResult.rows[0].id]);
        } else {
            return res.status(400).json({ success: false, error: 'Unknown 2FA method.' });
        }

        // 2FA verified — create real session
        const deviceInfo = parseDevice(req);
        const sessionToken = await findOrCreateSession(user.id, deviceInfo);

        // If user asked to trust this device, save it
        if (req.body.trustDevice) {
            await trustDevice(user.id, deviceInfo);
        }

        setSessionCookie(res, sessionToken);

        const jwtToken = jwt.sign(
            { userId: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            user: sanitizeUser(user),
            token: jwtToken,
            session_token: sessionToken
        });
    } catch (err) {
        console.error('2FA verify error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// POST /api/2fa/fallback-email — Send 2FA code via email when TOTP unavailable
router.post('/2fa/fallback-email', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const tempToken = (authHeader && authHeader.startsWith('Bearer '))
            ? authHeader.slice(7)
            : req.body?.tempToken;

        if (!tempToken) {
            return res.status(401).json({ success: false, error: 'Missing token.' });
        }
        const JWT_SECRET = req.app.get('JWT_SECRET');

        let decoded;
        try {
            decoded = jwt.verify(tempToken, JWT_SECRET);
        } catch {
            return res.status(401).json({ success: false, error: 'Session has expired. Please log in again.' });
        }

        if (!decoded.twoFactorPending) {
            return res.status(400).json({ success: false, error: 'Token invalid.' });
        }

        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
        const user = userResult.rows[0];
        if (!user) {
            return res.status(401).json({ success: false, error: 'User not found.' });
        }

        if (!user.two_factor_email_enabled) {
            return res.status(400).json({ success: false, error: 'Email 2FA is not enabled.' });
        }

        const code = String(crypto.randomInt(100000, 999999));
        const codeExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        await pool.query('DELETE FROM two_factor_codes WHERE user_id = $1', [user.id]);
        await pool.query(
            'INSERT INTO two_factor_codes (user_id, code, expires_at) VALUES ($1, $2, $3)',
            [user.id, code, codeExpiry]
        );
        const fallbackResult = await emailService.sendTwoFactorEmail(user.email, code);
        if (!fallbackResult.success) {
            console.error('2FA fallback email error:', fallbackResult.error);
            return res.status(500).json({ success: false, error: 'Could not send the email.' });
        }

        res.json({ success: true, message: 'Code has been sent to your email.' });
    } catch (err) {
        console.error('2FA fallback-email error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// POST /api/2fa/setup/totp — Generate TOTP secret + QR code for setup
router.post('/2fa/setup/totp', authRequired, async (req, res) => {
    try {
        const speakeasy = require('speakeasy');
        const QRCode = require('qrcode');

        const secret = speakeasy.generateSecret({
            name: 'CNote (' + req.user.email + ')',
            issuer: 'CNote'
        });

        const qrCode = await QRCode.toDataURL(secret.otpauth_url);

        res.json({
            success: true,
            secret: secret.base32,
            qrCode
        });
    } catch (err) {
        console.error('TOTP setup error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// POST /api/2fa/setup/totp/confirm — Confirm TOTP setup with verification code
router.post('/2fa/setup/totp/confirm', authRequired, async (req, res) => {
    try {
        const { code, secret } = req.body || {};
        if (!code || !secret) {
            return res.status(400).json({ success: false, error: 'Code and secret are required.' });
        }

        const speakeasy = require('speakeasy');
        const isValid = speakeasy.totp.verify({
            secret,
            encoding: 'base32',
            token: String(code).trim(),
            window: 1
        });

        if (!isValid) {
            return res.status(400).json({ success: false, error: 'Code is not valid. Try again.' });
        }

        await pool.query(
            'UPDATE users SET two_factor_enabled = TRUE, two_factor_method = $1, two_factor_secret = $2, two_factor_totp_enabled = TRUE, updated_at = NOW() WHERE id = $3',
            ['totp', secret, req.user.id]
        );

        res.json({ success: true, message: 'Authenticator 2FA has been enabled.' });
    } catch (err) {
        console.error('TOTP confirm error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// POST /api/2fa/setup/email — Enable email-based 2FA
router.post('/2fa/setup/email', authRequired, async (req, res) => {
    try {
        // Determine method: if totp is also enabled, keep method as totp (primary)
        const userResult = await pool.query('SELECT two_factor_totp_enabled FROM users WHERE id = $1', [req.user.id]);
        const hasTotp = userResult.rows[0]?.two_factor_totp_enabled;
        const method = hasTotp ? 'totp' : 'email';

        await pool.query(
            'UPDATE users SET two_factor_enabled = TRUE, two_factor_method = $1, two_factor_email_enabled = TRUE, updated_at = NOW() WHERE id = $2',
            [method, req.user.id]
        );
        res.json({ success: true, message: 'Email 2FA has been enabled.' });
    } catch (err) {
        console.error('Email 2FA setup error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// DELETE /api/2fa/disable — Disable all 2FA methods (requires password)
router.delete('/2fa/disable', authRequired, async (req, res) => {
    try {
        const { password, method } = req.body || {};

        const userResult = await pool.query('SELECT id, password_hash, two_factor_totp_enabled, two_factor_email_enabled FROM users WHERE id = $1', [req.user.id]);
        const user = userResult.rows[0];

        if (user.password_hash) {
            if (!password) {
                return res.status(400).json({ success: false, error: 'Password is required.' });
            }
            const valid = await bcrypt.compare(String(password), user.password_hash);
            if (!valid) {
                return res.status(401).json({ success: false, error: 'Incorrect password.' });
            }
        }

        if (method === 'totp') {
            // Disable only TOTP
            const stillHasEmail = !!user.two_factor_email_enabled;
            await pool.query(
                'UPDATE users SET two_factor_totp_enabled = FALSE, two_factor_secret = NULL, two_factor_enabled = $1, two_factor_method = $2, updated_at = NOW() WHERE id = $3',
                [stillHasEmail, stillHasEmail ? 'email' : null, req.user.id]
            );
            await pool.query('DELETE FROM two_factor_backup_codes WHERE user_id = $1', [req.user.id]);
            res.json({ success: true, message: 'Authenticator 2FA has been disabled.' });
        } else if (method === 'email') {
            // Disable only email
            const stillHasTotp = !!user.two_factor_totp_enabled;
            await pool.query(
                'UPDATE users SET two_factor_email_enabled = FALSE, two_factor_enabled = $1, two_factor_method = $2, updated_at = NOW() WHERE id = $3',
                [stillHasTotp, stillHasTotp ? 'totp' : null, req.user.id]
            );
            await pool.query('DELETE FROM two_factor_codes WHERE user_id = $1', [req.user.id]);
            res.json({ success: true, message: 'Email 2FA has been disabled.' });
        } else {
            // Disable all
            await pool.query(
                'UPDATE users SET two_factor_enabled = FALSE, two_factor_method = NULL, two_factor_secret = NULL, two_factor_totp_enabled = FALSE, two_factor_email_enabled = FALSE, updated_at = NOW() WHERE id = $1',
                [req.user.id]
            );
            await pool.query('DELETE FROM two_factor_codes WHERE user_id = $1', [req.user.id]);
            await pool.query('DELETE FROM two_factor_backup_codes WHERE user_id = $1', [req.user.id]);
            await pool.query('DELETE FROM trusted_devices WHERE user_id = $1', [req.user.id]);
            res.json({ success: true, message: '2FA has been completely disabled.' });
        }
    } catch (err) {
        console.error('2FA disable error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// POST /api/2fa/backup-codes/generate — Generate 10 backup codes (called after TOTP setup)
router.post('/2fa/backup-codes/generate', authRequired, async (req, res) => {
    try {
        // Only allow if user has 2FA enabled
        if (!req.user.two_factor_enabled) {
            return res.status(400).json({ success: false, error: '2FA must be enabled first.' });
        }

        // Delete old backup codes
        await pool.query('DELETE FROM two_factor_backup_codes WHERE user_id = $1', [req.user.id]);

        // Generate 10 random 8-char alphanumeric backup codes
        const codes = [];
        for (let i = 0; i < 10; i++) {
            const code = crypto.randomBytes(4).toString('hex'); // 8 hex chars
            codes.push(code);
            const hash = crypto.createHash('sha256').update(code.toLowerCase()).digest('hex');
            await pool.query(
                'INSERT INTO two_factor_backup_codes (user_id, code_hash) VALUES ($1, $2)',
                [req.user.id, hash]
            );
        }

        res.json({ success: true, codes });
    } catch (err) {
        console.error('Generate backup codes error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// POST /api/2fa/backup-codes/regenerate — Regenerate backup codes (requires password)
router.post('/2fa/backup-codes/regenerate', authRequired, async (req, res) => {
    try {
        if (!req.user.two_factor_enabled) {
            return res.status(400).json({ success: false, error: '2FA must be enabled first.' });
        }

        const { password } = req.body || {};
        if (req.user.password_hash) {
            if (!password) {
                return res.status(400).json({ success: false, error: 'Password is required.' });
            }
            const valid = await bcrypt.compare(String(password), req.user.password_hash);
            if (!valid) {
                return res.status(401).json({ success: false, error: 'Incorrect password.' });
            }
        }

        // Delete old backup codes
        await pool.query('DELETE FROM two_factor_backup_codes WHERE user_id = $1', [req.user.id]);

        // Generate 10 new codes
        const codes = [];
        for (let i = 0; i < 10; i++) {
            const code = crypto.randomBytes(4).toString('hex');
            codes.push(code);
            const hash = crypto.createHash('sha256').update(code.toLowerCase()).digest('hex');
            await pool.query(
                'INSERT INTO two_factor_backup_codes (user_id, code_hash) VALUES ($1, $2)',
                [req.user.id, hash]
            );
        }

        res.json({ success: true, codes });
    } catch (err) {
        console.error('Regenerate backup codes error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// GET /api/2fa/backup-codes/count — Get count of remaining unused backup codes
router.get('/2fa/backup-codes/count', authRequired, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT COUNT(*) AS remaining FROM two_factor_backup_codes WHERE user_id = $1 AND used = FALSE',
            [req.user.id]
        );
        res.json({ success: true, remaining: parseInt(result.rows[0].remaining, 10) });
    } catch (err) {
        console.error('Backup codes count error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// GET /api/trusted-devices — List all trusted devices for the current user
router.get('/trusted-devices', authRequired, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, browser, operating_system, ip_address, created_at, last_used, expires_at
             FROM trusted_devices
             WHERE user_id = $1 AND expires_at > NOW()
             ORDER BY last_used DESC`,
            [req.user.id]
        );
        res.json({ success: true, devices: result.rows });
    } catch (err) {
        console.error('List trusted devices error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// DELETE /api/trusted-devices/:id — Revoke a specific trusted device
router.delete('/trusted-devices/:id', authRequired, async (req, res) => {
    try {
        const deviceId = parseInt(req.params.id, 10);
        if (isNaN(deviceId)) {
            return res.status(400).json({ success: false, error: 'Invalid device ID.' });
        }
        await pool.query(
            'DELETE FROM trusted_devices WHERE id = $1 AND user_id = $2',
            [deviceId, req.user.id]
        );
        res.json({ success: true, message: 'Device has been revoked.' });
    } catch (err) {
        console.error('Revoke trusted device error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// DELETE /api/trusted-devices — Revoke all trusted devices for the current user
router.delete('/trusted-devices', authRequired, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM trusted_devices WHERE user_id = $1',
            [req.user.id]
        );
        res.json({ success: true, message: 'All trusted devices have been revoked.' });
    } catch (err) {
        console.error('Revoke all trusted devices error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// POST /api/me/set-password-email — Send a set-password link to a Google-only account's email
router.post('/me/set-password-email', authRequired, async (req, res) => {
    try {
        const userResult = await pool.query('SELECT id, email, password_hash FROM users WHERE id = $1', [req.user.id]);
        const user = userResult.rows[0];
        if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

        if (user.password_hash) {
            return res.status(400).json({ success: false, error: 'Your account already has a password. Use the change password option instead.' });
        }

        // Reuse the password_reset_tokens table — same flow, same page, just different email copy
        await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);
        const token = generateToken();
        await pool.query(
            'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
            [user.id, token, expiresAt(PASSWORD_RESET_EXPIRY_HOURS)]
        );

        emailService.sendSetPasswordEmail(user.email, token, process.env.BASE_URL).then(result => {
            if (!result.success) console.error('Failed to send set-password email:', result.error);
        });

        res.json({ success: true, message: 'Email sent! Check your inbox for the set-password link.' });
    } catch (err) {
        console.error('Set-password-email error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// POST /api/me/email-change-notify — Send security notification to old email after email change
router.post('/me/email-change-notify', authRequired, async (req, res) => {
    try {
        const { oldEmail, newEmail } = req.body || {};
        if (!oldEmail || !newEmail) {
            return res.status(400).json({ success: false, error: 'Missing oldEmail or newEmail.' });
        }

        // Generate a reset token so the user can recover access if the change was unauthorised
        await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [req.user.id]);
        const token = generateToken();
        await pool.query(
            'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
            [req.user.id, token, expiresAt()]
        );

        emailService.sendEmailChangedNotification(oldEmail, newEmail, token, process.env.BASE_URL).then(result => {
            if (!result.success) console.error('Failed to send email-changed notification:', result.error);
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Email-change-notify error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// POST /api/me/password-changed-notify — Send security notification email after password change
router.post('/me/password-changed-notify', authRequired, async (req, res) => {
    try {
        const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [req.user.id]);
        const user = userResult.rows[0];
        if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

        // Generate a fresh reset token so the user can undo if unauthorised
        await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [req.user.id]);
        const token = generateToken();
        await pool.query(
            'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
            [req.user.id, token, expiresAt()]
        );

        emailService.sendPasswordChangedNotification(user.email, token, process.env.BASE_URL).then(result => {
            if (!result.success) console.error('Failed to send password-changed notification:', result.error);
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Password-changed-notify error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── GDPR data export — in-memory rate limit (3 exports per day per user) ──
const exportRateLimitMap = new Map();

function checkExportRateLimit(userId) {
    const key = `export:${userId}`;
    const now = Date.now();
    const window = 24 * 3600 * 1000; // 24 hours
    const limit = 3;
    let entry = exportRateLimitMap.get(key);
    if (!entry || now > entry.resetTime) {
        entry = { count: 0, resetTime: now + window };
        exportRateLimitMap.set(key, entry);
    }
    entry.count++;
    if (entry.count > limit) {
        return { blocked: true, msBeforeNext: entry.resetTime - now };
    }
    return { blocked: false };
}

// GET /api/me/export — GDPR data export (synchronous JSON download)
router.get('/me/export', authRequired, async (req, res) => {
    // Rate limit: 3 exports per day per user
    try {
        const limitResult = checkExportRateLimit(req.user.id);
        if (limitResult.blocked) {
            res.set('Retry-After', Math.ceil(limitResult.msBeforeNext / 1000));
            return res.status(429).json({ success: false, error: 'Poți exporta datele de cel mult 3 ori pe zi.' });
        }
    } catch (limiterErr) {
        console.error('Export rate limiter error:', limiterErr.message);
        // Never block on limiter failure
    }

    try {
        // ── Profile (exclude password_hash and 2FA secrets) ─────────────
        const userResult = await pool.query(
            `SELECT id, username, email, bio, avatar, avatar_url,
                    favorite_consoles, owned_consoles, email_verified,
                    two_factor_enabled, two_factor_method,
                    two_factor_totp_enabled, two_factor_email_enabled,
                    google_id IS NOT NULL AS google_linked,
                    role, created_at, updated_at,
                    notify_new_friend, notify_new_message, notify_repair_reply,
                    social_discord, social_twitter, social_youtube, social_instagram,
                    show_email, show_stats, show_friends, show_social_links,
                    nickname, username_changed_at, birth_date
             FROM users WHERE id = $1`,
            [req.user.id]
        );
        // birth_date column may not exist yet — suppress that error gracefully
        let profileRow = userResult.rows[0];
        if (!profileRow) {
            return res.status(404).json({ success: false, error: 'User not found.' });
        }

        // ── Forum threads ────────────────────────────────────────────────
        const threadsResult = await pool.query(
            'SELECT id, console, title, body, tag, views, upvotes, created_at FROM forum_threads WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );

        // ── Forum replies ────────────────────────────────────────────────
        const repliesResult = await pool.query(
            'SELECT id, thread_id, body, upvotes, created_at FROM forum_replies WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );

        // ── DMs sent ─────────────────────────────────────────────────────
        const dmsResult = await pool.query(
            'SELECT id, receiver_id, message, listing_id, created_at FROM direct_messages WHERE sender_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );

        // ── Marketplace listings ─────────────────────────────────────────
        const listingsResult = await pool.query(
            'SELECT id, title, description, price, condition, category, location, country, created_at FROM listings WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );

        // ── Favorites ────────────────────────────────────────────────────
        const consoleFavsResult = await pool.query(
            'SELECT console_id, created_at FROM user_favorites WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        const listingFavsResult = await pool.query(
            'SELECT listing_id, created_at FROM listing_favorites WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );

        // ── Achievements (optional table) ─────────────────────────────────
        let achievements = [];
        try {
            const achievementsResult = await pool.query(
                'SELECT badge_id, earned_at FROM user_achievements WHERE user_id = $1 ORDER BY earned_at DESC',
                [req.user.id]
            );
            achievements = achievementsResult.rows;
        } catch { /* table may not exist — skip silently */ }

        // ── Reports submitted ─────────────────────────────────────────────
        const reportsResult = await pool.query(
            'SELECT id, content_type, content_id, reason, description, created_at FROM content_reports WHERE reporter_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );

        const payload = {
            exportedAt: new Date().toISOString(),
            user: profileRow,
            forum_threads: threadsResult.rows,
            forum_replies: repliesResult.rows,
            direct_messages: dmsResult.rows,
            listings: listingsResult.rows,
            favorites: {
                consoles: consoleFavsResult.rows,
                listings: listingFavsResult.rows
            },
            achievements,
            reports: reportsResult.rows
        };

        res.json({ success: true, ...payload });
    } catch (err) {
        console.error('GDPR export error:', err.message);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

router.findOrCreateSession = findOrCreateSession;
module.exports = router;
