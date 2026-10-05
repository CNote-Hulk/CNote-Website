/**
 * Advanced Search Module v2
 * Categories (priority order): Consoles → People → Marketplace Posts → Settings/Pages
 * Features: filter tabs, recent searches, keyboard nav, async API search
 */

import { API_BASE_URL } from '../config.js';

/* ── SVG icon map ── */
const ICONS = {
    console:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="68"><path d="M4 4h16v2H4zm0 14h16v2H4zM2 6h2v12H2zm18 0h2v12h-2zM8 9h2v6H8z M6 11h6v2H6zm8-2h2v2h-2zm2 4h2v2h-2z"/></svg>',
    user:        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="2"><path d="M9 2h6v2H9zm0 8h6v2H9zm6-6h2v6h-2zM7 4h2v6H7zM4 18h2v4H4zm14 0h2v4h-2zM8 14h8v2H8zm-2 2h2v2H6zm10 0h2v2h-2z"/></svg>',
    marketplace: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="69"><path d="M3 6h18v2H3zm2 14h14v2H5zM3 8h2v12H3zm16 0h2v12h-2z M7 4h2v6H7zm2-2h6v2H9zm6 2h2v6h-2z"/></svg>',
    forum:       '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="27"><path d="M4 2h16v2H4zm0 14h14v2H4zM2 4h2v12H2zm18 0h2v18h-2zm-2 14h2v2h-2z"/></svg>',
    settings:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="70"><path d="M4 20h3v-2h4v4h2v-4h4v2h-2v4H9v-4H7v2H2v-5h2v3Zm18 2h-5v-2h3v-3h2v5ZM6 11H2v2h4v4H4v-2H0V9h4V7h2v4Zm14-2h4v6h-4v2h-2v-4h4v-2h-4V7h2v2Zm-6 7h-4v-2h4v2Zm-4-2H8v-4h2v4Zm6 0h-2v-4h2v4Zm-2-4h-4V8h4v2ZM7 4H4v3H2V2h5v2Zm8 0h2V2h5v5h-2V4h-3v2h-4V2h-2v4H7V4h2V0h6v4Z"/></svg>',
    page:        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="5"><path d="M4 20h16v2H4zm16-10h2v10h-2zM2 10h2v10H2zm2-2h2v2H4zm2-2h2v2H6zm2-2h2v2H8zm2-2h4v2h-4zm4 2h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zM8 14h2v6H8zm2-2h4v2h-4zm4 2h2v6h-2z"/></svg>',
    dashboard:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="21"><path d="M4 2h16v2H4zM2 4h2v16H2zm2 7h16v2H4zm16-7h2v16h-2z M11 4h2v18h-2z M4 20h16v2H4z"/></svg>',
    learn:       '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="20"><path d="M2 3h9v2H2zM0 19h11v2H0zM13 3h9v2h-9zm0 16h11v2H13zM11 5h2v18h-2zM0 5h2v14H0zm22 0h2v14h-2zm-7 2h5v2h-5zm0 4h5v2h-5zm0 4h2v2h-2z"/></svg>',
    recent:      '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="41"><path d="M6 2h12v2H6zM2 6h2v12H2zm18 0h2v12h-2zm-2-2h2v2h-2zM4 4h2v2H4zm2 18h12v-2H6zm12-2h2v-2h-2zM4 20h2v-2H4zm7-14h2v7h-2zm2 7h2v2h-2zm2 2h2v2h-2z"/></svg>',
};

/* ── Category display labels ── */
const CATEGORY_LABELS = {
    console:     'Consoles',
    user:        'People',
    marketplace: 'Marketplace',
    forum:       'Forum',
    settings:    'Settings',
    page:        'Pages',
    dashboard:   'Dashboard',
    learn:       'Courses',
};

/* ── Render priority order ── */
const RENDER_ORDER = ['console', 'user', 'marketplace', 'forum', 'page', 'dashboard', 'settings', 'learn'];

