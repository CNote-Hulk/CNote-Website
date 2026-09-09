/**
 * Settings Page (profil.html)
 * Account settings, profile/privacy, security, notifications, appearance.
 */
import { AuthModule } from '../../js/modules/auth.js';
import { ProgressModule } from '../../js/modules/progress.js';
import { AchievementsModule } from '../../js/modules/achievements.js';
import { SearchModule } from '../../js/modules/search.js';
import { API_BASE_URL } from '../../js/config.js';
import { confirmModal, promptModal } from '../../js/utils/confirm-modal.js';
import { I18nModule } from '../../js/modules/i18n.js?v=20260909e';
import { createDatePicker } from '../../js/utils/date-picker.js';
import { openAvatarCropper } from '../../js/modules/avatar-cropper.js';

/** Shortcut pentru traduceri */
const t = key => I18nModule.t(key);

// Init search + profile dropdown
SearchModule.init();

const user = AuthModule.getCurrentUser();
if (!user) {
    window.location.href = 'login.html';
} else if (!user.username_chosen) {
    window.location.href = 'setup-username.html';
}

/** Escape HTML special characters */
function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/** Convert console ID slug to display name */
function formatConsoleDisplayName(value) {
    if (!value) return '';
    const words = String(value).trim().replace(/-/g, ' ').split(/\s+/).filter(Boolean)
        .map((word) => {
            const lower = word.toLowerCase();
            if (lower === 'playstation') return 'PlayStation';
            if (lower === 'xbox') return 'Xbox';
            if (lower === 'nintendo') return 'Nintendo';
            if (lower === 'sega') return 'Sega';
            if (/^\d+$/.test(lower)) return lower;
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        });
    return words.join(' ');
}

// ── Hash redirect map for old URLs ──
const HASH_REDIRECTS = {
    setari: 'account',
    acasa: null,
    cursuri: null,
    realizari: null,
    evaluari: null,
    anunturi: null,
    prieteni: null,
    favorite: null,
    cereri: null
};

