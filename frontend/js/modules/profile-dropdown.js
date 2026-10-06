/**
 * Profile Dropdown Module
 * Shows profile dropdown for both logged-in and logged-out states,
 * with language selector and theme switcher in both.
 */

import { AuthModule } from './auth.js?v=20261005';
import { I18nModule } from './i18n.js?v=20261005b';

const THEME_KEY = 'cnote-theme';
const ACCENT_KEY = 'cnote-accent-color';

/** Resolves the raw stored preference ('dark' | 'light' | 'system' | null) to a concrete
 * data-theme value — 'system' follows the OS's prefers-color-scheme live. */
function resolveTheme(stored) {
    if (stored === null) return 'dark'; // default for a visitor who never touched the toggle
    if (stored === 'system') return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    return stored;
}

// Apply saved theme immediately on module load (prevents flash).
(function () {
    document.documentElement.dataset.theme = resolveTheme(localStorage.getItem(THEME_KEY));
})();

// Keep a "System" choice live if the OS preference changes while the page is open.
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (localStorage.getItem(THEME_KEY) === 'system') {
        document.documentElement.dataset.theme = resolveTheme('system');
    }
});

// Apply saved accent color immediately on module load (only when logged in)
(function () {
    if (!localStorage.getItem('cn_session')) return;
    const hex = localStorage.getItem(ACCENT_KEY);
    if (!hex) return;
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    const lighten = (c) => Math.min(255, Math.floor(c + (255 - c) * 0.2));
    const light = `#${lighten(r).toString(16).padStart(2,'0')}${lighten(g).toString(16).padStart(2,'0')}${lighten(b).toString(16).padStart(2,'0')}`;
    const root = document.documentElement;
    root.style.setProperty('--accent-color', hex);
    root.style.setProperty('--accent-light', light);
    root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
    root.style.setProperty('--accent-color-rgb', `${r}, ${g}, ${b}`);
    root.style.setProperty('--glow-accent', `0 0 20px rgba(${r}, ${g}, ${b}, 0.15)`);
})();

