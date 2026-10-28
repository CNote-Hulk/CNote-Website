'use strict';
// Adds translated quiz text for existing lessons (e.g. the Starter Guide).
//   node backend/scripts/insert-quiz-translations.js            -> dry run (everything rolled back)
//   node backend/scripts/insert-quiz-translations.js --apply    -> writes
// Data: backend/scripts/data/quiz-translations-starter-guide.json
//   [{ "lesson_id": 1, "questions": [{ "question_en", "options_en": [], "tr": { "ro": { "question", "options": [], "explanation" }, ... } }] }]
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ensureQuizTranslationsTable, applyQuizTranslations } = require('./lib/quiz-translations');

async function run({ pool, apply, file, log = console.log }) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const client = await pool.connect();
    const total = { written: 0, missing: 0, invalid: 0 };
    try {
        await client.query('BEGIN');
        await ensureQuizTranslationsTable(client);
        for (const lesson of data) {
            const s = await applyQuizTranslations(client, lesson.lesson_id, lesson.questions, log);
            for (const k of Object.keys(total)) total[k] += s[k];
        }
        await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
    log(`${apply ? 'APPLIED' : 'DRY RUN (rolled back)'}: written ${total.written}, missing ${total.missing}, invalid ${total.invalid}`);
    return total;
}

module.exports = { run };

if (require.main === module) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const file = path.join(__dirname, 'data', 'quiz-translations-starter-guide.json');
    run({ pool, apply: process.argv.includes('--apply'), file })
        .then(() => pool.end())
        .catch(err => { console.error(err); pool.end(); process.exit(1); });
}
