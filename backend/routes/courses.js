/* ─────────────────────────────────────────
   FILE: routes/courses.js
   DESCRIPTION: Course, module, lesson, quiz, reactions, and comment endpoints.
   ───────────────────────────────────────── */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authRequired, authOptional } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminOnly');
const { awardXP } = require('../utils/gamification');

/* ── One-time table creation for reactions + comments ── */
(async function initLessonTables() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS lesson_reactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
                reaction_type VARCHAR(20) NOT NULL CHECK (reaction_type IN ('like','save','helpful')),
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(user_id, lesson_id, reaction_type)
            );
            CREATE TABLE IF NOT EXISTS lesson_comments (
                id SERIAL PRIMARY KEY,
                lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS lesson_comment_likes (
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                comment_id INTEGER REFERENCES lesson_comments(id) ON DELETE CASCADE,
                PRIMARY KEY(user_id, comment_id)
            );
        `);
        // Ensure user_lessons has the unique constraint required for ON CONFLICT upsert
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS user_lessons_user_lesson_uidx
            ON user_lessons(user_id, lesson_id)
        `);
    } catch (err) {
        console.error('[courses] lesson table init error:', err.message);
    }
})();

// GET /api/courses — all published courses with counts
router.get('/courses', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.*,
                COUNT(DISTINCT m.id)::int AS module_count,
                COUNT(DISTINCT CASE WHEN l.is_published THEN l.id END)::int AS lesson_count
            FROM courses c
            LEFT JOIN modules m ON m.course_id = c.id
            LEFT JOIN lessons l ON l.module_id = m.id
            WHERE c.is_published = true
            GROUP BY c.id
            ORDER BY c.id
        `);
        res.json({ success: true, courses: result.rows });
    } catch (err) {
        console.error('GET /courses error:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/courses/:slug — course with full module/lesson structure
router.get('/courses/:slug', authOptional, async (req, res) => {
    try {
        const { slug } = req.params;
        const lang = (req.query.lang || 'en').toLowerCase().slice(0, 5);
        const courseResult = await pool.query(
            'SELECT * FROM courses WHERE slug = $1',
            [slug]
        );
        if (!courseResult.rows.length) {
            return res.status(404).json({ success: false, error: 'Course not found' });
        }
        const course = courseResult.rows[0];

        const modulesResult = await pool.query(`
            SELECT m.id,
                COALESCE(mt.title, m.title) AS title,
                m.order_index,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', l.id,
                            'title', COALESCE(lt.title, l.title),
                            'order_index', l.order_index
                        )
                        ORDER BY l.order_index
                    ) FILTER (WHERE l.id IS NOT NULL),
                    '[]'
                ) AS lessons
            FROM modules m
            LEFT JOIN module_translations mt ON mt.module_id = m.id AND mt.lang = $2
            LEFT JOIN lessons l ON l.module_id = m.id AND l.is_published = true
            LEFT JOIN lesson_translations lt ON lt.lesson_id = l.id AND lt.lang = $2
            WHERE m.course_id = $1
            GROUP BY m.id, mt.title
            ORDER BY m.order_index
        `, [course.id, lang]);

        course.modules = modulesResult.rows;

        // Attach instructor (admin/creator) info
        const instructorResult = await pool.query(
            `SELECT id, username, avatar, bio FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`
        );
        const instructor = instructorResult.rows[0] || null;

        if (instructor && req.user) {
            const [friendRow, reqRow] = await Promise.all([
                pool.query(
                    `SELECT 1 FROM friends WHERE (user1_id=$1 AND user2_id=$2) OR (user1_id=$2 AND user2_id=$1)`,
                    [req.user.id, instructor.id]
                ),
                pool.query(
                    `SELECT id, sender_id FROM friend_requests WHERE ((sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1)) AND status='pending'`,
                    [req.user.id, instructor.id]
                ),
            ]);
            if (req.user.id === instructor.id) {
                instructor.friend_status = 'self';
            } else if (friendRow.rows.length) {
                instructor.friend_status = 'friends';
            } else if (reqRow.rows.length) {
                instructor.friend_status = reqRow.rows[0].sender_id === req.user.id ? 'pending_sent' : 'pending_received';
            } else {
                instructor.friend_status = 'none';
            }
        }

        course.instructor = instructor;
        res.json({ success: true, course });
    } catch (err) {
        console.error('GET /courses/:slug error:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/courses/:slug/progress — user progress for a course
router.get('/courses/:slug/progress', authRequired, async (req, res) => {
    try {
        const { slug } = req.params;
        const userId = req.user.id;

        const courseResult = await pool.query(
            'SELECT id FROM courses WHERE slug = $1',
            [slug]
        );
        if (!courseResult.rows.length) {
            return res.status(404).json({ success: false, error: 'Course not found' });
        }
        const courseId = courseResult.rows[0].id;

        const [completedResult, progressResult, totalResult] = await Promise.all([
            pool.query(`
                SELECT ul.lesson_id, ul.quiz_score FROM user_lessons ul
                JOIN lessons l ON l.id = ul.lesson_id
                JOIN modules m ON m.id = l.module_id
                WHERE ul.user_id = $1 AND m.course_id = $2 AND ul.completed = true
            `, [userId, courseId]),
            pool.query(
                'SELECT * FROM user_course_progress WHERE user_id = $1 AND course_id = $2',
                [userId, courseId]
            ),
            pool.query(`
                SELECT COUNT(l.id)::int AS total FROM lessons l
                JOIN modules m ON m.id = l.module_id
                WHERE m.course_id = $1 AND l.is_published = true
            `, [courseId])
        ]);

        const progress = progressResult.rows[0] || {};
        const completedIds = completedResult.rows.map(r => r.lesson_id);
        const total = totalResult.rows[0].total;

        const quizScores = {};
        completedResult.rows.forEach(r => {
            if (r.quiz_score != null) quizScores[r.lesson_id] = r.quiz_score;
        });

        res.json({
            success: true,
            completed_lesson_ids: completedIds,
            quiz_scores: quizScores,
            last_lesson_id: progress.last_lesson_id || null,
            course_completed: !!progress.completed_at,
            total_lessons: total
        });
    } catch (err) {
        console.error('GET /courses/:slug/progress error:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/lessons/:id — full lesson with quiz questions and course_slug (authOptional so guests can read)
router.get('/lessons/:id', authOptional, async (req, res) => {
    try {
        const lessonId = parseInt(req.params.id, 10);
        if (isNaN(lessonId)) {
            return res.status(400).json({ success: false, error: 'Invalid lesson id' });
        }
        const lang = (req.query.lang || 'en').toLowerCase().slice(0, 5);

        const lessonResult = await pool.query(`
            SELECT l.id, l.module_id, l.order_index, l.is_published,
                COALESCE(lt.title, l.title) AS title,
                COALESCE(lt.content_html, l.content_html) AS content_html,
                c.slug AS course_slug
            FROM lessons l
            JOIN modules m ON m.id = l.module_id
            JOIN courses c ON c.id = m.course_id
            LEFT JOIN lesson_translations lt ON lt.lesson_id = l.id AND lt.lang = $2
            WHERE l.id = $1 AND l.is_published = true
        `, [lessonId, lang]);
        if (!lessonResult.rows.length) {
            return res.status(404).json({ success: false, error: 'Lesson not found' });
        }
        const lesson = lessonResult.rows[0];

        // Attach instructor info to lesson too
        const lessonInstructorResult = await pool.query(
            `SELECT id, username, avatar, bio FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`
        );
        lesson.instructor = lessonInstructorResult.rows[0] || null;

        if (lesson.instructor && req.user) {
            const instrId = lesson.instructor.id;
            const [fr, rr] = await Promise.all([
                pool.query(`SELECT 1 FROM friends WHERE (user1_id=$1 AND user2_id=$2) OR (user1_id=$2 AND user2_id=$1)`, [req.user.id, instrId]),
                pool.query(`SELECT id, sender_id FROM friend_requests WHERE ((sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1)) AND status='pending'`, [req.user.id, instrId]),
            ]);
            lesson.instructor.friend_status = req.user.id === instrId ? 'self'
                : fr.rows.length ? 'friends'
                : rr.rows.length ? (rr.rows[0].sender_id === req.user.id ? 'pending_sent' : 'pending_received')
                : 'none';
        }

        // Quiz text follows ?lang= when a translation exists (quiz_question_translations); otherwise EN.
        // Falls back to the plain EN query if the translation table isn't there yet, so a lesson never breaks.
        let quizResult;
        try {
            quizResult = await pool.query(
                `SELECT q.id, COALESCE(qt.question, q.question) AS question,
                        COALESCE(qt.options, q.options) AS options,
                        q.correct_option,
                        COALESCE(qt.explanation, q.explanation) AS explanation
                 FROM quiz_questions q
                 LEFT JOIN quiz_question_translations qt ON qt.question_id = q.id AND qt.lang = $2
                 WHERE q.lesson_id = $1 ORDER BY RANDOM()`,
                [lessonId, lang]
            );
        } catch (qErr) {
            console.error('quiz translation query failed, falling back to EN:', qErr.message);
            quizResult = await pool.query(
                'SELECT id, question, options, correct_option, explanation FROM quiz_questions WHERE lesson_id = $1 ORDER BY RANDOM()',
                [lessonId]
            );
        }

        lesson.quiz_questions = quizResult.rows.map(q => {
            const options = Array.isArray(q.options) ? q.options : Object.values(q.options);
            const correctText = options[q.correct_option];
            const shuffled = [...options].sort(() => Math.random() - 0.5);
            return {
                ...q,
                options: shuffled,
                correct_option: shuffled.indexOf(correctText),
            };
        });

        res.json({ success: true, lesson });
    } catch (err) {
        console.error('GET /lessons/:id error:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PUT /api/lessons/:id — admin-only, update the EN canonical title/content_html.
// Learn/lesson content becomes admin-editable from the site (2026-09-06, same
// push as the Evolution console-page editor) — `lessons.title`/`content_html`
// ARE the EN row (mirrors console_mod_tutorials vs. its translations table:
// the base table is the EN canonical content, `lesson_translations` holds
// every other language separately and isn't touched here).
router.put('/lessons/:id', authRequired, adminOnly, async (req, res) => {
    const lessonId = parseInt(req.params.id, 10);
    if (isNaN(lessonId)) {
        return res.status(400).json({ success: false, error: 'Invalid lesson id' });
    }
    const { title, content_html } = req.body || {};
    if (!title || typeof title !== 'string') {
        return res.status(400).json({ success: false, error: 'Missing lesson title.' });
    }
    try {
        const { rows } = await pool.query(
            `UPDATE lessons SET title = $2, content_html = $3 WHERE id = $1 RETURNING id, title, content_html`,
            [lessonId, String(title).slice(0, 300), String(content_html || '')]
        );
        if (!rows.length) return res.status(404).json({ success: false, error: 'Lesson not found.' });
        res.json({ success: true, lesson: rows[0] });
    } catch (err) {
        console.error('PUT /lessons/:id error:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PUT /api/lessons/:id/quiz — admin-only, replaces the ENTIRE quiz question
// set for this lesson in one call (delete-then-insert inside a transaction)
// rather than per-question CRUD — one save operation for the whole editable
// unit, same shape as how console_mod_tutorials' `steps` array editor works.
router.put('/lessons/:id/quiz', authRequired, adminOnly, async (req, res) => {
    const lessonId = parseInt(req.params.id, 10);
    if (isNaN(lessonId)) {
        return res.status(400).json({ success: false, error: 'Invalid lesson id' });
    }
    const questions = Array.isArray(req.body?.questions) ? req.body.questions.slice(0, 30) : [];

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const lessonCheck = await client.query('SELECT id FROM lessons WHERE id = $1', [lessonId]);
        if (!lessonCheck.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Lesson not found.' });
        }

        await client.query('DELETE FROM quiz_questions WHERE lesson_id = $1', [lessonId]);

        for (const q of questions) {
            const question = String(q?.question || '').slice(0, 1000);
            const options = Array.isArray(q?.options)
                ? q.options.map(o => String(o).slice(0, 300)).filter(Boolean).slice(0, 8)
                : [];
            const correctOption = parseInt(q?.correct_option, 10);
            const explanation = String(q?.explanation || '').slice(0, 1000);
            // Skip malformed rows instead of failing the whole save — an admin
            // editing 5 good questions shouldn't lose all of them over one
            // half-filled draft row left in the editor.
            if (!question || options.length < 2 || isNaN(correctOption) || correctOption < 0 || correctOption >= options.length) {
                continue;
            }
            await client.query(
                `INSERT INTO quiz_questions (lesson_id, question, options, correct_option, explanation)
                 VALUES ($1, $2, $3, $4, $5)`,
                [lessonId, question, JSON.stringify(options), correctOption, explanation]
            );
        }

        await client.query('COMMIT');

        const { rows } = await pool.query(
            'SELECT id, question, options, correct_option, explanation FROM quiz_questions WHERE lesson_id = $1 ORDER BY id',
            [lessonId]
        );
        res.json({ success: true, questions: rows });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        console.error('PUT /lessons/:id/quiz error:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// POST /api/lessons/:id/complete — mark lesson complete, update progress
router.post('/lessons/:id/complete', authRequired, async (req, res) => {
    try {
        const lessonId = parseInt(req.params.id, 10);
        const userId = req.user.id;
        const { quiz_score } = req.body;

        if (isNaN(lessonId)) {
            return res.status(400).json({ success: false, error: 'Invalid lesson id' });
        }

        const lessonResult = await pool.query(
            'SELECT l.id, m.course_id FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.id = $1',
            [lessonId]
        );
        if (!lessonResult.rows.length) {
            return res.status(404).json({ success: false, error: 'Lesson not found' });
        }
        const { course_id } = lessonResult.rows[0];

        // Upsert user_lessons
        await pool.query(`
            INSERT INTO user_lessons (user_id, lesson_id, completed, quiz_score, completed_at)
            VALUES ($1, $2, true, $3, NOW())
            ON CONFLICT (user_id, lesson_id) DO UPDATE
            SET completed = true, quiz_score = $3, completed_at = NOW()
        `, [userId, lessonId, quiz_score || 0]);

        // Check if all course lessons are complete + find next lesson
        const [totalResult, doneResult, nextLessonResult] = await Promise.all([
            pool.query(`
                SELECT COUNT(l.id)::int AS total FROM lessons l
                JOIN modules m ON m.id = l.module_id
                WHERE m.course_id = $1 AND l.is_published = true
            `, [course_id]),
            pool.query(`
                SELECT COUNT(ul.id)::int AS done FROM user_lessons ul
                JOIN lessons l ON l.id = ul.lesson_id
                JOIN modules m ON m.id = l.module_id
                WHERE ul.user_id = $1 AND m.course_id = $2 AND ul.completed = true
            `, [userId, course_id]),
            pool.query(`
                SELECT l.id FROM lessons l
                JOIN modules m ON m.id = l.module_id
                WHERE m.course_id = $1 AND l.is_published = true
                  AND (m.order_index * 100000 + l.order_index) > (
                    SELECT m2.order_index * 100000 + l2.order_index
                    FROM lessons l2 JOIN modules m2 ON m2.id = l2.module_id
                    WHERE l2.id = $2
                  )
                ORDER BY m.order_index, l.order_index
                LIMIT 1
            `, [course_id, lessonId])
        ]);

        const total = totalResult.rows[0].total;
        const done = doneResult.rows[0].done;
        const allDone = total > 0 && done >= total;
        // Store the NEXT lesson so "Continue" resumes at the right place
        const nextLessonId = nextLessonResult.rows[0]?.id ?? lessonId;

        // Upsert user_course_progress — only set completed_at when finishing
        await pool.query(`
            INSERT INTO user_course_progress (user_id, course_id, last_lesson_id, completed_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, course_id) DO UPDATE
            SET last_lesson_id = $3,
                completed_at = CASE WHEN $4 IS NOT NULL THEN $4 ELSE user_course_progress.completed_at END
        `, [userId, course_id, nextLessonId, allDone ? new Date() : null]);

        res.json({ ok: true });
        // Fire-and-forget XP awards (sequential so level-up detection is accurate)
        ;(async () => {
            const io = req.app.get('io');
            await awardXP(pool, io, userId, 'lesson_complete', lessonId.toString());
            if (Number(quiz_score) === 100) {
                await awardXP(pool, io, userId, 'lesson_perfect', lessonId.toString());
            }
            if (allDone) {
                await awardXP(pool, io, userId, 'course_complete', course_id.toString());
                const firstCheck = await pool.query(
                    'SELECT COUNT(*)::int AS count FROM user_course_progress WHERE user_id=$1 AND completed_at IS NOT NULL',
                    [userId]
                );
                if (firstCheck.rows[0].count === 1) {
                    await awardXP(pool, io, userId, 'first_course', 'first');
                }
            }
        })().catch(() => {});
    } catch (err) {
        console.error('POST /lessons/:id/complete error:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/user/stats — learning statistics for the authenticated user
router.get('/user/stats', authRequired, async (req, res) => {
    try {
        const userId = req.user.id;

        const [totalResult, weekResult, avgResult, inProgressResult, completedResult, lastLessonResult] = await Promise.all([
            pool.query(
                'SELECT COUNT(*)::int AS total FROM user_lessons WHERE user_id = $1 AND completed = true',
                [userId]
            ),
            pool.query(
                `SELECT COUNT(*)::int AS this_week FROM user_lessons
                 WHERE user_id = $1 AND completed = true AND completed_at >= NOW() - INTERVAL '7 days'`,
                [userId]
            ),
            pool.query(
                `SELECT ROUND(AVG(quiz_score))::int AS avg_score FROM user_lessons
                 WHERE user_id = $1 AND completed = true AND quiz_score IS NOT NULL AND quiz_score > 0`,
                [userId]
            ),
            pool.query(
                'SELECT COUNT(*)::int AS in_progress FROM user_course_progress WHERE user_id = $1 AND completed_at IS NULL',
                [userId]
            ),
            pool.query(
                'SELECT COUNT(*)::int AS completed FROM user_course_progress WHERE user_id = $1 AND completed_at IS NOT NULL',
                [userId]
            ),
            pool.query(
                'SELECT last_lesson_id FROM user_course_progress WHERE user_id = $1 AND last_lesson_id IS NOT NULL LIMIT 1',
                [userId]
            )
        ]);

        res.json({
            success: true,
            lessons_completed_total: totalResult.rows[0].total,
            lessons_completed_this_week: weekResult.rows[0].this_week,
            average_quiz_score: avgResult.rows[0].avg_score || 0,
            courses_in_progress: inProgressResult.rows[0].in_progress,
            courses_completed: completedResult.rows[0].completed,
            last_lesson_id: lastLessonResult.rows[0] ? lastLessonResult.rows[0].last_lesson_id : null
        });
    } catch (err) {
        console.error('GET /user/stats error:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/user/progress/:username — Public course progress for any user
router.get('/user/progress/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const userRes = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
        if (!userRes.rows.length) return res.status(404).json({ success: false, error: 'User not found.' });
        const userId = userRes.rows[0].id;

        const result = await pool.query(`
            SELECT
                c.id          AS course_id,
                c.slug        AS course_slug,
                c.title       AS course_title,
                COUNT(DISTINCT l.id)::int                                           AS total_count,
                COUNT(DISTINCT ul.lesson_id)::int                                   AS completed_count
            FROM courses c
            LEFT JOIN modules m   ON m.course_id = c.id
            LEFT JOIN lessons l   ON l.module_id = m.id AND l.is_published = true
            LEFT JOIN user_lessons ul
                ON ul.lesson_id = l.id AND ul.user_id = $1 AND ul.completed = true
            WHERE c.is_published = true
            GROUP BY c.id, c.slug, c.title
            ORDER BY c.id
        `, [userId]);

        const courses = result.rows.map(r => ({
            id:        r.course_id,
            slug:      r.course_slug,
            title:     r.course_title,
            completed: r.completed_count,
            total:     r.total_count,
        }));

        res.json({ success: true, courses });
    } catch (err) {
        console.error('GET /user/progress/:username error:', err);
        res.status(500).json({ success: false, error: 'Internal server error.' });
    }
});

/* ─────────────────────────────────────────
   REACTIONS
───────────────────────────────────────── */

// GET /api/lessons/:id/reactions
router.get('/lessons/:id/reactions', authOptional, async (req, res) => {
    const lessonId = parseInt(req.params.id, 10);
    if (isNaN(lessonId)) return res.status(400).json({ error: 'Invalid lesson id' });
    const userId = req.user?.id;
    try {
        const countsResult = await pool.query(
            `SELECT reaction_type, COUNT(*)::int AS count
             FROM lesson_reactions WHERE lesson_id = $1
             GROUP BY reaction_type`,
            [lessonId]
        );
        const counts = { like: 0, save: 0, helpful: 0 };
        countsResult.rows.forEach(r => { counts[r.reaction_type] = r.count; });

        let userReactions = [];
        if (userId) {
            const ur = await pool.query(
                `SELECT reaction_type FROM lesson_reactions WHERE lesson_id = $1 AND user_id = $2`,
                [lessonId, userId]
            );
            userReactions = ur.rows.map(r => r.reaction_type);
        }

        res.json({ ...counts, user_reactions: userReactions });
    } catch (err) {
        console.error('GET /lessons/:id/reactions error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/lessons/:id/react  — toggle reaction
router.post('/lessons/:id/react', authRequired, async (req, res) => {
    const lessonId = parseInt(req.params.id, 10);
    if (isNaN(lessonId)) return res.status(400).json({ error: 'Invalid lesson id' });
    const userId = req.user.id;
    const { type } = req.body;
    if (!['like', 'save', 'helpful'].includes(type)) {
        return res.status(400).json({ error: 'Invalid reaction type' });
    }
    try {
        const existing = await pool.query(
            `SELECT id FROM lesson_reactions WHERE user_id = $1 AND lesson_id = $2 AND reaction_type = $3`,
            [userId, lessonId, type]
        );
        if (existing.rows.length) {
            await pool.query(
                `DELETE FROM lesson_reactions WHERE user_id = $1 AND lesson_id = $2 AND reaction_type = $3`,
                [userId, lessonId, type]
            );
            res.json({ active: false });
        } else {
            await pool.query(
                `INSERT INTO lesson_reactions (user_id, lesson_id, reaction_type) VALUES ($1, $2, $3)`,
                [userId, lessonId, type]
            );
            res.json({ active: true });
        }
    } catch (err) {
        console.error('POST /lessons/:id/react error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/* ─────────────────────────────────────────
   COMMENTS
───────────────────────────────────────── */

// GET /api/lessons/:id/comments
router.get('/lessons/:id/comments', authOptional, async (req, res) => {
    const lessonId = parseInt(req.params.id, 10);
    if (isNaN(lessonId)) return res.status(400).json({ error: 'Invalid lesson id' });
    const userId = req.user?.id;
    try {
        const commentsResult = await pool.query(
            `SELECT lc.id, lc.lesson_id, lc.user_id, lc.content, lc.created_at,
                    u.username,
                    COUNT(lcl.user_id)::int AS like_count
             FROM lesson_comments lc
             JOIN users u ON u.id = lc.user_id
             LEFT JOIN lesson_comment_likes lcl ON lcl.comment_id = lc.id
             WHERE lc.lesson_id = $1
             GROUP BY lc.id, u.username
             ORDER BY lc.created_at DESC`,
            [lessonId]
        );

        let userCommentLikes = [];
        if (userId) {
            const likesResult = await pool.query(
                `SELECT comment_id FROM lesson_comment_likes WHERE user_id = $1`,
                [userId]
            );
            userCommentLikes = likesResult.rows.map(r => r.comment_id);
        }

        res.json({ comments: commentsResult.rows, user_comment_likes: userCommentLikes });
    } catch (err) {
        console.error('GET /lessons/:id/comments error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/lessons/:id/comments
router.post('/lessons/:id/comments', authRequired, async (req, res) => {
    const lessonId = parseInt(req.params.id, 10);
    if (isNaN(lessonId)) return res.status(400).json({ error: 'Invalid lesson id' });
    const userId = req.user.id;
    const content = (req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Content is required' });

    try {
        const result = await pool.query(
            `INSERT INTO lesson_comments (lesson_id, user_id, content)
             VALUES ($1, $2, $3)
             RETURNING id, lesson_id, user_id, content, created_at`,
            [lessonId, userId, content]
        );
        const comment = result.rows[0];
        const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
        comment.username = userResult.rows[0]?.username || 'User';
        comment.like_count = 0;
        res.status(201).json({ comment });
    } catch (err) {
        console.error('POST /lessons/:id/comments error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/comments/:id/like  — toggle like on a comment
router.post('/comments/:id/like', authRequired, async (req, res) => {
    const commentId = parseInt(req.params.id, 10);
    if (isNaN(commentId)) return res.status(400).json({ error: 'Invalid comment id' });
    const userId = req.user.id;
    try {
        const existing = await pool.query(
            `SELECT 1 FROM lesson_comment_likes WHERE user_id = $1 AND comment_id = $2`,
            [userId, commentId]
        );
        if (existing.rows.length) {
            await pool.query(
                `DELETE FROM lesson_comment_likes WHERE user_id = $1 AND comment_id = $2`,
                [userId, commentId]
            );
            res.json({ liked: false });
        } else {
            await pool.query(
                `INSERT INTO lesson_comment_likes (user_id, comment_id) VALUES ($1, $2)`,
                [userId, commentId]
            );
            res.json({ liked: true });
        }
    } catch (err) {
        console.error('POST /comments/:id/like error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
