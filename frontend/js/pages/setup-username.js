/**
 * Setup Username Page Script
 * Handles first-time username selection with real-time availability check.
 * Redirects users who already have a username or are not logged in.
 */
import { AuthModule } from '../modules/auth.js';
import { API_BASE_URL } from '../config.js';
import { I18nModule } from '../modules/i18n.js?v=20260909';

/** Helper: get translated string with emoji fallback */
function t(key, fallback) {
    const val = I18nModule.t(key);
    return val && val !== key ? val : fallback;
}

// ─── Guard: redirect if not logged in or username already set ──
(async () => {
    const user = AuthModule.getCurrentUser();
    if (!user) {
        window.location.href = 'login.html';
        return;
    }
    // Refresh from server to get latest username_chosen status
    const fresh = await AuthModule.refreshSession();
    if (!fresh) {
        window.location.href = 'login.html';
        return;
    }
    if (fresh.username_chosen) {
        window.location.href = 'profil.html';
        return;
    }
})();

// ─── DOM references ─────────────────────────────
const form = document.getElementById('setup-username-form');
const input = document.getElementById('setup-username');
const statusEl = document.getElementById('username-status');
const errorEl = document.getElementById('setup-error');
const successEl = document.getElementById('setup-success');
const submitBtn = document.getElementById('setup-submit-btn');

// ─── Debounced availability check ───────────────
let checkTimer = null;

input.addEventListener('input', () => {
    const val = input.value.trim();
    clearTimeout(checkTimer);

    // Reset status
    statusEl.textContent = '';
    statusEl.className = 'username-status';

    if (val.length < 3) {
        if (val.length > 0) {
            statusEl.textContent = t('setup_username_min_chars', '⚠️ Minimum 3 characters');
            statusEl.classList.add('username-status--error');
        }
        return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(val)) {
        statusEl.textContent = t('setup_username_invalid_chars', '⚠️ Only letters, numbers, and underscores');
        statusEl.classList.add('username-status--error');
        return;
    }

    statusEl.textContent = t('setup_username_checking', '🔍 Checking...');
    statusEl.classList.add('username-status--checking');

    checkTimer = setTimeout(async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/check-username?username=${encodeURIComponent(val)}`);
            const data = await res.json();

            statusEl.className = 'username-status';
            if (data.available) {
                statusEl.textContent = t('setup_username_available', '✅ Available');
                statusEl.classList.add('username-status--available');
            } else {
                statusEl.textContent = t('setup_username_taken', '❌ Already taken');
                statusEl.classList.add('username-status--error');
            }
        } catch {
            statusEl.textContent = '';
            statusEl.className = 'username-status';
        }
    }, 400);
});

// ─── Form submit ────────────────────────────────
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = input.value.trim();

    errorEl.classList.remove('visible');
    successEl.classList.remove('visible');

    if (username.length < 3 || username.length > 20) {
        errorEl.textContent = t('setup_username_error_length', '⚠️ Username must be between 3 and 20 characters.');
        errorEl.classList.add('visible');
        return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        errorEl.textContent = t('setup_username_error_format', '⚠️ Username can only contain letters, numbers, and underscores.');
        errorEl.classList.add('visible');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = t('setup_username_btn_saving', '⏳ Saving...');

    try {
        const token = localStorage.getItem(AuthModule.TOKEN_KEY);
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const res = await fetch(`${API_BASE_URL}/setup-username`, {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify({ username })
        });
        const data = await res.json();

        if (data.success && data.user) {
            AuthModule._setSession(data.user);
            successEl.textContent = t('setup_username_success', '🎉 Username set!');
            successEl.classList.add('visible');
            // Show course recommendation instead of immediate redirect
            const recommend = document.getElementById('su-recommend');
            if (recommend) {
                recommend.classList.add('visible');
                recommend.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } else {
                setTimeout(() => { window.location.href = 'profil.html'; }, 800);
            }
        } else {
            errorEl.textContent = data.error || t('setup_username_error_generic', '❌ Could not set username.');
            errorEl.classList.add('visible');
        }
    } catch {
        errorEl.textContent = t('setup_username_error_server', '❌ Could not reach the server.');
        errorEl.classList.add('visible');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = t('setup_username_btn', '✅ Set Username');
    }
});
