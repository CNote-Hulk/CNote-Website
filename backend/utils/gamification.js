/**
 * gamification.js — Single source of truth for levels, XP, and achievements.
 * All other files import from here. Never define levels/achievements/XP values elsewhere.
 */

const LEVELS = [
    { level: 1,  name: 'Newcomer',   emoji: '🔌', xpRequired: 0     },
    { level: 2,  name: 'Watcher',    emoji: '📺', xpRequired: 150   },
    { level: 3,  name: 'Player',     emoji: '🕹️', xpRequired: 400   },
    { level: 4,  name: 'Collector',  emoji: '🧩', xpRequired: 800   },
    { level: 5,  name: 'Tinkerer',   emoji: '🔧', xpRequired: 1500  },
    { level: 6,  name: 'Explorer',   emoji: '📡', xpRequired: 2500  },
    { level: 7,  name: 'Enthusiast', emoji: '🏆', xpRequired: 4000  },
    { level: 8,  name: 'Historian',  emoji: '🎓', xpRequired: 6000  },
    { level: 9,  name: 'Technician', emoji: '⚙️', xpRequired: 9000  },
    { level: 10, name: 'Legend',     emoji: '👑', xpRequired: 13000 },
];

const XP_ACTIONS = {
    welcome_bonus:       { xp: 50,  limit: 'once',         description: 'Welcome to Console Notebook' },
    lesson_complete:     { xp: 50,  limit: 'per_item',      description: 'Completed a lesson' },
    lesson_perfect:      { xp: 30,  limit: 'per_item',      description: 'Perfect quiz score' },
    course_complete:     { xp: 200, limit: 'per_item',      description: 'Completed a course' },
    first_course:        { xp: 100, limit: 'once',          description: 'First course completed' },
    console_visit:       { xp: 10,  limit: 'per_item',      description: 'Visited a console page' },
    console_favorite:    { xp: 5,   limit: 'per_item',      description: 'Added console to favorites' },
    console_owned:       { xp: 8,   limit: 'per_item',      description: 'Added console to owned' },
    friend_added:        { xp: 15,  limit: 'daily_cap_150', description: 'Added a friend' },
    forum_post:          { xp: 20,  limit: 'daily_cap_100', description: 'Posted in forum' },
    forum_reply:         { xp: 10,  limit: 'daily_cap_60',  description: 'Replied in forum' },
    post_upvoted:        { xp: 5,   limit: 'daily_cap_50',  description: 'Your post was upvoted' },
    first_dm:            { xp: 10,  limit: 'once',          description: 'Sent first DM' },
    marketplace_listing: { xp: 15,  limit: 'daily_cap_45',  description: 'Created a listing' },
    profile_complete:    { xp: 25,  limit: 'once',          description: 'Completed your profile' },
    first_chat_message:  { xp: 10,  limit: 'once',          description: 'First chat message' },
    ebay_connected:      { xp: 30,  limit: 'once',          description: 'Connected eBay account' },
};