/* ── Filter tab definitions ── */
const FILTER_TABS = [
    { id: 'all',         label: 'All' },
    { id: 'console',     label: 'Consoles' },
    { id: 'user',        label: 'People' },
    { id: 'marketplace', label: 'Posts' },
    { id: 'forum',       label: 'Forum' },
    { id: 'settings',    label: 'Settings' },
];

/* ── Categories visible per filter tab ── */
const FILTER_CATEGORIES = {
    all:         null, // show all
    console:     ['console'],
    user:        ['user'],
    marketplace: ['marketplace'],
    forum:       ['forum'],
    settings:    ['settings', 'page', 'dashboard', 'learn'],
};

/* ── localStorage key for recent searches ── */
const RECENT_KEY = 'cn_search_recent';
const RECENT_MAX  = 6;

export const SearchModule = {
    _overlay:       null,
    _input:         null,
    _results:       null,
    _consoles:      [],
    _selectedIndex: -1,
    _visible:       false,
    _debounceTimer: null,
    _activeFilter:  'all',

    /* Accumulated results state — each async call updates its slice then re-renders */
    _state: { console: [], user: [], marketplace: [], forum: [], page: [], dashboard: [], settings: [], learn: [] },
    _currentQuery: '',

    /* ── Init ── */

    init() {
        if (!this._overlay) {
            this._loadConsoles();
            this._createOverlay();
        }
        this._bindNavButton();
        this._bindKeys();

        window.addEventListener('cn:language-changed', () => {
            setTimeout(() => { if (window.CONSOLES_DATA) this._consoles = window.CONSOLES_DATA; }, 100);
        });
    },

    /* ── Data loading ── */

    _loadConsoles() {
        if (window.CONSOLES_DATA) { this._consoles = window.CONSOLES_DATA; return; }
        const tryLoad = () => {
            if (window.CONSOLES_DATA) this._consoles = window.CONSOLES_DATA;
            else setTimeout(tryLoad, 200);
        };
        setTimeout(tryLoad, 300);
    },

    /* ── Static search index ── */

    _getStaticIndex() {
        return [
            // ── Pages ──
            { cat: 'page', name: 'Home',       desc: 'Dashboard',                   keywords: 'home dashboard acasa panou',                                                               href: 'home.html' },
            { cat: 'page', name: 'Community',  desc: 'Forum, Marketplace, Repair',  keywords: 'community forum marketplace piata reparatii comunitate',                                   href: 'community.html' },
            { cat: 'page', name: 'Learn',      desc: 'Courses & lessons',           keywords: 'learn invata cursuri lectii courses education educatie',                                    href: 'invata.html' },
            { cat: 'page', name: 'Evolution',  desc: 'Console encyclopedia',        keywords: 'evolution evolutie enciclopedie encyclopedia timeline istorie history',                     href: 'evolutie.html' },
            { cat: 'page', name: 'Compare',    desc: 'Compare consoles side by side', keywords: 'compare comparatie consoles versus vs side',                                             href: 'comparatie.html' },
            { cat: 'page', name: 'Help',       desc: 'FAQ & contact',               keywords: 'help ajutor faq intrebari contact support',                                                href: 'help.html' },
            { cat: 'page', name: 'Statistics', desc: 'Platform statistics',         keywords: 'statistics statistici stats analytics',                                                    href: 'statistici.html' },

            // ── Settings tabs ──
            { cat: 'settings', name: 'Account settings',   desc: 'Username, bio, email',              keywords: 'account cont username email bio setari settings',                                  href: 'profil.html#account' },
            { cat: 'settings', name: 'Profile settings',   desc: 'Avatar, social links, privacy',     keywords: 'profile profil avatar poza social discord twitter youtube instagram privacy',       href: 'profil.html#profil' },
            { cat: 'settings', name: 'Security',           desc: 'Password, 2FA, sessions',           keywords: 'security securitate parola password 2fa two factor authenticator sessions',        href: 'profil.html#security' },
            { cat: 'settings', name: 'Notifications',      desc: 'Email notification preferences',    keywords: 'notifications notificari email alerts mesaje messages friend request',              href: 'profil.html#notifications' },
            { cat: 'settings', name: 'Appearance',         desc: 'Theme, accent color, language',     keywords: 'appearance aparenta tema theme dark light accent color culoare language limba',     href: 'profil.html#appearance' },
            { cat: 'settings', name: 'Change password',    desc: 'Update your account password',      keywords: 'change password schimba parola update',                                            href: 'profil.html#security' },
            { cat: 'settings', name: 'Two-factor auth',    desc: 'Enable TOTP or email 2FA',          keywords: '2fa two factor authenticator totp backup codes google doi factori',                 href: 'profil.html#security' },
            { cat: 'settings', name: 'Change email',       desc: 'Update your email address',         keywords: 'change email schimba adresa address',                                              href: 'profil.html#security' },
            { cat: 'settings', name: 'Theme',              desc: 'Switch between dark and light mode', keywords: 'theme dark light auto mode tema luminos intunecat',                               href: 'profil.html#appearance' },
            { cat: 'settings', name: 'Language',           desc: 'Change app language',               keywords: 'language limba english romana franceza germana spaniola',                          href: 'profil.html#appearance' },
            { cat: 'settings', name: 'Accent color',       desc: 'Customize your accent color',       keywords: 'accent color culoare personalizare customize',                                     href: 'profil.html#appearance' },
            { cat: 'settings', name: 'Delete account',     desc: 'Permanently delete your account',   keywords: 'delete account sterge cont permanent',                                             href: 'profil.html#security' },
            { cat: 'settings', name: 'Trusted devices',    desc: 'Manage devices that skip 2FA',      keywords: 'trusted devices dispozitive incredere 2fa skip',                                   href: 'profil.html#security' },
            { cat: 'settings', name: 'Active sessions',    desc: 'View and manage login sessions',    keywords: 'sessions sesiuni active login devices dispozitive logout',                         href: 'profil.html#security' },
            { cat: 'settings', name: 'Social links',       desc: 'Discord, Twitter, YouTube, Instagram', keywords: 'social links discord twitter youtube instagram connect',                        href: 'profil.html#profil' },
            { cat: 'settings', name: 'Privacy',            desc: 'Control profile visibility',        keywords: 'privacy confidentialitate visibility show hide email stats friends',               href: 'profil.html#profil' },

            // ── Dashboard panels ──
            { cat: 'dashboard', name: 'Collection',   desc: 'Your owned consoles',     keywords: 'collection colectie owned consoles detinute my',       href: 'home.html#collection' },
            { cat: 'dashboard', name: 'Favorites',    desc: 'Your favorite consoles',  keywords: 'favorites favorite consoles preferate',                 href: 'home.html#favorites' },
            { cat: 'dashboard', name: 'Progress',     desc: 'Course progress tracker', keywords: 'progress progres course curs tracker',                  href: 'home.html#progress' },
            { cat: 'dashboard', name: 'Achievements', desc: 'Badges and milestones',   keywords: 'achievements realizari badges insigne milestones',       href: 'home.html#achievements' },
            { cat: 'dashboard', name: 'Friends',      desc: 'Your friends list',       keywords: 'friends prieteni lista list requests cereri',            href: 'home.html#friends' },
            { cat: 'dashboard', name: 'My Posts',     desc: 'Your forum posts',        keywords: 'my posts postarile mele forum threads',                  href: 'home.html#posts' },
            { cat: 'dashboard', name: 'Liked Posts',  desc: 'Posts you liked',         keywords: 'liked posts apreciate favorite forum',                   href: 'home.html#liked' },

            // ── Courses ──
            { cat: 'learn', name: 'Console Engineering', desc: '42 lessons — electricity, electronics, hardware', keywords: 'console engineering inginerie electricitate hardware arhitectura diagnostics', href: 'invata.html' },
            { cat: 'learn', name: 'Console Modding',     desc: 'Learn to mod consoles',                          keywords: 'console modding mod custom retro repair reparare',                          href: 'invata.html' },
        ];
    },

    /* ── Path resolution ── */

    _resolveImagePath(imgRelativePath) {
        const path = window.location.pathname;
        if (path.includes('/pages/consoles/') || path.includes('\\pages\\consoles\\')) return '../../' + imgRelativePath;
        if (path.includes('/pages/curs/')     || path.includes('\\pages\\curs\\'))     return '../../' + imgRelativePath;
        if (path.includes('/pages/')          || path.includes('\\pages\\'))           return '../../' + imgRelativePath;
        return '/' + String(imgRelativePath || '').replace(/^\/+/, '');
    },

    _resolvePath(href) {
        const path = window.location.pathname;
        if (href.startsWith('/') || href.startsWith('http')) return href;
        if (href.endsWith('.html') && !href.includes('/') && !href.includes('#')) {
            if (path.includes('/pages/consoles/') || path.includes('\\pages\\consoles\\')) return '../' + href;
            if (path.includes('/pages/curs/')     || path.includes('\\pages\\curs\\'))     return '../' + href;
            if (path.includes('/pages/')          || path.includes('\\pages\\'))           return href;
            return '/html/pages/' + href;
        }
        if (href.includes('.html')) {
            const [file, hash] = href.split('#');
            let resolved;
            if (path.includes('/pages/consoles/') || path.includes('\\pages\\consoles\\')) resolved = '../' + file;
            else if (path.includes('/pages/curs/') || path.includes('\\pages\\curs\\'))    resolved = '../' + file;
            else if (path.includes('/pages/')      || path.includes('\\pages\\'))          resolved = file;
            else resolved = '/html/pages/' + file;
            return hash ? resolved + '#' + hash : resolved;
        }
        return href;
    },

    _resolveConsolePath(consoleId) {
        const path = window.location.pathname;
        if (path.includes('/pages/consoles/') || path.includes('\\pages\\consoles\\')) return consoleId + '.html';
        if (path.includes('/pages/curs/')     || path.includes('\\pages\\curs\\'))     return '../consoles/' + consoleId + '.html';
        if (path.includes('/pages/')          || path.includes('\\pages\\'))           return 'consoles/' + consoleId + '.html';
        return '/html/pages/consoles/' + consoleId + '.html';
    },

    _resolveUserPath(username) {
        const path = window.location.pathname;
        const file = 'user-profile.html?username=' + encodeURIComponent(username);
        if (path.includes('/pages/consoles/') || path.includes('\\pages\\consoles\\')) return '../' + file;
        if (path.includes('/pages/curs/')     || path.includes('\\pages\\curs\\'))     return '../' + file;
        if (path.includes('/pages/')          || path.includes('\\pages\\'))           return file;
        return '/html/pages/' + file;
    },

    _resolveCommunityPath() {
        const path = window.location.pathname;
        if (path.includes('/pages/consoles/') || path.includes('\\pages\\consoles\\')) return '../community.html';
        if (path.includes('/pages/curs/')     || path.includes('\\pages\\curs\\'))     return '../community.html';
        if (path.includes('/pages/')          || path.includes('\\pages\\'))           return 'community.html';
        return '/html/pages/community.html';
    },

    _resolveForumThreadPath(consoleKey, threadId) {
        return this._resolveCommunityPath() + `#forum/${consoleKey}/thread/${threadId}`;
    },

    /* ── Overlay DOM ── */

    _createOverlay() {
        const filterHtml = FILTER_TABS.map(t =>
            `<button class="search-filter-btn${t.id === 'all' ? ' search-filter-btn--active' : ''}" data-filter="${t.id}">${t.label}</button>`
        ).join('');

        const overlay = document.createElement('div');
        overlay.className = 'search-overlay';
        overlay.innerHTML = `
            <div class="search-overlay__backdrop"></div>
            <div class="search-overlay__container">
                <div class="search-overlay__input-wrap">
                    <svg class="search-overlay__icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="0"><path d="M22 22h-2v-2h2v2Zm-2-2h-2v-2h2v2Zm-6-2H6v-2h8v2Zm4 0h-2v-2h2v2ZM6 16H4v-2h2v2Zm10 0h-2v-2h2v2ZM4 14H2V6h2v8Zm14 0h-2V6h2v8ZM6 6H4V4h2v2Zm10 0h-2V4h2v2Zm-2-2H6V2h8v2Z"/></svg>
                    <input type="text" class="search-overlay__input" placeholder="Search consoles, people, posts, settings..." autocomplete="off" spellcheck="false">
                    <kbd class="search-overlay__kbd">ESC</kbd>
                </div>
                <div class="search-overlay__filters">${filterHtml}</div>
                <div class="search-overlay__results"></div>
                <div class="search-overlay__footer">
                    <span class="search-footer-hint"><kbd>↑↓</kbd> navigate</kbd></span>
                    <span class="search-footer-hint"><kbd>↵</kbd> open</span>
                    <span class="search-footer-hint"><kbd>ESC</kbd> close</span>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        this._overlay = overlay;
        this._input   = overlay.querySelector('.search-overlay__input');
        this._results = overlay.querySelector('.search-overlay__results');

        overlay.querySelector('.search-overlay__backdrop').addEventListener('click', () => this.close());
        this._input.addEventListener('input',   () => this._onInput());
        this._input.addEventListener('keydown', (e) => this._handleInputKey(e));

        overlay.querySelectorAll('.search-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => this._setFilter(btn.dataset.filter));
        });
    },

    _bindNavButton() {
        document.addEventListener('click', (e) => {
            if (e.target.closest('.navbar-search-btn')) {
                e.preventDefault();
                this.open();
            }
        });
    },

    _bindKeys() {
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); this.open(); }
            if (e.key === 'Escape' && this._visible) this.close();
        });
    },

    open() {
        this._visible = true;
        this._overlay.classList.add('search-overlay--active');
        document.body.classList.add('search-open');
        this._input.value = '';
        this._currentQuery = '';
        this._selectedIndex = -1;
        this._setFilter('all', false);
        this._clearState();
        this._showRecent();
        setTimeout(() => this._input.focus(), 50);
    },

    close() {
        this._visible = false;
        this._overlay.classList.remove('search-overlay--active');
        document.body.classList.remove('search-open');
    },

    /* ── State helpers ── */

    _clearState() {
        Object.keys(this._state).forEach(k => { this._state[k] = []; });
    },

    /* ── Filter tab ── */

    _setFilter(filterId, rerender = true) {
        this._activeFilter = filterId;
        this._overlay.querySelectorAll('.search-filter-btn').forEach(btn => {
            btn.classList.toggle('search-filter-btn--active', btn.dataset.filter === filterId);
        });
        if (rerender && this._currentQuery) this._render();
    },

    /* ── Normalization ── */

    _normalize(str) {
        return str.toLowerCase()
            .replace(/[ăâ]/g, 'a').replace(/[îí]/g, 'i')
            .replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
            .replace(/[-_]/g, ' ');
    },

    /* ── Input handler ── */

    _onInput() {
        this._selectedIndex = -1;
        const query = this._input.value.trim();
        this._currentQuery = query;

        if (!query) { this._clearState(); this._showRecent(); return; }

        this._searchLocal(query);

        clearTimeout(this._debounceTimer);
        if (query.length >= 2) {
            this._debounceTimer = setTimeout(() => this._searchAsync(query), 300);
        }
    },

    /* ── Local search (consoles + static index) ── */

    _searchLocal(query) {
        const q = this._normalize(query);

        // Consoles
        this._state.console = this._consoles.filter(c => {
            const name = this._normalize(c.name || '');
            const mfr  = this._normalize(c.manufacturer || '');
            const year = String(c.release || '');
            const id   = this._normalize(c.id || '');
            return name.includes(q) || mfr.includes(q) || year.includes(q) || id.includes(q);
        }).slice(0, 6).map(c => ({
            cat:  'console',
            name: c.name,
            desc: c.manufacturer + ' · ' + c.release,
            href: this._resolveConsolePath(c.id),
            img:  this._resolveImagePath(c.image || ''),
        }));

        // Static index (settings, pages, dashboard, learn)
        const staticIndex = this._getStaticIndex();
        ['page', 'dashboard', 'settings', 'learn'].forEach(cat => { this._state[cat] = []; });

        staticIndex.forEach(item => {
            const searchable = this._normalize(item.name + ' ' + item.desc + ' ' + (item.keywords || ''));
            if (!searchable.includes(q)) return;
            const bucket = item.cat;
            if (this._state[bucket] && this._state[bucket].length < 5) {
                this._state[bucket].push({
                    cat:  bucket,
                    name: item.name,
                    desc: item.desc,
                    href: this._resolvePath(item.href),
                });
            }
        });

        this._render();
    },

    /* ── Async search (users + marketplace) ── */

    async _searchAsync(query) {
        if (query !== this._currentQuery) return;
        await Promise.allSettled([
            this._searchUsers(query),
            this._searchMarketplace(query),
            this._searchForum(query),
        ]);
    },

    async _searchUsers(query) {
        try {
            const token = localStorage.getItem('cn_token');
            if (!token) return;
            const res = await fetch(API_BASE_URL + '/users/search?q=' + encodeURIComponent(query), {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!res.ok) return;
            const data = await res.json();
            if (!data.success || !data.users?.length) return;
            if (query !== this._currentQuery) return;

            this._state.user = data.users.slice(0, 5).map(u => ({
                cat:  'user',
                name: u.username,
                desc: u.bio ? u.bio.substring(0, 60) : 'User',
                href: this._resolveUserPath(u.username),
                img:  u.avatar || '',
            }));
            this._render();
        } catch { /* silently fail */ }
    },

    async _searchMarketplace(query) {
        try {
            const res = await fetch(API_BASE_URL + '/marketplace/listings?search=' + encodeURIComponent(query) + '&limit=4&sort=newest');
            if (!res.ok) return;
            const data = await res.json();
            if (!data.success || !data.listings?.length) return;
            if (query !== this._currentQuery) return;

            this._state.marketplace = data.listings.slice(0, 4).map(l => ({
                cat:   'marketplace',
                name:  l.title,
                desc:  (l.price != null ? l.price + ' RON' : '') + (l.condition ? ' · ' + l.condition : ''),
                href:  this._resolveCommunityPath(),
                img:   l.cover_image || '',
                badge: l.price != null ? l.price + ' RON' : null,
            }));
            this._render();
        } catch { /* silently fail */ }
    },

    async _searchForum(query) {
        try {
            const res = await fetch(API_BASE_URL + '/forum/search?q=' + encodeURIComponent(query) + '&limit=5');
            if (!res.ok) return;
            const data = await res.json();
            if (!data.success || !data.threads?.length) return;
            if (query !== this._currentQuery) return;

            this._state.forum = data.threads.slice(0, 5).map(t => ({
                cat:  'forum',
                name: t.title,
                desc: (t.snippet || '').trim() || ('@' + t.username),
                href: this._resolveForumThreadPath(t.console, t.id),
            }));
            this._render();
        } catch { /* silently fail */ }
    },

    /* ── Recent searches ── */

    _getRecent() {
        try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
    },

    _saveRecent(query) {
        if (!query || query.length < 2) return;
        const list = this._getRecent().filter(q => q !== query);
        list.unshift(query);
        localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
    },

    _clearRecent() {
        localStorage.removeItem(RECENT_KEY);
        this._showRecent();
    },

    _showRecent() {
        const recent = this._getRecent();
        if (!recent.length) {
            this._results.innerHTML = '<div class="search-overlay__empty">Start typing to search...</div>';
            return;
        }
        let html = '<div class="search-recent">';
        html += '<div class="search-recent__header"><span class="search-recent__label">Recent searches</span><button class="search-recent__clear">Clear</button></div>';
        recent.forEach(q => {
            html += `<button class="search-recent-item" data-query="${this._escHtml(q)}">
                <span class="search-result__icon">${ICONS.recent}</span>
                <span class="search-recent-item__text">${this._escHtml(q)}</span>
            </button>`;
        });
        html += '</div>';
        this._results.innerHTML = html;

        this._results.querySelector('.search-recent__clear')?.addEventListener('click', () => this._clearRecent());
        this._results.querySelectorAll('.search-recent-item').forEach(btn => {
            btn.addEventListener('click', () => {
                this._input.value = btn.dataset.query;
                this._onInput();
                this._input.focus();
            });
        });
    },

    _escHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    /* ── Rendering ── */

    _render() {
        const allowed = FILTER_CATEGORIES[this._activeFilter];

        // Collect results in priority order, filtered by active tab
        const grouped = new Map();
        RENDER_ORDER.forEach(cat => {
            if (allowed && !allowed.includes(cat)) return;
            if (this._state[cat]?.length) grouped.set(cat, this._state[cat]);
        });

        if (!grouped.size) {
            this._results.innerHTML = '<div class="search-overlay__empty">No results found</div>';
            return;
        }

        let html = '';
        let globalIdx = 0;

        for (const [cat, items] of grouped) {
            html += `<div class="search-category" data-cat-section="${cat}">`;
            html += `<div class="search-category__label search-category__label--${cat}">${ICONS[cat] || ''} ${CATEGORY_LABELS[cat] || cat}</div>`;
            items.forEach(item => {
                const imgTag = item.img
                    ? `<img class="search-result__img" src="${this._escHtml(item.img)}" alt="" loading="lazy" onerror="this.style.display='none'">`
                    : `<span class="search-result__icon search-result__icon--${cat}">${ICONS[cat] || ''}</span>`;
                const badgeHtml = item.badge
                    ? `<span class="search-result__badge">${this._escHtml(item.badge)}</span>`
                    : '';
                html += `<a href="${item.href}" class="search-result" data-index="${globalIdx}">
                    ${imgTag}
                    <div class="search-result__info">
                        <span class="search-result__name">${this._escHtml(item.name)}</span>
                        <span class="search-result__meta">${this._escHtml(item.desc)}</span>
                    </div>
                    ${badgeHtml}
                </a>`;
                globalIdx++;
            });
            html += '</div>';
        }

        this._results.innerHTML = html;

        // Save query to recent when user clicks a result
        this._results.querySelectorAll('.search-result').forEach(a => {
            a.addEventListener('click', () => this._saveRecent(this._currentQuery), { once: true });
        });
    },

    /* ── Keyboard navigation ── */

    _handleInputKey(e) {
        const items = Array.from(this._results.querySelectorAll('.search-result'));
        if (!items.length) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this._selectedIndex = Math.min(this._selectedIndex + 1, items.length - 1);
            this._highlightResult(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this._selectedIndex = Math.max(this._selectedIndex - 1, 0);
            this._highlightResult(items);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const target = items[this._selectedIndex];
            if (target) { this._saveRecent(this._currentQuery); window.location.href = target.href; }
        }
    },

    _highlightResult(items) {
        items.forEach((el, i) => {
            el.classList.toggle('search-result--active', i === this._selectedIndex);
            if (i === this._selectedIndex) el.scrollIntoView({ block: 'nearest' });
        });
    }
};
