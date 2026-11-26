/**
 * Notification Routes — /api/notifications
 * In-app notifications for forum replies, DMs, listings, etc.
 * Uses PostgreSQL pool from db.js.
 */
/* ── REQUIRED IMPORTS — DO NOT REMOVE ──────
   If you add a new package:
     1. require() it here
     2. Add it to package.json dependencies
   ────────────────────────────────────────── */
const express = require('express');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');
const { sendPushToUser } = require('../services/firebaseAdmin');

const router = express.Router();

const VALID_TYPES = ['forum_reply', 'new_dm', 'listing_interest', 'listing_sold', 'repair_accepted', 'upvote', 'friend_request', 'friend_accepted', 'achievement_unlocked', 'shop_order'];

// ── GET /api/notifications ───────────────────────────────
router.get('/', authRequired, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, type, message, link, read, created_at
            FROM notifications
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 50
        `, [req.user.id]);

        res.json({ success: true, notifications: result.rows });
    } catch (err) {
        console.error('Notifications GET error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── GET /api/notifications/unread-count ──────────────────
router.get('/unread-count', authRequired, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = false',
            [req.user.id]
        );
        res.json({ success: true, count: parseInt(result.rows[0].count) });
    } catch (err) {
        console.error('Notifications unread GET error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── POST /api/notifications/:id/read ─────────────────────
router.post('/:id/read', authRequired, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID.' });

    try {
        await pool.query(
            'UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Notification read POST error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── POST /api/notifications/read-all ─────────────────────
router.post('/read-all', authRequired, async (req, res) => {
    try {
        await pool.query(
            'UPDATE notifications SET read = true WHERE user_id = $1 AND read = false',
            [req.user.id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Notifications read-all POST error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── POST /api/notifications/register-token ───────────────
// Registers/refreshes a device's FCM push token (DM notifications). Upserts on
// (user_id, fcm_token) — the same device re-registering (e.g. app relaunch)
// just bumps updated_at instead of creating a duplicate row.
router.post('/register-token', authRequired, async (req, res) => {
    const { fcmToken, deviceInfo } = req.body;
    if (!fcmToken || typeof fcmToken !== 'string' || !fcmToken.trim()) {
        return res.status(400).json({ success: false, error: 'fcmToken is required.' });
    }

    try {
        await pool.query(
            `INSERT INTO user_fcm_tokens (user_id, fcm_token, device_info)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, fcm_token) DO UPDATE SET updated_at = NOW()`,
            [req.user.id, fcmToken.trim(), deviceInfo ? String(deviceInfo).slice(0, 255) : '']
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Register FCM token POST error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── POST /api/notifications/notify-dm ────────────────────
// The Android app writes DMs straight to Supabase (bypassing /api/dm/send
// entirely), so that route's push trigger never fires for app-to-app chat.
// This endpoint lets the app explicitly ask the backend to push-notify the
// receiver after a successful Supabase insert — no direct_messages write here,
// the app already did that; this only fans out the FCM push.
router.post('/notify-dm', authRequired, async (req, res) => {
    const receiverId = parseInt(req.body.receiverId);
    const message = typeof req.body.message === 'string' ? req.body.message : '';
    if (!receiverId || receiverId === req.user.id) {
        return res.status(400).json({ success: false, error: 'Invalid receiverId.' });
    }

    try {
        const body = message.length > 100 ? `${message.slice(0, 100)}...` : message;
        const senderAvatar = await getUserAvatar(req.user.id);
        await sendPushToUser(receiverId, req.user.username, body, {
            type: 'dm',
            senderId: String(req.user.id),
            senderAvatar,
            conversationWith: String(req.user.id),
            // Lets a multi-account-on-one-device client (Android's account switcher) know
            // which of ITS saved accounts this push is addressed to, so notification actions
            // (Reply/Mark as read) authenticate as that account instead of whichever one
            // happens to be active in the app — see MessageNotifier.kt on the app.
            receiverId: String(receiverId)
        });
        res.json({ success: true });
    } catch (err) {
        console.error('notify-dm POST error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

// ── POST /api/notifications/notify-dm-reaction ───────────
// Same rationale as notify-dm above: reactions are written straight to Supabase's
// message_reactions table (see ChatViewModel.toggleReaction on the app), so this
// endpoint is the only way the receiver ever gets FCM-pushed about one. Reused as
// a "dm" push (same MessagingStyle stack on the app) rather than its own channel —
// a reaction is just another line in the same conversation thread.
router.post('/notify-dm-reaction', authRequired, async (req, res) => {
    const receiverId = parseInt(req.body.receiverId);
    const emoji = typeof req.body.emoji === 'string' ? req.body.emoji.slice(0, 8) : '';
    const messagePreview = typeof req.body.messagePreview === 'string' ? req.body.messagePreview.slice(0, 80) : '';
    if (!receiverId || receiverId === req.user.id || !emoji) {
        return res.status(400).json({ success: false, error: 'Invalid request.' });
    }

    try {
        const body = messagePreview ? `${emoji} reacted: "${messagePreview}"` : `${emoji} reacted to your message`;
        const senderAvatar = await getUserAvatar(req.user.id);
        await sendPushToUser(receiverId, req.user.username, body, {
            type: 'dm_reaction',
            senderId: String(req.user.id),
            senderAvatar,
            conversationWith: String(req.user.id),
            receiverId: String(receiverId)
        });
        res.json({ success: true });
    } catch (err) {
        console.error('notify-dm-reaction POST error:', err);
        res.status(500).json({ success: false, error: 'Internal error.' });
    }
});

/**
 * getUserAvatar
 * @description Looks up a user's avatar URL for embedding in a push payload.
 * Returns '' (never null/undefined — FCM data values must all be strings) if
 * the user has no avatar set or the lookup fails.
 */
async function getUserAvatar(userId) {
    try {
        const result = await pool.query('SELECT avatar FROM users WHERE id = $1', [userId]);
        return result.rows[0]?.avatar || '';
    } catch {
        return '';
    }
}

/**
 * Helper: create a notification (used by other routes)
 * Usage: const { createNotification } = require('./notifications');
 */
async function createNotification(userId, type, message, link, req) {
    if (!userId || !VALID_TYPES.includes(type)) return;
    try {
        await pool.query(
            'INSERT INTO notifications (user_id, type, message, link) VALUES ($1, $2, $3, $4)',
            [userId, type, String(message).slice(0, 500), String(link || '').slice(0, 500)]
        );
        // Emitere notificare live dacă există io
        if (req && req.app && req.app.get('io')) {
            req.app.get('io').to(String(userId)).emit('notification', { type, message, link });
        }
    } catch (err) {
        console.error('createNotification error:', err);
    }
}

module.exports = router;
module.exports.createNotification = createNotification;
