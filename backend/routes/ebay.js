const express = require('express');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

// eBay marketplace sync (OAuth connect/callback/status/disconnect, listings
// import) was removed 2026-09-09 — Andrei: "renuntam la ea, nu isi are
// rostu" (dropping it, doesn't make sense). Only these two routes survive:
// they're a MANDATORY eBay compliance endpoint any registered eBay developer
// app must keep answering (the "Marketplace Account Deletion" notification
// eBay itself calls, unrelated to CNote's own users — see the log line
// below), completely independent of whether the integration is actually
// used. Disabling it risks eBay revoking the developer app's API
// credentials entirely, which matters even with sync gone in case the app
// registration is ever needed again. If Andrei deregisters the eBay
// developer app itself (an action on eBay's side, not this repo), this
// whole file can go too — until then, keep it.

// GET /api/ebay/account-deletion — eBay endpoint verification challenge
router.get('/account-deletion', (req, res) => {
    const challengeCode = req.query.challenge_code;
    if (!challengeCode) {
        return res.status(400).json({ error: 'Missing challenge_code' });
    }

    const verificationToken = process.env.EBAY_VERIFICATION_TOKEN || '';
    const endpointUrl = process.env.EBAY_DELETION_ENDPOINT_URL || '';

    const hash = crypto
        .createHash('sha256')
        .update(challengeCode + verificationToken + endpointUrl)
        .digest('hex');

    return res.json({ challengeResponse: hash });
});

// POST /api/ebay/account-deletion — Marketplace Account Deletion notification
router.post('/account-deletion', async (req, res) => {
    try {
        const notification = req.body?.notification;
        const data = notification?.data || {};
        const userId = data.userId;
        const username = data.username;

        if (userId) {
            try {
                await db.query(
                    `DELETE FROM marketplace_accounts WHERE provider = 'ebay' AND provider_user_id = $1`,
                    [String(userId)]
                );
            } catch (dbErr) {
                console.error('eBay deletion DB error:', dbErr.message);
            }
            console.log('eBay account deletion processed:', userId, username || '');
        }

        return res.json({ acknowledged: true });
    } catch (err) {
        console.error('eBay account-deletion handler error:', err.message);
        // Always return 200 — eBay retries on 5xx
        return res.json({ acknowledged: true });
    }
});

module.exports = router;