const ACHIEVEMENTS = [
    // Learning (7)
    { id: 'first_lesson',    name: 'First Step',        emoji: '📝', category: 'learning',
      description: 'Complete your first lesson',
      condition: { type: 'lessons_completed', threshold: 1 },  xpReward: 20 },
    { id: 'lesson_5',        name: 'Quick Learner',     emoji: '🔍', category: 'learning',
      description: 'Complete 5 lessons',
      condition: { type: 'lessons_completed', threshold: 5 },  xpReward: 30 },
    { id: 'lesson_15',       name: 'Dedicated Student', emoji: '📚', category: 'learning',
      description: 'Complete 15 lessons',
      condition: { type: 'lessons_completed', threshold: 15 }, xpReward: 50 },
    { id: 'lesson_30',       name: 'Scholar',           emoji: '🎒', category: 'learning',
      description: 'Complete 30 lessons',
      condition: { type: 'lessons_completed', threshold: 30 }, xpReward: 75 },
    { id: 'first_course',    name: 'Graduate',          emoji: '🎓', category: 'learning',
      description: 'Complete your first course',
      condition: { type: 'courses_completed', threshold: 1 },  xpReward: 100 },
    { id: 'perfect_quiz',    name: 'Perfectionist',     emoji: '💯', category: 'learning',
      description: 'Score 100% on a quiz',
      condition: { type: 'perfect_quizzes', threshold: 1 },    xpReward: 40 },
    { id: 'quiz_streak_5',   name: 'Quiz Master',       emoji: '🧠', category: 'learning',
      description: '5 perfect quiz scores',
      condition: { type: 'perfect_quizzes', threshold: 5 },    xpReward: 80 },

    // Explorer (6)
    { id: 'console_3',       name: 'Scout',             emoji: '🧭', category: 'explorer',
      description: 'Visit 3 console pages',
      condition: { type: 'consoles_visited', threshold: 3 },   xpReward: 15 },
    { id: 'console_10',      name: 'Explorer',          emoji: '🗺️', category: 'explorer',
      description: 'Visit 10 console pages',
      condition: { type: 'consoles_visited', threshold: 10 },  xpReward: 30 },
    { id: 'console_25',      name: 'Archivist',         emoji: '🗂️', category: 'explorer',
      description: 'Visit 25 console pages',
      condition: { type: 'consoles_visited', threshold: 25 },  xpReward: 50 },
    { id: 'console_52',      name: 'Encyclopedia',      emoji: '📖', category: 'explorer',
      description: 'Visit all console pages',
      condition: { type: 'consoles_visited', threshold: 52 },  xpReward: 150 },
    { id: 'first_favorite',  name: 'Wishlist',          emoji: '❤️', category: 'explorer',
      description: 'Add your first console to favorites',
      condition: { type: 'consoles_favorited', threshold: 1 }, xpReward: 10 },
    { id: 'first_owned',     name: 'Owner',             emoji: '🎮', category: 'explorer',
      description: 'Add your first owned console',
      condition: { type: 'consoles_owned', threshold: 1 },     xpReward: 10 },

    // Community (6)
    { id: 'first_post',      name: 'Voice',             emoji: '💬', category: 'community',
      description: 'Create your first forum post',
      condition: { type: 'forum_posts', threshold: 1 },        xpReward: 25 },
    { id: 'post_10',         name: 'Contributor',       emoji: '✍️', category: 'community',
      description: 'Create 10 forum posts',
      condition: { type: 'forum_posts', threshold: 10 },       xpReward: 50 },
    { id: 'first_friend',    name: 'Connected',         emoji: '👋', category: 'community',
      description: 'Add your first friend',
      condition: { type: 'friends_count', threshold: 1 },      xpReward: 20 },
    { id: 'friends_5',       name: 'Sociable',          emoji: '🦋', category: 'community',
      description: 'Have 5 friends',
      condition: { type: 'friends_count', threshold: 5 },      xpReward: 40 },
    { id: 'first_dm',        name: 'Messenger',         emoji: '✉️', category: 'community',
      description: 'Send your first direct message',
      condition: { type: 'dms_sent', threshold: 1 },           xpReward: 10 },
    { id: 'helpful_5',       name: 'Helper',            emoji: '⭐', category: 'community',
      description: 'Receive 5 upvotes on your posts',
      condition: { type: 'upvotes_received', threshold: 5 },   xpReward: 30 },

    // Marketplace (4)
    { id: 'first_listing',   name: 'Seller',            emoji: '🏷️', category: 'marketplace',
      description: 'Create your first listing',
      condition: { type: 'listings_created', threshold: 1 },   xpReward: 25 },
    { id: 'listing_5',       name: 'Dealer',            emoji: '🛒', category: 'marketplace',
      description: 'Create 5 listings',
      condition: { type: 'listings_created', threshold: 5 },   xpReward: 50 },
    { id: 'first_ebay',      name: 'Connected Seller',  emoji: '🔗', category: 'marketplace',
      description: 'Connect your eBay account',
      condition: { type: 'ebay_connected', threshold: 1 },     xpReward: 30 },
    { id: 'collector_5',     name: 'Hoarder',           emoji: '📦', category: 'marketplace',
      description: 'Own 5 consoles in your collection',
      condition: { type: 'consoles_owned', threshold: 5 },     xpReward: 40 },

    // Veteran (4)
    { id: 'week_1',          name: 'Regular',           emoji: '📅', category: 'veteran',
      description: 'Member for 7 days',
      condition: { type: 'days_member', threshold: 7 },        xpReward: 20 },
    { id: 'month_1',         name: 'Loyal',             emoji: '🗓️', category: 'veteran',
      description: 'Member for 30 days',
      condition: { type: 'days_member', threshold: 30 },       xpReward: 50 },
    { id: 'month_3',         name: 'Dedicated',         emoji: '🏅', category: 'veteran',
      description: 'Member for 90 days',
      condition: { type: 'days_member', threshold: 90 },       xpReward: 80 },
    { id: 'year_1',          name: 'Veteran',           emoji: '🏛️', category: 'veteran',
      description: 'Member for 365 days',
      condition: { type: 'days_member', threshold: 365 },      xpReward: 150 },

    // Special (3)
    { id: 'profile_complete', name: 'Identity',         emoji: '✨', category: 'special',
      description: 'Complete your profile (avatar + bio)',
      condition: { type: 'profile_complete', threshold: 1 },   xpReward: 30 },
    { id: 'early_adopter',   name: 'Founder',           emoji: '🌟', category: 'special',
      description: 'One of the first 100 members',
      condition: { type: 'user_id_under', threshold: 100 },    xpReward: 100 },
    { id: 'completionist',   name: 'Completionist',     emoji: '💎', category: 'special',
      description: 'Unlock all other achievements',
      condition: { type: 'achievements_count', threshold: 29 }, xpReward: 500 },
];