/** Main settings initializer */
function initSettings() {
    if (!user) return;

    // ═══ TAB SYSTEM ═══
    let achievementsLoaded = false;
    let reportsLoaded = false;
    let adminReportsLoaded = false;
    let adminAnalyticsLoaded = false;
    const activateTab = (tabKey, syncHash = false) => {
        let tabBtn = document.querySelector(`.profile-tab[data-tab="${tabKey}"]`);
        let panel = document.querySelector(`.profile-panel[data-panel="${tabKey}"]`);
        if (!tabBtn || !panel) return;

        document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.profile-panel').forEach(p => p.classList.remove('active'));

        tabBtn.classList.add('active');
        panel.classList.add('active');

        if (tabKey === 'achievements' && !achievementsLoaded) {
            achievementsLoaded = true;
            loadAchievements().catch(err => console.error(err));
        }

        if (tabKey === 'reports' && !reportsLoaded) {
            reportsLoaded = true;
            loadMyReports().catch(err => console.error('[reports]', err));
        }

        if (tabKey === 'admin-reports' && !adminReportsLoaded) {
            adminReportsLoaded = true;
            loadAdminReports().catch(err => console.error('[admin-reports]', err));
        }

        if (tabKey === 'admin-analytics' && !adminAnalyticsLoaded) {
            adminAnalyticsLoaded = true;
            loadAdminAnalytics().catch(err => console.error('[admin-analytics]', err));
        }

        if (syncHash) {
            const nextHash = `#${tabKey}`;
            if (window.location.hash !== nextHash) {
                window.location.hash = tabKey;
            }
        }
    };

    const applyHashTab = () => {
        const hash = window.location.hash.replace('#', '');
        if (!hash) return;
        // Handle old URL redirects
        if (hash in HASH_REDIRECTS) {
            const newTab = HASH_REDIRECTS[hash];
            if (newTab) {
                activateTab(newTab);
                window.location.hash = newTab;
            }
            return;
        }
        activateTab(hash);
    };

    // ═══ SIDEBAR HEADER ═══
    document.getElementById('profile-name').textContent = user.username;
    document.getElementById('profile-bio').textContent = user.bio || 'No description yet.';
    const profileDateEl = document.getElementById('profile-date');
    if (profileDateEl) profileDateEl.textContent = 'Member since ' + new Date(user.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });

    const adminBadge = document.getElementById('profile-admin-badge');
    if (adminBadge && user.role === 'admin') adminBadge.hidden = false;

    // Show admin tabs (sidebar + mobile dropdown) for admins
    if (user.role === 'admin') {
        document.querySelectorAll('.admin-only-tab').forEach(el => { el.hidden = false; });
    }

    const levelEl = document.getElementById('profile-level');
    if (levelEl) {
        const token = localStorage.getItem('cn_token');
        if (token) {
            fetch(`${API_BASE_URL}/me/level`, { headers: { 'Authorization': 'Bearer ' + token } })
                .then(r => r.json())
                .then(d => {
                    if (d.success) {
                        levelEl.textContent = `${d.emoji} ${d.name}`;
                        levelEl.hidden = false;
                        localStorage.setItem('cn_user_level', JSON.stringify({ emoji: d.emoji, name: d.name }));
                        const progressEl = document.getElementById('profile-level-progress');
                        if (progressEl) {
                            const barHtml = `<div style="margin-top:6px;height:3px;background:rgba(var(--accent-rgb),0.12);border-radius:2px;overflow:hidden;"><div style="width:${d.progressPercent}%;height:100%;background:var(--accent-color);border-radius:2px;transition:width 0.5s;"></div></div>`;
                            if (d.isMaxLevel) {
                                progressEl.innerHTML = `<span>${t('level_max_reached')}</span>`;
                            } else {
                                const nextLabel = d.nextLevelEmoji && d.nextLevelName
                                    ? `${t('level_next_label')}: ${d.nextLevelEmoji} ${d.nextLevelName}`
                                    : t('level_next_label');
                                progressEl.innerHTML = `<span>${d.xp} / ${d.xpForNext} XP — ${nextLabel}</span>${barHtml}`;
                            }
                            progressEl.hidden = false;
                        }
                    }
                })
                .catch(() => {});
        }
    }

    // ═══ AVATAR ═══
    const avatarBtn = document.getElementById('profile-avatar');
    const avatarInput = document.getElementById('avatar-upload');
    const avatarImg = document.getElementById('profile-avatar-img');
    const avatarFallback = document.getElementById('profile-avatar-fallback');
    const settingsAvatarImg = document.getElementById('settings-avatar-img');
    const settingsAvatarFallback = document.getElementById('settings-avatar-fallback');
    const getPreferredAvatar = () => AuthModule.normalizeAvatarUrl((user.avatar || '').trim());

    const renderAvatar = (avatar) => {
        const hasAvatar = !!avatar;
        avatarImg.hidden = !hasAvatar;
        avatarFallback.hidden = hasAvatar;
        if (hasAvatar) avatarImg.src = avatar;
        else avatarImg.removeAttribute('src');
        if (settingsAvatarImg) {
            settingsAvatarImg.hidden = !hasAvatar;
            settingsAvatarFallback.hidden = hasAvatar;
            if (hasAvatar) settingsAvatarImg.src = avatar;
            else settingsAvatarImg.removeAttribute('src');
        }
    };

    renderAvatar(getPreferredAvatar());

    // ── Lightbox open/close ──
    const lightbox = document.getElementById('avatar-lightbox');
    const lbImg = document.getElementById('avatar-lightbox-img');
    const lbFallback = document.getElementById('avatar-lightbox-fallback');
    const lbChangeBtn = document.getElementById('avatar-lb-change');
    const lbRemoveBtn = document.getElementById('avatar-lb-remove');

    function openProfileLightbox() {
        if (!lightbox) return;
        const avatarSrc = getPreferredAvatar();
        if (avatarSrc) {
            lbImg.src = avatarSrc;
            lbImg.hidden = false;
            lbFallback.hidden = true;
        } else {
            lbImg.hidden = true;
            lbFallback.hidden = false;
        }
        lightbox.classList.add('is-open');
        document.body.style.overflow = 'hidden';
    }

    function closeProfileLightbox() {
        if (lightbox) lightbox.classList.remove('is-open');
        document.body.style.overflow = '';
    }

    document.getElementById('avatar-lightbox-close')?.addEventListener('click', closeProfileLightbox);
    document.getElementById('avatar-lightbox-backdrop')?.addEventListener('click', closeProfileLightbox);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeProfileLightbox(); });

    lbChangeBtn?.addEventListener('click', () => { closeProfileLightbox(); avatarInput.click(); });

    lbRemoveBtn?.addEventListener('click', async () => {
        try {
            const result = await AuthModule.removeAvatar();
            if (!result || !result.success) {
                showSettingsMessage(result?.error || 'Could not remove profile picture.', false);
                return;
            }
            user.avatar = result.user.avatar;
            renderAvatar('');
            if (lbImg) { lbImg.hidden = true; lbFallback.hidden = false; }
            showSettingsMessage('Profile picture removed.', true);
            closeProfileLightbox();
        } catch {
            showSettingsMessage('Could not remove profile picture.', false);
        }
    });

    avatarBtn.addEventListener('click', openProfileLightbox);
    document.getElementById('settings-avatar-btn')?.addEventListener('click', openProfileLightbox);

    avatarInput.addEventListener('change', async (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            showSettingsMessage('You can only upload images.', false);
            avatarInput.value = '';
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            showSettingsMessage('Image is too large. Maximum 5MB.', false);
            avatarInput.value = '';
            return;
        }
        try {
            // WhatsApp-style crop: user picks which part of the image is visible
            const blob = await openAvatarCropper(file);
            if (!blob) { // cancelled
                avatarInput.value = '';
                return;
            }
            const result = await AuthModule.uploadAvatar(blob);
            if (!result || !result.success) {
                showSettingsMessage(result?.error || 'Could not update profile picture.', false);
                return;
            }
            user.avatar = result.user.avatar;
            renderAvatar(getPreferredAvatar());
            showSettingsMessage('Profile picture has been updated.', true);
        } catch (error) {
            showSettingsMessage(error.message || 'Could not update profile picture.', false);
        } finally {
            avatarInput.value = '';
        }
    });

    // ═══ TAB CLICK BINDING ═══
    document.querySelectorAll('.profile-tab').forEach(tab => {
        tab.addEventListener('click', () => activateTab(tab.dataset.tab, true));
    });

    applyHashTab();
    window.addEventListener('hashchange', applyHashTab);

    // ═══ ACCOUNT TAB ═══
    document.getElementById('set-username').value = user.username;
    document.getElementById('set-bio').value = user.bio || '';
    document.getElementById('set-email').value = user.email || '';
    // ── Custom date picker for birth date ──
    let _birthDatePicker = null;
    const birthDateContainer = document.getElementById('birth-date-picker');
    if (birthDateContainer) {
        const today = new Date();
        const maxISO = `${today.getFullYear() - 13}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const initVal = user.birth_date ? user.birth_date.slice(0, 10) : '';
        _birthDatePicker = createDatePicker(birthDateContainer, {
            value: initVal,
            placeholder: 'Select date of birth',
            maxDate: maxISO,
        });
        // If session cache is old, fetch fresh birth_date
        if (!user.birth_date) {
            const token = localStorage.getItem('cn_token');
            fetch(`${API_BASE_URL}/me`, { headers: token ? { 'Authorization': 'Bearer ' + token } : {} })
                .then(r => r.json()).then(d => {
                    if (d.user?.birth_date) _birthDatePicker.setValue(d.user.birth_date.slice(0, 10));
                }).catch(() => {});
        }
    }

    // Username cooldown hint
    const USERNAME_COOLDOWN_DAYS = 7;
    const usernameCooldownHint = document.getElementById('username-cooldown-hint');
    const usernameInput = document.getElementById('set-username');
    if (usernameCooldownHint && user.username_changed_at) {
        const changedAt = new Date(user.username_changed_at);
        const nextAllowed = new Date(changedAt.getTime() + USERNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
        const now = new Date();
        if (nextAllowed > now) {
            const dateStr = nextAllowed.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
            usernameCooldownHint.textContent = 'Next username change available on ' + dateStr + '.';
            usernameCooldownHint.style.display = '';
            if (usernameInput) usernameInput.disabled = true;
        }
    }

    initOwnedConsolesSelect();

    // Password section toggle for Google-only users
    const passwordSectionInfo = document.getElementById('password-section-info');
    const currentPasswordField = document.getElementById('current-password-field');
    const newPasswordField = document.getElementById('new-password-field');
    const confirmPasswordField = document.getElementById('confirm-password-field');
    if (!user.has_password) {
        if (passwordSectionInfo) passwordSectionInfo.style.display = '';
        if (currentPasswordField) currentPasswordField.style.display = 'none';
        if (newPasswordField) newPasswordField.style.display = 'none';
        if (confirmPasswordField) confirmPasswordField.style.display = 'none';
    } else {
        if (passwordSectionInfo) passwordSectionInfo.style.display = 'none';
        if (currentPasswordField) currentPasswordField.style.display = '';
        if (newPasswordField) newPasswordField.style.display = '';
        if (confirmPasswordField) confirmPasswordField.style.display = '';
    }

    // "Send set-password email" button for Google-only accounts
    const sendSetPasswordBtn = document.getElementById('send-set-password-btn');
    const setPasswordLinkMsg = document.getElementById('set-password-link-msg');
    if (sendSetPasswordBtn) {
        // Refresh has_password from API in case session cache is stale
        const _refreshPwSection = (hasPassword) => {
            if (hasPassword) {
                if (passwordSectionInfo) passwordSectionInfo.style.display = 'none';
                if (currentPasswordField) currentPasswordField.style.display = '';
                if (newPasswordField) newPasswordField.style.display = '';
                if (confirmPasswordField) confirmPasswordField.style.display = '';
            } else {
                if (passwordSectionInfo) passwordSectionInfo.style.display = '';
                if (currentPasswordField) currentPasswordField.style.display = 'none';
                if (newPasswordField) newPasswordField.style.display = 'none';
                if (confirmPasswordField) confirmPasswordField.style.display = 'none';
            }
        };
        {
            const _t = localStorage.getItem('cn_token');
            fetch(API_BASE_URL + '/me', {
                headers: _t ? { 'Authorization': 'Bearer ' + _t } : {},
                credentials: 'include'
            }).then(r => r.json()).then(d => {
                if (!d.user) return;
                const fresh = d.user.has_password;
                if (fresh !== user.has_password) {
                    _refreshPwSection(fresh);
                    const cached = AuthModule.getCurrentUser();
                    if (cached) {
                        cached.has_password = fresh;
                        localStorage.setItem(AuthModule.SESSION_KEY, JSON.stringify(cached));
                    }
                }
            }).catch(() => {});
        }
        sendSetPasswordBtn.addEventListener('click', async () => {
            const cached = AuthModule.getCurrentUser();
            if (cached && cached.has_password) return;
            sendSetPasswordBtn.disabled = true;
            sendSetPasswordBtn.textContent = 'Sending…';
            try {
                const token = localStorage.getItem('cn_token');
                const headers = { 'Content-Type': 'application/json' };
                if (token) headers['Authorization'] = 'Bearer ' + token;
                const res = await fetch(API_BASE_URL + '/me/set-password-email', {
                    method: 'POST', headers, credentials: 'include',
                    body: JSON.stringify({})
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.success) {
                    showMessage(setPasswordLinkMsg, data.error || 'Could not send the email. Try again later.', false);
                } else {
                    showMessage(setPasswordLinkMsg, data.message || 'Email sent! Check your inbox.', true);
                }
            } catch {
                showMessage(setPasswordLinkMsg, 'Could not send the email. Try again later.', false);
            } finally {
                sendSetPasswordBtn.disabled = false;
                sendSetPasswordBtn.textContent = 'Send set-password email';
            }
        });
    }

    // Show password confirmation field when email differs from current
    const emailInput = document.getElementById('set-email');
    const emailConfirmPasswordField = document.getElementById('email-confirm-password-field');
    const emailConfirmPasswordInput = document.getElementById('set-email-confirm-password');
    if (emailInput && emailConfirmPasswordField && user.has_password) {
        emailInput.addEventListener('input', () => {
            const changed = emailInput.value.trim().toLowerCase() !== (user.email || '').toLowerCase();
            emailConfirmPasswordField.style.display = changed ? '' : 'none';
            if (!changed && emailConfirmPasswordInput) emailConfirmPasswordInput.value = '';
        });
    }

    // Email verification banner
    const accountPanel = document.getElementById('panel-account');
    if (accountPanel && !user.email_verified && !document.getElementById('email-verification-banner')) {
        const verifyBanner = document.createElement('div');
        verifyBanner.className = 'course-card';
        verifyBanner.id = 'email-verification-banner';
        verifyBanner.style.marginBottom = '16px';
        verifyBanner.style.border = '1px solid rgba(212, 162, 78, 0.28)';
        verifyBanner.style.background = 'rgba(212, 162, 78, 0.08)';
        verifyBanner.innerHTML = `
            <div style="display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap;">
                <div>
                    <div style="color:var(--accent-color);font-weight:700;margin-bottom:6px;">Email not verified</div>
                    <div style="color:var(--text-light);font-size:0.9rem;">Your email is not verified. Check your inbox.</div>
                </div>
                <button type="button" class="auth-btn" id="resend-verification-btn" style="white-space:nowrap;">Resend verification email</button>
            </div>
        `;
        accountPanel.insertBefore(verifyBanner, accountPanel.firstChild);
    }

    // ═══ SETTINGS MESSAGE UTILITY ═══
    const showSettingsMessage = (message, isSuccess) => {
        const msg = document.getElementById('settings-msg');
        if (!msg) return;
        if (isSuccess) {
            msg.style.color = 'var(--success)';
            msg.style.background = 'rgba(74, 222, 128, 0.1)';
            msg.style.borderColor = 'rgba(74, 222, 128, 0.2)';
        } else {
            msg.style.color = '#e57373';
            msg.style.background = 'rgba(229, 115, 115, 0.12)';
            msg.style.borderColor = 'rgba(229, 115, 115, 0.25)';
        }
        msg.textContent = message;
        msg.classList.add('visible');
        setTimeout(() => msg.classList.remove('visible'), 3200);
    };

    // ═══ BACKUP CODES MODAL ═══
    const showBackupCodesModal = (codes) => {
        let overlay = document.getElementById('backup-codes-overlay');
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.id = 'backup-codes-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);';
        const formatted = codes.map((c, i) => `${String(i + 1).padStart(2, ' ')}. ${c}`).join('\n');
        overlay.innerHTML = `
            <div style="background:var(--bg-card,#1e1e1e);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:28px 32px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
                <h3 style="margin:0 0 8px;font-size:1.1rem;color:var(--text-primary,#fff);">Backup codes</h3>
                <p style="color:var(--text-muted,#a89880);font-size:0.85rem;margin:0 0 16px;">Save these codes in a safe place. Each code can only be used once. They will not be shown again.</p>
                <pre id="backup-codes-list" style="background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:16px 20px;font-family:'Courier New',monospace;font-size:0.95rem;line-height:1.8;color:var(--text-light,#f5eee6);white-space:pre;margin:0 0 16px;user-select:all;">${formatted}</pre>
                <div style="display:flex;gap:8px;justify-content:flex-end;">
                    <button type="button" id="backup-codes-copy" class="auth-btn settings-row__btn" style="font-size:0.82rem;padding:6px 14px;">Copy</button>
                    <button type="button" id="backup-codes-close" class="auth-btn settings-row__btn" style="font-size:0.82rem;padding:6px 14px;">Done</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#backup-codes-copy').addEventListener('click', () => {
            navigator.clipboard.writeText(codes.join('\n')).then(() => {
                const btn = overlay.querySelector('#backup-codes-copy');
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
            });
        });
        overlay.querySelector('#backup-codes-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    };

    // Generic message helper for any message element
    const showMessage = (msgEl, message, isSuccess) => {
        if (!msgEl) return;
        if (isSuccess) {
            msgEl.style.color = 'var(--success)';
            msgEl.style.background = 'rgba(74, 222, 128, 0.1)';
            msgEl.style.borderColor = 'rgba(74, 222, 128, 0.2)';
        } else {
            msgEl.style.color = '#e57373';
            msgEl.style.background = 'rgba(229, 115, 115, 0.12)';
            msgEl.style.borderColor = 'rgba(229, 115, 115, 0.25)';
        }
        msgEl.textContent = message;
        msgEl.classList.add('visible');
        setTimeout(() => msgEl.classList.remove('visible'), 3200);
    };

    // ═══ SETTINGS FORM (Account tab) ═══
    document.getElementById('settings-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('set-username').value;
        const bio = document.getElementById('set-bio').value;
        const owned_consoles = document.getElementById('set-owned-consoles').value;
        const email = document.getElementById('set-email').value;
        const currentPassword = document.getElementById('set-current-password').value;
        const emailConfirmPassword = (document.getElementById('set-email-confirm-password') || {}).value || '';
        const newPassword = document.getElementById('set-new-password').value;
        const confirmPassword = document.getElementById('set-new-password-confirm').value;

        const emailChanged = email.trim().toLowerCase() !== (user.email || '').toLowerCase();
        const wantsPasswordChange = newPassword.length > 0 || confirmPassword.length > 0;
        const isSetPasswordMode = !user.has_password;

        // For email change: require the email-specific password field
        if (emailChanged && user.has_password && !emailConfirmPassword) {
            showSettingsMessage('Enter your current password to confirm the email change.', false);
            if (emailConfirmPasswordField) emailConfirmPasswordField.style.display = '';
            if (emailConfirmPasswordInput) emailConfirmPasswordInput.focus();
            return;
        }

        if (!isSetPasswordMode && wantsPasswordChange && !currentPassword) {
            showSettingsMessage('Enter your current password to change your password.', false);
            return;
        }
        if (wantsPasswordChange && newPassword !== confirmPassword) {
            showSettingsMessage('New password and confirmation do not match.', false);
            return;
        }

        const birthDateVal = _birthDatePicker ? _birthDatePicker.getValue() : '';
        const profileResult = await AuthModule.updateProfile({ username, bio, owned_consoles, birth_date: birthDateVal || null });
        if (profileResult === false || (profileResult && !profileResult.success && profileResult.error)) {
            showSettingsMessage(profileResult?.error || 'Username is already taken.', false);
            return;
        }

        // Save owned consoles to table
        try {
            const ownedList = owned_consoles.split(',').map(s => s.trim()).filter(Boolean);
            const token = localStorage.getItem('cn_token');
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = 'Bearer ' + token;
            await fetch(API_BASE_URL + '/owned-consoles', {
                method: 'PUT', headers, credentials: 'include',
                body: JSON.stringify({ consoles: ownedList })
            });
            window.dispatchEvent(new CustomEvent('cn:owned-changed'));
        } catch { /* ignore */ }

        document.getElementById('profile-name').textContent = username;
        document.getElementById('profile-bio').textContent = bio || 'No description yet.';

        if (emailChanged) {
            const oldEmail = user.email || '';
            const emailResult = await AuthModule.updateEmail(email, emailConfirmPassword || currentPassword);
            if (!emailResult.success) {
                showSettingsMessage(emailResult.error || 'Could not change email.', false);
                return;
            }
            // Notify old address about the change (best-effort)
            try {
                const token = localStorage.getItem('cn_token');
                const headers = { 'Content-Type': 'application/json' };
                if (token) headers['Authorization'] = 'Bearer ' + token;
                await fetch(API_BASE_URL + '/me/email-change-notify', {
                    method: 'POST', headers, credentials: 'include',
                    body: JSON.stringify({ oldEmail, newEmail: email.trim().toLowerCase() })
                });
            } catch { /* non-critical */ }
            if (emailConfirmPasswordField) emailConfirmPasswordField.style.display = 'none';
            if (emailConfirmPasswordInput) emailConfirmPasswordInput.value = '';
        }

        if (wantsPasswordChange && !isSetPasswordMode) {
            const passwordResult = await AuthModule.updatePassword(currentPassword, newPassword);
            if (!passwordResult.success) {
                showSettingsMessage(passwordResult.error || 'Could not change password.', false);
                return;
            }
            // Notify user by email that their password was changed
            try {
                const token = localStorage.getItem('cn_token');
                const headers = { 'Content-Type': 'application/json' };
                if (token) headers['Authorization'] = 'Bearer ' + token;
                await fetch(API_BASE_URL + '/me/password-changed-notify', {
                    method: 'POST', headers, credentials: 'include',
                    body: JSON.stringify({})
                });
            } catch { /* non-critical */ }
            document.getElementById('set-new-password').value = '';
            document.getElementById('set-new-password-confirm').value = '';
        }

        user.username = username.trim();
        user.bio = bio;
        user.owned_consoles = owned_consoles;
        user.email = email.trim().toLowerCase();
        document.getElementById('set-current-password').value = '';
        showSettingsMessage('Settings updated successfully.', true);
    });

    // ═══ OWNED CONSOLES SAVE ═══
    const saveConsolesBtn = document.getElementById('save-owned-consoles-btn');
    const consolesMsg = document.getElementById('owned-consoles-msg');
    if (saveConsolesBtn && consolesMsg) {
        saveConsolesBtn.addEventListener('click', async () => {
            const owned_consoles = document.getElementById('set-owned-consoles').value;
            consolesMsg.style.display = 'none';
            saveConsolesBtn.disabled = true;
            try {
                const ownedList = owned_consoles.split(',').map(s => s.trim()).filter(Boolean);
                const token = localStorage.getItem('cn_token');
                const headers = { 'Content-Type': 'application/json' };
                if (token) headers['Authorization'] = 'Bearer ' + token;
                const res = await fetch(API_BASE_URL + '/owned-consoles', {
                    method: 'PUT', headers, credentials: 'include',
                    body: JSON.stringify({ consoles: ownedList })
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.success !== false) {
                    consolesMsg.textContent = 'Consoles saved.';
                    consolesMsg.style.color = 'var(--success, #4ade80)';
                    window.dispatchEvent(new CustomEvent('cn:owned-changed'));
                } else {
                    consolesMsg.textContent = data.error || 'Failed to save consoles.';
                    consolesMsg.style.color = 'var(--error, #e57373)';
                }
            } catch {
                consolesMsg.textContent = 'Failed to save consoles.';
                consolesMsg.style.color = 'var(--error, #e57373)';
            }
            consolesMsg.style.display = 'block';
            saveConsolesBtn.disabled = false;
        });
    }

    // ═══ CONFIRM DIALOG ═══
    const showConfirmDialog = ({
        title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
        withPassword = false, withTextInput = false
    }) => {
        const modal = document.getElementById('confirm-modal');
        const titleEl = document.getElementById('confirm-modal-title');
        const textEl = document.getElementById('confirm-modal-text');
        const okBtn = document.getElementById('confirm-modal-ok');
        const cancelBtn = document.getElementById('confirm-modal-cancel');
        const cancelBackdrop = modal.querySelector('[data-modal-cancel]');
        const actionsEl = modal.querySelector('.app-modal__actions');

        const existingInputWrap = modal.querySelector('.app-modal__input-wrap');
        if (existingInputWrap) existingInputWrap.remove();

        let modalInput = null;
        if (withPassword || withTextInput) {
            const wrap = document.createElement('div');
            wrap.className = 'app-modal__input-wrap';
            wrap.style.margin = '12px 0 2px';
            if (withPassword) {
                wrap.innerHTML = `<label for="confirm-modal-input" style="display:block;font-size:0.82rem;color:var(--text-muted,#a89880);margin-bottom:6px;">Password</label>
                    <input id="confirm-modal-input" type="password" autocomplete="current-password" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.2);color:var(--text-light,#f5eee6);outline:none;" />`;
            } else {
                wrap.innerHTML = `<label for="confirm-modal-input" style="display:block;font-size:0.82rem;color:var(--text-muted,#a89880);margin-bottom:6px;">Type DELETE to confirm</label>
                    <input id="confirm-modal-input" type="text" autocomplete="off" placeholder="DELETE" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.2);color:var(--text-light,#f5eee6);outline:none;text-transform:uppercase;letter-spacing:0.1em;" />`;
            }
            modal.querySelector('.app-modal__dialog').insertBefore(wrap, actionsEl);
            modalInput = wrap.querySelector('#confirm-modal-input');
        }

        titleEl.textContent = title;
        textEl.textContent = message;
        okBtn.textContent = confirmLabel;
        cancelBtn.textContent = cancelLabel;
        modal.hidden = false;
        document.body.classList.add('modal-open');
        setTimeout(() => { if (modalInput) modalInput.focus(); else okBtn.focus(); }, 0);

        return new Promise((resolve) => {
            const close = (value) => {
                modal.hidden = true;
                document.body.classList.remove('modal-open');
                okBtn.removeEventListener('click', onOk);
                cancelBtn.removeEventListener('click', onCancel);
                cancelBackdrop.removeEventListener('click', onCancel);
                document.removeEventListener('keydown', onKeydown);
                const cleanup = modal.querySelector('.app-modal__input-wrap');
                if (cleanup) cleanup.remove();
                resolve(value);
            };
            const onOk = () => {
                if (withPassword) close({ confirmed: true, password: (modalInput?.value || '').trim() });
                else if (withTextInput) close({ confirmed: true, textValue: (modalInput?.value || '').trim() });
                else close(true);
            };
            const onCancel = () => {
                if (withPassword || withTextInput) close({ confirmed: false });
                else close(false);
            };
            const onKeydown = (event) => {
                if (event.key === 'Escape') onCancel();
                if ((withPassword || withTextInput) && event.key === 'Enter') onOk();
            };
            okBtn.addEventListener('click', onOk);
            cancelBtn.addEventListener('click', onCancel);
            cancelBackdrop.addEventListener('click', onCancel);
            document.addEventListener('keydown', onKeydown);
        });
    };

    // ═══ RESET ALL PROGRESS ═══
    document.getElementById('reset-all-btn').addEventListener('click', async () => {
        const confirmed = await showConfirmDialog({
            title: 'Full Data Reset',
            message: 'All progress will be deleted. Continue?',
            confirmLabel: 'Yes, reset', cancelLabel: 'Cancel'
        });
        if (!confirmed) return;

        try {
            const token = localStorage.getItem('cn_token');
            const resp = await fetch('/api/reset-progress', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                }
            });
            if (!resp.ok) throw new Error();
            showSettingsMessage('Reset complete.', true);
        } catch {
            showSettingsMessage('Reset failed. Please try again.', false);
            return;
        }
        achievementsLoaded = false;
        loadAchievements().catch(err => console.error(err));
    });

    function updateAchievementsUI(userData) {
        const badgeContainer = document.getElementById('badge-container');
        if (badgeContainer) {
            badgeContainer.innerHTML = '';
            const badges = Array.isArray(userData.badges) ? userData.badges : [];
            const CATEGORIES = window.AchievementsModule ? AchievementsModule.CATEGORIES : [];
            const categoryOrder = CATEGORIES.map(c => c.id);

            // Group badges by category
            const grouped = {};
            badges.forEach(badge => {
                const cat = badge.category || 'other';
                if (!grouped[cat]) grouped[cat] = [];
                grouped[cat].push(badge);
            });

            const renderGroup = (catId) => {
                const items = grouped[catId];
                if (!items || items.length === 0) return;
                const catDef = CATEGORIES.find(c => c.id === catId);
                const earned = items.filter(b => b.unlocked || b.earned).length;

                const section = document.createElement('div');
                section.className = 'ach-category';
                section.innerHTML = `<div class="ach-category__header">
                    <span class="ach-category__icon">${catDef ? catDef.icon : '🏅'}</span>
                    <span class="ach-category__label">${t('ach_cat_' + catId)}</span>
                    <span class="ach-category__count">${earned}/${items.length}</span>
                </div>
                <div class="ach-category__grid"></div>`;

                const grid = section.querySelector('.ach-category__grid');
                items.forEach(badge => {
                    const isEarned = !!(badge.unlocked || badge.earned);
                    const earnedDate = isEarned && badge.earned_at
                        ? new Date(badge.earned_at).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' })
                        : '';
                    const el = document.createElement('div');
                    el.className = 'achievement-badge' + (isEarned ? ' earned' : ' locked');
                    el.innerHTML = `
                        <div class="achievement-badge__icon">${badge.emoji || badge.icon || '🏅'}</div>
                        <div class="achievement-badge__name">${badge.name}</div>
                        <div class="achievement-badge__desc">${badge.description || ''}</div>
                        <div class="achievement-badge__status">${isEarned ? `${t('ach_earned')}${earnedDate ? ' ' + earnedDate : ''}` : t('ach_locked')}</div>
                    `;
                    grid.appendChild(el);
                });
                badgeContainer.appendChild(section);
            };

            categoryOrder.forEach(renderGroup);
            // Render any uncategorized
            Object.keys(grouped).filter(k => !categoryOrder.includes(k)).forEach(renderGroup);
        }

        const levelEl = document.getElementById('user-level');
        if (levelEl && userData.level) {
            levelEl.textContent = `${userData.level.emoji} ${userData.level.name}`;
        }
    }

    function calcLevelFromAchievements(achievements) {
        // Fallback estimate using public signals — real level comes from /api/me/level
        const earned = achievements.filter(a => a.unlocked || a.earned).length;
        if (window.AchievementsModule?.computePublicLevel) {
            return AchievementsModule.computePublicLevel(0, earned, 0, 1);
        }
        return { level: 1, name: 'Newcomer', emoji: '🔌' };
    }

    async function loadAchievements() {
        const badgeContainer = document.getElementById('badge-container');
        if (badgeContainer) badgeContainer.innerHTML = '<p style="color:var(--text-muted,#a89880);font-size:0.9rem;">Loading…</p>';
        try {
            const token = localStorage.getItem('cn_token');
            const resp = await fetch('/api/achievements', {
                headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                credentials: 'include'
            });
            if (!resp.ok) throw new Error('Could not load achievements');
            const data = await resp.json();
            const achievements = Array.isArray(data.achievements) ? data.achievements : [];
            const allBadges = (window.AchievementsModule && AchievementsModule.getAllBadges)
                ? AchievementsModule.getAllBadges(achievements) : achievements;
            const prevBadgeIds = JSON.parse(localStorage.getItem('cn_earned_badges') || '[]');
            const currentBadgeIds = allBadges.filter(b => b.earned || b.unlocked).map(b => b.id);
            const newBadgeIds = currentBadgeIds.filter(id => !prevBadgeIds.includes(id));
            if (newBadgeIds.length > 0 && window.AchievementsModule && AchievementsModule.showUnlockNotifications) {
                AchievementsModule.showUnlockNotifications(newBadgeIds, allBadges);
            }
            localStorage.setItem('cn_earned_badges', JSON.stringify(currentBadgeIds));
            updateAchievementsUI({ badges: achievements, level: calcLevelFromAchievements(achievements) });
        } catch (err) {
            const bc = document.getElementById('badge-container');
            if (bc) bc.innerHTML = '<p style="color:var(--error,#e57373);font-size:0.9rem;">Could not load achievements.</p>';
        }
    }

    // ═══ RESEND VERIFICATION ═══
    const resendVerificationBtn = document.getElementById('resend-verification-btn');
    if (resendVerificationBtn) {
        resendVerificationBtn.addEventListener('click', async () => {
            resendVerificationBtn.disabled = true;
            resendVerificationBtn.textContent = 'Sending...';
            try {
                const result = await fetch(API_BASE_URL + '/resend-verification', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(localStorage.getItem('cn_token') ? { Authorization: 'Bearer ' + localStorage.getItem('cn_token') } : {}) },
                    credentials: 'include'
                });
                const data = await result.json();
                showSettingsMessage(data.message || 'Verification email has been resent.', !!data.success);
            } catch {
                showSettingsMessage('Could not resend verification email.', false);
            } finally {
                resendVerificationBtn.disabled = false;
                resendVerificationBtn.textContent = 'Resend verification email';
            }
        });
    }

    // ═══ PROFILE TAB — Nickname ═══
    const nicknameInput = document.getElementById('set-nickname');
    const saveNicknameBtn = document.getElementById('save-nickname-btn');
    const nicknameMsg = document.getElementById('nickname-msg');
    if (nicknameInput) nicknameInput.value = user.nickname || '';
    if (saveNicknameBtn) {
        saveNicknameBtn.addEventListener('click', async () => {
            const result = await AuthModule.updateProfile({ nickname: nicknameInput?.value || '' });
            if (result?.success) user.nickname = (nicknameInput?.value || '').trim();
            showMessage(nicknameMsg, result?.success ? 'Nickname saved.' : (result?.error || 'Error.'), !!result?.success);
        });
    }

    // ═══ PROFILE TAB — Privacy toggles ═══
    const showEmailToggle = document.getElementById('show-email');
    const showStatsToggle = document.getElementById('show-stats');
    const showFriendsToggle = document.getElementById('show-friends');
    const showSocialToggle = document.getElementById('show-social-links');

    if (showEmailToggle) showEmailToggle.checked = !!user.show_email;
    if (showStatsToggle) showStatsToggle.checked = user.show_stats !== false;
    if (showFriendsToggle) showFriendsToggle.checked = user.show_friends !== false;
    if (showSocialToggle) showSocialToggle.checked = user.show_social_links !== false;

    const savePrivacyBtn = document.getElementById('save-privacy-btn');
    if (savePrivacyBtn) {
        savePrivacyBtn.addEventListener('click', async () => {
            const result = await AuthModule.updateProfile({
                show_email: showEmailToggle?.checked ?? false,
                show_stats: showStatsToggle?.checked ?? true,
                show_friends: showFriendsToggle?.checked ?? true,
                show_social_links: showSocialToggle?.checked ?? true
            });
            showMessage(document.getElementById('privacy-msg'), result?.success ? 'Privacy settings saved.' : (result?.error || 'Error.'), !!result?.success);
        });
    }

    // ═══ PROFILE TAB — Social links ═══
    const socialDiscord = document.getElementById('social-discord');
    const socialTwitter = document.getElementById('social-twitter');
    const socialYoutube = document.getElementById('social-youtube');
    const socialInstagram = document.getElementById('social-instagram');

    if (socialDiscord) socialDiscord.value = user.social_discord || '';
    if (socialTwitter) socialTwitter.value = user.social_twitter || '';
    if (socialYoutube) socialYoutube.value = user.social_youtube || '';
    if (socialInstagram) socialInstagram.value = user.social_instagram || '';

    const saveSocialBtn = document.getElementById('save-social-btn');
    if (saveSocialBtn) {
        saveSocialBtn.addEventListener('click', async () => {
            const result = await AuthModule.updateProfile({
                social_discord: socialDiscord?.value || '',
                social_twitter: socialTwitter?.value || '',
                social_youtube: socialYoutube?.value || '',
                social_instagram: socialInstagram?.value || ''
            });
            showMessage(document.getElementById('social-msg'), result?.success ? 'Social links saved.' : (result?.error || 'Error.'), !!result?.success);
        });
    }

    // ═══ NOTIFICATIONS TAB ═══
    const notifFriend = document.getElementById('notif-new-friend');
    const notifMessage = document.getElementById('notif-new-message');
    const notifRepair = document.getElementById('notif-repair-reply');
    if (notifFriend) notifFriend.checked = user.notify_new_friend !== false;
    if (notifMessage) notifMessage.checked = user.notify_new_message !== false;
    if (notifRepair) notifRepair.checked = user.notify_repair_reply !== false;

    const saveNotifBtn = document.getElementById('save-notif-prefs-btn');
    if (saveNotifBtn) {
        saveNotifBtn.addEventListener('click', async () => {
            const result = await AuthModule.updateProfile({
                notify_new_friend: notifFriend?.checked ?? true,
                notify_new_message: notifMessage?.checked ?? true,
                notify_repair_reply: notifRepair?.checked ?? false
            });
            showMessage(document.getElementById('notif-prefs-msg'), result?.success ? 'Notification preferences saved.' : (result?.error || 'Could not save preferences.'), !!result?.success);
        });
    }

    // ═══ SECURITY TAB — Dynamic cards ═══
    const securityPanel = document.getElementById('panel-security');

    // Google Account Card
    if (securityPanel && !document.getElementById('google-account-card')) {
        const googleCard = document.createElement('div');
        googleCard.className = 'settings-injected-row';
        googleCard.id = 'google-account-card';
        googleCard.innerHTML = `
            <div class="settings-injected-row__meta">
                <div class="settings-injected-row__title">Google account</div>
                <div class="settings-injected-row__desc">${user.google_linked
                    ? 'Your account is connected with Google.'
                    : 'Connect your account with Google for quick login.'}</div>
            </div>
            <div class="settings-injected-row__body">
                ${user.google_linked
                    ? '<button type="button" class="auth-btn settings-row__btn" id="google-unlink-btn" style="background:transparent;border:1px solid var(--color-border, #444);color:var(--text-light);">Disconnect Google</button>'
                    : '<button type="button" class="auth-btn settings-row__btn" id="google-link-btn" style="display:flex;align-items:center;gap:10px;background:rgba(255,255,255,0.05);color:var(--text-light,#F5F0E8);border:1px solid rgba(255,255,255,0.12);font-weight:600;"><span style="font-weight:700;font-size:1.1rem;line-height:1;">G</span> Connect with Google</button>'
                }
            </div>
        `;
        securityPanel.appendChild(googleCard);
    }

    // Two-Factor Authentication Card
    if (securityPanel && !document.getElementById('two-factor-card')) {
        const tfCard = document.createElement('div');
        tfCard.className = 'settings-injected-row';
        tfCard.id = 'two-factor-card';
        const totpEnabled = !!user.two_factor_totp_enabled;
        const emailEnabled = !!user.two_factor_email_enabled;

        let totpSection;
        if (totpEnabled) {
            totpSection = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                <span style="color:var(--success, #4ade80);font-size:0.88rem;">&#10003; Authenticator app — active${emailEnabled ? ' (primary)' : ''}</span>
                <button type="button" class="auth-btn auth-btn--danger settings-row__btn" id="disable-totp-btn" style="background:transparent;border:1px solid rgba(229,115,115,0.55);color:#f3a5a5;font-size:0.82rem;padding:5px 12px;">Disable</button>
            </div>`;
        } else {
            totpSection = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                <span style="color:var(--text-light);font-size:0.88rem;">Authenticator app — inactive</span>
                <button type="button" class="auth-btn settings-row__btn" id="setup-totp-2fa-btn" style="font-size:0.82rem;padding:5px 12px;">Enable</button>
            </div>
            <div id="totp-setup-area" style="display:none;margin-top:16px;">
                <p style="color:var(--text-light);font-size:0.88rem;margin-bottom:10px;">Scan the QR code with your authenticator app:</p>
                <div id="totp-qr-container" style="text-align:center;margin-bottom:12px;"></div>
                <p id="totp-secret-display" style="font-family:monospace;font-size:0.85rem;color:var(--text-light);word-break:break-all;margin-bottom:12px;text-align:center;"></p>
                <div style="display:flex;gap:8px;align-items:center;">
                    <input type="text" id="totp-confirm-code" placeholder="000000" maxlength="6" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" style="text-align:center;font-size:1.2rem;letter-spacing:0.3rem;padding:8px 12px;border:1px solid var(--color-border, #444);border-radius:6px;background:var(--bg-card, #1a1a1a);color:var(--text-primary, #fff);width:140px;">
                    <button type="button" class="auth-btn settings-row__btn" id="totp-confirm-btn">Confirm</button>
                </div>
            </div>`;
        }

        let emailSection;
        if (emailEnabled) {
            emailSection = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                <span style="color:var(--success, #4ade80);font-size:0.88rem;">&#10003; Email — active${totpEnabled ? ' (fallback)' : ''}</span>
                <button type="button" class="auth-btn auth-btn--danger settings-row__btn" id="disable-email-btn" style="background:transparent;border:1px solid rgba(229,115,115,0.55);color:#f3a5a5;font-size:0.82rem;padding:5px 12px;">Disable</button>
            </div>`;
        } else {
            emailSection = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                <span style="color:var(--text-light);font-size:0.88rem;">Email — inactive</span>
                <button type="button" class="auth-btn settings-row__btn" id="setup-email-2fa-btn" style="font-size:0.82rem;padding:5px 12px;">Enable</button>
            </div>`;
        }

        let backupSection = '';
        if (totpEnabled || emailEnabled) {
            backupSection = `
                    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.06);margin:2px 0;">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                        <span style="color:var(--text-light);font-size:0.88rem;">Backup codes — <span id="backup-codes-remaining" style="color:var(--text-muted,#a89880);">loading...</span></span>
                        <button type="button" class="auth-btn settings-row__btn" id="regenerate-backup-codes-btn" style="font-size:0.82rem;padding:5px 12px;">Regenerate</button>
                    </div>`;
        }

        tfCard.innerHTML = `
            <div class="settings-injected-row__meta">
                <div class="settings-injected-row__title">Two-factor auth (2FA)</div>
                <div class="settings-injected-row__desc">Add an extra layer of security. The authenticator app is primary, email is fallback.</div>
            </div>
            <div class="settings-injected-row__body">
                <div style="display:flex;flex-direction:column;gap:12px;">
                    ${totpSection}
                    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.06);margin:2px 0;">
                    ${emailSection}
                    ${backupSection}
                </div>
            </div>
        `;
        securityPanel.appendChild(tfCard);

        // Load backup codes count
        if (totpEnabled || emailEnabled) {
            AuthModule.getBackupCodesCount().then(count => {
                const el = document.getElementById('backup-codes-remaining');
                if (el) el.textContent = count + ' remaining';
                if (el && count === 0) el.style.color = '#e57373';
            });
        }
    }

    // Delete account button is now in the Account tab (static HTML)

    // ═══ SECURITY — Google handlers ═══
    const googleLinkBtn = document.getElementById('google-link-btn');
    if (googleLinkBtn) googleLinkBtn.addEventListener('click', () => AuthModule.linkGoogle());

    const googleUnlinkBtn = document.getElementById('google-unlink-btn');
    if (googleUnlinkBtn) {
        googleUnlinkBtn.addEventListener('click', async () => {
            const confirmed = await showConfirmDialog({ title: 'Disconnect Google', message: 'Are you sure you want to disconnect your Google account?', confirmLabel: 'Disconnect', cancelLabel: 'Cancel' });
            if (!confirmed) return;
            const result = await AuthModule.unlinkGoogle();
            if (result.success) {
                showSettingsMessage('Google has been disconnected.', true);
                const card = document.getElementById('google-account-card');
                if (card) card.remove();
            } else {
                showSettingsMessage(result.error || 'Error.', false);
            }
        });
    }

    // ═══ SECURITY — 2FA handlers ═══
    const refreshTwoFactorCard = () => {
        const card = document.getElementById('two-factor-card');
        if (card) card.remove();
        window.location.hash = 'security';
        window.location.reload();
    };

    const setupEmail2faBtn = document.getElementById('setup-email-2fa-btn');
    if (setupEmail2faBtn) {
        setupEmail2faBtn.addEventListener('click', async () => {
            const confirmed = await showConfirmDialog({ title: 'Enable Email 2FA', message: 'You will receive a code by email on each login. Continue?', confirmLabel: 'Enable', cancelLabel: 'Cancel' });
            if (!confirmed) return;
            const result = await AuthModule.enableEmailTwoFactor();
            if (result.success) { showSettingsMessage('Email 2FA has been enabled!', true); refreshTwoFactorCard(); }
            else showSettingsMessage(result.error || 'Error.', false);
        });
    }

    const setupTotp2faBtn = document.getElementById('setup-totp-2fa-btn');
    if (setupTotp2faBtn) {
        setupTotp2faBtn.addEventListener('click', async () => {
            const result = await AuthModule.setupTOTP();
            if (!result.success) { showSettingsMessage(result.error || 'Error generating QR code.', false); return; }
            const area = document.getElementById('totp-setup-area');
            document.getElementById('totp-qr-container').innerHTML = '<img src="' + result.qrCode + '" alt="QR Code" style="max-width:200px;border-radius:8px;">';
            document.getElementById('totp-secret-display').textContent = 'Manual key: ' + result.secret;
            area.style.display = 'block';
            area.dataset.secret = result.secret;
        });
    }

    const totpConfirmInput = document.getElementById('totp-confirm-code');
    if (totpConfirmInput) {
        totpConfirmInput.addEventListener('input', () => {
            if (totpConfirmInput.value.replace(/\D/g, '').length === 6) {
                document.getElementById('totp-confirm-btn')?.click();
            }
        });
    }

    const totpConfirmBtn = document.getElementById('totp-confirm-btn');
    if (totpConfirmBtn) {
        totpConfirmBtn.addEventListener('click', async () => {
            const code = document.getElementById('totp-confirm-code').value.trim();
            const secret = document.getElementById('totp-setup-area').dataset.secret;
            if (!code || code.length !== 6) { showSettingsMessage('Enter the 6-digit code.', false); return; }
            const result = await AuthModule.confirmTOTP(code, secret);
            if (result.success) {
                showSettingsMessage('Authenticator app 2FA has been enabled!', true);
                // Generate backup codes and show them
                const backupResult = await AuthModule.generateBackupCodes();
                if (backupResult.success && backupResult.codes) {
                    showBackupCodesModal(backupResult.codes);
                }
                refreshTwoFactorCard();
            }
            else showSettingsMessage(result.error || 'Invalid code.', false);
        });
    }

    const disable2faHandler = async (method, label) => {
        const dialogResult = await showConfirmDialog({ title: 'Disable 2FA via ' + label, message: 'Enter your password to disable 2FA via ' + label + '.', confirmLabel: 'Disable', cancelLabel: 'Cancel', withPassword: true });
        if (!dialogResult || !dialogResult.confirmed) return;
        if (!dialogResult.password) { showSettingsMessage('Enter your password to confirm.', false); return; }
        const result = await AuthModule.disableTwoFactor(dialogResult.password, method);
        if (result.success) { showSettingsMessage(result.message || '2FA has been disabled.', true); refreshTwoFactorCard(); }
        else showSettingsMessage(result.error || 'Error.', false);
    };

    const disableTotpBtn = document.getElementById('disable-totp-btn');
    if (disableTotpBtn) disableTotpBtn.addEventListener('click', () => disable2faHandler('totp', 'authenticator app'));

    const disableEmailBtn = document.getElementById('disable-email-btn');
    if (disableEmailBtn) disableEmailBtn.addEventListener('click', () => disable2faHandler('email', 'email'));

    const regenBackupBtn = document.getElementById('regenerate-backup-codes-btn');
    if (regenBackupBtn) {
        regenBackupBtn.addEventListener('click', async () => {
            const dialogResult = await showConfirmDialog({ title: 'Regenerate backup codes', message: 'This will invalidate all existing backup codes. Enter your password to continue.', confirmLabel: 'Regenerate', cancelLabel: 'Cancel', withPassword: true });
            if (!dialogResult || !dialogResult.confirmed) return;
            if (!dialogResult.password) { showSettingsMessage('Enter your password to confirm.', false); return; }
            const result = await AuthModule.regenerateBackupCodes(dialogResult.password);
            if (result.success && result.codes) {
                showBackupCodesModal(result.codes);
                showSettingsMessage('Backup codes have been regenerated.', true);
                const el = document.getElementById('backup-codes-remaining');
                if (el) { el.textContent = '10 remaining'; el.style.color = ''; }
            } else {
                showSettingsMessage(result.error || 'Error regenerating codes.', false);
            }
        });
    }

    // Google link success from URL params
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('google_linked') === '1') {
        showSettingsMessage('Google account has been connected successfully!', true);
        history.replaceState(null, '', window.location.pathname + window.location.hash);
    }
    if (urlParams.get('error') === 'google_already_linked') {
        showSettingsMessage('This Google account is already used by another user.', false);
        history.replaceState(null, '', window.location.pathname + window.location.hash);
    }

    // ═══ ACCOUNT — Delete account ═══
    const deleteAccountBtn = document.getElementById('delete-account-btn');
    if (deleteAccountBtn) {
        deleteAccountBtn.addEventListener('click', async () => {
            let result;
            let currentHasPassword = user.has_password;
            try {
                const t = localStorage.getItem('cn_token');
                const meRes = await fetch(API_BASE_URL + '/me', {
                    headers: t ? { 'Authorization': 'Bearer ' + t } : {},
                    credentials: 'include'
                });
                if (meRes.ok) {
                    const meData = await meRes.json();
                    if (meData.user) currentHasPassword = meData.user.has_password;
                }
            } catch {}
            if (currentHasPassword) {
                const dialogResult = await showConfirmDialog({ title: 'Delete account', message: 'This action is permanent. Enter your password to confirm.', confirmLabel: 'Delete account', cancelLabel: 'Cancel', withPassword: true });
                if (!dialogResult || !dialogResult.confirmed) return;
                if (!dialogResult.password) { showSettingsMessage('Enter your password to confirm.', false); return; }
                result = await AuthModule.deleteAccount({ password: dialogResult.password });
            } else {
                const dialogResult = await showConfirmDialog({ title: 'Delete Account', message: 'Type DELETE to confirm permanent account deletion.', confirmLabel: 'Delete account', cancelLabel: 'Cancel', withTextInput: true });
                if (!dialogResult || !dialogResult.confirmed) return;
                if (!dialogResult.textValue) { showSettingsMessage('Type DELETE to confirm.', false); return; }
                result = await AuthModule.deleteAccount({ confirmText: dialogResult.textValue });
            }
            if (!result.success) { showSettingsMessage(result.error || 'Could not delete the account.', false); return; }
            await AuthModule.logout();
            window.location.href = '/html/pages/index.html';
        });
    }

    // ═══ ACCOUNT — GDPR data export ═══
    const exportDataBtn = document.getElementById('export-data-btn');
    if (exportDataBtn) {
        exportDataBtn.addEventListener('click', async () => {
            const originalText = exportDataBtn.textContent;
            exportDataBtn.disabled = true;
            exportDataBtn.textContent = t('gdpr.export.loading');

            try {
                const token = localStorage.getItem('cn_token');
                const res = await fetch(`${API_BASE_URL}/me/export`, {
                    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                    credentials: 'include'
                });

                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    showSettingsMessage(data.error || t('gdpr.export.error'), false);
                    return;
                }

                const data = await res.json();
                const filename = `cnote-export-${user.username}-${new Date().toISOString().slice(0, 10)}.json`;
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
            } catch {
                showSettingsMessage(t('gdpr.export.error'), false);
            } finally {
                exportDataBtn.disabled = false;
                exportDataBtn.textContent = originalText;
            }
        });
    }

    // ═══ SECURITY — Sessions ═══
    function timeAgo(dateStr) {
        if (!dateStr) return 'unknown';
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + ' min ago';
        const hours = Math.floor(mins / 60);
        if (hours < 24) return hours + ' hours ago';
        return Math.floor(hours / 24) + ' days ago';
    }

    async function loadSessions() {
        const container = document.getElementById('sessions-container');
        const logoutOthersBtn = document.getElementById('logout-others-btn');
        try {
            const sessions = await AuthModule.getSessions();
            if (!sessions || sessions.length === 0) {
                container.innerHTML = '<p style="color:var(--text-muted,#a89880);font-size:0.85rem;">No active sessions.</p>';
                logoutOthersBtn.hidden = true;
                return;
            }
            container.innerHTML = sessions.map(s => {
                const icon = s.device_type === 'mobile' || s.device_type === 'tablet' ? '📱' : '💻';
                const current = s.is_current ? ' <span style="color:var(--success);font-size:0.75rem;font-weight:600;">(current session)</span>' : '';
                return `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px 14px;">
                    <div style="font-size:0.9rem;color:var(--text-light);">${icon} ${escapeHtml(s.browser)} on ${escapeHtml(s.operating_system)}${current}</div>
                    <div style="font-size:0.78rem;color:var(--text-muted,#a89880);margin-top:4px;">IP: ${escapeHtml(s.ip_address)} · Last activity: ${timeAgo(s.last_activity)}</div>
                    <button class="session-logout-btn" data-session-id="${s.id}" data-is-current="${s.is_current ? '1' : '0'}" style="background:none;border:1px solid rgba(229,115,115,0.4);color:#e57373;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:0.75rem;margin-top:6px;">Log out</button>
                </div>`;
            }).join('');
            logoutOthersBtn.hidden = sessions.length === 0;
            container.querySelectorAll('.session-logout-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const result = await AuthModule.terminateSession(parseInt(btn.dataset.sessionId, 10));
                    if (!result.success) return;
                    if (btn.dataset.isCurrent === '1') { await AuthModule.logout(); window.location.href = '/html/pages/index.html'; return; }
                    loadSessions();
                });
            });
        } catch {
            container.innerHTML = '<p style="color:#e57373;font-size:0.85rem;">Failed to load sessions.</p>';
        }
    }

    document.getElementById('logout-others-btn').addEventListener('click', async () => {
        const confirmed = await showConfirmDialog({ title: 'Log out other devices', message: 'Do you want to log out from all other devices?', confirmLabel: 'Yes, log out', cancelLabel: 'Cancel' });
        if (!confirmed) return;
        const result = await AuthModule.terminateAllSessions();
        if (result.success) window.location.href = '/html/pages/index.html';
    });

    // ═══ SECURITY — Trusted Devices ═══
    async function loadTrustedDevices() {
        const container = document.getElementById('trusted-devices-container');
        const revokeAllBtn = document.getElementById('revoke-all-trusted-btn');
        if (!container) return;
        try {
            const devices = await AuthModule.getTrustedDevices();
            if (!devices || devices.length === 0) {
                container.innerHTML = '<p style="color:var(--text-muted,#a89880);font-size:0.85rem;">No trusted devices.</p>';
                revokeAllBtn.hidden = true;
                return;
            }
            container.innerHTML = devices.map(d => {
                return `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px 14px;">
                    <div style="font-size:0.9rem;color:var(--text-light);">🔒 ${escapeHtml(d.browser || 'Unknown')} on ${escapeHtml(d.operating_system || 'Unknown')}</div>
                    <div style="font-size:0.78rem;color:var(--text-muted,#a89880);margin-top:4px;">IP: ${escapeHtml(d.ip_address || '?')} · Last used: ${timeAgo(d.last_used)} · Expires: ${new Date(d.expires_at).toLocaleDateString()}</div>
                    <button class="trusted-device-revoke-btn" data-device-id="${d.id}" style="background:none;border:1px solid rgba(229,115,115,0.4);color:#e57373;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:0.75rem;margin-top:6px;">Revoke</button>
                </div>`;
            }).join('');
            revokeAllBtn.hidden = devices.length === 0;
            container.querySelectorAll('.trusted-device-revoke-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const result = await AuthModule.revokeTrustedDevice(parseInt(btn.dataset.deviceId, 10));
                    if (result.success) loadTrustedDevices();
                });
            });
        } catch {
            container.innerHTML = '<p style="color:#e57373;font-size:0.85rem;">Failed to load trusted devices.</p>';
        }
    }

    document.getElementById('revoke-all-trusted-btn').addEventListener('click', async () => {
        const confirmed = await showConfirmDialog({ title: 'Revoke all trusted devices', message: 'All devices will need to complete 2FA again on next login. Continue?', confirmLabel: 'Revoke all', cancelLabel: 'Cancel' });
        if (!confirmed) return;
        const result = await AuthModule.revokeAllTrustedDevices();
        if (result.success) loadTrustedDevices();
    });

    loadSessions();
    loadTrustedDevices();

    // ═══ APPEARANCE TAB — Theme selector ═══
    // Dark is the default for a visitor who never touched the toggle. "System" is stored
    // as the literal string 'system' and resolved live to whichever of dark/light matches
    // the OS preference — see the matching resolveTheme() in profile-dropdown.js.
    const themeCards = document.querySelectorAll('.theme-card[data-theme-value]');
    const storedTheme = localStorage.getItem('cnote-theme');
    const currentTheme = storedTheme === null ? 'dark' : storedTheme;

    function resolveThemeValue(theme) {
        if (theme === 'system') return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        return theme;
    }

    themeCards.forEach(card => {
        if (card.dataset.themeValue === currentTheme) card.classList.add('active');
        card.addEventListener('click', () => {
            const theme = card.dataset.themeValue;
            document.documentElement.dataset.theme = resolveThemeValue(theme);
            localStorage.setItem('cnote-theme', theme);
            themeCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            // Sync accent picker if no custom accent is saved
            if (!localStorage.getItem('cnote-accent-color')) {
                requestAnimationFrame(() => syncPickerToAccent(getComputedAccent()));
            }
        });
    });

    // ═══ APPEARANCE TAB — Accent color ═══
    function lightenHex(hex, percent) {
        let r = parseInt(hex.slice(1,3), 16);
        let g = parseInt(hex.slice(3,5), 16);
        let b = parseInt(hex.slice(5,7), 16);
        r = Math.min(255, Math.floor(r + (255 - r) * percent / 100));
        g = Math.min(255, Math.floor(g + (255 - g) * percent / 100));
        b = Math.min(255, Math.floor(b + (255 - b) * percent / 100));
        return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
    }

    function applyAccentColor(hex) {
        const r = parseInt(hex.slice(1,3), 16);
        const g = parseInt(hex.slice(3,5), 16);
        const b = parseInt(hex.slice(5,7), 16);
        const root = document.documentElement;
        root.style.setProperty('--accent-color', hex);
        root.style.setProperty('--accent-light', lightenHex(hex, 20));
        root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
        root.style.setProperty('--accent-color-rgb', `${r}, ${g}, ${b}`);
        root.style.setProperty('--glow-accent', `0 0 20px rgba(${r}, ${g}, ${b}, 0.15)`);
        localStorage.setItem('cnote-accent-color', hex);
    }

    function resetAccentColor() {
        localStorage.removeItem('cnote-accent-color');
        const root = document.documentElement;
        root.style.removeProperty('--accent-color');
        root.style.removeProperty('--accent-light');
        root.style.removeProperty('--accent-rgb');
        root.style.removeProperty('--accent-color-rgb');
        root.style.removeProperty('--glow-accent');
    }

    function getComputedAccent() {
        const theme = document.documentElement.dataset.theme || '';
        const fromCss = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
        if (fromCss) return fromCss;
        if (theme === 'dark') return '#FFFFFF';
        if (theme === 'light') return '#111317';
        return '#F5F0E8';
    }

    function syncPickerToAccent(hex) {
        if (accentInput) accentInput.value = hex;
        accentSwatches.forEach(s => s.classList.toggle('active', s.dataset.color === hex));
    }

    const accentInput = document.getElementById('accent-color-input');
    const accentSwatches = document.querySelectorAll('.accent-swatch');
    const resetAccentBtn = document.getElementById('reset-accent-btn');
    const savedAccent = localStorage.getItem('cnote-accent-color');

    if (savedAccent) {
        if (accentInput) accentInput.value = savedAccent;
        accentSwatches.forEach(s => {
            s.classList.toggle('active', s.dataset.color === savedAccent);
        });
    } else {
        syncPickerToAccent(getComputedAccent());
    }

    if (accentInput) {
        accentInput.addEventListener('input', (e) => {
            applyAccentColor(e.target.value);
            accentSwatches.forEach(s => s.classList.remove('active'));
        });
    }

    accentSwatches.forEach(swatch => {
        swatch.addEventListener('click', () => {
            const color = swatch.dataset.color;
            applyAccentColor(color);
            if (accentInput) accentInput.value = color;
            accentSwatches.forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
        });
    });

    if (resetAccentBtn) {
        resetAccentBtn.addEventListener('click', () => {
            resetAccentColor();
            syncPickerToAccent(getComputedAccent());
        });
    }
}

