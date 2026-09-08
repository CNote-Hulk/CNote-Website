/**
 * Verify Email Success Page Script
 * Verifies email token from URL, shows result, handles resend.
 */
import { API_BASE_URL } from '../config.js';
import { I18nModule } from '../modules/i18n.js?v=20260908';

// Force default language to English on this page so the verification flow always appears in English.
I18nModule.setLang('en');

(async function() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const loadingEl = document.getElementById('verify-loading');
    const successEl = document.getElementById('verify-success');
    const errorEl = document.getElementById('verify-error');
    const resendBtn = document.getElementById('verify-resend-btn');

    if (!token) {
        loadingEl.hidden = true;
        errorEl.hidden = false;
        document.getElementById('verify-error-msg').textContent = 'Invalid link — missing verification token.';
        return;
    }

    try {
        const res = await fetch(API_BASE_URL + '/verify-email?token=' + encodeURIComponent(token));
        const data = await res.json();

        loadingEl.hidden = true;
        if (data.success) {
            successEl.hidden = false;
            document.getElementById('verify-success-msg').textContent = data.message || 'Your email was successfully verified!';
        } else {
            errorEl.hidden = false;
            document.getElementById('verify-error-msg').textContent = data.error || 'Verification failed.';
        }
    } catch {
        loadingEl.hidden = true;
        errorEl.hidden = false;
        document.getElementById('verify-error-msg').textContent = 'Unable to contact the server. Please try again.';
    }

    if (resendBtn) {
        resendBtn.addEventListener('click', async () => {
            const email = window.prompt('Enter your email to resend the verification link:');
            if (!email) return;

            resendBtn.disabled = true;
            resendBtn.textContent = 'Sending...';

            try {
                const res = await fetch(API_BASE_URL + '/resend-verification-public', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });
                const data = await res.json();
                document.getElementById('verify-error-msg').textContent = data.success
                    ? 'If an unverified account exists with that email, we resent the verification link.'
                    : (data.error || 'Failed to resend the verification email.');
            } catch {
                document.getElementById('verify-error-msg').textContent = 'Failed to resend the verification email.';
            } finally {
                resendBtn.disabled = false;
                resendBtn.textContent = 'Resend verification email';
            }
        });
    }
})();