/**
 * Returns the current level object plus progress info for a given XP amount.
 * Always returns a valid object — never null/undefined.
 */
function getLevelFromXP(xp) {
    const safeXp = Math.max(0, parseInt(xp) || 0);
    let currentLevel = LEVELS[0];
    for (const level of LEVELS) {
        if (safeXp >= level.xpRequired) {
            currentLevel = level;
        } else {
            break;
        }
    }
    const currentIndex = LEVELS.indexOf(currentLevel);
    const nextLevel = LEVELS[currentIndex + 1] || null;
    return {
        ...currentLevel,
        xp: safeXp,
        xpForNext: nextLevel ? nextLevel.xpRequired : currentLevel.xpRequired,
        nextLevelName: nextLevel ? nextLevel.name : null,
        nextLevelEmoji: nextLevel ? nextLevel.emoji : null,
        progressPercent: nextLevel
            ? Math.round(((safeXp - currentLevel.xpRequired) /
                (nextLevel.xpRequired - currentLevel.xpRequired)) * 100)
            : 100,
        isMaxLevel: !nextLevel,
    };
}

/**
 * Award XP to a user. Idempotent — duplicate calls for the same action+reference are safe.
 * Internally calls checkAchievements after every successful award.
 *
 * @returns {{ xpAwarded: number, newTotal: number, leveledUp: boolean, newLevel: object|null }}
 */
async function awardXP(pool, io, userId, actionType, referenceId = null) {
    const action = XP_ACTIONS[actionType];
    if (!action) return { xpAwarded: 0 };

    try {
        // Check daily cap before attempting insert
        if (action.limit && action.limit.startsWith('daily_cap_')) {
            const cap = parseInt(action.limit.replace('daily_cap_', ''), 10);
            const capRes = await pool.query(
                `SELECT COALESCE(SUM(xp_amount), 0)::int AS total
                 FROM xp_transactions
                 WHERE user_id = $1 AND action_type = $2 AND created_at >= CURRENT_DATE`,
                [userId, actionType]
            );
            if (capRes.rows[0].total >= cap) return { xpAwarded: 0 };
        }

        // Idempotent insert — UNIQUE(user_id, action_type, reference_id) blocks duplicates
        const txRes = await pool.query(
            `INSERT INTO xp_transactions (user_id, action_type, xp_amount, reference_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, action_type, reference_id) DO NOTHING
             RETURNING xp_amount`,
            [userId, actionType, action.xp, referenceId]
        );

        if (!txRes.rows.length) return { xpAwarded: 0 }; // duplicate, already awarded

        const updRes = await pool.query(
            `UPDATE users SET xp = xp + $1, xp_updated_at = NOW() WHERE id = $2 RETURNING xp`,
            [action.xp, userId]
        );

        const newTotal = updRes.rows[0].xp;
        const prevTotal = newTotal - action.xp;
        const prevLvl = getLevelFromXP(prevTotal);
        const newLvl = getLevelFromXP(newTotal);
        const leveledUp = newLvl.level > prevLvl.level;

        await checkAchievements(pool, io, userId);

        return { xpAwarded: action.xp, newTotal, leveledUp, newLevel: leveledUp ? newLvl : null };
    } catch (err) {
        console.error(`awardXP(${actionType}) error:`, err.message);
        return { xpAwarded: 0 };
    }
}

