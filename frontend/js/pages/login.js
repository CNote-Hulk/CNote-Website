/**
 * Login Page Script
 * Handles server login, local login, Google OAuth, 2FA verification,
 * email fallback, resend verification, and URL error display.
 */
import { AuthModule } from '../modules/auth.js?v=20261005';

// ─── Handle Google OAuth redirect ────────────────
const googleData = AuthModule.handleGoogleRedirect();
if (googleData && googleData.user) {
    if (!googleData.user.username_chosen) {
        window.location.href = 'setup-username.html';
    } else {
        window.location.href = 'index.html';
    }
}

// Auto-login: check if token is still valid
(async () => {
    const user = await AuthModule.autoLogin();
    if (user) {
        if (!user.username_chosen) {
            window.location.href = 'setup-username.html';
        } else {
            window.location.href = 'index.html';
        }
        return;
    }
})();


// ─── Server login ───────────────────────────────
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    errorEl.classList.remove('visible');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Connecting...';

    try {
        const result = await AuthModule.login(email, password);
        if (result.twoFactorRequired) {
            // Show 2FA section, hide login form
            document.getElementById('login-form').style.display = 'none';
            document.querySelector('.auth-separator').style.display = 'none';
            document.getElementById('google-login-btn').style.display = 'none';
            document.querySelector('#tab-server > .auth-link:last-child').style.display = 'none';
            const tfSection = document.getElementById('two-factor-section');
            tfSection.style.display = 'block';
            tfSection.dataset.method = result.method || 'totp';
            const tfInfo = document.getElementById('two-factor-info');
            const fallbackEl = document.getElementById('two-factor-fallback');
            if (result.method === 'email') {
                tfInfo.textContent = 'We sent a verification code to your email.';
                fallbackEl.style.display = 'none';
            } else {
                tfInfo.textContent = 'Enter the code from your authenticator app.';
                fallbackEl.style.display = result.canFallbackToEmail ? 'block' : 'none';
            }
            document.getElementById('two-factor-code').focus();
        } else if (result.success) {
            const cur = AuthModule.getCurrentUser();
            if (cur && !cur.username_chosen) {
                window.location.href = 'setup-username.html';
            } else {
                window.location.href = 'index.html';
            }
        } else if (result.error === 'email_not_verified') {
            errorEl.classList.remove('visible');
            const verifyWarn = document.getElementById('login-verify-warning');
            verifyWarn.style.display = 'block';
            verifyWarn.dataset.email = email;
            document.getElementById('resend-verify-msg').style.display = 'none';
        } else {
            errorEl.textContent = result.error;
            errorEl.classList.add('visible');
        }
    } catch {
        errorEl.textContent = 'Could not reach the server.';
        errorEl.classList.add('visible');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Log in';
    }
});

// ─── 2FA verification ───────────────────────────
document.getElementById('two-factor-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('two-factor-code').value.trim();
    const errorEl = document.getElementById('two-factor-error');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const currentMethod = document.getElementById('two-factor-section').dataset.method || 'totp';

    errorEl.classList.remove('visible');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifying...';

    try {
        const trustDevice = document.getElementById('trust-device-checkbox')?.checked || false;
        const result = await AuthModule.verifyTwoFactor(code, currentMethod, trustDevice);
        if (result.success) {
            const cur = AuthModule.getCurrentUser();
            if (cur && !cur.username_chosen) {
                window.location.href = 'setup-username.html';
            } else {
                window.location.href = 'index.html';
            }
        } else {
            errorEl.textContent = result.error || 'Invalid code.';
            errorEl.classList.add('visible');
        }
    } catch {
        errorEl.textContent = 'Could not reach the server.';
        errorEl.classList.add('visible');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Verify';
    }
});

// ─── 2FA back button ────────────────────────────
document.getElementById('two-factor-back').addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.removeItem('cnote_temp_token');
    document.getElementById('two-factor-section').style.display = 'none';
    document.getElementById('two-factor-fallback').style.display = 'none';
    document.getElementById('two-factor-backup').style.display = 'none';
    document.getElementById('login-form').style.display = '';
    document.querySelector('.auth-separator').style.display = '';
    document.getElementById('google-login-btn').style.display = '';
    document.querySelector('#tab-server > .auth-link:last-child').style.display = '';
    const codeInput = document.getElementById('two-factor-code');
    codeInput.value = '';
    codeInput.maxLength = 6;
    codeInput.placeholder = '000000';
    codeInput.pattern = '[0-9]{6}';
    codeInput.inputMode = 'numeric';
    codeInput.style.letterSpacing = '0.5rem';
    document.getElementById('two-factor-error').classList.remove('visible');
});