export const ProfileDropdownModule = {
    _dropdown: null,
    _btn: null,
    _open: false,

    _escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    },

    init() {
        if (this._dropdown) return;
        this._btn = document.querySelector('.navbar-profile-btn');
        if (!this._btn) return;

        this._btn.parentElement.querySelectorAll('.profile-dropdown').forEach(d => d.remove());

        this._createDropdown();
        this._bind();
    },

    _resolvePagePath(page) {
        const path = window.location.pathname;
        if (path.includes('/pages/consoles/')      || path.includes('\\pages\\consoles\\'))      return '../' + page;
        if (path.includes('/pages/curs/')          || path.includes('\\pages\\curs\\'))          return '../' + page;
        if (path.includes('/pages/help/')          || path.includes('\\pages\\help\\'))          return '../' + page;
        if (path.includes('/pages/legal files/')   || path.includes('\\pages\\legal files\\'))   return '../' + page;
        if (path.includes('/pages/legal%20files/') || path.includes('\\pages\\legal%20files\\')) return '../' + page;
        if (path.includes('/pages/')               || path.includes('\\pages\\'))                return page;
        return '/html/pages/' + page;
    },

    _langSelectorHTML() {
        return `
            <div class="profile-dropdown__divider"></div>
            <div class="profile-dropdown__item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="71"><path d="M6 2h12v2H6zm0 18h12v2H6zM4 4h2v2H4zm5 0h2v2H9zm0 14h2v2H9zm4 0h2v2h-2zM7 6h2v12H7zm8 0h2v12h-2zm-2-2h2v2h-2zm7 0h-2v2h2zM2 6h2v12H2zm20 0h-2v12h2zM4 18h2v2H4zm16 0h-2v2h2z M3 11h18v2H3z"/></svg>
                <span data-i18n="profile_language"></span>
                <select class="profile-dropdown__lang-select" aria-label="Language selector">
                    <option value="en" data-i18n="lang_en">English</option>
                    <option value="ro" data-i18n="lang_ro">Română</option>
                    <option value="es" data-i18n="lang_es">Español</option>
                    <option value="fr" data-i18n="lang_fr">Français</option>
                    <option value="it" data-i18n="lang_it">Italiano</option>
                    <option value="de" data-i18n="lang_de">Deutsch</option>
                </select>
            </div>`;
    },

    _themePickerHTML() {
        const stored = localStorage.getItem(THEME_KEY);
        const current = stored === null ? 'dark' : stored;
        const active = (t) => current === t ? ' active' : '';
        return `
            <div class="profile-dropdown__divider"></div>
            <div class="profile-dropdown__item profile-dropdown__theme-row">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="72"><path d="M13 22h-2v-3h2v3Zm-6-3H5v-2h2v2Zm12 0h-2v-2h2v2Zm-4-2H9v-2h6v2Zm-6-2H7V9h2v6Zm8 0h-2V9h2v6ZM5 13H2v-2h3v2Zm17 0h-3v-2h3v2Zm-7-4H9V7h6v2ZM7 7H5V5h2v2Zm12 0h-2V5h2v2Zm-6-2h-2V2h2v3Z"/></svg>
                <span data-i18n="profile_theme">Theme</span>
                <div class="profile-dropdown__theme-btns">
                    <button class="profile-dropdown__theme-btn${active('dark')}" data-theme="dark" title="Dark">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="73"><path d="M18 22H8v-2h10v2ZM8 20H6v-2h2v2Zm12 0h-2v-2h2v2ZM6 18H4v-2h2v2Zm16 0h-2v-4h-2v-2h2v-2h2v8ZM4 16H2V6h2v10Zm14 0h-6v-2h6v2Zm-6-2h-2v-2h2v2Zm-2-2H8V6h2v6ZM6 6H4V4h2v2Zm8-2h-2v2h-2V4H6V2h8v2Z"/></svg>
                    </button>
                    <button class="profile-dropdown__theme-btn${active('light')}" data-theme="light" title="Light">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="72"><path d="M13 22h-2v-3h2v3Zm-6-3H5v-2h2v2Zm12 0h-2v-2h2v2Zm-4-2H9v-2h6v2Zm-6-2H7V9h2v6Zm8 0h-2V9h2v6ZM5 13H2v-2h3v2Zm17 0h-3v-2h3v2Zm-7-4H9V7h6v2ZM7 7H5V5h2v2Zm12 0h-2V5h2v2Zm-6-2h-2V2h2v3Z"/></svg>
                    </button>
                    <button class="profile-dropdown__theme-btn${active('system')}" data-theme="system" title="${I18nModule.t('profile_theme_system') || 'Set as system'}">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="74"><path d="M4 2h16v2H4zm0 14h16v2H4zM2 4h2v12H2zm18 0h2v12h-2zm-9 14h2v2h-2zm-3 2h8v2H8z"/></svg>
                    </button>
                </div>
            </div>`;
    },

    _createDropdown() {
        const dd = document.createElement('div');
        dd.className = 'profile-dropdown';
        this._btn.parentElement.appendChild(dd);
        this._dropdown = dd;

        if (AuthModule.isLoggedIn()) {
            this._buildLoggedIn(dd);
        } else {
            this._buildLoggedOut(dd);
        }

        I18nModule.apply();
    },

    _buildLoggedIn(dd) {
        const user = AuthModule.getCurrentUser() || {};
        const name = this._escapeHtml(user.username || 'User');
        const email = this._escapeHtml(user.email || 'No email');
        const avatarRaw = AuthModule.normalizeAvatarUrl(user.avatar || '');
        const avatar = avatarRaw ? this._escapeHtml(avatarRaw) : '';
        // The name/avatar block goes to the user's own PUBLIC profile - the same page
        // everyone else sees - while the Settings item below goes to profil.html. Before,
        // both led to profil.html, so clicking your own name just opened settings and there
        // was no way to reach your own profile from here.
        // /user/<name> is the canonical profile URL - server.js routes it to user-profile.html
        // and it is what the address bar shows - so link the pretty form, not the query one.
        const profilePath = user.username
            ? '/user/' + encodeURIComponent(user.username)
            : this._resolvePagePath('profil.html');
        const avatarMarkup = avatar
            ? `<img src="${avatar}" alt="User avatar" class="profile-dropdown__avatar-img">`
            : `<span class="profile-dropdown__avatar-fallback" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="2"><path d="M9 2h6v2H9zm0 8h6v2H9zm6-6h2v6h-2zM7 4h2v6H7zM4 18h2v4H4zm14 0h2v4h-2zM8 14h8v2H8zm-2 2h2v2H6zm10 0h2v2h-2z"/></svg>
               </span>`;

        const storedLevel = (() => { try { return JSON.parse(localStorage.getItem('cn_user_level') || 'null'); } catch { return null; } })();
        const levelMarkup = storedLevel
            ? `<span class="profile-dropdown__level">${storedLevel.emoji} ${storedLevel.name}</span>`
            : '';

        dd.innerHTML = `
            <a href="${profilePath}" class="profile-dropdown__profile">
                <span class="profile-dropdown__avatar">${avatarMarkup}</span>
                <span class="profile-dropdown__meta">
                    <span class="profile-dropdown__name">${name}</span>
                    <span class="profile-dropdown__email">${email}</span>
                    ${levelMarkup}
                </span>
            </a>
            <div class="profile-dropdown__divider profile-dropdown__divider--profile"></div>
            <a href="${this._resolvePagePath('community.html')}#dm" class="profile-dropdown__item">
                <span class="profile-dropdown__emoji">💬</span>
                <span data-i18n="profile_dm">Direct Messages</span>
            </a>
            <a href="${this._resolvePagePath('community.html')}" class="profile-dropdown__item">
                <span class="profile-dropdown__emoji">🔔</span>
                <span data-i18n="profile_notifications">Notifications</span>
            </a>
            <a href="${this._resolvePagePath('help.html')}#repair" class="profile-dropdown__item">
                <span class="profile-dropdown__emoji">📋</span>
                <span data-i18n="profile_requests">Requests</span>
            </a>
            <a href="${this._resolvePagePath('profil.html')}#account" class="profile-dropdown__item">
                <span class="profile-dropdown__emoji">⚙️</span>
                <span data-i18n="profile_settings">Settings</span>
            </a>
            <a href="${this._resolvePagePath('statistici.html')}" class="profile-dropdown__item">
                <span class="profile-dropdown__emoji">📊</span>
                <span data-i18n="profile_stats">Statistics</span>
            </a>
            ${this._langSelectorHTML()}
            ${this._themePickerHTML()}
            <div class="profile-dropdown__divider"></div>
            <button class="profile-dropdown__item profile-dropdown__logout">
                <span class="profile-dropdown__emoji">🚪</span>
                <span data-i18n="profile_logout">Log out</span>
            </button>
        `;
    },

    _buildLoggedOut(dd) {
        dd.innerHTML = `
            <a href="${this._resolvePagePath('login.html')}" class="profile-dropdown__item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="75"><path d="M2 11h14v2H2zm10-2h2v2h-2z M10 7h2v10h-2zm2 6h2v2h-2zM6 2h12v2H6zm0 18h12v2H6zM4 4h2v5H4zm0 11h2v5H4zM18 4h2v16h-2z"/></svg>
                <span data-i18n="profile_login">Log in</span>
            </a>
            ${this._langSelectorHTML()}
            ${this._themePickerHTML()}
        `;
    },

    _setTheme(theme) {
        document.documentElement.dataset.theme = resolveTheme(theme);
        // Store the raw choice ('dark' | 'light' | 'system'), not the resolved value — needed
        // so "System" stays correctly highlighted/live-updating rather than freezing at
        // whatever concrete theme happened to resolve at click time.
        localStorage.setItem(THEME_KEY, theme);
        this._dropdown.querySelectorAll('.profile-dropdown__theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });
    },

    _bind() {
        // Strip any event listeners added by the fallback script
        // (fallback runs before ES modules and may attach a redirect-to-login handler)
        const cleanBtn = this._btn.cloneNode(true);
        this._btn.parentElement.replaceChild(cleanBtn, this._btn);
        this._btn = cleanBtn;

        this._btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        document.addEventListener('click', (e) => {
            if (this._open && !this._dropdown.contains(e.target) && !this._btn.contains(e.target)) {
                this.hide();
            }
        });

        const logoutBtn = this._dropdown.querySelector('.profile-dropdown__logout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                await AuthModule.logout();
                window.location.href = '/html/pages/index.html';
            });
        }

        const langSelect = this._dropdown.querySelector('.profile-dropdown__lang-select');
        if (langSelect) {
            langSelect.addEventListener('change', (e) => {
                I18nModule.setLang(e.target.value);
            });
        }

        this._dropdown.querySelectorAll('.profile-dropdown__theme-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._setTheme(btn.dataset.theme);
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this._open) this.hide();
        });
    },

    toggle() {
        this._open ? this.hide() : this.show();
    },

    show() {
        this._open = true;
        this._dropdown.classList.add('profile-dropdown--active');
    },

    hide() {
        this._open = false;
        this._dropdown.classList.remove('profile-dropdown--active');
    }
};