// ── DSA Art. 16 — My Reports ─────────────────────────────────

const CONTENT_TYPE_KEYS = {
    forum_thread:   'report_content_type_forum_thread',
    forum_reply:    'report_content_type_forum_reply',
    direct_message: 'report_content_type_direct_message',
    listing:        'report_content_type_listing',
    user_profile:   'report_content_type_user_profile',
};

const REASON_KEYS_PROFILE = {
    illegal_content: 'report_reason_illegal_content',
    hate_speech:     'report_reason_hate_speech',
    harassment:      'report_reason_harassment',
    spam:            'report_reason_spam',
    csam:            'report_reason_csam',
    misinformation:  'report_reason_misinformation',
    other:           'report_reason_other',
};

const STATUS_CLS = {
    pending:   'pending',
    reviewed:  'reviewed',
    actioned:  'actioned',
    resolved:  'resolved',
    dismissed: 'dismissed',
};

/**
 * loadMyReports
 * Fetches GET /api/reports/my and renders a table in #my-reports-container.
 * Called lazily the first time the "reports" tab is opened.
 */
async function loadMyReports() {
    const container = document.getElementById('my-reports-container');
    if (!container) return;

    container.innerHTML = `<p class="my-reports-empty">${t('report_my_reports_loading')}</p>`;

    try {
        const session = AuthModule.getCurrentUser();
        const token = session?.token
            || localStorage.getItem('cn_token')
            || (() => { try { return JSON.parse(localStorage.getItem('cn_session') || 'null')?.token; } catch { return null; } })();

        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        const resp = await fetch(`${API_BASE_URL}/reports/my`, { headers });
        const data = await resp.json().catch(() => ({}));

        if (!resp.ok || !data.success) throw new Error(data.error || 'Error');

        const reports = data.reports || [];

        if (!reports.length) {
            container.innerHTML = `<p class="my-reports-empty">${t('report_my_reports_empty')}</p>`;
            return;
        }

        const rows = reports.map(r => {
            const cls = STATUS_CLS[r.status] || 'pending';
            const statusLabel = t('report_status_' + (r.status || 'pending'));
            const date = new Date(r.created_at).toLocaleDateString(I18nModule.lang === 'ro' ? 'ro-RO' : undefined, {
                day: '2-digit', month: '2-digit', year: 'numeric'
            });
            const typeLabel   = t(CONTENT_TYPE_KEYS[r.content_type] || 'report_col_content_type');
            const reasonLabel = t(REASON_KEYS_PROFILE[r.reason] || 'report_col_reason');

            const labelSuffix = r.content_label ? ': ' + escapeHtml(r.content_label.slice(0, 40)) : '';
            const safeLink = r.content_link ? r.content_link.replace(/"/g, '%22') : '';
            const contentCell = safeLink
                ? `<a href="${safeLink}" class="report-content-link" target="_blank" rel="noopener">${typeLabel}${labelSuffix}</a>`
                : `${typeLabel}${labelSuffix}`;

            return `<tr>
                <td>${contentCell}</td>
                <td>${reasonLabel}</td>
                <td><span class="report-status-badge report-status-badge--${cls}">${statusLabel}</span></td>
                <td>${date}</td>
            </tr>`;
        }).join('');

        container.innerHTML = `
            <table class="my-reports-table">
                <thead>
                    <tr>
                        <th>${t('report_col_content_type')}</th>
                        <th>${t('report_col_reason')}</th>
                        <th>${t('report_col_status')}</th>
                        <th>${t('report_col_date')}</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>`;

    } catch (err) {
        console.error('[loadMyReports]', err);
        container.innerHTML = `<p class="my-reports-empty">${t('report_my_reports_load_error')}</p>`;
    }
}

/**
 * loadAdminReports
 * Fetches GET /api/reports/admin and renders interactive report cards.
 * Admin only — tab is hidden for non-admins.
 */
async function loadAdminReports() {
    const container = document.getElementById('admin-reports-container');
    if (!container) return;

    const token = localStorage.getItem('cn_token') || '';
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    const REASON_ICONS = {
        spam: '🚫', hate_speech: '💢', harassment: '😡',
        illegal_content: '⚠️', csam: '🔞', misinformation: '❌', other: '📋',
    };
    const REASON_LABELS = {
        spam: 'Spam', hate_speech: 'Hate speech', harassment: 'Harassment',
        illegal_content: 'Illegal content', csam: 'CSAM', misinformation: 'Misinformation', other: 'Other',
    };
    const TYPE_ICONS = {
        forum_thread: '💬', forum_reply: '↩️', user_profile: '👤',
        listing: '🏷️', direct_message: '✉️',
    };
    const TYPE_LABELS = {
        forum_thread: 'Forum post', forum_reply: 'Forum reply', user_profile: 'User profile',
        listing: 'Marketplace listing', direct_message: 'Direct message',
    };
    // Action buttons per status
    // (2026-09-01) "Resolve" is no longer a plain status flip — Andrei asked for it to
    // present the actual moderation choices (ban permanent/temp, mute, delete content)
    // instead, since those are what actually resolve a report. It's handled separately
    // below (data-resolve-toggle), not as a plain data-status entry here — see renderCards.
    const STATUS_ACTIONS = {
        pending:   [
            { status: 'reviewed',  label: '👁 Mark reviewed',  cls: 'ar-btn--review' },
            { status: 'dismissed', label: '✖ Dismiss',          cls: 'ar-btn--dismiss' },
        ],
        reviewed:  [
            { status: 'dismissed', label: '✖ Dismiss',          cls: 'ar-btn--dismiss' },
        ],
        // (2026-09-01) Andrei: once a report is resolved (ban/mute/delete already acted on
        // it), Dismiss doesn't make sense alongside it — the only thing left to offer is
        // undoing the call, i.e. Reopen.
        resolved:  [
            { status: 'pending',   label: '↩ Reopen',           cls: 'ar-btn--reopen' },
        ],
        dismissed: [
            { status: 'pending',   label: '↩ Reopen',           cls: 'ar-btn--reopen' },
        ],
    };

    let allReports = [];
    let activeFilter = 'all';

    async function setStatus(reportId, newStatus, cardEl) {
        cardEl.classList.add('ar-card--loading');
        try {
            const res = await fetch(`${API_BASE_URL}/reports/admin/${reportId}`, {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
                credentials: 'include',
            });
            const data = await res.json();
            if (data.success) {
                const r = allReports.find(x => String(x.id) === String(reportId));
                if (r) r.status = newStatus;
                applyFilter(activeFilter);
            } else {
                cardEl.classList.remove('ar-card--loading');
                alert('Error: ' + (data.error || 'Unknown error'));
            }
        } catch {
            cardEl.classList.remove('ar-card--loading');
        }
    }

    async function moderationAction(reportId, action, cardEl, body) {
        cardEl.classList.add('ar-card--loading');
        // ban-author-permanent/ban-author-temp are both the same `ban-author` server
        // endpoint — the distinction lives in `body.hours` (see reports.js), not the URL.
        const endpointAction = action.startsWith('ban-author') ? 'ban-author' : action;
        try {
            const res = await fetch(`${API_BASE_URL}/reports/admin/${reportId}/${endpointAction}`, {
                method: action === 'content' ? 'DELETE' : 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: body ? JSON.stringify(body) : undefined,
                credentials: 'include',
            });
            const data = await res.json();
            if (data.success) {
                if (action.startsWith('ban-author')) {
                    const r = allReports.find(x => String(x.id) === String(reportId));
                    if (r) r.status = 'resolved';
                } else if (action === 'mute-author') {
                    // Matches the server (reports.js's mute-author sets status='resolved',
                    // it's one of the "Resolve" choices now, not a separate track) — this
                    // was still stuck on the pre-redesign 'reviewed' value, which showed the
                    // wrong badge/actions (Dismiss only, no Reopen) right after muting until
                    // the next full reload re-fetched the real status from the server.
                    const r = allReports.find(x => String(x.id) === String(reportId));
                    if (r) r.status = 'resolved';
                } else if (action === 'content') {
                    const r = allReports.find(x => String(x.id) === String(reportId));
                    if (r) r.status = 'resolved';
                }
                applyFilter(activeFilter);
            } else {
                cardEl.classList.remove('ar-card--loading');
                alert('Error: ' + (data.error || 'Unknown error'));
            }
        } catch {
            cardEl.classList.remove('ar-card--loading');
        }
    }

    function renderCards(reports) {
        if (!reports.length) {
            container.innerHTML = `<p class="my-reports-empty">No reports in this category.</p>`;
            return;
        }

        const cards = reports.map(r => {
            const cls = STATUS_CLS[r.status] || 'pending';
            const statusLabel = { pending: 'Pending', reviewed: 'Reviewed', resolved: 'Resolved', dismissed: 'Dismissed' }[r.status] || r.status;
            const date = new Date(r.created_at).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const typeIcon = TYPE_ICONS[r.content_type] || '📄';
            const typeLabel = TYPE_LABELS[r.content_type] || r.content_type.replace(/_/g, ' ');
            const reasonIcon = REASON_ICONS[r.reason] || '📋';
            const reasonLabel = REASON_LABELS[r.reason] || r.reason.replace(/_/g, ' ');
            const reporter = r.reporter_username
                ? `<a href="/user/${escapeHtml(r.reporter_username)}" target="_blank" class="ar-reporter">@${escapeHtml(r.reporter_username)}</a>`
                : '<span class="ar-reporter ar-reporter--anon">Anonymous</span>';
            // (2026-09-01) content_label used to be a link that navigated away to the
            // reported content's live page — Andrei asked to see the actual reported
            // content (message/listing/etc.) right here instead, not leave Admin Reports.
            // Plain non-navigating label now; content_body (already returned in full by
            // GET /reports/admin, never truncated here) is the "show me the message" part.
            const rawLabel = r.content_label || `#${r.content_id}`;
            const contentLabel = escapeHtml(rawLabel);
            const contentBody = r.content_body
                ? `<div class="ar-content-body">${escapeHtml(r.content_body)}</div>`
                : '';
            const contentImage = r.content_image
                ? `<img class="ar-content-image" src="${escapeHtml(r.content_image)}" alt="" loading="lazy">`
                : '';
            const reporterNote = r.description ? `<div class="ar-description">"${escapeHtml(r.description)}"</div>` : '';
            const actions = (STATUS_ACTIONS[r.status] || []).map(a =>
                `<button class="ar-btn ${a.cls}" data-id="${r.id}" data-status="${a.status}">${a.label}</button>`
            ).join('');

            // "Resolve" — pending/reviewed only. Opens the moderation choice list
            // (ar-card__mod-actions, hidden by default) if there's an author to act on;
            // otherwise falls back to a plain status flip (data-resolve-fallback) since
            // there's nothing left to ban/mute/delete.
            const canModerate = (r.status === 'pending' || r.status === 'reviewed');
            const resolveBtn = canModerate
                ? (r.author_id
                    ? `<button class="ar-btn ar-btn--resolve" data-id="${r.id}" data-resolve-toggle="1">✅ Resolve</button>`
                    : `<button class="ar-btn ar-btn--resolve" data-id="${r.id}" data-status="resolved">✅ Resolve</button>`)
                : '';

            const modActions = r.author_id ? [
                `<button class="ar-btn ar-btn--ban" data-id="${r.id}" data-mod-action="ban-author-permanent">🚫 ${t('admin_ban_permanent_btn')}</button>`,
                `<button class="ar-btn ar-btn--ban" data-id="${r.id}" data-mod-action="ban-author-temp">⏳ ${t('admin_ban_temp_btn')}</button>`,
                `<button class="ar-btn ar-btn--mute" data-id="${r.id}" data-mod-action="mute-author">🔇 ${t('admin_mute_author_btn')}</button>`,
                r.content_type !== 'user_profile'
                    ? `<button class="ar-btn ar-btn--delete-content" data-id="${r.id}" data-mod-action="content">🗑 ${t('admin_delete_content_btn')}</button>`
                    : '',
            ].join('') : '';

            return `<div class="ar-card" data-report-id="${r.id}">
                <div class="ar-card__header">
                    <div class="ar-card__type">${typeIcon} ${typeLabel}</div>
                    <span class="report-status-badge report-status-badge--${cls}">${statusLabel}</span>
                </div>
                <div class="ar-card__content">
                    <div class="ar-card__label">${contentLabel}</div>
                    ${contentImage}
                    ${contentBody}
                    <div class="ar-card__meta">
                        <span>${reasonIcon} <strong>${reasonLabel}</strong></span>
                        <span>·</span>
                        <span>Reported by ${reporter}</span>
                        <span>·</span>
                        <span>${date}</span>
                    </div>
                    ${reporterNote}
                </div>
                <div class="ar-card__actions">${resolveBtn}${actions || (resolveBtn ? '' : '<span class="ar-no-actions">No further actions</span>')}</div>
                ${modActions ? `<div class="ar-card__mod-actions" hidden>${modActions}</div>` : ''}
            </div>`;
        }).join('');

        container.innerHTML = `<div class="ar-card-list">${cards}</div>`;

        container.querySelectorAll('.ar-btn[data-status]').forEach(btn => {
            btn.addEventListener('click', () => {
                const card = btn.closest('.ar-card');
                setStatus(btn.dataset.id, btn.dataset.status, card);
            });
        });

        // "Resolve" reveals the moderation choice list in place, instead of immediately
        // flipping status — the actual chosen action (ban/mute/delete) is what resolves it.
        container.querySelectorAll('.ar-btn[data-resolve-toggle]').forEach(btn => {
            btn.addEventListener('click', () => {
                const card = btn.closest('.ar-card');
                const modPanel = card.querySelector('.ar-card__mod-actions');
                if (modPanel) modPanel.hidden = !modPanel.hidden;
            });
        });

        container.querySelectorAll('.ar-btn[data-mod-action]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const card = btn.closest('.ar-card');
                const action = btn.dataset.modAction;
                if (action === 'ban-author-permanent') {
                    const ok = await confirmModal(t('admin_ban_confirm'), { ok: t('admin_ban_confirm_ok') });
                    if (!ok) return;
                    moderationAction(btn.dataset.id, 'ban-author-permanent', card, { reason: 'Content report' });
                } else if (action === 'ban-author-temp') {
                    const days = parseInt(await promptModal(t('admin_ban_temp_prompt'), { defaultValue: 7 }), 10);
                    if (!days || days <= 0) return;
                    const ok = await confirmModal(t('admin_ban_confirm'), { ok: t('admin_ban_confirm_ok') });
                    if (!ok) return;
                    moderationAction(btn.dataset.id, 'ban-author-temp', card, { reason: 'Content report', hours: days * 24 });
                } else if (action === 'mute-author') {
                    const hours = parseInt(await promptModal(t('admin_mute_prompt'), { defaultValue: 72 }), 10);
                    if (!hours || hours <= 0) return;
                    moderationAction(btn.dataset.id, 'mute-author', card, { hours });
                } else if (action === 'content') {
                    const ok = await confirmModal(t('admin_delete_content_confirm'), { ok: t('admin_delete_content_confirm_ok') });
                    if (!ok) return;
                    moderationAction(btn.dataset.id, 'content', card);
                }
            });
        });
    }

    function applyFilter(filter) {
        activeFilter = filter;
        document.querySelectorAll('.admin-filter-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.filter === filter);
        });
        const filtered = filter === 'all' ? allReports : allReports.filter(r => r.status === filter);
        renderCards(filtered);
    }

    document.querySelectorAll('.admin-filter-btn[data-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            showModerated(false);
            applyFilter(btn.dataset.filter);
        });
    });

    // ── "🔒 Banned & Muted" toggle — Andrei: "add a list where you can see everyone
    // you've banned or muted, so you can lift it if it was a mistake". Swaps the reports
    // list out for a flat list of currently-sanctioned users, independent of which
    // report (if any) led to the sanction — lazy-loaded on first toggle.
    const moderatedContainer = document.getElementById('admin-moderated-container');
    const moderatedBtn = document.getElementById('admin-view-moderated-btn');
    let moderatedLoaded = false;

    function showModerated(show) {
        if (moderatedContainer) moderatedContainer.hidden = !show;
        if (container) container.hidden = show;
        document.querySelector('.admin-reports-filters')?.querySelectorAll('.admin-filter-btn[data-filter]')
            .forEach(b => b.classList.toggle('active', !show && b.dataset.filter === activeFilter));
        moderatedBtn?.classList.toggle('active', show);
    }

    async function loadModeratedUsers() {
        if (!moderatedContainer) return;
        moderatedContainer.innerHTML = `<p class="my-reports-empty">Loading…</p>`;
        try {
            const resp = await fetch(`${API_BASE_URL}/admin/moderated-users`, { headers, credentials: 'include' });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || !data.success) throw new Error(data.error || 'Error');
            renderModeratedUsers(data.users || []);
        } catch (err) {
            console.error('[loadModeratedUsers]', err);
            moderatedContainer.innerHTML = `<p class="my-reports-empty">Failed to load.</p>`;
        }
    }

    function renderModeratedUsers(users) {
        if (!users.length) {
            moderatedContainer.innerHTML = `<p class="my-reports-empty">No one is currently banned or muted.</p>`;
            return;
        }
        const rows = users.map(u => {
            const banned = u.is_banned;
            const muted = !banned && u.muted_until;
            const untilLabel = banned
                ? (u.banned_until ? `until ${new Date(u.banned_until).toLocaleString('ro-RO')}` : 'permanently')
                : (muted ? `until ${new Date(u.muted_until).toLocaleString('ro-RO')}` : '');
            const reasonLine = u.banned_reason ? `<div class="ar-description">"${escapeHtml(u.banned_reason)}"</div>` : '';
            return `<div class="ar-card" data-user-id="${u.id}">
                <div class="ar-card__header">
                    <div class="ar-card__type">${banned ? '🚫 Banned' : '🔇 Muted'} ${escapeHtml(untilLabel)}</div>
                </div>
                <div class="ar-card__content">
                    <div class="ar-card__label">@${escapeHtml(u.username)}</div>
                    ${reasonLine}
                </div>
                <div class="ar-card__actions">
                    <button class="ar-btn ar-btn--reopen" data-user-id="${u.id}" data-lift="${banned ? 'unban' : 'unmute'}">
                        ↩ ${banned ? 'Unban' : 'Unmute'}
                    </button>
                </div>
            </div>`;
        }).join('');
        moderatedContainer.innerHTML = `<div class="ar-card-list">${rows}</div>`;

        moderatedContainer.querySelectorAll('.ar-btn[data-lift]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const card = btn.closest('.ar-card');
                card.classList.add('ar-card--loading');
                try {
                    const res = await fetch(`${API_BASE_URL}/admin/users/${btn.dataset.userId}/${btn.dataset.lift}`, {
                        method: 'POST',
                        headers: { ...headers, 'Content-Type': 'application/json' },
                        credentials: 'include',
                    });
                    const data = await res.json();
                    if (data.success) {
                        card.remove();
                    } else {
                        card.classList.remove('ar-card--loading');
                        alert('Error: ' + (data.error || 'Unknown error'));
                    }
                } catch {
                    card.classList.remove('ar-card--loading');
                }
            });
        });
    }

    moderatedBtn?.addEventListener('click', () => {
        showModerated(true);
        if (!moderatedLoaded) {
            moderatedLoaded = true;
            loadModeratedUsers();
        }
    });

    container.innerHTML = `<p class="my-reports-empty">Loading…</p>`;
    try {
        const resp = await fetch(`${API_BASE_URL}/reports/admin`, { headers, credentials: 'include' });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success) throw new Error(data.error || 'Error');
        allReports = data.reports || [];
        applyFilter('all');
    } catch (err) {
        console.error('[loadAdminReports]', err);
        container.innerHTML = `<p class="my-reports-empty">Failed to load reports.</p>`;
    }
}

