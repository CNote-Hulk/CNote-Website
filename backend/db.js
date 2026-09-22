/**
 * Database setup - Supabase Postgres via pg (node-postgres)
 * Creates tables on first run and exposes the pool instance.
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	ssl: { rejectUnauthorized: false },
	// (2026-09-22) Was unset -> defaulted to max:10 with no checkout/idle
	// timeouts. Under normal concurrent traffic (dashboard pages fire 4-5
	// authed requests at once, each grabbing its own connection against
	// Supabase's Session pooler, which holds a connection for the whole
	// client session rather than releasing it per-query) the pool of 10
	// saturated fast, and every subsequent request queued for the default
	// no-limit checkout wait, eventually dying at Railway's edge timeout
	// (~125s) instead of failing fast. Andrei saw this as "se incarca la
	// infinit" on login. Raised the ceiling and added explicit timeouts so
	// a starved request fails in ~8s (503) instead of hanging for 2 minutes.
	// If this still saturates, the real fix is switching DATABASE_URL from
	// the Session pooler (port 5432) to the Transaction pooler (port 6543)
	// in Supabase's connection settings — Transaction mode releases the
	// backend connection after each query instead of holding it for the
	// session, which is a much better fit for a stateless web backend.
	max: 20,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 8000
});

/**
 * Create all tables and run schema migrations.
 * Uses IF NOT EXISTS so it is safe to call on every startup.
 */
