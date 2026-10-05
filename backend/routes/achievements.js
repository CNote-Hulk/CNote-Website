// Achievements API route
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authRequired } = require('../middleware/auth');
const { ACHIEVEMENTS, getAchievementMetrics } = require('../utils/gamification');

router.get('/', authRequired, async (req, res) => {
    const userId = req.user.id;

    try {
        // One query for every counter + one for the stored badges (2 connections max, sequential).
        const metrics = await getAchievementMetrics(pool, userId);
        if (!metrics) {
            return res.status(404).json({ success: false, message: 'User not found.', achievements: [] });
        }
        const storedRes = await pool.query('SELECT badge_id, earned_at, xp_awarded FROM user_achievements WHERE user_id = $1', [userId]);

        const storedMap = new Map(storedRes.rows.map(r => [r.badge_id, r]));
        const storedCount = storedMap.size;

        const achievements = ACHIEVEMENTS.map(ach => {
            const { type, threshold } = ach.condition;
            let value;
            if (type === 'user_id_under') {
                value = metrics.user_id_value < threshold ? 1 : 0;
            } else if (type === 'achievements_count') {
                value = storedCount;
            } else {
                value = metrics[type] ?? 0;
            }
            const stored = storedMap.get(ach.id);
            return {
                ...ach,
                unlocked: value >= threshold,
                earned_at: stored ? stored.earned_at : null,
                xp_awarded: stored ? stored.xp_awarded : null,
            };
        });

        res.json({ success: true, achievements });
    } catch (err) {
        console.error('Error fetching achievements:', err);
        res.status(500).json({ success: false, message: 'Server error fetching achievements.', achievements: [] });
    }
});

// GET /api/achievements/user/:username — Public achievement view for any user
router.get('/user/:username', async (req, res) => {
    const { username } = req.params;
    try {
        const userResult = await pool.query(
            'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
            [username]
        );
        if (!userResult.rows.length) {
            return res.status(404).json({ success: false, message: 'User not found.', achievements: [] });
        }
        const userId = userResult.rows[0].id;

        const metrics = await getAchievementMetrics(pool, userId);
        if (!metrics) {
            return res.status(404).json({ success: false, message: 'User not found.', achievements: [] });
        }
        const storedRes = await pool.query('SELECT badge_id, earned_at FROM user_achievements WHERE user_id = $1', [userId]);

        const storedMap = new Map(storedRes.rows.map(r => [r.badge_id, r]));
        const storedCount = storedMap.size;

        const achievements = ACHIEVEMENTS.map(ach => {
            const { type, threshold } = ach.condition;
            let value;
            if (type === 'user_id_under') {
                value = metrics.user_id_value < threshold ? 1 : 0;
            } else if (type === 'achievements_count') {
                value = storedCount;
            } else {
                value = metrics[type] ?? 0;
            }
            const stored = storedMap.get(ach.id);
            return {
                ...ach,
                unlocked: value >= threshold,
                earned_at: stored ? stored.earned_at : null,
            };
        });

        res.json({ success: true, achievements });
    } catch (err) {
        console.error('Error fetching public achievements:', err);
        res.status(500).json({ success: false, message: 'Server error.', achievements: [] });
    }
});

module.exports = router;