/**
 * Inner helper: given pre-fetched metrics + a current storedIds set,
 * insert any newly-unlocked achievements and award their XP.
 * Returns the list of achievement objects that were actually inserted.
 */
async function _unlockNewAchievements(pool, userId, metrics, storedIds) {
    const currentlyUnlocked = new Set();
    for (const ach of ACHIEVEMENTS) {
        const { type, threshold } = ach.condition;
        let value;
        if (type === 'user_id_under') {
            value = metrics.user_id_value < threshold ? 1 : 0;
        } else if (type === 'achievements_count') {
            value = storedIds.size;
        } else {
            value = metrics[type] ?? 0;
        }
        if (value >= threshold) currentlyUnlocked.add(ach.id);
    }

    const newlyUnlocked = [...currentlyUnlocked].filter(id => !storedIds.has(id));
    const awarded = [];

    for (const badgeId of newlyUnlocked) {
        const ach = ACHIEVEMENTS.find(a => a.id === badgeId);
        if (!ach) continue;

        const insertRes = await pool.query(
            `INSERT INTO user_achievements (user_id, badge_id, xp_awarded)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING
             RETURNING badge_id`,
            [userId, badgeId, ach.xpReward]
        );
        if (!insertRes.rows.length) continue; // already stored by a concurrent call

        const xpTxRes = await pool.query(
            `INSERT INTO xp_transactions (user_id, action_type, xp_amount, reference_id)
             VALUES ($1, 'achievement_reward', $2, $3)
             ON CONFLICT (user_id, action_type, reference_id) DO NOTHING
             RETURNING xp_amount`,
            [userId, ach.xpReward, `ach_${badgeId}`]
        );
        if (xpTxRes.rows.length > 0) {
            await pool.query(
                `UPDATE users SET xp = xp + $1, xp_updated_at = NOW() WHERE id = $2`,
                [ach.xpReward, userId]
            );
        }

        awarded.push(ach);
    }

    return awarded;
}

/**
 * All the per-user counters that achievement conditions are checked against,
 * fetched in ONE query (one pooled connection) instead of 14 parallel ones.
 *
 * (2026-10-05) The three callers (GET /api/achievements, GET
 * /api/achievements/user/:username and checkAchievements, which runs after
 * every awardXP) each used to fire 13-14 pool.query() calls through
 * Promise.all. Against Supabase's Session pooler (pool_size 15) a single
 * profile view therefore grabbed almost every connection the database
 * allows, and two concurrent users were enough to hit EMAXCONNSESSION —
 * 500s on achievements, articles, marketplace, and on /api/me during a page
 * reload (which the frontend then treated as "logged out").
 *
 * @returns {Promise<object|null>} metrics keyed by achievement condition
 *          type, or null when the user doesn't exist
 */