async function loadAdminAnalytics() {
    const container = document.getElementById('admin-analytics-container');
    if (!container) return;

    const token = localStorage.getItem('cn_token') || '';
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    container.innerHTML = `<p class="my-reports-empty">${t('admin_analytics_loading')}</p>`;
    try {
        const resp = await fetch(`${API_BASE_URL}/admin/stats`, { headers, credentials: 'include' });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success) throw new Error(data.error || 'Error');

        const tiles = [
            { icon: '👥', label: t('admin_stat_total_users'), value: data.totalUsers },
            { icon: '🟢', label: t('admin_stat_active_7d'), value: data.activeUsers7d },
            { icon: '📈', label: t('admin_stat_active_30d'), value: data.activeUsers30d },
            { icon: '🛒', label: t('admin_stat_listings'), value: data.totalListings },
            { icon: '💬', label: t('admin_stat_threads'), value: data.totalThreads },
            { icon: '💭', label: t('admin_stat_replies'), value: data.totalReplies },
        ];
        const tilesHtml = tiles.map(tile => `
            <div class="aa-tile">
                <span class="aa-tile__icon">${tile.icon}</span>
                <div class="aa-tile__value">${tile.value}</div>
                <div class="aa-tile__label">${tile.label}</div>
            </div>
        `).join('');

        const maxSignups = Math.max(1, ...data.signupsByDay.map(d => d.count));
        const signupsHtml = data.signupsByDay.length
            ? data.signupsByDay.map(d => {
                const date = new Date(d.day).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
                const pct = Math.round((d.count / maxSignups) * 100);
                return `<div class="aa-bar-row">
                    <span class="aa-bar-row__label">${date}</span>
                    <div class="aa-bar-row__track"><div class="aa-bar-row__fill" style="width:${pct}%"></div></div>
                    <span class="aa-bar-row__value">${d.count}</span>
                </div>`;
            }).join('')
            : `<p class="my-reports-empty">${t('admin_analytics_no_signups')}</p>`;

        const STATUS_ICONS = { active: '🟢', sold: '✅', inactive: '⏸' };
        const statusHtml = data.listingsByStatus.map(s =>
            `<span class="aa-status-chip aa-status-chip--${s.status}">${STATUS_ICONS[s.status] || '•'} ${s.status}: ${s.count}</span>`
        ).join('');

        container.innerHTML = `
            <div class="aa-tiles">${tilesHtml}</div>
            <h4 class="aa-section-title">${t('admin_analytics_signups_title')}</h4>
            <div class="aa-bars">${signupsHtml}</div>
            <h4 class="aa-section-title">${t('admin_analytics_status_title')}</h4>
            <div class="aa-status-row">${statusHtml}</div>
        `;
    } catch (err) {
        console.error('[loadAdminAnalytics]', err);
        container.innerHTML = `<p class="my-reports-empty">${t('admin_analytics_error')}</p>`;
    }
}