async function initializeSchema() {
	await pool.query(`
		/* ── Core user & auth tables ── */
		CREATE TABLE IF NOT EXISTS users (
			id              SERIAL PRIMARY KEY,
			username        TEXT    NOT NULL,
			email           TEXT    NOT NULL UNIQUE,
			password_hash   TEXT    DEFAULT NULL,
			bio             TEXT    DEFAULT '',
			avatar          TEXT    DEFAULT '',
			favorite_consoles TEXT  DEFAULT '',
			owned_consoles  TEXT    DEFAULT '',
			email_verified  BOOLEAN DEFAULT FALSE,
			two_factor_enabled BOOLEAN DEFAULT FALSE,
			two_factor_method VARCHAR(10) DEFAULT NULL,
			two_factor_secret VARCHAR(255) DEFAULT NULL,
			two_factor_totp_enabled BOOLEAN DEFAULT FALSE,
			two_factor_email_enabled BOOLEAN DEFAULT FALSE,
			google_id       VARCHAR(255) DEFAULT NULL,
			avatar_url      TEXT    DEFAULT NULL,
			created_at      TIMESTAMP DEFAULT NOW(),
			updated_at      TIMESTAMP DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS email_verification_tokens (
			id          SERIAL PRIMARY KEY,
			user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			token       TEXT    NOT NULL UNIQUE,
			expires_at  TIMESTAMP NOT NULL,
			created_at  TIMESTAMP DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS password_reset_tokens (
			id          SERIAL PRIMARY KEY,
			user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			token       TEXT    NOT NULL UNIQUE,
			expires_at  TIMESTAMP NOT NULL
		);

		CREATE TABLE IF NOT EXISTS user_sessions (
			id                SERIAL PRIMARY KEY,
			user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			session_token     TEXT    NOT NULL UNIQUE,
			device_type       TEXT    DEFAULT 'desktop',
			browser           TEXT    DEFAULT '',
			operating_system  TEXT    DEFAULT '',
			ip_address        TEXT    DEFAULT '',
			country           TEXT    DEFAULT '',
			login_time        TIMESTAMP DEFAULT NOW(),
			last_activity     TIMESTAMP DEFAULT NOW(),
			is_active         BOOLEAN DEFAULT TRUE
		);

		/* ── Chat ── */
		CREATE TABLE IF NOT EXISTS messages (
			id          SERIAL PRIMARY KEY,
			user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			message     TEXT    NOT NULL,
			created_at  TIMESTAMP DEFAULT NOW()
		);

		/* ── Social (ratings, favorites, owned, friends, visits) ── */

		CREATE TABLE IF NOT EXISTS user_console_visits (
		    id SERIAL PRIMARY KEY,
		    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		    console_id TEXT NOT NULL,
		    visited_at TIMESTAMP DEFAULT NOW(),
		    UNIQUE(user_id, console_id)
		);

		CREATE TABLE IF NOT EXISTS console_ratings (
			id          SERIAL PRIMARY KEY,
			user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			console_id  TEXT    NOT NULL,
			rating      INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
			created_at  TIMESTAMP DEFAULT NOW(),
			UNIQUE(user_id, console_id)
		);

		CREATE TABLE IF NOT EXISTS user_favorites (
			id          SERIAL PRIMARY KEY,
			user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			console_id  TEXT    NOT NULL,
			created_at  TIMESTAMP DEFAULT NOW(),
			UNIQUE(user_id, console_id)
		);

		CREATE TABLE IF NOT EXISTS user_owned_consoles (
			id          SERIAL PRIMARY KEY,
			user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			console_id  TEXT    NOT NULL,
			UNIQUE(user_id, console_id)
		);

		CREATE TABLE IF NOT EXISTS friend_requests (
			id          SERIAL PRIMARY KEY,
			sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
			created_at  TIMESTAMP DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS friends (
			id          SERIAL PRIMARY KEY,
			user1_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			user2_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			created_at  TIMESTAMP DEFAULT NOW(),
			UNIQUE(user1_id, user2_id)
		);

		/* ── 2FA codes (email-based one-time codes) ── */
		CREATE TABLE IF NOT EXISTS two_factor_codes (
			id          SERIAL PRIMARY KEY,
			user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			code        VARCHAR(10) NOT NULL,
			expires_at  TIMESTAMP NOT NULL,
			used        BOOLEAN DEFAULT FALSE,
			created_at  TIMESTAMP DEFAULT NOW()
		);

		/* === ConsoleHub Tables === */

		CREATE TABLE IF NOT EXISTS forum_threads (
			id          SERIAL PRIMARY KEY,
			user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			console     TEXT    NOT NULL,
			title       TEXT    NOT NULL,
			body        TEXT    NOT NULL,
			tag         TEXT    DEFAULT 'General',
			views       INTEGER DEFAULT 0,
			upvotes     INTEGER DEFAULT 0,
			created_at  TIMESTAMP DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS forum_replies (
			id          SERIAL PRIMARY KEY,
			thread_id   INTEGER NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
			user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			body        TEXT    NOT NULL,
			upvotes     INTEGER DEFAULT 0,
			created_at  TIMESTAMP DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS forum_upvotes (
			id          SERIAL PRIMARY KEY,
			user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			thread_id   INTEGER REFERENCES forum_threads(id) ON DELETE CASCADE,
			reply_id    INTEGER REFERENCES forum_replies(id) ON DELETE CASCADE,
			created_at  TIMESTAMP DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS listings (
			id          SERIAL PRIMARY KEY,
			user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			title       TEXT    NOT NULL,
			description TEXT    NOT NULL,
			price       DECIMAL(10,2) NOT NULL,
			condition   TEXT    DEFAULT 'good',
			category    TEXT    DEFAULT 'consoles',
			location    TEXT    DEFAULT '',
			phone       TEXT    DEFAULT '',
			olx_url     TEXT    DEFAULT '',
			images      TEXT    DEFAULT '[]',
			sold        BOOLEAN DEFAULT FALSE,
			created_at  TIMESTAMP DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS repair_requests (
			id                 SERIAL PRIMARY KEY,
			user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			console            TEXT    NOT NULL,
			symptoms           TEXT    NOT NULL,
			description        TEXT    DEFAULT '',
			severity           TEXT    DEFAULT 'unknown',
			ai_diagnosis       TEXT    DEFAULT '',
			estimated_cost_min INTEGER DEFAULT 0,
			estimated_cost_max INTEGER DEFAULT 0,
			estimated_time     TEXT    DEFAULT '',
			recommendation     TEXT    DEFAULT '',
			status             TEXT    DEFAULT 'draft',
			created_at         TIMESTAMP DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS direct_messages (
			id          SERIAL PRIMARY KEY,
			sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			message     TEXT    NOT NULL,
			listing_id  INTEGER REFERENCES listings(id) ON DELETE SET NULL,
			read        BOOLEAN DEFAULT FALSE,
			created_at  TIMESTAMP DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS notifications (
			id          SERIAL PRIMARY KEY,
			user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			type        TEXT    NOT NULL,
			message     TEXT    NOT NULL,
			link        TEXT    DEFAULT '',
			read        BOOLEAN DEFAULT FALSE,
			created_at  TIMESTAMP DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS listing_favorites (
			id          SERIAL PRIMARY KEY,
			user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			listing_id  INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
			created_at  TIMESTAMP DEFAULT NOW(),
			UNIQUE(user_id, listing_id)
		);

		/* ── Console translations (all 6 languages) ── */
		CREATE TABLE IF NOT EXISTS consoles_translations (
			id      TEXT    NOT NULL,
			lang    TEXT    NOT NULL,
			data    JSONB   NOT NULL,
			PRIMARY KEY (id, lang)
		);

		/* ── 2FA backup codes ── */
		CREATE TABLE IF NOT EXISTS two_factor_backup_codes (
			id          SERIAL PRIMARY KEY,
			user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			code_hash   VARCHAR(128) NOT NULL,
			used        BOOLEAN DEFAULT FALSE,
			used_at     TIMESTAMP DEFAULT NULL,
			created_at  TIMESTAMP DEFAULT NOW()
		);

		/* ── Trusted devices (skip 2FA) ── */
		CREATE TABLE IF NOT EXISTS trusted_devices (
			id          SERIAL PRIMARY KEY,
			user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			device_hash VARCHAR(128) NOT NULL,
			browser     TEXT,
			operating_system TEXT,
			ip_address  TEXT,
			created_at  TIMESTAMP DEFAULT NOW(),
			last_used   TIMESTAMP DEFAULT NOW(),
			expires_at  TIMESTAMP NOT NULL,
			UNIQUE(user_id, device_hash)
		);

		/* ── Marketplace Integration (OLX, eBay) ── */
		CREATE TABLE IF NOT EXISTS marketplace_accounts (
			id              SERIAL PRIMARY KEY,
			user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			provider        TEXT NOT NULL CHECK (provider IN ('olx', 'ebay')),
			access_token    TEXT NOT NULL,
			refresh_token   TEXT DEFAULT NULL,
			provider_user_id TEXT NOT NULL,
			expires_at      TIMESTAMP DEFAULT NULL,
			last_sync       TIMESTAMP DEFAULT NULL,
			connected_at    TIMESTAMP DEFAULT NOW(),
			updated_at      TIMESTAMP DEFAULT NOW(),
			UNIQUE(user_id, provider)
		);

		/* ── Learn: courses, modules, lessons, quizzes (routes/courses.js) ── */
		CREATE TABLE IF NOT EXISTS courses (
			id           SERIAL PRIMARY KEY,
			slug         TEXT    NOT NULL UNIQUE,
			title        TEXT    NOT NULL,
			description  TEXT    DEFAULT '',
			icon         TEXT    DEFAULT '',
			order_index  INTEGER DEFAULT 0,
			is_published BOOLEAN DEFAULT TRUE,
			created_at   TIMESTAMP DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS modules (
			id          SERIAL PRIMARY KEY,
			course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
			title       TEXT    NOT NULL,
			order_index INTEGER DEFAULT 0,
			created_at  TIMESTAMP DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS lessons (
			id           SERIAL PRIMARY KEY,
			module_id    INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
			title        TEXT    NOT NULL,
			content_html TEXT    DEFAULT '',
			order_index  INTEGER DEFAULT 0,
			is_published BOOLEAN DEFAULT TRUE,
			created_at   TIMESTAMP DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS quiz_questions (
			id             SERIAL PRIMARY KEY,
			lesson_id      INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
			question       TEXT    NOT NULL,
			options        JSONB   NOT NULL,
			correct_option INTEGER NOT NULL,
			explanation    TEXT    DEFAULT ''
		);

		CREATE TABLE IF NOT EXISTS lesson_translations (
			id           SERIAL PRIMARY KEY,
			lesson_id    INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
			lang         TEXT    NOT NULL,
			title        TEXT    NOT NULL,
			content_html TEXT    DEFAULT '',
			UNIQUE(lesson_id, lang)
		);

		CREATE TABLE IF NOT EXISTS module_translations (
			id        SERIAL PRIMARY KEY,
			module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
			lang      TEXT    NOT NULL,
			title     TEXT    NOT NULL,
			UNIQUE(module_id, lang)
		);

		CREATE TABLE IF NOT EXISTS user_lessons (
			id           SERIAL PRIMARY KEY,
			user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			lesson_id    INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
			completed    BOOLEAN DEFAULT FALSE,
			quiz_score   INTEGER DEFAULT NULL,
			completed_at TIMESTAMP DEFAULT NULL,
			UNIQUE(user_id, lesson_id)
		);

		CREATE TABLE IF NOT EXISTS user_course_progress (
			id             SERIAL PRIMARY KEY,
			user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			course_id      INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
			last_lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
			completed_at   TIMESTAMP DEFAULT NULL,
			UNIQUE(user_id, course_id)
		);

		/* ── Gamification: XP ledger + unlocked achievements (utils/gamification.js) ── */
		CREATE TABLE IF NOT EXISTS xp_transactions (
			id           SERIAL PRIMARY KEY,
			user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			action_type  TEXT    NOT NULL,
			xp_amount    INTEGER NOT NULL,
			reference_id TEXT    DEFAULT NULL,
			created_at   TIMESTAMP DEFAULT NOW(),
			UNIQUE(user_id, action_type, reference_id)
		);

		CREATE TABLE IF NOT EXISTS user_achievements (
			id          SERIAL PRIMARY KEY,
			user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			badge_id    TEXT    NOT NULL,
			xp_awarded  INTEGER DEFAULT 0,
			earned_at   TIMESTAMP DEFAULT NOW(),
			notified_at TIMESTAMP DEFAULT NULL,
			UNIQUE(user_id, badge_id)
		);

		/* ── DSA Article 16 notice-and-action content reports (routes/reports.js) ── */
		CREATE TABLE IF NOT EXISTS content_reports (
			id               SERIAL PRIMARY KEY,
			reporter_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
			content_type     TEXT    NOT NULL,
			content_id       TEXT    NOT NULL,
			reason           TEXT    NOT NULL,
			description      TEXT    DEFAULT NULL,
			reporter_contact TEXT    DEFAULT NULL,
			status           TEXT    DEFAULT 'pending',
			created_at       TIMESTAMP DEFAULT NOW()
		);

		/* ── Push notification device tokens, Android app FCM (services/firebaseAdmin.js) ── */
		CREATE TABLE IF NOT EXISTS user_fcm_tokens (
			id          SERIAL PRIMARY KEY,
			user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			fcm_token   TEXT    NOT NULL,
			device_info TEXT    DEFAULT '',
			created_at  TIMESTAMP DEFAULT NOW(),
			updated_at  TIMESTAMP DEFAULT NOW(),
			UNIQUE(user_id, fcm_token)
		);
	`);

	// Column migrations — idempotent ALTER statements to evolve schema
	const migrations = [
		`ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS favorite_consoles TEXT DEFAULT ''`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS owned_consoles TEXT DEFAULT ''`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_method VARCHAR(10) DEFAULT NULL`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret VARCHAR(255) DEFAULT NULL`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_totp_enabled BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_email_enabled BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) DEFAULT NULL`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL`,
		`ALTER TABLE email_verification_tokens ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
		`ALTER TABLE listings ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`,
		`ALTER TABLE listings ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0`,
		`ALTER TABLE listings ADD COLUMN IF NOT EXISTS favorites_count INTEGER DEFAULT 0`,
		`ALTER TABLE listings ADD COLUMN IF NOT EXISTS console_type TEXT DEFAULT ''`,
		`ALTER TABLE listings ADD COLUMN IF NOT EXISTS country TEXT DEFAULT ''`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user'`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS username_chosen BOOLEAN DEFAULT TRUE`,
		`ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS username TEXT DEFAULT ''`,
		`ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS custom_symptom TEXT DEFAULT ''`,
		`ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS admin_reply TEXT DEFAULT ''`,
		`ALTER TABLE repair_requests ADD COLUMN IF NOT EXISTS console_model TEXT DEFAULT ''`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_new_friend BOOLEAN DEFAULT TRUE`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_new_message BOOLEAN DEFAULT TRUE`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_repair_reply BOOLEAN DEFAULT TRUE`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS social_discord TEXT DEFAULT ''`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS social_twitter TEXT DEFAULT ''`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS social_youtube TEXT DEFAULT ''`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS social_instagram TEXT DEFAULT ''`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS show_email BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS show_stats BOOLEAN DEFAULT TRUE`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS show_friends BOOLEAN DEFAULT TRUE`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS show_social_links BOOLEAN DEFAULT TRUE`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMP DEFAULT NULL`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname TEXT DEFAULT ''`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(5) DEFAULT 'en'`,
		`ALTER TABLE listings ADD COLUMN IF NOT EXISTS marketplace_provider TEXT DEFAULT NULL`,
		`ALTER TABLE listings ADD COLUMN IF NOT EXISTS external_listing_id TEXT DEFAULT NULL`,
		`ALTER TABLE listings ADD COLUMN IF NOT EXISTS synced_from_external BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE listings ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT NULL`,
		`ALTER TABLE listings ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'RON'`,
		`ALTER TABLE listings ADD COLUMN IF NOT EXISTS url TEXT DEFAULT ''`,
		`ALTER TABLE listings ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP DEFAULT NULL`,
		// ── Gamification XP counter on the user row (utils/gamification.js) ──
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS xp INTEGER DEFAULT 0`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS xp_updated_at TIMESTAMP DEFAULT NULL`,
		// ── Chat / DM attachments (images + voice messages, stored on our own object storage) ──
		`ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_key TEXT DEFAULT NULL`,
		`ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_type TEXT DEFAULT NULL CHECK (attachment_type IS NULL OR attachment_type IN ('image', 'voice', 'sticker'))`,
		`ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_size INTEGER DEFAULT NULL`,
		`ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_duration_ms INTEGER DEFAULT NULL`,
		`ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS attachment_key TEXT DEFAULT NULL`,
		`ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS attachment_type TEXT DEFAULT NULL CHECK (attachment_type IS NULL OR attachment_type IN ('image', 'voice', 'sticker'))`,
		`ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS attachment_size INTEGER DEFAULT NULL`,
		`ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS attachment_duration_ms INTEGER DEFAULT NULL`,
		`ALTER TABLE messages ALTER COLUMN message DROP NOT NULL`,
		`ALTER TABLE direct_messages ALTER COLUMN message DROP NOT NULL`,
		// reply_to/edited_at + the message_reactions table were added directly on Supabase
		// during the Android app's own development (it talks to Supabase PostgREST directly,
		// bypassing this backend) and were never mirrored into this migration array — backfilled
		// here (2026-07-25) so a fresh bootstrap of the DB matches what's actually live, and
		// because the website's own /dm endpoints now use them too (reply/edit/reactions UI).
		`ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to BIGINT REFERENCES messages(id) ON DELETE SET NULL`,
		`ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP DEFAULT NULL`,
		`ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS reply_to BIGINT REFERENCES direct_messages(id) ON DELETE SET NULL`,
		`ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP DEFAULT NULL`,
		`CREATE TABLE IF NOT EXISTS message_reactions (
			id SERIAL PRIMARY KEY,
			scope TEXT NOT NULL CHECK (scope IN ('general', 'dm')),
			message_id BIGINT NOT NULL,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			emoji TEXT NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 8),
			created_at TIMESTAMP DEFAULT NOW(),
			UNIQUE (scope, message_id, user_id, emoji)
		)`,
		// Widen the CHECK on databases created before 'sticker' existed (ADD COLUMN IF NOT
		// EXISTS above is a no-op there, so it wouldn't pick up the new allowed value).
		`ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_attachment_type_check`,
		`ALTER TABLE messages ADD CONSTRAINT messages_attachment_type_check CHECK (attachment_type IS NULL OR attachment_type IN ('image', 'voice', 'sticker'))`,
		`ALTER TABLE direct_messages DROP CONSTRAINT IF EXISTS direct_messages_attachment_type_check`,
		`ALTER TABLE direct_messages ADD CONSTRAINT direct_messages_attachment_type_check CHECK (attachment_type IS NULL OR attachment_type IN ('image', 'voice', 'sticker'))`,
		// ── Synced sticker library (user's own stickers, sent via attachment_type='sticker' above) ──
		`CREATE TABLE IF NOT EXISTS user_stickers (
			id BIGSERIAL PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			storage_key TEXT NOT NULL,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`ALTER TABLE user_stickers ENABLE ROW LEVEL SECURITY`,
		`DROP POLICY IF EXISTS mobile_read_stickers ON user_stickers`,
		`CREATE POLICY mobile_read_stickers ON user_stickers FOR SELECT TO anon, authenticated USING (true)`,
		`DROP POLICY IF EXISTS mobile_insert_stickers ON user_stickers`,
		`CREATE POLICY mobile_insert_stickers ON user_stickers FOR INSERT TO anon, authenticated WITH CHECK (storage_key LIKE 'chat/stickers/%')`,
		`DROP POLICY IF EXISTS mobile_delete_stickers ON user_stickers`,
		`CREATE POLICY mobile_delete_stickers ON user_stickers FOR DELETE TO anon, authenticated USING (true)`,
		// Fix: attachment-only messages (message = "") were rejected by RLS, which required
		// char_length(message) >= 1 unconditionally — blocked every photo/voice/sticker send.
		`DROP POLICY IF EXISTS mobile_insert_dms ON direct_messages`,
		`CREATE POLICY mobile_insert_dms ON direct_messages FOR INSERT TO anon, authenticated WITH CHECK (attachment_key IS NOT NULL OR char_length(message) BETWEEN 1 AND 2000)`,
		`DROP POLICY IF EXISTS mobile_insert_messages ON messages`,
		`CREATE POLICY mobile_insert_messages ON messages FOR INSERT TO anon, authenticated WITH CHECK ((attachment_key IS NOT NULL OR char_length(message) BETWEEN 1 AND 500) AND channel = ANY (ARRAY['chat','playstation','xbox','nintendo','pc','other']))`,
			// Same bug, but on UPDATE — read-receipt PATCHes (only touch the `read` column)
			// were silently rejected by RLS for attachment-only rows, since with_check is
			// evaluated against the resulting row regardless of which columns actually changed.
			`DROP POLICY IF EXISTS mobile_update_dms ON direct_messages`,
			`CREATE POLICY mobile_update_dms ON direct_messages FOR UPDATE USING (true) WITH CHECK (attachment_key IS NOT NULL OR char_length(message) BETWEEN 1 AND 2000)`,
			`DROP POLICY IF EXISTS mobile_update_messages ON messages`,
			`CREATE POLICY mobile_update_messages ON messages FOR UPDATE USING (true) WITH CHECK (attachment_key IS NOT NULL OR char_length(message) BETWEEN 1 AND 500)`,
		`INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
			VALUES ('avatars', 'avatars', true, ARRAY['image/jpeg','image/png','image/webp'], 2097152)
			ON CONFLICT (id) DO NOTHING`,

		// ── Indexes for the most frequent lookup/filter columns ──────────────
		// None of these existed before — every query below was previously a
		// sequential scan.
		`CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_friend_requests_sender_id ON friend_requests(sender_id)`,
		`CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver_id ON friend_requests(receiver_id)`,
		`CREATE INDEX IF NOT EXISTS idx_friends_user1_id ON friends(user1_id)`,
		`CREATE INDEX IF NOT EXISTS idx_friends_user2_id ON friends(user2_id)`,
		`CREATE INDEX IF NOT EXISTS idx_two_factor_codes_user_id ON two_factor_codes(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_two_factor_backup_codes_user_id ON two_factor_backup_codes(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_forum_threads_user_id ON forum_threads(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_forum_threads_console ON forum_threads(console)`,
		`CREATE INDEX IF NOT EXISTS idx_forum_replies_thread_id ON forum_replies(thread_id)`,
		`CREATE INDEX IF NOT EXISTS idx_forum_replies_user_id ON forum_replies(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_forum_upvotes_user_thread ON forum_upvotes(user_id, thread_id)`,
		`CREATE INDEX IF NOT EXISTS idx_forum_upvotes_user_reply ON forum_upvotes(user_id, reply_id)`,
		`CREATE INDEX IF NOT EXISTS idx_listings_user_id ON listings(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category)`,
		`CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status)`,
		`CREATE INDEX IF NOT EXISTS idx_listing_favorites_listing_id ON listing_favorites(listing_id)`,
		`CREATE INDEX IF NOT EXISTS idx_repair_requests_user_id ON repair_requests(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_repair_requests_status ON repair_requests(status)`,
		`CREATE INDEX IF NOT EXISTS idx_direct_messages_sender_receiver ON direct_messages(sender_id, receiver_id)`,
		`CREATE INDEX IF NOT EXISTS idx_direct_messages_receiver_sender ON direct_messages(receiver_id, sender_id)`,
		`CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read)`,
		`CREATE INDEX IF NOT EXISTS idx_consoles_translations_lang ON consoles_translations(lang)`,
		`CREATE INDEX IF NOT EXISTS idx_console_ratings_console_id ON console_ratings(console_id)`,
		`CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_user_achievements_user_id ON user_achievements(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_xp_transactions_user_id ON xp_transactions(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_user_lessons_user_id ON user_lessons(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_user_course_progress_user_id ON user_course_progress(user_id)`,

		// ── Leaderboard (public XP ranking) ──────────────────────────────────
		`CREATE INDEX IF NOT EXISTS idx_users_xp_desc ON users(xp DESC) WHERE show_stats = true`,

		// ── Forum "mark as solved" ───────────────────────────────────────────
		`ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS solved_reply_id INTEGER REFERENCES forum_replies(id) ON DELETE SET NULL`,
		`CREATE INDEX IF NOT EXISTS idx_forum_threads_solved_reply_id ON forum_threads(solved_reply_id)`,

		// ── Forum reply-to-a-specific-reply (quoted/threaded replies) ────────
		`ALTER TABLE forum_replies ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES forum_replies(id) ON DELETE SET NULL`,
		`CREATE INDEX IF NOT EXISTS idx_forum_replies_reply_to_id ON forum_replies(reply_to_id)`,

		// ── Forum thread optional image (single photo attached to the post, Reddit-style) ──
		`ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS image_key TEXT DEFAULT NULL`,

		// ── Moderation (ban / temporary mute) ────────────────────────────────
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_reason TEXT DEFAULT NULL`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMP DEFAULT NULL`,
		// (2026-09-01) NULL = permanent ban, a future timestamp = temporary ban that auto-
		// lifts — see middleware/auth.js's isActivelyBanned/liftExpiredBan and
		// routes/reports.js's ban-author (optional `hours` in the request body).
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_until TIMESTAMP DEFAULT NULL`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS muted_until TIMESTAMP DEFAULT NULL`,

		// ── Seller reviews (marketplace trust) ────────────────────────────────
		`CREATE TABLE IF NOT EXISTS seller_reviews (
			id SERIAL PRIMARY KEY,
			reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
			rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
			comment TEXT DEFAULT '',
			created_at TIMESTAMP DEFAULT NOW(),
			UNIQUE(reviewer_id, seller_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_seller_reviews_seller_id ON seller_reviews(seller_id)`,

		// ── Community photo gallery ────────────────────────────────────────────
		`CREATE TABLE IF NOT EXISTS community_photos (
			id SERIAL PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			image_key TEXT NOT NULL,
			caption TEXT DEFAULT '',
			console_type TEXT DEFAULT '',
			created_at TIMESTAMP DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_community_photos_created_at ON community_photos(created_at DESC)`,

		// ── Articles (admin-written blog posts) ────────────────────────────────
		`CREATE TABLE IF NOT EXISTS articles (
			id SERIAL PRIMARY KEY,
			slug TEXT UNIQUE NOT NULL,
			title TEXT NOT NULL,
			excerpt TEXT DEFAULT '',
			content_html TEXT NOT NULL,
			cover_image_key TEXT DEFAULT NULL,
			author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			published BOOLEAN DEFAULT TRUE,
			views INTEGER DEFAULT 0,
			created_at TIMESTAMP DEFAULT NOW(),
			updated_at TIMESTAMP DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_articles_published_created_at ON articles(published, created_at DESC)`,

		// ── Orders (no-payment marketplace checkout — buyer submits Sameday
		// shipping data, seller processes the shipment off-platform) ──────────
		`CREATE TABLE IF NOT EXISTS orders (
			id                SERIAL PRIMARY KEY,
			listing_id        INTEGER REFERENCES listings(id) ON DELETE SET NULL,
			listing_title     TEXT NOT NULL,
			buyer_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			seller_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			delivery_method   TEXT NOT NULL,
			recipient_name    TEXT NOT NULL,
			recipient_phone   TEXT NOT NULL,
			county            TEXT DEFAULT '',
			city              TEXT DEFAULT '',
			address           TEXT DEFAULT '',
			easybox_name      TEXT DEFAULT '',
			notes             TEXT DEFAULT '',
			product_price     DECIMAL(10,2) NOT NULL,
			shipping_price    DECIMAL(10,2) NOT NULL,
			total_price       DECIMAL(10,2) NOT NULL,
			status            TEXT NOT NULL DEFAULT 'new',
			created_at        TIMESTAMP DEFAULT NOW(),
			shipped_at        TIMESTAMP DEFAULT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_orders_seller_status ON orders(seller_id, status, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id, created_at DESC)`,

		// (2026-09-01) Checkout form gained separate first/last name + email +
		// an optional address line 2 (apt/building/floor) — added as new
		// columns rather than reworking recipient_name (still NOT NULL, kept
		// populated as "first last" for backward compat with any existing
		// rows and the seller-queue display code that already reads it).
		`ALTER TABLE orders ADD COLUMN IF NOT EXISTS recipient_first_name TEXT DEFAULT ''`,
		`ALTER TABLE orders ADD COLUMN IF NOT EXISTS recipient_last_name TEXT DEFAULT ''`,
		`ALTER TABLE orders ADD COLUMN IF NOT EXISTS recipient_email TEXT DEFAULT ''`,
		`ALTER TABLE orders ADD COLUMN IF NOT EXISTS address_line2 TEXT DEFAULT ''`,
	];
	for (const sql of migrations) {
		try { await pool.query(sql); } catch { }
	}

	// Backfill admin role for known admin accounts
	try {
		await pool.query(`UPDATE users SET role = 'admin' WHERE LOWER(username) = LOWER('AndreiHulk07') OR LOWER(email) IN (LOWER('console.notebook.app@gmail.com'), LOWER('andreihlc2007@gmail.com'))`);
	} catch { }

	// Backfill listing status for pre-existing rows
	try { await pool.query(`UPDATE listings SET status = 'active' WHERE status IS NULL`); } catch { }

	// Migrate repair_requests status from 'draft'/'submitted' to 'pending'
	try { await pool.query(`UPDATE repair_requests SET status = 'pending' WHERE status IN ('draft', 'submitted')`); } catch { }

	// Migrate is_active from INTEGER to BOOLEAN if needed
	try { await pool.query(`ALTER TABLE user_sessions ALTER COLUMN is_active TYPE BOOLEAN USING is_active::int::boolean`); } catch { }
	try { await pool.query(`ALTER TABLE user_sessions ALTER COLUMN is_active SET DEFAULT TRUE`); } catch { }

	// Make password_hash nullable for Google OAuth users
	try { await pool.query('ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL'); } catch { }

	// Migrate email_verified from INTEGER to BOOLEAN if needed
	try { await pool.query(`ALTER TABLE users ALTER COLUMN email_verified TYPE BOOLEAN USING email_verified::int::boolean`); } catch { }
	try { await pool.query(`ALTER TABLE users ALTER COLUMN email_verified SET DEFAULT FALSE`); } catch { }

	// Migrate two_factor_enabled from INTEGER to BOOLEAN if needed
	try { await pool.query(`ALTER TABLE users ALTER COLUMN two_factor_enabled TYPE BOOLEAN USING two_factor_enabled::int::boolean`); } catch { }
	try { await pool.query(`ALTER TABLE users ALTER COLUMN two_factor_enabled SET DEFAULT FALSE`); } catch { }

	// Backfill new dual-method 2FA columns from legacy single-method data
	try {
		await pool.query(`UPDATE users SET two_factor_totp_enabled = TRUE WHERE two_factor_enabled = TRUE AND two_factor_method = 'totp' AND two_factor_totp_enabled = FALSE`);
		await pool.query(`UPDATE users SET two_factor_email_enabled = TRUE WHERE two_factor_enabled = TRUE AND two_factor_method = 'email' AND two_factor_email_enabled = FALSE`);
	} catch { }
}

initializeSchema()
	.then(() => console.log('Connected to Supabase Postgres database'))
	.catch(err => {
		console.error('Database connection/schema error:', err);
		process.exit(1);
	});

module.exports = pool;
