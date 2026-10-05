/* ─────────────────────────────────────────
   FILE: auth.js
   DESCRIPTION: Authentication middleware. Validates JWT from
   Authorization header, falls back to session cookie lookup.
   Attaches user object and session info to req.
   ───────────────────────────────────────── */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');

function hashSessionToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * isActivelyBanned / liftExpiredBan
 * @description (2026-09-01) Bans can now be permanent (banned_until IS NULL) or
 *              for a fixed period (banned_until in the future) — see
 *              routes/reports.js's ban-author, which accepts an optional `hours`.
 *              A row with is_banned=TRUE whose banned_until has already passed is
 *              no longer actively banned; liftExpiredBan clears it (fire-and-forget,
 *              errors ignored — worst case it re-checks next request) so the user
 *              doesn't stay flagged banned forever in the DB once their time is up.
 */
function isActivelyBanned(user) {
    if (!user.is_banned) return false;
    if (!user.banned_until) return true; // permanent
    return new Date(user.banned_until).getTime() > Date.now();
}

function liftExpiredBan(userId) {
    pool.query(
        `UPDATE users SET is_banned = FALSE, banned_reason = NULL, banned_at = NULL, banned_until = NULL WHERE id = $1`,
        [userId]
    ).catch(() => {});
}

/**
 * authRequired
 * @description Express middleware that authenticates requests.
 *              Strategy: try JWT verification first; if that fails,
 *              fall back to session_token lookup in user_sessions table.
 *              On success, attaches req.user, req.sessionId, req.sessionToken.
 */
async function authRequired(req, res, next) {
    const token = extractToken(req);
    if (!token) {
        return res.status(401).json({ success: false, error: 'Autentificare necesara.' });
    }

    const JWT_SECRET = req.app.get('JWT_SECRET');

    // Strategy 1: verify JWT from Authorization header.
    // (2026-10-05) Only a failed *verification* may fall through to the
    // session-token lookup below. The user lookup used to sit in the same
    // try with an empty catch, so a transient DB error (e.g. EMAXCONNSESSION
    // when the Supabase pooler was full) on a perfectly valid JWT fell through
    // to Strategy 2, found no session row for the JWT, and answered 401
    // "Sesiune invalida" — which the frontend treats as "logged out" and wipes
    // the local session. That was the "logged out on every reload" bug.
    let decoded = null;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch {
        decoded = null;
    }

    if (decoded) {
        let user;
        try {
            const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
            user = userResult.rows[0];
        } catch (dbErr) {
            console.error('Auth user DB error:', dbErr);
            return res.status(503).json({ success: false, error: 'Service temporarily unavailable. Please try again.', retryable: true });
        }
        if (!user) {
            return res.status(401).json({ success: false, error: 'Utilizator inexistent.' });
        }
        if (isActivelyBanned(user)) {
            return res.status(401).json({ success: false, error: 'Cont suspendat.', banned: true });
        }
        if (user.is_banned) liftExpiredBan(user.id);
        req.user = {
            id: user.id,
            username: user.username,
            email: user.email,
            bio: user.bio,
            avatar: user.avatar,
            favorite_consoles: user.favorite_consoles,
            owned_consoles: user.owned_consoles,
            email_verified: user.email_verified,
            two_factor_enabled: user.two_factor_enabled,
            two_factor_method: user.two_factor_method,
            two_factor_totp_enabled: user.two_factor_totp_enabled,
            two_factor_email_enabled: user.two_factor_email_enabled,
            google_id: user.google_id,
            avatar_url: user.avatar_url,
            password_hash: user.password_hash || null,
            role: user.role || 'user',
            username_chosen: user.username_chosen !== false,
            created_at: user.created_at,
            birth_date: user.birth_date || null,
            notify_new_friend: user.notify_new_friend,
            notify_new_message: user.notify_new_message,
            notify_repair_reply: user.notify_repair_reply,
            social_discord: user.social_discord,
            social_twitter: user.social_twitter,
            social_youtube: user.social_youtube,
            social_instagram: user.social_instagram,
            show_email: user.show_email,
            show_stats: user.show_stats,
            show_friends: user.show_friends,
            show_social_links: user.show_social_links,
            nickname: user.nickname,
            username_changed_at: user.username_changed_at,
            language: user.language,
            muted_until: user.muted_until
        };
        return next();
    }

    // Strategy 2: fall back to session token lookup in DB
    let sessionResult;
    try {
        // DB: join user_sessions with users where session is still active
        sessionResult = await pool.query(`
        SELECT s.id AS session_id, s.user_id, u.id, u.username, u.email, u.bio, u.avatar,
               u.favorite_consoles, u.owned_consoles,
               u.email_verified, u.two_factor_enabled, u.two_factor_method,
               u.two_factor_totp_enabled, u.two_factor_email_enabled,
               u.google_id, u.avatar_url, u.password_hash,
               u.role, u.username_chosen,
               u.created_at, u.birth_date,
               u.notify_new_friend, u.notify_new_message, u.notify_repair_reply,
               u.social_discord, u.social_twitter, u.social_youtube, u.social_instagram,
               u.show_email, u.show_stats, u.show_friends, u.show_social_links,
               u.nickname, u.username_changed_at, u.language,
               u.is_banned, u.banned_until, u.muted_until
        FROM user_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.session_token = $1 AND s.is_active = true
        `, [hashSessionToken(token)]);
    } catch (dbErr) {
        // A DB failure is not an invalid session — 503, never 401, so the client keeps its login.
        console.error('Auth session DB error:', dbErr);
        return res.status(503).json({ success: false, error: 'Service temporarily unavailable. Please try again.', retryable: true });
    }

    const session = sessionResult.rows[0];
    if (!session) {
        return res.status(401).json({ success: false, error: 'Sesiune invalida sau expirata.' });
    }
    if (isActivelyBanned(session)) {
        return res.status(401).json({ success: false, error: 'Cont suspendat.', banned: true });
    }
    if (session.is_banned) liftExpiredBan(session.user_id);

    // DB: update last_activity timestamp for this session. Fire-and-forget:
    // it's bookkeeping, and an unhandled rejection here (async middleware,
    // Express 4) would leave the request hanging instead of answering.
    pool.query('UPDATE user_sessions SET last_activity = NOW() WHERE id = $1', [session.session_id])
        .catch(err => console.error('Session last_activity update failed:', err.message));

    req.user = {
        id: session.user_id,
        username: session.username,
        email: session.email,
        bio: session.bio,
        avatar: session.avatar,
        favorite_consoles: session.favorite_consoles,
        owned_consoles: session.owned_consoles,
        email_verified: session.email_verified,
        two_factor_enabled: session.two_factor_enabled,
        two_factor_method: session.two_factor_method,
        two_factor_totp_enabled: session.two_factor_totp_enabled,
        two_factor_email_enabled: session.two_factor_email_enabled,
        google_id: session.google_id,
        avatar_url: session.avatar_url,
        password_hash: session.password_hash || null,
        role: session.role || 'user',
        username_chosen: session.username_chosen !== false,
        created_at: session.created_at,
        birth_date: session.birth_date || null,
        notify_new_friend: session.notify_new_friend,
        notify_new_message: session.notify_new_message,
        notify_repair_reply: session.notify_repair_reply,
        social_discord: session.social_discord,
        social_twitter: session.social_twitter,
        social_youtube: session.social_youtube,
        social_instagram: session.social_instagram,
        show_email: session.show_email,
        show_stats: session.show_stats,
        show_friends: session.show_friends,
        show_social_links: session.show_social_links,
        nickname: session.nickname,
        username_changed_at: session.username_changed_at,
        language: session.language,
        muted_until: session.muted_until
    };
    req.sessionId = session.session_id;
    req.sessionToken = token;
    next();
}