// ─── 2FA fallback to email ──────────────────────
document.getElementById('two-factor-fallback-link').addEventListener('click', async (e) => {
    e.preventDefault();
    const link = e.target;
    const errorEl = document.getElementById('two-factor-error');
    const tfInfo = document.getElementById('two-factor-info');

    link.style.pointerEvents = 'none';
    link.textContent = 'Sending code...';
    errorEl.classList.remove('visible');

    try {
        const result = await AuthModule.requestEmailFallback();
        if (result.success) {
            tfInfo.textContent = 'We sent a verification code to your email.';
            document.getElementById('two-factor-section').dataset.method = 'email';
            document.getElementById('two-factor-fallback').style.display = 'none';
            document.getElementById('two-factor-code').value = '';
            document.getElementById('two-factor-code').focus();
        } else {
            errorEl.textContent = result.error || 'Could not send the code.';
            errorEl.classList.add('visible');
        }
    } catch {
        errorEl.textContent = 'Could not reach the server.';
        errorEl.classList.add('visible');
    } finally {
        link.style.pointerEvents = '';
        link.textContent = 'Can\'t access the app? Get code via email';
    }
});

// ─── 2FA backup code option ─────────────────────
document.getElementById('two-factor-backup-link').addEventListener('click', (e) => {
    e.preventDefault();
    const tfSection = document.getElementById('two-factor-section');
    const codeInput = document.getElementById('two-factor-code');
    const tfInfo = document.getElementById('two-factor-info');

    tfSection.dataset.method = 'backup';
    tfInfo.textContent = 'Enter one of your 8-character backup codes.';
    codeInput.value = '';
    codeInput.maxLength = 8;
    codeInput.placeholder = 'abcd1234';
    codeInput.pattern = '[a-fA-F0-9]{8}';
    codeInput.inputMode = 'text';
    codeInput.style.letterSpacing = '0.3rem';
    document.getElementById('two-factor-fallback').style.display = 'none';
    document.getElementById('two-factor-backup').style.display = 'none';
    codeInput.focus();
});

// ─── Google login button ────────────────────────
document.getElementById('google-login-btn').addEventListener('click', () => {
    AuthModule.loginWithGoogle();
});

// ─── Resend verification email ──────────────────
document.getElementById('resend-verify-btn').addEventListener('click', async (e) => {
    const btn = e.target;
    const warn = document.getElementById('login-verify-warning');
    const msgEl = document.getElementById('resend-verify-msg');
    const email = warn.dataset.email;
    if (!email) return;

    btn.disabled = true;
    btn.textContent = 'Sending...';
    msgEl.style.display = 'none';

    try {
        const data = await AuthModule._api('POST', '/resend-verification-public', { email });
        msgEl.textContent = 'Email resent! Check your inbox.';
        msgEl.style.color = 'var(--success, #4ade80)';
        msgEl.style.display = 'block';
    } catch {
        msgEl.textContent = 'Could not resend the email.';
        msgEl.style.color = '#e57373';
        msgEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Resend verification email';
    }
});

// ─── Show error from URL params ─────────────────
const urlParams = new URLSearchParams(window.location.search);
const googleError = urlParams.get('error');
if (googleError) {
    const errorEl = document.getElementById('login-error');
    const errorMessages = {
        'google_failed': 'Google authentication failed.',
        'google_auth_failed': 'Error authenticating with Google.',
        'google_not_configured': 'Google OAuth is not configured.',
        'account_banned': 'Your account has been suspended.'
    };
    // (2026-09-01) google-auth.js now passes the real "why + until" message (same detail
    // as a plain email/password login gets) for account_banned specifically — prefer it
    // over the generic map entry when present.
    errorEl.textContent = urlParams.get('message') || errorMessages[googleError] || 'Authentication error.';
    errorEl.classList.add('visible');
    history.replaceState(null, '', window.location.pathname);
}