/** Initialize the owned-consoles multi-select dropdown */
async function initOwnedConsolesSelect() {
    const listEl = document.getElementById('owned-consoles-list');
    const searchEl = document.getElementById('owned-consoles-search');
    const hiddenInput = document.getElementById('set-owned-consoles');
    if (!listEl || !searchEl || !hiddenInput) return;

    let allConsoles = [];
    let selectedIds = new Set();

    try {
        const token = localStorage.getItem('cn_token');
        const headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const [consolesRes, ownedRes] = await Promise.all([
            fetch(API_BASE_URL + '/consoles/list', { headers, credentials: 'include' }),
            fetch(API_BASE_URL + '/owned-consoles', { headers, credentials: 'include' })
        ]);
        const consolesData = await consolesRes.json();
        const ownedData = await ownedRes.json();
        if (consolesData.success) allConsoles = consolesData.consoles;
        if (ownedData.success) ownedData.consoles.forEach(id => selectedIds.add(id));
    } catch { }

    if (allConsoles.length === 0 && window.CONSOLES_DATA && window.CONSOLES_DATA.length > 0) {
        allConsoles = window.CONSOLES_DATA.map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
    }

    if (allConsoles.length === 0) {
        listEl.innerHTML = '<p style="color:#e57373;font-size:0.85rem;">Could not load consoles.</p>';
        return;
    }

    if (user.owned_consoles) {
        user.owned_consoles.split(',').map(s => s.trim()).filter(Boolean).forEach(id => selectedIds.add(id));
    }

    function updateHidden() { hiddenInput.value = Array.from(selectedIds).join(','); }

    function renderList(filter = '') {
        const normalizedFilter = String(filter || '').trim().toLowerCase();
        const filtered = filter
            ? allConsoles.filter(c => {
                const idText = String(c.id || '').toLowerCase();
                const nameText = formatConsoleDisplayName(c.name || c.id || '').toLowerCase();
                return idText.includes(normalizedFilter) || nameText.includes(normalizedFilter);
            })
            : allConsoles;

        if (filtered.length === 0) {
            listEl.innerHTML = '<p style="color:var(--text-gray);font-size:0.85rem;padding:8px;">No consoles found.</p>';
            return;
        }

        listEl.innerHTML = filtered.map(c => {
            const checked = selectedIds.has(c.id);
            const displayName = formatConsoleDisplayName(c.name || c.id);
            return `<label class="owned-console-item${checked ? ' checked' : ''}">
                <input type="checkbox" value="${escapeHtml(c.id)}" ${checked ? 'checked' : ''}>
                <span class="owned-console-check">${checked ? '☑' : '☐'}</span>
                <span class="owned-console-name">${escapeHtml(displayName)}</span>
            </label>`;
        }).join('');

        listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => {
                if (cb.checked) selectedIds.add(cb.value);
                else selectedIds.delete(cb.value);
                updateHidden();
                renderList(searchEl.value);
            });
        });
    }

    searchEl.addEventListener('input', () => renderList(searchEl.value));
    renderList();
    updateHidden();
}