/**
 * extractToken
 * @description Extracts auth token from: 1) Authorization: Bearer header,
 *              2) cn_session_token cookie, 3) ?token= query param.
 */
function extractToken(req) {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) return auth.slice(7);

    const cookies = parseCookies(req.headers.cookie || '');
    if (cookies['cn_session_token']) return cookies['cn_session_token'];

    // Only allow ?token= for SSE endpoint (EventSource doesn't support custom headers)
    if (req.path === '/events' && req.query && typeof req.query.token === 'string') {
        return req.query.token.trim() || null;
    }

    return null;
}

/**
 * parseCookies
 * @description Manual cookie string parser (avoids library dependency).
 */
function parseCookies(cookieStr) {
    const result = {};
    cookieStr.split(';').forEach(pair => {
        const [key, ...vals] = pair.trim().split('=');
        if (key) result[key.trim()] = decodeURIComponent(vals.join('='));
    });
    return result;
}

/**
 * authOptional
 * @description Like authRequired, but does NOT return 401 if no token.
 *              If token is present and valid, attaches req.user.
 *              If missing or invalid, req.user stays undefined and request continues.
 */
async function authOptional(req, res, next) {
    const token = extractToken(req);
    if (!token) return next();

    const JWT_SECRET = req.app.get('JWT_SECRET');

    // Same split as authRequired: a valid JWT never falls through to the
    // session-token lookup; on a DB error the request just continues anonymous.
    let decoded = null;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch {
        decoded = null;
    }
    if (decoded) {
        try {
            const userResult = await pool.query('SELECT id, username FROM users WHERE id = $1', [decoded.userId]);
            if (userResult.rows[0]) {
                req.user = { id: userResult.rows[0].id, username: userResult.rows[0].username };
            }
        } catch (dbErr) {
            console.error('authOptional user DB error:', dbErr.message);
        }
        return next();
    }

    try {
        const sessionResult = await pool.query(`
            SELECT s.user_id, u.username FROM user_sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.session_token = $1 AND s.is_active = true
        `, [hashSessionToken(token)]);
        if (sessionResult.rows[0]) {
            req.user = { id: sessionResult.rows[0].user_id, username: sessionResult.rows[0].username };
        }
    } catch {}

    next();
}

module.exports = { authRequired, authOptional, isActivelyBanned, liftExpiredBan };