async function getAchievementMetrics(pool, userId) {
    const { rows } = await pool.query(
        `SELECT u.id, u.created_at, u.avatar, u.bio,
            (SELECT COUNT(*)::int FROM user_console_visits WHERE user_id = u.id)                           AS consoles_visited,
            (SELECT COUNT(*)::int FROM friends WHERE user1_id = u.id OR user2_id = u.id)                  AS friends_count,
            (SELECT COUNT(*)::int FROM user_favorites WHERE user_id = u.id)                               AS consoles_favorited,
            (SELECT COUNT(*)::int FROM user_owned_consoles WHERE user_id = u.id)                          AS consoles_owned,
            (SELECT COUNT(*)::int FROM user_lessons WHERE user_id = u.id AND completed = true)            AS lessons_completed,
            (SELECT COUNT(*)::int FROM user_course_progress WHERE user_id = u.id AND completed_at IS NOT NULL) AS courses_completed,
            (SELECT COUNT(*)::int FROM user_lessons WHERE user_id = u.id AND quiz_score = 100)            AS perfect_quizzes,
            (SELECT COUNT(*)::int FROM forum_threads WHERE user_id = u.id)                                AS forum_posts,
            (SELECT COUNT(*)::int FROM direct_messages WHERE sender_id = u.id)                            AS dms_sent,
            (SELECT COALESCE(SUM(upvotes), 0) FROM forum_threads WHERE user_id = u.id) +
            (SELECT COALESCE(SUM(upvotes), 0) FROM forum_replies WHERE user_id = u.id)                    AS upvotes_received,
            (SELECT COUNT(*)::int FROM listings WHERE user_id = u.id)                                     AS listings_created,
            (SELECT COUNT(*)::int FROM marketplace_accounts WHERE user_id = u.id AND provider = 'ebay')   AS ebay_accounts
         FROM users u
         WHERE u.id = $1`,
        [userId]
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
        lessons_completed:  r.lessons_completed,
        courses_completed:  r.courses_completed,
        perfect_quizzes:    r.perfect_quizzes,
        consoles_visited:   r.consoles_visited,
        consoles_favorited: r.consoles_favorited,
        consoles_owned:     r.consoles_owned,
        forum_posts:        r.forum_posts,
        friends_count:      r.friends_count,
        dms_sent:           r.dms_sent,
        upvotes_received:   parseInt(r.upvotes_received, 10) || 0,
        listings_created:   r.listings_created,
        ebay_connected:     r.ebay_accounts > 0 ? 1 : 0,
        days_member:        Math.floor((Date.now() - new Date(r.created_at)) / 86400000),
        profile_complete:   (r.avatar && r.bio) ? 1 : 0,
        user_id_value:      r.id,
    };
}

/**
 * Check and unlock newly earned achievements for a user.
 * Persists to DB and emits via Socket.io if io is provided.
 * Called automatically by awardXP — no need to call this directly.
 *
 * @returns {Array} newly unlocked achievement objects
 */
async function checkAchievements(pool, io, userId) {
    try {
        const metrics = await getAchievementMetrics(pool, userId);
        if (!metrics) return [];
        const storedRes = await pool.query('SELECT badge_id FROM user_achievements WHERE user_id = $1', [userId]);

        const storedIds = new Set(storedRes.rows.map(r => r.badge_id));

        const awardedAchievements = await _unlockNewAchievements(pool, userId, metrics, storedIds);

        // Second pass: re-evaluate achievements_count after the batch so the
        // completionist badge (and any future count-gated ones) can fire in
        // the same run that pushed the count over the threshold.
        if (awardedAchievements.length > 0) {
            const updatedStoredIds = new Set([...storedIds, ...awardedAchievements.map(a => a.id)]);
            const bonus = await _unlockNewAchievements(pool, userId, metrics, updatedStoredIds);
            awardedAchievements.push(...bonus);
        }

        // Persist a notification row for every unlock so offline/not-currently-connected
        // users still see it later in the bell — the socket emit below is only a live toast
        // and is skipped entirely when the user has no open connection.
        if (awardedAchievements.length > 0) {
            const { createNotification } = require('../routes/notifications');
            for (const ach of awardedAchievements) {
                await createNotification(
                    userId,
                    'achievement_unlocked',
                    `${ach.emoji} Achievement unlocked: ${ach.name}`,
                    '/html/pages/statistici.html'
                );
            }
        }

        if (io && awardedAchievements.length > 0) {
            const room = io.sockets.adapter.rooms.get(String(userId));
            const delivered = room && room.size > 0;
            if (delivered) {
                io.to(String(userId)).emit('achievement_unlocked', {
                    awardedIds: awardedAchievements.map(a => a.id),
                    achievements: awardedAchievements.map(a => ({
                        id: a.id,
                        name: a.name,
                        emoji: a.emoji,
                        category: a.category,
                        description: a.description,
                        xpReward: a.xpReward,
                    })),
                });
                await pool.query(
                    `UPDATE user_achievements SET notified_at = NOW()
                     WHERE user_id = $1 AND badge_id = ANY($2) AND notified_at IS NULL`,
                    [userId, awardedAchievements.map(a => a.id)]
                );
            }
            // If no socket in room, notified_at stays NULL — will be delivered on next register
        }

        return awardedAchievements;
    } catch (err) {
        console.error('checkAchievements error:', err.message);
        return [];
    }
}

module.exports = { LEVELS, XP_ACTIONS, ACHIEVEMENTS, getLevelFromXP, awardXP, checkAchievements, getAchievementMetrics };