// ── Mobile bottom nav — tab switching ────────────────────────
(function initMbnTabs() {
    const TABS = ['account', 'profil', 'privacy', 'security', 'notifications', 'appearance', 'reports', 'admin-reports', 'admin-analytics'];
    const btn = document.getElementById('mbn-more-btn');
    const dd  = document.getElementById('mbn-dropdown');

    function setActive(tabKey) {
        document.querySelectorAll('.mbn-item[data-mbn-tab]').forEach(el => {
            el.classList.toggle('mbn-item--active', el.dataset.mbnTab === tabKey);
        });
        document.querySelectorAll('.mbn-dd-item[data-mbn-tab]').forEach(el => {
            const match = el.dataset.mbnTab === tabKey;
            el.classList.toggle('mbn-item--active', match);
            if (match && btn) btn.classList.add('mbn-item--active');
        });
    }

    function switchTab(tabKey) {
        const profileBtn = document.querySelector(`.profile-tab[data-tab="${tabKey}"]`);
        if (profileBtn) profileBtn.click();
        setActive(tabKey);
    }

    const initial = location.hash.slice(1);
    setActive(TABS.includes(initial) ? initial : 'account');

    document.querySelectorAll('.mbn-item[data-mbn-tab], .mbn-dd-item[data-mbn-tab]').forEach(el => {
        el.addEventListener('click', () => {
            switchTab(el.dataset.mbnTab);
            if (dd) dd.classList.remove('is-open');
            if (btn) btn.setAttribute('aria-expanded', 'false');
        });
    });

    window.addEventListener('hashchange', () => {
        const h = location.hash.slice(1);
        if (TABS.includes(h)) setActive(h);
    });
}());

