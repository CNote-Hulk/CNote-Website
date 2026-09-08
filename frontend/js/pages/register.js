/**
 * Register Page Script
 * Password strength indicator, username availability check,
 * registration form submission, and Google OAuth redirect.
 */
import { AuthModule } from '../modules/auth.js';
import { API_BASE_URL } from '../config.js';
import { I18nModule } from '../modules/i18n.js?v=20260909';
import { createDatePicker } from '../utils/date-picker.js';

// Redirect if already logged in
if (AuthModule.isLoggedIn()) {
    window.location.href = 'profil.html';
}

// ─── Custom Date Picker ───────────────────────────
const birthDateInput = document.getElementById('reg-birth-date');
const birthDatePickerContainer = document.getElementById('reg-birth-date-picker');
const today = new Date();
const maxISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
createDatePicker(birthDatePickerContainer, {
    placeholder: 'Select date of birth',
    maxDate: maxISO,
    onChange: (iso) => { birthDateInput.value = iso || ''; }
});

// ─── Password strength indicator ──────────────────
const pwdInput = document.getElementById('reg-password');
const strengthWrap = document.getElementById('password-strength');
const rules = [
    { label: '8+ characters', test: v => v.length >= 8 },
    { label: 'A-Z', test: v => /[A-Z]/.test(v) },
    { label: '0-9', test: v => /[0-9]/.test(v) },
    { label: '!@#$…', test: v => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(v) }
];
rules.forEach(r => {
    const el = document.createElement('span');
    el.textContent = r.label;
    el.style.cssText = 'font-size:0.75rem;padding:3px 10px;border-radius:20px;border:1px solid rgba(255,255,255,0.1);color:#666;transition:all .2s;';
    r.el = el;
    strengthWrap.appendChild(el);
});
pwdInput.addEventListener('input', () => {
    const v = pwdInput.value;
    rules.forEach(r => {
        const ok = r.test(v);
        r.el.style.color = ok ? '#4ade80' : '#666';
        r.el.style.borderColor = ok ? 'rgba(74,222,128,0.4)' : 'rgba(255,255,255,0.1)';
        r.el.textContent = (ok ? '✓ ' : '') + r.label;
    });
});

// ─── Username availability check ──────────────────
const usernameInput = document.getElementById('reg-username');
const usernameStatus = document.getElementById('username-status');
let usernameTimer = null;
usernameInput.addEventListener('input', () => {
    clearTimeout(usernameTimer);
    const val = usernameInput.value.trim();
    if (val.length < 3) { usernameStatus.textContent = ''; return; }
    usernameStatus.textContent = '…';
    usernameStatus.style.color = '#888';
    usernameTimer = setTimeout(async () => {
        try {
            const r = await fetch(`${API_BASE_URL}/check-username?username=${encodeURIComponent(val)}`);
            const d = await r.json();
            if (usernameInput.value.trim() !== val) return;
            if (d.available) {
                usernameStatus.textContent = '✓ Available';
                usernameStatus.style.color = '#4ade80';
            } else {
                usernameStatus.textContent = '✗ Username is already taken';
                usernameStatus.style.color = '#f87171';
            }
        } catch {
            usernameStatus.textContent = '';
        }
    }, 500);
});

// ─── Turnstile (CAPTCHA) widget ────────────────────
// Site key is injected server-side as window.TURNSTILE_SITE_KEY (see
// server.js's serveHTMLWithNonce). Render once the widget script + key
// are both available; skip entirely if no site key is configured.
let turnstileWidgetId = null;
function renderTurnstileWhenReady(attemptsLeft = 50) {
    const container = document.getElementById('register-turnstile');
    if (!container || !window.TURNSTILE_SITE_KEY) return;
    if (window.turnstile) {
        turnstileWidgetId = window.turnstile.render(container, { sitekey: window.TURNSTILE_SITE_KEY, theme: 'light', size: 'flexible' });
        return;
    }
    if (attemptsLeft <= 0) return; // Turnstile script failed to load — submit will proceed without a token
    setTimeout(() => renderTurnstileWhenReady(attemptsLeft - 1), 100);
}
renderTurnstileWhenReady();

// ─── Register form submission ─────────────────────
document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('reg-username').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const confirm = document.getElementById('reg-password-confirm').value;
    const birthDateVal = (document.getElementById('reg-birth-date')?.value || '').trim();
    const birthDateErrorEl = document.getElementById('birth-date-error');

    const errorEl = document.getElementById('register-error');
    const successEl = document.getElementById('register-success');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    // ── T&C + Privacy validation ──────────────────────────────────────────
    if (!document.getElementById('reg-terms').checked) {
        errorEl.textContent = I18nModule.t('register.error.terms') || 'You must agree to the Terms & Conditions.';
        errorEl.classList.add('visible');
        return;
    }
    if (!document.getElementById('reg-privacy').checked) {
        errorEl.textContent = I18nModule.t('register.error.privacy') || 'You must accept the Privacy Policy.';
        errorEl.classList.add('visible');
        return;
    }

    // ── Client-side age gate ──────────────────────────────────────────────
    if (birthDateErrorEl) birthDateErrorEl.style.display = 'none';
    if (birthDateVal) {
        const dob = new Date(birthDateVal);
        if (!isNaN(dob.getTime())) {
            const today = new Date();
            let age = today.getFullYear() - dob.getFullYear();
            const monthDiff = today.getMonth() - dob.getMonth();
            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age--;
            if (age < 16) {
                const msg = I18nModule.t('register.error.underage');
                if (birthDateErrorEl) {
                    birthDateErrorEl.textContent = msg;
                    birthDateErrorEl.style.display = 'block';
                } else {
                    errorEl.textContent = msg;
                    errorEl.classList.add('visible');
                }
                return;
            }
        }
    }

    if (password !== confirm) {
            errorEl.textContent = 'Passwords do not match.';
            errorEl.classList.add('visible');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create account';
            return;
        }

    errorEl.classList.remove('visible');
    if (successEl) successEl.classList.remove('visible');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account...';

    try {
        const turnstileToken = (window.turnstile && turnstileWidgetId != null)
            ? window.turnstile.getResponse(turnstileWidgetId)
            : undefined;
        const result = await AuthModule.register(username, email, password, birthDateVal || undefined, {
            termsAccepted: document.getElementById('reg-terms').checked,
            privacyAccepted: document.getElementById('reg-privacy').checked,
            turnstileToken,
        });
        if (result.success) {
            document.getElementById('register-form-wrap').style.display = 'none';
            document.getElementById('register-sent-email').textContent = email;
            document.getElementById('register-success-screen').style.display = 'block';
            errorEl.classList.remove('visible');
            if (successEl) successEl.classList.remove('visible');
        } else {
            errorEl.textContent = result.error;
            errorEl.classList.add('visible');
        }
    } catch {
        errorEl.textContent = 'Unable to contact the server.';
        errorEl.classList.add('visible');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create account';
    }
});

// ─── Google register ──────────────────────────────
document.getElementById('google-register-btn').addEventListener('click', () => {
    AuthModule.loginWithGoogle();
});
