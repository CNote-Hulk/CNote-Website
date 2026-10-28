'use strict';
// Creates the "Electronics Foundations" course skeleton (course, modules, all lessons) and fills in the lessons
// that are written. Everything else is a placeholder that real content replaces later.
//   node backend/scripts/seed-electronics-foundations.js            -> dry run (everything rolled back)
//   node backend/scripts/seed-electronics-foundations.js --apply    -> writes
//   add --force to overwrite EN content/quiz that was edited by hand (default: hand edits are kept)
// Safe to re-run: it finds the course by slug, modules and lessons by their position, and never overwrites a
// lesson's EN content unless that content is still a placeholder.
// The course is created with is_published = FALSE (not listed on the Learn page; reachable only by its URL).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ensureQuizTranslationsTable, applyQuizTranslations } = require('./lib/quiz-translations');

const DATA = path.join(__dirname, 'data');
const LANGS = ['ro', 'de', 'es', 'fr', 'it'];
const MARK = 'data-placeholder="1"';
const isPlaceholder = (h) => !h || !h.trim() || h.includes(MARK);
const placeholderHtml = (text) => `<div class="intro-box" ${MARK}>\n  <p>${text}</p>\n</div>`;
const readData = (name) => fs.readFileSync(path.join(DATA, name), 'utf8');

function loadReady(key) {
    const html = { en: readData(`${key}.html`) };
    for (const lg of LANGS) {
        const f = path.join(DATA, `${key}.${lg}.html`);
        if (fs.existsSync(f)) html[lg] = fs.readFileSync(f, 'utf8');
    }
    const quiz = JSON.parse(readData(`${key}.quiz.json`));
    return { html, quiz };
}

async function seed({ pool, apply, force = false, log = console.log }) {
    const plan = JSON.parse(readData('electronics-foundations.json'));
    const client = await pool.connect();
    const s = { course: 'kept', modules: 0, created: 0, updated: 0, kept: 0, translations: 0, quizInserted: 0, quizTr: { written: 0, missing: 0, invalid: 0 } };
    try {
        await client.query('BEGIN');
        await ensureQuizTranslationsTable(client);

        let course = (await client.query('SELECT id FROM courses WHERE slug = $1', [plan.course.slug])).rows[0];
        if (!course) {
            course = (await client.query(
                `INSERT INTO courses (slug, title, description, icon, difficulty, order_index, is_published)
                 VALUES ($1, $2, $3, $4, $5, $6, FALSE) RETURNING id`,
                [plan.course.slug, plan.course.title, plan.course.description, plan.course.icon, plan.course.difficulty, plan.course.order_index]
            )).rows[0];
            s.course = 'created (NOT published)';
        }

        for (const m of plan.modules) {
            let mod = (await client.query('SELECT id FROM modules WHERE course_id = $1 AND order_index = $2', [course.id, m.order])).rows[0];
            if (!mod) {
                mod = (await client.query('INSERT INTO modules (course_id, title, order_index) VALUES ($1, $2, $3) RETURNING id', [course.id, m.title.en, m.order])).rows[0];
            }
            s.modules++;
            for (const lg of LANGS) {
                if (!m.title[lg]) continue;
                await client.query(
                    `INSERT INTO module_translations (module_id, lang, title) VALUES ($1, $2, $3)
                     ON CONFLICT (module_id, lang) DO UPDATE SET title = EXCLUDED.title`,
                    [mod.id, lg, m.title[lg]]
                );
            }

            for (const l of m.lessons) {
                const ready = l.ready ? loadReady(l.ready) : null;
                const enHtml = ready ? ready.html.en : placeholderHtml(plan.placeholder.en);
                const row = (await client.query('SELECT id, content_html FROM lessons WHERE module_id = $1 AND order_index = $2', [mod.id, l.order])).rows[0];
                let lessonId;
                if (!row) {
                    lessonId = (await client.query(
                        `INSERT INTO lessons (module_id, title, content_html, order_index, is_published) VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
                        [mod.id, l.title.en, enHtml, l.order]
                    )).rows[0].id;
                    s.created++;
                } else {
                    lessonId = row.id;
                    if (force || isPlaceholder(row.content_html)) {
                        await client.query('UPDATE lessons SET title = $2, content_html = $3 WHERE id = $1', [lessonId, l.title.en, enHtml]);
                        s.updated++;
                    } else {
                        s.kept++;
                        log(`  = kept hand-edited EN content: M${m.order} L${l.order} "${l.title.en}"`);
                    }
                }

                for (const lg of LANGS) {
                    if (!l.title[lg]) continue;
                    let html;
                    if (!ready) html = placeholderHtml(plan.placeholder[lg]);
                    else if (ready.html[lg]) html = ready.html[lg];
                    else continue; // written lesson without a translation yet -> falls back to EN title + content
                    await client.query(
                        `INSERT INTO lesson_translations (lesson_id, lang, title, content_html) VALUES ($1, $2, $3, $4)
                         ON CONFLICT (lesson_id, lang) DO UPDATE SET title = EXCLUDED.title, content_html = EXCLUDED.content_html`,
                        [lessonId, lg, l.title[lg], html]
                    );
                    s.translations++;
                }

                if (ready) {
                    const cnt = (await client.query('SELECT COUNT(*)::int AS n FROM quiz_questions WHERE lesson_id = $1', [lessonId])).rows[0].n;
                    if (cnt === 0 || force) {
                        if (cnt > 0) await client.query('DELETE FROM quiz_questions WHERE lesson_id = $1', [lessonId]);
                        for (const q of ready.quiz.questions) {
                            await client.query(
                                `INSERT INTO quiz_questions (lesson_id, question, options, correct_option, explanation) VALUES ($1, $2, $3::jsonb, $4, $5)`,
                                [lessonId, q.question, JSON.stringify(q.options), q.correct_option, q.explanation || '']
                            );
                            s.quizInserted++;
                        }
                    }
                    const entries = ready.quiz.questions.map((q, i) => ({
                        question_en: q.question,
                        options_en: q.options,
                        tr: Object.fromEntries(LANGS.filter(lg => ready.quiz.translations && ready.quiz.translations[lg] && ready.quiz.translations[lg][i])
                            .map(lg => [lg, ready.quiz.translations[lg][i]])),
                    }));
                    const qs = await applyQuizTranslations(client, lessonId, entries, log);
                    for (const k of Object.keys(s.quizTr)) s.quizTr[k] += qs[k];
                }
            }
        }
        await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
    log(`${apply ? 'APPLIED' : 'DRY RUN (rolled back)'}: course ${s.course}; modules ${s.modules}; lessons created ${s.created}, updated ${s.updated}, kept ${s.kept}; ` +
        `lesson translations ${s.translations}; quiz questions inserted ${s.quizInserted}; quiz translations written ${s.quizTr.written} (missing ${s.quizTr.missing}, invalid ${s.quizTr.invalid})`);
    return s;
}

module.exports = { seed, isPlaceholder };

if (require.main === module) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    seed({ pool, apply: process.argv.includes('--apply'), force: process.argv.includes('--force') })
        .then(() => pool.end())
        .catch(err => { console.error(err); pool.end(); process.exit(1); });
}
