const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authRequired } = require('../middleware/auth');
const { checkAchievements } = require('../utils/gamification');

router.post('/reset-progress', authRequired, async (req, res) => {
    try {
        const userId = req.user.id;
        await resetUserData(userId);
        // Re-calculează achievements din zero pe baza datelor rămase
        // (postări, prieteni, DM-uri — care nu se șterg la reset)
        await checkAchievements(pool, null, userId);
        res.json({ success: true, message: 'All progress has been reset.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Reset failed' });
    }
});



// Each query runs independently — a missing table won't block the rest
async function resetUserData(userId) {
    const queries = [
        'DELETE FROM user_lessons WHERE user_id = $1',
        'DELETE FROM user_achievements WHERE user_id = $1',
        'DELETE FROM user_console_visits WHERE user_id = $1',
        'DELETE FROM user_favorites WHERE user_id = $1',
        'DELETE FROM user_owned_consoles WHERE user_id = $1',
        'DELETE FROM xp_transactions WHERE user_id = $1',
        'DELETE FROM course_part_completions WHERE user_id = $1',
    ];
    for (const q of queries) {
        try { await pool.query(q, [userId]); } catch (_) { /* table may not exist yet */ }
    }
    // Reset XP counter on the user row
    try { await pool.query('UPDATE users SET xp = 0, xp_updated_at = NOW() WHERE id = $1', [userId]); } catch (_) {}
}

module.exports = router;