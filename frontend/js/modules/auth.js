/**
 * Authentication Module
 * Communicates with the backend API (POST /login, /register, etc.)
 * Falls back to localStorage for offline/file:// usage.
 *
 * All async methods that hit the API return Promises.
 * Synchronous helpers (getCurrentUser, isLoggedIn) read from the local session cache.
 */

import { API_BASE_URL } from '../config.js';

export const AuthModule = {
    SESSION_KEY: 'cn_session',
    TOKEN_KEY: 'cn_token',
    SERVER_SESSION_TOKEN_KEY: 'cn_session_token',
    _sessionEventSource: null,
    _sessionWatchRetryTimer: null,

    /** Base URL for API calls, configurable for production deployments */
    _apiBase: API_BASE_URL,

    // ─── Internal helpers ───────────────────────────────

    /** Cache user data locally so synchronous reads still work */
    _setSession(user) {
        const normalizedAvatar = this.normalizeAvatarUrl(user.avatar || '');
        const normalizedAvatarUrl = this.normalizeAvatarUrl(user.avatar_url || '');
        const session = {
            id: user.id,
            username: user.username,
            email: user.email,
            avatar: normalizedAvatar,
            bio: user.bio || '',
            favorite_consoles: user.favorite_consoles || '',
            owned_consoles: user.owned_consoles || '',
            email_verified: user.email_verified,
            avatar_url: normalizedAvatarUrl,
            two_factor_enabled: !!user.two_factor_enabled,
            two_factor_method: user.two_factor_method || null,
            two_factor_totp_enabled: !!user.two_factor_totp_enabled,
            two_factor_email_enabled: !!user.two_factor_email_enabled,
            google_linked: !!user.google_linked,
            has_password: user.has_password !== false,
            role: user.role || 'user',
            username_chosen: user.username_chosen !== false,
            created_at: user.created_at,
            notify_new_friend: user.notify_new_friend !== false,
            notify_new_message: user.notify_new_message !== false,
            notify_repair_reply: user.notify_repair_reply !== false,
            social_discord: user.social_discord || '',
            social_twitter: user.social_twitter || '',
            social_youtube: user.social_youtube || '',
            social_instagram: user.social_instagram || '',
            show_email: !!user.show_email,
            show_stats: user.show_stats !== false,
            show_friends: user.show_friends !== false,
            show_social_links: user.show_social_links !== false
        };
        localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
    },

    normalizeAvatarUrl(avatarUrl, preferredSize = 1024) {
        const raw = typeof avatarUrl === 'string' ? avatarUrl.trim() : '';
        if (!raw || raw.startsWith('data:')) return raw;

        const isGoogleAvatar = /googleusercontent\.com|ggpht\.com/i.test(raw);
        if (!isGoogleAvatar) return raw;

        let upgraded = raw
            .replace(/[?&]sz=\d+/i, (m) => m.charAt(0) + 'sz=' + preferredSize)
            .replace(/=s\d{2,4}(-c)?(?=&|$)/i, '=s' + preferredSize + '-c')
            .replace(/\/s\d{2,4}(-c)?(?=\/)/i, '/s' + preferredSize + '-c');

        if (upgraded === raw && !/[?&]sz=\d+/i.test(raw)) {
            upgraded += (raw.includes('?') ? '&' : '?') + 'sz=' + preferredSize;
        }
        return upgraded;
    },

    /** Get current user from local cache */
    getCurrentUser() {
        try {
            const s = JSON.parse(localStorage.getItem(this.SESSION_KEY));
            return s && s.id ? s : null;
        } catch { return null; }
    },

    /** Check if logged in (synchronous, reads local cache) */
    isLoggedIn() {
        return !!this.getCurrentUser();
    },

    /** Generic API call */
    async _api(method, path, body) {
        const headers = {};
        const token = localStorage.getItem(this.TOKEN_KEY);
        if (token) {
            headers['Authorization'] = 'Bearer ' + token;
        }
        const opts = {
            method,
            headers,
            credentials: 'include'
        };
        if (body instanceof FormData) {
            // Let the browser set Content-Type so the multipart boundary is included
            opts.body = body;
        } else if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(this._apiBase + path, opts);
        if (!res.ok) {
            // Only 401 means "your session is gone". 403 is "not allowed to do
            // this" (admin-only route, wrong current password, muted, not your
            // listing) and 5xx is a server hiccup — neither may log the user out.
            // (2026-10-05: clearing on 403 too logged people out on things like
            // a mistyped current password.)
            if (res.status === 401) {
                localStorage.removeItem(this.SESSION_KEY);
                localStorage.removeItem(this.TOKEN_KEY);
                localStorage.removeItem(this.SERVER_SESSION_TOKEN_KEY);
            }
            try {
                return await res.json();
            } catch {
                return { success: false, status: res.status, error: 'API error.' };
            }
        }
        return await res.json();
    },

    // ─── Register ───────────────────────────────────────

    /**
     * Register a new user.
     * After registration the user must verify their email before logging in.
     * @returns {Promise<{success, error?, user?, message?}>}
     */
    async register(username, email, password, birth_date, opts = {}) {
        if (!username || String(username).trim().length < 1)
            return { success: false, error: 'Username is required.' };
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            return { success: false, error: 'Email address is not valid.' };
        if (!password || password.length < 8 ||
            !/[A-Z]/.test(password) || !/[a-z]/.test(password) ||
            !/[0-9]/.test(password) || !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password))
            return { success: false, error: 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.' };

        try {
            const body = {
                username, email, password,
                terms_accepted: !!opts.termsAccepted,
                privacy_accepted: !!opts.privacyAccepted,
            };
            if (birth_date) body.birth_date = birth_date;
            if (opts.turnstileToken) body.turnstileToken = opts.turnstileToken;
            const data = await this._api('POST', '/register', body);
            // Do NOT set session — the user must verify email first
            return data;
        } catch {
return { success: false, error: 'Could not contact the server.' };
        }
    },

    // ─── Login ──────────────────────────────────────────────────

    /**
     * Login — creates server session + caches user locally + stores JWT.
     * @returns {Promise<{success, error?, user?, token?}>}
     */
    async login(email, password) {
        if (!email || !password)
            return { success: false, error: 'Please fill in all fields.' };

        try {
            const data = await this._api('POST', '/login', { email, password });
            if (data.twoFactorRequired) {
                // Store temp token for 2FA verification
                localStorage.setItem('cnote_temp_token', data.tempToken);
                return data;
            }
            if (data.success && data.user) {
                this._setSession(data.user);
                if (data.token) {
                    localStorage.setItem(this.TOKEN_KEY, data.token);
                }
                if (data.session_token) {
                    localStorage.setItem(this.SERVER_SESSION_TOKEN_KEY, data.session_token);
                }
            }
            return data;
        } catch {
            return { success: false, error: 'Could not contact the server.' };
        }
    },

    // ─── Local Login (offline) ──────────────────────────

    /**
     * Create a local-only session (no server needed).
     * Useful for file:// or offline usage.
     */
    localLogin(username) {
        const session = {
            id: 'local_' + Date.now(),
            username: username,
            email: '',
            avatar: '',
            bio: '',
            email_verified: false,
            created_at: new Date().toISOString(),
            local: true
        };
        localStorage.setItem(this.SESSION_KEY, JSON.stringify(session));
    },

    // ─── Logout ─────────────────────────────────────────

    async logout() {
        this.stopSessionWatch();
        try {
            await this._api('POST', '/logout');
        } catch { /* ignore network errors on logout */ }
        localStorage.removeItem(this.SESSION_KEY);
        localStorage.removeItem(this.TOKEN_KEY);
        localStorage.removeItem(this.SERVER_SESSION_TOKEN_KEY);
    },

    // ─── Refresh session from server ────────────────────

    /** Fetch fresh user data from backend and update local cache */
    async refreshSession() {
        try {
            const data = await this._api('GET', '/profile');
            if (data && data.success && data.user) {
                this._setSession(data.user);
                return data.user;
            }
            // (2026-10-05) Don't clear the session here on any failure: if the
            // server answered 401 the session really is invalid and _api()
            // already cleared it; any other failure (500/503 when the DB is
            // busy, network blip) is temporary, so keep the cached user logged
            // in. Clearing on every failure is what logged people out on
            // reload whenever the database was briefly unreachable.
            return this.getCurrentUser();
        } catch {
            return this.getCurrentUser();
        }
    },

    // ─── Update profile (username, bio, avatar) ─────────

    async updateProfile(fields) {
        const cur = this.getCurrentUser();
        if (!cur) return { success: false, error: 'Not logged in.' };

        try {
            const data = await this._api('PUT', '/me', fields);
            if (data.success && data.user) {
                this._setSession(data.user);
            }
            return data;
        } catch {
            return { success: false, error: 'Could not contact the server.' };
        }
    },

    /** Upload a new profile picture. `blob` is a File/Blob (image). */
    async uploadAvatar(blob) {
        const cur = this.getCurrentUser();
        if (!cur) return { success: false, error: 'Not logged in.' };

        try {
            const formData = new FormData();
            formData.append('avatar', blob, 'avatar.jpg');
            const data = await this._api('POST', '/me/avatar', formData);
            if (data.success && data.user) {
                this._setSession(data.user);
            }
            return data;
        } catch {
            return { success: false, error: 'Could not contact the server.' };
        }
    },

    /** Remove the current profile picture. */
    async removeAvatar() {
        const cur = this.getCurrentUser();
        if (!cur) return { success: false, error: 'Not logged in.' };

        try {
            const data = await this._api('DELETE', '/me/avatar');
            if (data.success && data.user) {
                this._setSession(data.user);
            }
            return data;
        } catch {
            return { success: false, error: 'Could not contact the server.' };
        }
    },

    // ─── Update email ───────────────────────────────────

    async updateEmail(newEmail, currentPassword) {
        if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail))
            return { success: false, error: 'Email address is not valid.' };
        if (!currentPassword)
            return { success: false, error: 'Enter your current password to change your email.' };

        try {
            const data = await this._api('PUT', '/me/email', { newEmail, currentPassword });
            if (data.success && data.user) {
                this._setSession(data.user);
            }
            return data;
        } catch {
return { success: false, error: 'Could not contact the server.' };
        }
    },

    // ─── Update password ────────────────────────────────────────

    async updatePassword(currentPassword, newPassword) {
        if (!currentPassword)
            return { success: false, error: 'Enter your current password.' };
        if (!newPassword || newPassword.length < 8 ||
            !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) ||
            !/[0-9]/.test(newPassword) || !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword))
            return { success: false, error: 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.' };

        try {
            const data = await this._api('PUT', '/me/password', { currentPassword, newPassword });
            return data;
        } catch {
            return { success: false, error: 'Could not contact the server.' };
        }
    },

    // ─── Session management ─────────────────────────────

    /** Get all active sessions for the current user */
    async getSessions() {
        try {
            const data = await this._api('GET', '/sessions');
            return data.success ? data.sessions : [];
        } catch {
            return [];
        }
    },

    /** Terminate a specific session by id */
    async terminateSession(sessionId) {
        try {
            return await this._api('DELETE', '/sessions/' + sessionId);
        } catch {
            return { success: false, error: 'Could not contact the server.' };
        }
    },

    /** Terminate all sessions except current */
    async terminateOtherSessions() {
        try {
            return await this._api('DELETE', '/sessions');
        } catch {
            return { success: false, error: 'Could not contact the server.' };
        }
    },

    /** Terminate all sessions, including current, then clear local auth state */
    async terminateAllSessions() {
        try {
            await this._api('DELETE', '/sessions');
        } catch {
            // Continue with local logout even if the API call fails.
        }
        await this.logout();
        return { success: true };
    },

    async deleteAccount(body) {
        if (!body || (!body.password && !body.confirmText)) {
            return { success: false, error: 'Confirmation is required.' };
        }
        try {
            return await this._api('DELETE', '/account', body);
        } catch {
            return { success: false, error: 'Could not contact the server.' };
        }
    },

    /** Set initial password for Google-only accounts */
    async setPassword(password, confirmPassword) {
        if (!password || password.length < 8 ||
            !/[A-Z]/.test(password) || !/[a-z]/.test(password) ||
            !/[0-9]/.test(password) || !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password))
            return { success: false, error: 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.' };
        if (password !== confirmPassword)
            return { success: false, error: 'Passwords do not match.' };
        try {
            const data = await this._api('POST', '/account/set-password', { password, confirmPassword });
            if (data.success) {
                const user = this.getCurrentUser();
                if (user) {
                    user.has_password = true;
                    localStorage.setItem(this.SESSION_KEY, JSON.stringify(user));
                }
            }
            return data;
        } catch {
            return { success: false, error: 'Could not contact the server.' };
        }
    },

    stopSessionWatch() {
        if (this._sessionWatchRetryTimer) {
            clearTimeout(this._sessionWatchRetryTimer);
            this._sessionWatchRetryTimer = null;
        }
        if (this._sessionEventSource) {
            this._sessionEventSource.close();
            this._sessionEventSource = null;
        }
    },

    startSessionWatch() {
        if (window.location.protocol === 'file:') return;

        this.stopSessionWatch();

        const sessionToken = localStorage.getItem(this.SERVER_SESSION_TOKEN_KEY);
        const jwtToken = localStorage.getItem(this.TOKEN_KEY);
        const authToken = sessionToken || jwtToken;
        if (!authToken) return;

        let retries = 0;
        const MAX_RETRIES = 3;

        const connect = () => {
            const url = `${this._apiBase}/sessions/events?token=${encodeURIComponent(authToken)}`;
            const source = new EventSource(url);
            this._sessionEventSource = source;

            source.onmessage = async (event) => {
                retries = 0;
                try {
                    const payload = JSON.parse(event.data || '{}');
                    if (payload.event === 'session_terminated') {
                        this.stopSessionWatch();
                        await this.logout();
                        window.location.href = '/html/pages/login.html';
                    }
                } catch {
                    // Ignore malformed events.
                }
            };

            source.onerror = () => {
                source.close();
                if (retries >= MAX_RETRIES) return;
                retries++;
                if (this._sessionWatchRetryTimer) clearTimeout(this._sessionWatchRetryTimer);
                this._sessionWatchRetryTimer = setTimeout(() => {
                    this._sessionWatchRetryTimer = null;
                    if (this.getCurrentUser()) connect();
                }, 5000 * retries);
            };
        };

        connect();
    },

    // ─── Auto-login (check token on page load) ─────────

    /**
     * Check if a stored JWT token is still valid.
     * Call this on page load to restore the session.
     * @returns {Promise<user|null>}
     */
    async autoLogin() {
        const token = localStorage.getItem(this.TOKEN_KEY);
        if (!token) return null;
        return this.refreshSession();
    },

    // ─── Two-Factor Authentication ──────────────────────

    /** Verify 2FA code during login (uses temp token) */
    async verifyTwoFactor(code, method, trustDevice) {
        const tempToken = localStorage.getItem('cnote_temp_token');
        if (!tempToken) return { success: false, error: 'Temporary session has expired.' };

        try {
            const body = { tempToken, code };
            if (method) body.method = method;
            if (trustDevice) body.trustDevice = true;
            const data = await this._api('POST', '/2fa/verify', body);
            if (data.success && data.user) {
                localStorage.removeItem('cnote_temp_token');
                this._setSession(data.user);
                if (data.token) localStorage.setItem(this.TOKEN_KEY, data.token);
                if (data.session_token) localStorage.setItem(this.SERVER_SESSION_TOKEN_KEY, data.session_token);
            }
            return data;
        } catch {
            return { success: false, error: 'Could not contact the server.' };
        }
    },

    /** Request TOTP setup (returns QR code + secret) */
    async setupTOTP() {
        try {
            return await this._api('POST', '/2fa/setup/totp');
        } catch {
            return { success: false, error: 'Could not contact the server.' };
        }
    },

    /** Confirm TOTP setup with a verification code */
    async confirmTOTP(code, secret) {
        try {
            const data = await this._api('POST', '/2fa/setup/totp/confirm', { code, secret });
            if (data.success) {
                const user = this.getCurrentUser();
                if (user) {
                    user.two_factor_enabled = true;
                    user.two_factor_method = 'totp';
                    user.two_factor_totp_enabled = true;
                    localStorage.setItem(this.SESSION_KEY, JSON.stringify(user));
                }
            }
            return data;
        } catch {
            return { success: false, error: 'Could not contact the server.' };
        }
    },

    /** Enable email-based 2FA */
    async enableEmailTwoFactor() {
        try {
            const data = await this._api('POST', '/2fa/setup/email');
            if (data.success) {
                const user = this.getCurrentUser();
                if (user) {
                    user.two_factor_enabled = true;
                    if (!user.two_factor_totp_enabled) user.two_factor_method = 'email';
                    user.two_factor_email_enabled = true;
                    localStorage.setItem(this.SESSION_KEY, JSON.stringify(user));
                }
            }
            return data;
        } catch {
            return { success: false, error: 'Could not contact the server.' };
        }
    },

    /** Disable 2FA (requires password). Pass method='totp'|'email' for per-method, or omit for all. */
    async disableTwoFactor(password, method) {
        try {
            const body = { password };
            if (method) body.method = method;
            const data = await this._api('DELETE', '/2fa/disable', body);
            if (data.success) {
                const user = this.getCurrentUser();
                if (user) {
                    if (method === 'totp') {
                        user.two_factor_totp_enabled = false;
                        user.two_factor_enabled = !!user.two_factor_email_enabled;
                        user.two_factor_method = user.two_factor_email_enabled ? 'email' : null;
                    } else if (method === 'email') {
                        user.two_factor_email_enabled = false;
                        user.two_factor_enabled = !!user.two_factor_totp_enabled;
                        user.two_factor_method = user.two_factor_totp_enabled ? 'totp' : null;
                    } else {
                        user.two_factor_enabled = false;
                        user.two_factor_method = null;
                        user.two_factor_totp_enabled = false;
                        user.two_factor_email_enabled = false;
                    }
                    localStorage.setItem(this.SESSION_KEY, JSON.stringify(user));
                }
            }
            return data;
        } catch {
            return { success: false, error: 'Could not contact the server.' };
        }
    },

    // ─── Google OAuth ───────────────────────────────────

    /** Get all trusted devices for the current user */
    async getTrustedDevices() {
        try {
            const data = await this._api('GET', '/trusted-devices');
            return data.success ? data.devices : [];
        } catch {
            return [];
        }
    },

    /** Revoke a specific trusted device by id */
    async revokeTrustedDevice(deviceId) {
        try {
            return await this._api('DELETE', '/trusted-devices/' + deviceId);
        } catch {
            return { success: false, error: 'Could not contact the server.' };
        }
    },

    /** Revoke all trusted devices */
    async revokeAllTrustedDevices() {
        try {
            return await this._api('DELETE', '/trusted-devices');
        } catch {
            return { success: false, error: 'Could not contact the server.' };
        }
    },

    /** Request email fallback code during 2FA login (switch from TOTP to email) */
    async requestEmailFallback() {
        const tempToken = localStorage.getItem('cnote_temp_token');
        if (!tempToken) return { success: false, error: 'Temporary session has expired.' };
        try {
            return await this._api('POST', '/2fa/fallback-email', { tempToken });
        } catch {
            return { success: false, error: 'Could not contact the server.' };
        }
    },

    // ─── Backup Codes ───────────────────────────────────

    /** Generate backup codes (after 2FA setup) */
    async generateBackupCodes() {
        try {
            return await this._api('POST', '/2fa/backup-codes/generate');
        } catch {
            return { success: false, error: 'Could not contact the server.' };
        }
    },

    /** Regenerate backup codes (requires password) */
    async regenerateBackupCodes(password) {
        try {
            return await this._api('POST', '/2fa/backup-codes/regenerate', { password });
        } catch {
            return { success: false, error: 'Could not contact the server.' };
        }
    },

    /** Get count of remaining unused backup codes */
    async getBackupCodesCount() {
        try {
            const data = await this._api('GET', '/2fa/backup-codes/count');
            return data.success ? data.remaining : 0;
        } catch {
            return 0;
        }
    },

    /** Redirect to Google OAuth for login/register */
    loginWithGoogle() {
        window.location.href = this._apiBase + '/auth/google';
    },

    /** Redirect to Google OAuth for account linking */
    linkGoogle() {
        const token = localStorage.getItem(this.TOKEN_KEY);
        if (!token) return;
        window.location.href = this._apiBase + '/auth/google?link_token=' + encodeURIComponent(token);
    },

    /** Unlink Google from account */
    async unlinkGoogle() {
        try {
            const data = await this._api('DELETE', '/auth/google/unlink');
            if (data.success) {
                const user = this.getCurrentUser();
                if (user) {
                    user.google_linked = false;
                    localStorage.setItem(this.SESSION_KEY, JSON.stringify(user));
                }
            }
            return data;
        } catch {
            return { success: false, error: 'Could not contact the server.' };
        }
    },

    /** Handle Google OAuth redirect (call on login page load) */
    handleGoogleRedirect() {
        const hash = window.location.hash;
        if (!hash.startsWith('#google_auth=')) return null;

        try {
            const base64 = hash.replace('#google_auth=', '');
            const data = JSON.parse(atob(base64));
            // Clear hash from URL
            history.replaceState(null, '', window.location.pathname + window.location.search);

            if (data.token) localStorage.setItem(this.TOKEN_KEY, data.token);
            if (data.session_token) localStorage.setItem(this.SERVER_SESSION_TOKEN_KEY, data.session_token);
            if (data.user) this._setSession(data.user);

            return data;
        } catch {
            return null;
        }
    }
};
