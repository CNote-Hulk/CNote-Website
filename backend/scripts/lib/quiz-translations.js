'use strict';
// Shared helpers for quiz translations (quiz_question_translations).
// quiz_questions stays the EN canonical row; translations hang off question_id.

const QUIZ_TRANSLATIONS_DDL = `CREATE TABLE IF NOT EXISTS quiz_question_translations (
    id          SERIAL PRIMARY KEY,
    question_id INTEGER NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
    lang        TEXT    NOT NULL,
    question    TEXT    NOT NULL,
    options     JSONB   NOT NULL,
    explanation TEXT    DEFAULT '',
    UNIQUE(question_id, lang)
)`;

async function ensureQuizTranslationsTable(client) {
    await client.query(QUIZ_TRANSLATIONS_DDL);
}

// entries: [{ question_en, options_en: [...], tr: { ro: { question, options: [...aligned to options_en], explanation }, ... } }]
// Questions are matched to the DB by (lesson_id, EN question text). Options are re-aligned to the order
// stored in the DB, so translations survive however the EN options were ordered when they were exported.
async function applyQuizTranslations(client, lessonId, entries, log = () => {}) {
    const stats = { written: 0, missing: 0, invalid: 0 };
    for (const e of entries) {
        const r = await client.query(
            'SELECT id, options FROM quiz_questions WHERE lesson_id = $1 AND question = $2',
            [lessonId, e.question_en]
        );
        if (!r.rows.length) {
            stats.missing++;
            log(`  ! lesson ${lessonId}: no EN question matches "${String(e.question_en).slice(0, 60)}"`);
            continue;
        }
        const qid = r.rows[0].id;
        const raw = r.rows[0].options;
        const dbOptions = Array.isArray(raw) ? raw : Object.values(raw);
        for (const [lang, t] of Object.entries(e.tr || {})) {
            if (!t || !t.question || !Array.isArray(t.options) || t.options.length !== e.options_en.length) {
                stats.invalid++;
                log(`  ! lesson ${lessonId} [${lang}]: bad translation shape for "${String(e.question_en).slice(0, 50)}"`);
                continue;
            }
            const aligned = [];
            let ok = true;
            for (const o of dbOptions) {
                const i = e.options_en.indexOf(o);
                if (i < 0) { ok = false; break; }
                aligned.push(t.options[i]);
            }
            if (!ok) {
                stats.invalid++;
                log(`  ! lesson ${lessonId} [${lang}]: EN options differ from the DB for "${String(e.question_en).slice(0, 50)}"`);
                continue;
            }
            await client.query(
                `INSERT INTO quiz_question_translations (question_id, lang, question, options, explanation)
                 VALUES ($1, $2, $3, $4::jsonb, $5)
                 ON CONFLICT (question_id, lang) DO UPDATE
                 SET question = EXCLUDED.question, options = EXCLUDED.options, explanation = EXCLUDED.explanation`,
                [qid, lang, t.question, JSON.stringify(aligned), t.explanation || '']
            );
            stats.written++;
        }
    }
    return stats;
}

module.exports = { QUIZ_TRANSLATIONS_DDL, ensureQuizTranslationsTable, applyQuizTranslations };