initSettings();

/**
 * Marketplace Connections Panel
 * Handles marketplace integration UI (connect, disconnect, sync, status)
 * for any provider added to MARKETPLACES below. Both eBay and OLX
 * currently show as static "Coming soon" cards in profil.html (no button
 * ids) — OLX because its API needs a registered business account not
 * live yet, eBay deactivated 2026-07-23 (was fully functional; the
 * backend integration — routes/ebay.js, providers/EbayProvider.js — is
 * untouched and ready to re-enable, only the UI entry point is off).
 * MARKETPLACES is intentionally empty until one of them comes back.
 */

const MARKETPLACES = [];

/** Initialize marketplace connections panel */
async function initMarketplace() {
	const token = localStorage.getItem('cn_token');

	// -----------------------------
	// Load accounts from backend
	// -----------------------------
	async function loadMarketplaceAccounts() {
		try {
			const res = await fetch(`${API_BASE_URL}/marketplace/accounts`, {
				headers: { Authorization: `Bearer ${token}` }
			});

			const data = await res.json();
			if (!data.success) return;

			const accounts = data.accounts || [];

			MARKETPLACES.forEach(({ id }) => {
				const account = accounts.find(a => a.provider === id);
				updateProviderUI(id, account);
			});
		} catch (err) {
			console.error('Failed to load marketplace accounts:', err);
		}
	}

	// -----------------------------
	// UI updater (generic)
	// -----------------------------
	function updateProviderUI(provider, account) {
		const status = document.getElementById(`${provider}-status`);
		const connectBtn = document.getElementById(`connect-${provider}-btn`);
		const disconnectBtn = document.getElementById(`disconnect-${provider}-btn`);
		const syncBtn = document.getElementById(`sync-${provider}-btn`);
		const lastSync = document.getElementById(`${provider}-last-sync`);

		if (!status || !connectBtn || !disconnectBtn || !syncBtn) return;

		const userDiv = document.getElementById(`${provider}-user`);
		const usernameSpan = document.getElementById(`${provider}-username`);

		if (account) {
			status.textContent = t('settings_provider_connected');
			connectBtn.hidden = true;
			disconnectBtn.hidden = false;
			syncBtn.hidden = false;

			if (account.lastSync && lastSync) {
				const d = new Date(account.lastSync);
				lastSync.textContent = `${t('settings_last_sync')} ${d.toLocaleDateString(I18nModule.lang)} ${d.toLocaleTimeString(I18nModule.lang, { hour: '2-digit', minute: '2-digit' })}`;
				lastSync.hidden = false;
			}

			if (userDiv && usernameSpan && account.providerUserId) {
				usernameSpan.textContent = `@${account.providerUserId}`;
				userDiv.hidden = false;
			} else if (userDiv) {
				userDiv.hidden = true;
			}
		} else {
			status.textContent = t('settings_provider_not_connected');
			connectBtn.hidden = false;
			disconnectBtn.hidden = true;
			syncBtn.hidden = true;

			if (lastSync) lastSync.hidden = true;
			if (userDiv) userDiv.hidden = true;
		}
	}

	// -----------------------------
	// Connect provider
	// -----------------------------
	async function connectProvider(provider) {
		try {
			const res = await fetch(
				`${API_BASE_URL}/marketplace/${provider}/auth-url`,
				{
					headers: { Authorization: `Bearer ${token}` }
				}
			);

			const data = await res.json();

			if (!data.success || !data.authUrl) {
				return showMarketplaceMessage(
					`${t('settings_marketplace_auth_url_failed')} ${provider.toUpperCase()}`,
					false
				);
			}

			// Open OAuth in a popup so user stays on the settings page
			const w = 600, h = 700;
			const left = Math.round(window.screenX + (window.outerWidth - w) / 2);
			const top = Math.round(window.screenY + (window.outerHeight - h) / 2);
			const popup = window.open(
				data.authUrl,
				'marketplace-auth',
				`width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no,location=yes`
			);

			if (!popup || popup.closed) {
				// Popup blocked — fall back to full redirect
				window.location.href = data.authUrl;
				return;
			}

			// Poll until popup closes, then refresh account list
			const poll = setInterval(async () => {
				if (!popup || popup.closed) {
					clearInterval(poll);
					await loadMarketplaceAccounts();
				}
			}, 1000);
		} catch (err) {
			console.error(`Connect ${provider} error:`, err);
			showMarketplaceMessage(err.message, false);
		}
	}

	// -----------------------------
	// Disconnect provider
	// -----------------------------
	async function disconnectProvider(provider) {
		const confirmed = await confirmModal(
			`Disconnect ${provider.toUpperCase()}? This will remove your connection.`,
			{ ok: 'Disconnect', cancel: 'Cancel' }
		);

		if (!confirmed) return;

		try {
			const res = await fetch(
				`${API_BASE_URL}/marketplace/${provider}/disconnect`,
				{
					method: 'POST',
					headers: { Authorization: `Bearer ${token}` }
				}
			);

			const data = await res.json();

			if (data.success) {
				showMarketplaceMessage(`${t('settings_disconnected_from')} ${provider.toUpperCase()}`, true);
				if (provider === 'ebay') {
					const logoutPopup = window.open('https://www.ebay.com/logout', 'ebay-logout', 'width=1,height=1,left=-1000,top=-1000');
					setTimeout(() => logoutPopup?.close(), 3000);
				}
				loadMarketplaceAccounts();
			} else {
				showMarketplaceMessage(data.error || t('settings_disconnect_failed'), false);
			}
		} catch (err) {
			console.error(err);
			showMarketplaceMessage(t('settings_disconnect_failed'), false);
		}
	}

	// -----------------------------
	// Sync provider
	// -----------------------------
	async function syncProvider(provider) {
		const btn = document.getElementById(`sync-${provider}-btn`);
		if (btn) btn.disabled = true;

		try {
			const res = await fetch(
				`${API_BASE_URL}/marketplace/${provider}/sync`,
				{
					method: 'POST',
					headers: { Authorization: `Bearer ${token}` }
				}
			);

			const data = await res.json();

			if (data.success) {
				showMarketplaceMessage(
					`${data.listingsAdded || 0} ${t('settings_sync_success')} ${provider.toUpperCase()}`,
					true
				);
				loadMarketplaceAccounts();
			} else {
				showMarketplaceMessage(data.message || t('settings_sync_failed'), false);
			}
		} catch (err) {
			console.error(err);
			showMarketplaceMessage(t('settings_sync_failed'), false);
		} finally {
			if (btn) btn.disabled = false;
		}
	}

	// -----------------------------
	// Message helper
	// -----------------------------
	function showMarketplaceMessage(msg, success) {
		const el = document.getElementById('marketplace-msg');
		if (!el) return;

		el.textContent = msg;
		el.style.display = 'block';
		el.style.color = success ? 'var(--success, #4ade80)' : '#e57373';

		setTimeout(() => (el.style.display = 'none'), 5000);
	}

	// -----------------------------
	// Bind events (scalable)
	// -----------------------------
	function bindEvents() {
		MARKETPLACES.forEach(({ id }) => {
			document
				.getElementById(`connect-${id}-btn`)
				?.addEventListener('click', () => connectProvider(id));

			document
				.getElementById(`disconnect-${id}-btn`)
				?.addEventListener('click', () => disconnectProvider(id));

			document
				.getElementById(`sync-${id}-btn`)
				?.addEventListener('click', () => syncProvider(id));
		});
	}

	// -----------------------------
	// OAuth callback check
	// -----------------------------
	function handleOAuthCallback() {
		const params = new URLSearchParams(window.location.search);

		// If this page is the popup target, notify the opener and close
		if (window.opener && !window.opener.closed) {
			if (params.get('marketplace_connected') === '1') {
				try { window.opener.postMessage({ type: 'marketplace_connected' }, window.location.origin); } catch (_) {}
				window.close();
				return;
			}
			if (params.get('ebay') === 'error' || params.get('marketplace_error')) {
				try { window.opener.postMessage({ type: 'marketplace_error' }, window.location.origin); } catch (_) {}
				window.close();
				return;
			}
		}

		// Normal (non-popup) callback handling
		if (params.get('marketplace_connected') === '1') {
			showMarketplaceMessage(t('settings_marketplace_connected'), true);
			loadMarketplaceAccounts();
			history.replaceState(null, '', window.location.pathname);
		}
		if (params.get('ebay') === 'error' || params.get('marketplace_error')) {
			showMarketplaceMessage(t('settings_sync_failed'), false);
			history.replaceState(null, '', window.location.pathname);
		}
	}

	// Listen for messages from the OAuth popup
	window.addEventListener('message', (e) => {
		if (e.origin !== window.location.origin) return;
		if (e.data?.type === 'marketplace_connected') {
			showMarketplaceMessage(t('settings_marketplace_connected'), true);
			loadMarketplaceAccounts();
		}
		if (e.data?.type === 'marketplace_error') {
			showMarketplaceMessage(t('settings_sync_failed'), false);
		}
	});

	// Init
	bindEvents();
	loadMarketplaceAccounts();
	handleOAuthCallback();
}

initMarketplace();