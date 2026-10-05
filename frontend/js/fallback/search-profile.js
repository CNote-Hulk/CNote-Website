/**
 * Search & Profile Dropdown Fallback (non-module IIFE)
 * Advanced search: consoles → people → marketplace posts → settings/pages
 * Works on file:// protocol without ES module support
 */

(function() {
    if (window.__SEARCH_PROFILE_INITIALIZED__) return;
    window.__SEARCH_PROFILE_INITIALIZED__ = true;

    var API = (window.CN_API_BASE_URL || '/api').replace(/\/$/, '');

    // ---- Auth helper ----
    var AuthHelper = {
        SESSION_KEY: 'cn_session',
        TOKEN_KEY: 'cn_token',
        isLoggedIn: function() { return !!this.getCurrentUser(); },
        getCurrentUser: function() {
            try {
                var s = JSON.parse(localStorage.getItem(this.SESSION_KEY));
                return s && s.id ? s : null;
            } catch(e) { return null; }
        },
        logout: function() {
            localStorage.removeItem(this.SESSION_KEY);
            localStorage.removeItem(this.TOKEN_KEY);
        }
    };

    // ---- Constants ----
    var RENDER_ORDER = ['console', 'user', 'marketplace', 'page', 'dashboard', 'settings', 'learn'];

    var CATEGORY_LABELS = {
        console:     'Consoles',
        user:        'People',
        marketplace: 'Marketplace',
        settings:    'Settings',
        page:        'Pages',
        dashboard:   'Dashboard',
        learn:       'Courses'
    };

    var FILTER_TABS = [
        { id: 'all',         label: 'All' },
        { id: 'console',     label: 'Consoles' },
        { id: 'user',        label: 'People' },
        { id: 'marketplace', label: 'Posts' },
        { id: 'settings',    label: 'Settings' }
    ];

    var FILTER_CATEGORIES = {
        all:         null,
        console:     ['console'],
        user:        ['user'],
        marketplace: ['marketplace'],
        settings:    ['settings', 'page', 'dashboard', 'learn']
    };

    var ICONS = {
        console:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="68"><path d="M4 4h16v2H4zm0 14h16v2H4zM2 6h2v12H2zm18 0h2v12h-2zM8 9h2v6H8z M6 11h6v2H6zm8-2h2v2h-2zm2 4h2v2h-2z"/></svg>',
        user:        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="2"><path d="M9 2h6v2H9zm0 8h6v2H9zm6-6h2v6h-2zM7 4h2v6H7zM4 18h2v4H4zm14 0h2v4h-2zM8 14h8v2H8zm-2 2h2v2H6zm10 0h2v2h-2z"/></svg>',
        marketplace: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="69"><path d="M3 6h18v2H3zm2 14h14v2H5zM3 8h2v12H3zm16 0h2v12h-2z M7 4h2v6H7zm2-2h6v2H9zm6 2h2v6h-2z"/></svg>',
        settings:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="70"><path d="M4 20h3v-2h4v4h2v-4h4v2h-2v4H9v-4H7v2H2v-5h2v3Zm18 2h-5v-2h3v-3h2v5ZM6 11H2v2h4v4H4v-2H0V9h4V7h2v4Zm14-2h4v6h-4v2h-2v-4h4v-2h-4V7h2v2Zm-6 7h-4v-2h4v2Zm-4-2H8v-4h2v4Zm6 0h-2v-4h2v4Zm-2-4h-4V8h4v2ZM7 4H4v3H2V2h5v2Zm8 0h2V2h5v5h-2V4h-3v2h-4V2h-2v4H7V4h2V0h6v4Z"/></svg>',
        page:        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="5"><path d="M4 20h16v2H4zm16-10h2v10h-2zM2 10h2v10H2zm2-2h2v2H4zm2-2h2v2H6zm2-2h2v2H8zm2-2h4v2h-4zm4 2h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zM8 14h2v6H8zm2-2h4v2h-4zm4 2h2v6h-2z"/></svg>',
        dashboard:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="21"><path d="M4 2h16v2H4zM2 4h2v16H2zm2 7h16v2H4zm16-7h2v16h-2z M11 4h2v18h-2z M4 20h16v2H4z"/></svg>',
        learn:       '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="20"><path d="M2 3h9v2H2zM0 19h11v2H0zM13 3h9v2h-9zm0 16h11v2H13zM11 5h2v18h-2zM0 5h2v14H0zm22 0h2v14h-2zm-7 2h5v2h-5zm0 4h5v2h-5zm0 4h2v2h-2z"/></svg>',
        recent:      '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="41"><path d="M6 2h12v2H6zM2 6h2v12H2zm18 0h2v12h-2zm-2-2h2v2h-2zM4 4h2v2H4zm2 18h12v-2H6zm12-2h2v-2h-2zM4 20h2v-2H4zm7-14h2v7h-2zm2 7h2v2h-2zm2 2h2v2h-2z"/></svg>'
    };

    var RECENT_KEY = 'cn_search_recent';
    var RECENT_MAX  = 6;

    // ---- Path helpers ----
    function resolveImagePath(imgRelativePath) {
        var p = window.location.pathname;
        if (p.indexOf('/pages/consoles/') !== -1 || p.indexOf('\\pages\\consoles\\') !== -1) return '../../' + imgRelativePath;
        if (p.indexOf('/pages/curs/')     !== -1 || p.indexOf('\\pages\\curs\\')     !== -1) return '../../' + imgRelativePath;
        if (p.indexOf('/pages/')          !== -1 || p.indexOf('\\pages\\')           !== -1) return '../../' + imgRelativePath;
        return '/' + String(imgRelativePath || '').replace(/^\/+/, '');
    }

    function resolveConsolePath(consoleId) {
        var p = window.location.pathname;
        if (p.indexOf('/pages/consoles/') !== -1 || p.indexOf('\\pages\\consoles\\') !== -1) return consoleId + '.html';
        if (p.indexOf('/pages/curs/')     !== -1 || p.indexOf('\\pages\\curs\\')     !== -1) return '../consoles/' + consoleId + '.html';
        if (p.indexOf('/pages/')          !== -1 || p.indexOf('\\pages\\')           !== -1) return 'consoles/' + consoleId + '.html';
        return '/html/pages/consoles/' + consoleId + '.html';
    }

    function resolvePagePath(page) {
        var p = window.location.pathname;
        if (p.indexOf('/pages/consoles/') !== -1 || p.indexOf('\\pages\\consoles\\') !== -1) return '../' + page;
        if (p.indexOf('/pages/curs/')     !== -1 || p.indexOf('\\pages\\curs\\')     !== -1) return '../' + page;
        if (p.indexOf('/pages/help/')     !== -1 || p.indexOf('\\pages\\help\\')     !== -1) return '../' + page;
        if (p.indexOf('/pages/')          !== -1 || p.indexOf('\\pages\\')           !== -1) return page;
        return '/html/pages/' + page;
    }

    function resolveCommunityPath() { return resolvePagePath('community.html'); }
    function resolveUserPath(username) { return resolvePagePath('user-profile.html?username=' + encodeURIComponent(username)); }

    function escHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function normalize(str) {
        return str.toLowerCase()
            .replace(/[ăâ]/g, 'a').replace(/[îí]/g, 'i')
            .replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
            .replace(/[-_]/g, ' ');
    }

    // ---- Static index ----
    function getStaticIndex() {
        return [
            { cat: 'page', name: 'Home',       desc: 'Dashboard',                   keywords: 'home dashboard acasa panou',                                                           href: 'home.html' },
            { cat: 'page', name: 'Community',  desc: 'Forum, Marketplace, Repair',  keywords: 'community forum marketplace piata reparatii comunitate',                               href: 'community.html' },
            { cat: 'page', name: 'Learn',      desc: 'Courses & lessons',           keywords: 'learn invata cursuri lectii courses education educatie',                                href: 'invata.html' },
            { cat: 'page', name: 'Evolution',  desc: 'Console encyclopedia',        keywords: 'evolution evolutie enciclopedie encyclopedia timeline istorie history',                 href: 'evolutie.html' },
            { cat: 'page', name: 'Compare',    desc: 'Compare consoles side by side', keywords: 'compare comparatie consoles versus vs side',                                         href: 'comparatie.html' },
            { cat: 'page', name: 'Help',       desc: 'FAQ & contact',               keywords: 'help ajutor faq intrebari contact support',                                            href: 'help.html' },
            { cat: 'page', name: 'Statistics', desc: 'Platform statistics',         keywords: 'statistics statistici stats analytics',                                                href: 'statistici.html' },
            { cat: 'settings', name: 'Account settings',  desc: 'Username, bio, email',              keywords: 'account cont username email bio setari settings',                              href: 'profil.html#account' },
            { cat: 'settings', name: 'Profile settings',  desc: 'Avatar, social links, privacy',     keywords: 'profile profil avatar poza social discord twitter youtube instagram privacy',   href: 'profil.html#profil' },
            { cat: 'settings', name: 'Security',          desc: 'Password, 2FA, sessions',           keywords: 'security securitate parola password 2fa two factor authenticator sessions',    href: 'profil.html#security' },
            { cat: 'settings', name: 'Notifications',     desc: 'Email notification preferences',    keywords: 'notifications notificari email alerts mesaje messages friend request',          href: 'profil.html#notifications' },
            { cat: 'settings', name: 'Appearance',        desc: 'Theme, accent color, language',     keywords: 'appearance aparenta tema theme dark light accent color culoare language limba', href: 'profil.html#appearance' },
            { cat: 'settings', name: 'Change password',   desc: 'Update your account password',      keywords: 'change password schimba parola update',                                        href: 'profil.html#security' },
            { cat: 'settings', name: 'Two-factor auth',   desc: 'Enable TOTP or email 2FA',          keywords: '2fa two factor authenticator totp backup codes google doi factori',             href: 'profil.html#security' },
            { cat: 'settings', name: 'Theme',             desc: 'Switch between dark and light mode', keywords: 'theme dark light auto mode tema luminos intunecat',                           href: 'profil.html#appearance' },
            { cat: 'settings', name: 'Language',          desc: 'Change app language',               keywords: 'language limba english romana franceza germana spaniola',                      href: 'profil.html#appearance' },
            { cat: 'settings', name: 'Accent color',      desc: 'Customize your accent color',       keywords: 'accent color culoare personalizare customize',                                 href: 'profil.html#appearance' },
            { cat: 'settings', name: 'Delete account',    desc: 'Permanently delete your account',   keywords: 'delete account sterge cont permanent',                                         href: 'profil.html#security' },
            { cat: 'settings', name: 'Trusted devices',   desc: 'Manage devices that skip 2FA',      keywords: 'trusted devices dispozitive incredere 2fa skip',                               href: 'profil.html#security' },
            { cat: 'settings', name: 'Active sessions',   desc: 'View and manage login sessions',    keywords: 'sessions sesiuni active login devices dispozitive logout',                     href: 'profil.html#security' },
            { cat: 'settings', name: 'Social links',      desc: 'Discord, Twitter, YouTube, Instagram', keywords: 'social links discord twitter youtube instagram connect',                    href: 'profil.html#profil' },
            { cat: 'settings', name: 'Privacy',           desc: 'Control profile visibility',        keywords: 'privacy confidentialitate visibility show hide email stats friends',           href: 'profil.html#profil' },
            { cat: 'dashboard', name: 'Collection',   desc: 'Your owned consoles',     keywords: 'collection colectie owned consoles detinute my',         href: 'home.html#collection' },
            { cat: 'dashboard', name: 'Favorites',    desc: 'Your favorite consoles',  keywords: 'favorites favorite consoles preferate',                   href: 'home.html#favorites' },
            { cat: 'dashboard', name: 'Progress',     desc: 'Course progress tracker', keywords: 'progress progres course curs tracker',                    href: 'home.html#progress' },
            { cat: 'dashboard', name: 'Achievements', desc: 'Badges and milestones',   keywords: 'achievements realizari badges insigne milestones',         href: 'home.html#achievements' },
            { cat: 'dashboard', name: 'Friends',      desc: 'Your friends list',       keywords: 'friends prieteni lista list requests cereri',              href: 'home.html#friends' },
            { cat: 'dashboard', name: 'My Posts',     desc: 'Your forum posts',        keywords: 'my posts postarile mele forum threads',                    href: 'home.html#posts' },
            { cat: 'dashboard', name: 'Liked Posts',  desc: 'Posts you liked',         keywords: 'liked posts apreciate favorite forum',                     href: 'home.html#liked' },
            { cat: 'learn', name: 'Console Engineering', desc: '42 lessons — electricity, electronics, hardware', keywords: 'console engineering inginerie electricitate hardware arhitectura diagnostics', href: 'invata.html' },
            { cat: 'learn', name: 'Console Modding',     desc: 'Learn to mod consoles',                          keywords: 'console modding mod custom retro repair reparare',                          href: 'invata.html' }
        ];
    }

    function resolveStaticHref(href) {
        var p = window.location.pathname;
        if (href.startsWith && (href.startsWith('/') || href.startsWith('http'))) return href;
        var parts = href.split('#');
        var file = parts[0], hash = parts[1];
        var resolved;
        if (p.indexOf('/pages/consoles/') !== -1 || p.indexOf('\\pages\\consoles\\') !== -1) resolved = '../' + file;
        else if (p.indexOf('/pages/curs/') !== -1 || p.indexOf('\\pages\\curs\\') !== -1)    resolved = '../' + file;
        else if (p.indexOf('/pages/')      !== -1 || p.indexOf('\\pages\\')       !== -1)    resolved = file;
        else resolved = '/html/pages/' + file;
        return hash ? resolved + '#' + hash : resolved;
    }

    // ---- Recent searches ----
    function getRecent() {
        try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch(e) { return []; }
    }

    function saveRecent(query) {
        if (!query || query.length < 2) return;
        var list = getRecent().filter(function(q) { return q !== query; });
        list.unshift(query);
        localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
    }

    // ---- Search state ----
    var searchOverlay, searchInput, searchResults, selectedIndex = -1, searchVisible = false;
    var activeFilter = 'all';
    var debounceTimer = null;
    var currentQuery = '';
    var consoles = [];
    var state = { console: [], user: [], marketplace: [], page: [], dashboard: [], settings: [], learn: [] };

    function loadConsoles() {
        if (window.CONSOLES_DATA) { consoles = window.CONSOLES_DATA; return; }
        var tryLoad = function() {
            if (window.CONSOLES_DATA) consoles = window.CONSOLES_DATA;
            else setTimeout(tryLoad, 200);
        };
        setTimeout(tryLoad, 300);
    }

    function clearState() {
        RENDER_ORDER.forEach(function(k) { state[k] = []; });
    }

    // ---- Overlay DOM ----
    function createSearchOverlay() {
        if (document.querySelector('.search-overlay')) return;

        var filterHtml = FILTER_TABS.map(function(t) {
            return '<button class="search-filter-btn' + (t.id === 'all' ? ' search-filter-btn--active' : '') +
                   '" data-filter="' + t.id + '">' + t.label + '</button>';
        }).join('');

        var ov = document.createElement('div');
        ov.className = 'search-overlay';
        // SAFE: filter tab labels (t.label) come from a hardcoded FILTER_CATEGORIES
        // constant in this file and are not user-controlled. The overlay shell is
        // otherwise all hardcoded HTML structure.
        ov.innerHTML =
            '<div class="search-overlay__backdrop"></div>' +
            '<div class="search-overlay__container">' +
                '<div class="search-overlay__input-wrap">' +
                    '<svg class="search-overlay__icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="0"><path d="M22 22h-2v-2h2v2Zm-2-2h-2v-2h2v2Zm-6-2H6v-2h8v2Zm4 0h-2v-2h2v2ZM6 16H4v-2h2v2Zm10 0h-2v-2h2v2ZM4 14H2V6h2v8Zm14 0h-2V6h2v8ZM6 6H4V4h2v2Zm10 0h-2V4h2v2Zm-2-2H6V2h8v2Z"/></svg>' +
                    '<input type="text" class="search-overlay__input" placeholder="Search consoles, people, posts, settings..." autocomplete="off" spellcheck="false">' +
                    '<kbd class="search-overlay__kbd">ESC</kbd>' +
                '</div>' +
                '<div class="search-overlay__filters">' + filterHtml + '</div>' +
                '<div class="search-overlay__results"></div>' +
                '<div class="search-overlay__footer">' +
                    '<span class="search-footer-hint"><kbd>↑↓</kbd> navigate</span>' +
                    '<span class="search-footer-hint"><kbd>↵</kbd> open</span>' +
                    '<span class="search-footer-hint"><kbd>ESC</kbd> close</span>' +
                '</div>' +
            '</div>';
        document.body.appendChild(ov);

        searchOverlay = ov;
        searchInput   = ov.querySelector('.search-overlay__input');
        searchResults = ov.querySelector('.search-overlay__results');

        ov.querySelector('.search-overlay__backdrop').addEventListener('click', closeSearch);
        searchInput.addEventListener('input', onInput);
        searchInput.addEventListener('keydown', handleSearchKey);

        ov.querySelectorAll('.search-filter-btn').forEach(function(btn) {
            btn.addEventListener('click', function() { setFilter(btn.getAttribute('data-filter')); });
        });
    }

    function openSearch() {
        searchVisible = true;
        searchOverlay.classList.add('search-overlay--active');
        document.body.classList.add('search-open');
        searchInput.value = '';
        currentQuery = '';
        selectedIndex = -1;
        setFilter('all', false);
        clearState();
        showRecent();
        setTimeout(function() { searchInput.focus(); }, 50);
    }

    function closeSearch() {
        searchVisible = false;
        searchOverlay.classList.remove('search-overlay--active');
        document.body.classList.remove('search-open');
    }

    // ---- Filter ----
    function setFilter(filterId, rerender) {
        activeFilter = filterId;
        searchOverlay.querySelectorAll('.search-filter-btn').forEach(function(btn) {
            btn.classList.toggle('search-filter-btn--active', btn.getAttribute('data-filter') === filterId);
        });
        if (rerender !== false && currentQuery) render();
    }

    // ---- Input ----
    function onInput() {
        selectedIndex = -1;
        var query = searchInput.value.trim();
        currentQuery = query;

        if (!query) { clearState(); showRecent(); return; }

        searchLocal(query);

        clearTimeout(debounceTimer);
        if (query.length >= 2) {
            debounceTimer = setTimeout(function() { searchAsync(query); }, 300);
        }
    }

    // ---- Local search ----
    function searchLocal(query) {
        var q = normalize(query);

        // Consoles
        var consoleMatches = [];
        for (var i = 0; i < consoles.length && consoleMatches.length < 6; i++) {
            var c = consoles[i];
            if (normalize(c.name || '').indexOf(q) !== -1 ||
                normalize(c.manufacturer || '').indexOf(q) !== -1 ||
                String(c.release || '').indexOf(q) !== -1 ||
                normalize(c.id || '').indexOf(q) !== -1) {
                consoleMatches.push({ cat: 'console', name: c.name, desc: c.manufacturer + ' · ' + c.release, href: resolveConsolePath(c.id), img: resolveImagePath(c.image || '') });
            }
        }
        state.console = consoleMatches;

        // Static index
        state.page = []; state.dashboard = []; state.settings = []; state.learn = [];
        var staticIndex = getStaticIndex();
        for (var j = 0; j < staticIndex.length; j++) {
            var item = staticIndex[j];
            var searchable = normalize(item.name + ' ' + item.desc + ' ' + (item.keywords || ''));
            if (searchable.indexOf(q) === -1) continue;
            var bucket = item.cat;
            if (state[bucket] && state[bucket].length < 5) {
                state[bucket].push({ cat: bucket, name: item.name, desc: item.desc, href: resolveStaticHref(item.href) });
            }
        }

        render();
    }

    // ---- Async search ----
    function searchAsync(query) {
        searchUsers(query);
        searchMarketplace(query);
    }

    function searchUsers(query) {
        var token = localStorage.getItem('cn_token');
        if (!token) return;
        fetch(API + '/users/search?q=' + encodeURIComponent(query), {
            headers: { 'Authorization': 'Bearer ' + token }
        }).then(function(res) {
            if (!res.ok) return null;
            return res.json();
        }).then(function(data) {
            if (!data || !data.success || !data.users || !data.users.length) return;
            if (query !== currentQuery) return;
            state.user = data.users.slice(0, 5).map(function(u) {
                return { cat: 'user', name: u.username, desc: u.bio ? u.bio.substring(0, 60) : 'User', href: resolveUserPath(u.username), img: u.avatar || '' };
            });
            render();
        }).catch(function() {});
    }

    function searchMarketplace(query) {
        fetch(API + '/marketplace/listings?search=' + encodeURIComponent(query) + '&limit=4&sort=newest')
        .then(function(res) {
            if (!res.ok) return null;
            return res.json();
        }).then(function(data) {
            if (!data || !data.success || !data.listings || !data.listings.length) return;
            if (query !== currentQuery) return;
            state.marketplace = data.listings.slice(0, 4).map(function(l) {
                return {
                    cat:   'marketplace',
                    name:  l.title,
                    desc:  (l.price != null ? l.price + ' RON' : '') + (l.condition ? ' · ' + l.condition : ''),
                    href:  resolveCommunityPath(),
                    img:   l.cover_image || '',
                    badge: l.price != null ? l.price + ' RON' : null
                };
            });
            render();
        }).catch(function() {});
    }

    // ---- Recent searches display ----
    function showRecent() {
        var recent = getRecent();
        if (!recent.length) {
            // SAFE: hardcoded only.
            searchResults.innerHTML = '<div class="search-overlay__empty">Start typing to search...</div>';
            return;
        }
        var html = '<div class="search-recent">' +
            '<div class="search-recent__header">' +
                '<span class="search-recent__label">Recent searches</span>' +
                '<button class="search-recent__clear">Clear</button>' +
            '</div>';
        recent.forEach(function(q) {
            html += '<button class="search-recent-item" data-query="' + escHtml(q) + '">' +
                '<span class="search-result__icon">' + ICONS.recent + '</span>' +
                '<span class="search-recent-item__text">' + escHtml(q) + '</span>' +
            '</button>';
        });
        html += '</div>';
        // SAFE: all user-sourced values (recent search strings from localStorage)
        // are passed through escHtml() before insertion. ICONS.recent is a hardcoded SVG.
        searchResults.innerHTML = html;

        var clearBtn = searchResults.querySelector('.search-recent__clear');
        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                localStorage.removeItem(RECENT_KEY);
                showRecent();
            });
        }
        searchResults.querySelectorAll('.search-recent-item').forEach(function(btn) {
            btn.addEventListener('click', function() {
                searchInput.value = btn.getAttribute('data-query');
                onInput();
                searchInput.focus();
            });
        });
    }

    // ---- Render ----
    function render() {
        var allowed = FILTER_CATEGORIES[activeFilter];
        var html = '';
        var globalIdx = 0;
        var hasAny = false;

        RENDER_ORDER.forEach(function(cat) {
            if (allowed && allowed.indexOf(cat) === -1) return;
            var items = state[cat];
            if (!items || !items.length) return;
            hasAny = true;

            html += '<div class="search-category" data-cat-section="' + cat + '">';
            html += '<div class="search-category__label search-category__label--' + cat + '">' + (ICONS[cat] || '') + ' ' + (CATEGORY_LABELS[cat] || cat) + '</div>';

            items.forEach(function(item) {
                var imgTag = item.img
                    ? '<img class="search-result__img" src="' + escHtml(item.img) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
                    : '<span class="search-result__icon search-result__icon--' + cat + '">' + (ICONS[cat] || '') + '</span>';
                var badgeHtml = item.badge
                    ? '<span class="search-result__badge">' + escHtml(item.badge) + '</span>'
                    : '';
                html += '<a href="' + escHtml(item.href) + '" class="search-result" data-index="' + globalIdx + '">' +
                    imgTag +
                    '<div class="search-result__info">' +
                        '<span class="search-result__name">' + escHtml(item.name) + '</span>' +
                        '<span class="search-result__meta">' + escHtml(item.desc) + '</span>' +
                    '</div>' +
                    badgeHtml +
                '</a>';
                globalIdx++;
            });
            html += '</div>';
        });

        if (!hasAny) {
            // SAFE: hardcoded only.
            searchResults.innerHTML = '<div class="search-overlay__empty">No results found</div>';
            return;
        }
        // SAFE: all user-sourced values (item.name, item.desc, item.href, item.img,
        // item.badge) are passed through escHtml() before insertion. See render() above.
        searchResults.innerHTML = html;

        searchResults.querySelectorAll('.search-result').forEach(function(a) {
            a.addEventListener('click', function() { saveRecent(currentQuery); }, { once: true });
        });
    }

    // ---- Keyboard navigation ----
    function handleSearchKey(e) {
        var items = searchResults.querySelectorAll('.search-result');
        if (!items.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
            highlightResult(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, 0);
            highlightResult(items);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedIndex >= 0 && items[selectedIndex]) {
                saveRecent(currentQuery);
                window.location.href = items[selectedIndex].href;
            }
        }
    }

    function highlightResult(items) {
        for (var i = 0; i < items.length; i++) {
            items[i].classList.toggle('search-result--active', i === selectedIndex);
            if (i === selectedIndex) items[i].scrollIntoView({ block: 'nearest' });
        }
    }

    // ---- Avatar URL helper ----
    function normalizeAvatarUrl(avatarUrl, preferredSize) {
        var raw = typeof avatarUrl === 'string' ? avatarUrl.trim() : '';
        if (!raw || raw.indexOf('data:') === 0) return raw;
        if (!/googleusercontent\.com|ggpht\.com/i.test(raw)) return raw;
        var size = preferredSize || 1024;
        var upgraded = raw
            .replace(/[?&]sz=\d+/i, function(m) { return m.charAt(0) + 'sz=' + size; })
            .replace(/=s\d{2,4}(-c)?(?=&|$)/i, '=s' + size + '-c')
            .replace(/\/s\d{2,4}(-c)?(?=\/)/i, '/s' + size + '-c');
        if (upgraded === raw && !/[?&]sz=\d+/i.test(raw)) {
            upgraded += (raw.indexOf('?') !== -1 ? '&' : '?') + 'sz=' + size;
        }
        return upgraded;
    }

    // ---- Profile Dropdown ----
    var profileDropdown, profileBtn, profileOpen = false;

    function createProfileDropdown() {
        profileBtn = document.querySelector('.navbar-profile-btn');
        if (!profileBtn) return;
        if (profileBtn.parentElement.querySelector('.profile-dropdown')) return;

        var user = AuthHelper.getCurrentUser() || {};
        var name = escHtml(user.username || 'User');
        var email = escHtml(user.email || 'No email');
        var avatarRaw = normalizeAvatarUrl(user.avatar || '');
        var avatar = avatarRaw ? escHtml(avatarRaw) : '';
        var profilePath = resolvePagePath('profil.html');
        var avatarMarkup = avatar
            ? '<img src="' + avatar + '" alt="User avatar" class="profile-dropdown__avatar-img">'
            : '<span class="profile-dropdown__avatar-fallback" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="2"><path d="M9 2h6v2H9zm0 8h6v2H9zm6-6h2v6h-2zM7 4h2v6H7zM4 18h2v4H4zm14 0h2v4h-2zM8 14h8v2H8zm-2 2h2v2H6zm10 0h2v2h-2z"/></svg></span>';

        var dd = document.createElement('div');
        dd.className = 'profile-dropdown';
        // SAFE: all user-sourced values (name, email, avatar) are passed through
        // escHtml() before use (see lines above). All hrefs resolve to internal pages
        // via resolvePagePath(). No external or user-supplied URLs are injected.
        dd.innerHTML =
            '<a href="' + profilePath + '" class="profile-dropdown__profile">' +
                '<span class="profile-dropdown__avatar">' + avatarMarkup + '</span>' +
                '<span class="profile-dropdown__meta">' +
                    '<span class="profile-dropdown__name">' + name + '</span>' +
                    '<span class="profile-dropdown__email">' + email + '</span>' +
                '</span>' +
            '</a>' +
            '<div class="profile-dropdown__divider profile-dropdown__divider--profile"></div>' +
            '<a href="' + resolvePagePath('community.html') + '#dm" class="profile-dropdown__item"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="27"><path d="M4 2h16v2H4zm0 14h14v2H4zM2 4h2v12H2zm18 0h2v18h-2zm-2 14h2v2h-2z"/></svg> <span data-i18n="profile_dm">Direct Messages</span></a>' +
            '<a href="' + resolvePagePath('community.html') + '" class="profile-dropdown__item"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="1"><path d="M9 2h6v2H9zM7 4h2v2H7zm8 0h2v2h-2zM5 6h2v7H5zm12 0h2v7h-2zM3 13h2v4H3zm16 0h2v4h-2z M3 15h18v2H3zm5 3h2v2H8zm6 0h2v2h-2zm-4 2h4v2h-4z"/></svg> <span data-i18n="profile_notifications">Notifications</span></a>' +
            '<a href="' + resolvePagePath('profil.html') + '#cereri" class="profile-dropdown__item"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="12"><path d="M6 4H4v16h2zm10-2H6v2h10zm4 4h-2v14h2zm-2 14H6v2h12zM16 4h2v2h-2zm-4 0h2v6h-2z M12 8h6v2h-6zm-4 8h8v2H8zm0-4h8v2H8zm0-4h2v2H8z"/></svg> <span data-i18n="profile_requests">Requests</span></a>' +
            '<div class="profile-dropdown__divider"></div>' +
            '<a href="' + resolvePagePath('profil.html') + '#cursuri" class="profile-dropdown__item"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="10"><path d="M6 2h14v2H6zm0 18h14v2H6zM20 4h2v16h-2zM4 4h2v16H4z M2 7h6v2H2zm0 4h6v2H2zm0 4h6v2H2zM16 4h2v16h-2z"/></svg> <span data-i18n="profile_courses">My Courses</span></a>' +
            '<a href="' + resolvePagePath('profil.html') + '#realizari" class="profile-dropdown__item"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="78"><path d="M16 17H13V19H15V21H9V19H11V17H8V15H16V17ZM18 5H22V11H20V7H18V11H20V13H18V15H16V5H8V15H6V13H4V11H6V7H4V11H2V5H6V3H18V5Z"/></svg> <span data-i18n="profile_achievements">Achievements</span></a>' +
            '<a href="' + resolvePagePath('profil.html') + '#anunturi" class="profile-dropdown__item"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="79"><path d="M20 20H4v-2h4v-8H4v8H2V6h2v2h16V6h2v12h-2v-8H10v8h10v2Zm0-14H4V4h16v2Z"/></svg> <span data-i18n="profile_announcements">My Listings</span></a>' +
            '<a href="' + resolvePagePath('profil.html') + '#favorite" class="profile-dropdown__item"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="7"><path d="M13 22h-2v-2h2v2Zm-2-2H9v-2h2v2Zm4 0h-2v-2h2v2Zm-6-2H7v-2h2v2Zm8 0h-2v-2h2v2ZM7 16H5v-2h2v2Zm12 0h-2v-2h2v2ZM5 14H3v-2h2v2Zm16 0h-2v-2h2v2ZM3 12H1V6h2v6Zm20 0h-2V6h2v6ZM13 8h-2V6h2v2ZM5 6H3V4h2v2Zm6 0H9V4h2v2Zm4 0h-2V4h2v2Zm6 0h-2V4h2v2ZM9 4H5V2h4v2Zm10 0h-4V2h4v2Z"/></svg> <span data-i18n="profile_favorites">Liked Listings</span></a>' +
            '<a href="' + resolvePagePath('profil.html') + '#prieteni" class="profile-dropdown__item"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="11"><path d="M5 2h6v2H5zm10 0h4v2h-4zM5 10h6v2H5zm10 0h4v2h-4zm4-6h2v6h-2zm-8 0h2v6h-2zM3 4h2v6H3zM0 18h2v4H0zm14 0h2v4h-2zm8 0h2v4h-2zM4 14h8v2H4zm12 0h4v2h-4zM2 16h2v2H2zm10 0h2v2h-2zm8 0h2v2h-2z"/></svg> <span data-i18n="profile_friends">Friends</span></a>' +
            '<a href="' + resolvePagePath('profil.html') + '#setari" class="profile-dropdown__item"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="70"><path d="M4 20h3v-2h4v4h2v-4h4v2h-2v4H9v-4H7v2H2v-5h2v3Zm18 2h-5v-2h3v-3h2v5ZM6 11H2v2h4v4H4v-2H0V9h4V7h2v4Zm14-2h4v6h-4v2h-2v-4h4v-2h-4V7h2v2Zm-6 7h-4v-2h4v2Zm-4-2H8v-4h2v4Zm6 0h-2v-4h2v4Zm-2-4h-4V8h4v2ZM7 4H4v3H2V2h5v2Zm8 0h2V2h5v5h-2V4h-3v2h-4V2h-2v4H7V4h2V0h6v4Z"/></svg> <span data-i18n="profile_settings">Settings</span></a>' +
            '<a href="' + resolvePagePath('statistici.html') + '" class="profile-dropdown__item"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="32"><path d="M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2zM7 11h2v6H7zm4-4h2v10h-2zm4 6h2v4h-2z"/></svg> <span data-i18n="profile_stats">Statistics</span></a>' +
            '<div class="profile-dropdown__divider"></div>' +
            '<button class="profile-dropdown__item profile-dropdown__logout"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="80"><path d="M8 11h12v2H8zm8-2h2v2h-2z M14 7h2v10h-2zm2 6h2v2h-2zM6 2h12v2H6zm0 18h12v2H6zM4 4h2v16H4zm14 0h2v3h-2zm0 13h2v3h-2z"/></svg> <span data-i18n="profile_logout">Log out</span></button>';

        profileBtn.parentElement.appendChild(dd);
        profileDropdown = dd;

        profileBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (!AuthHelper.isLoggedIn()) { window.location.href = resolvePagePath('login.html'); return; }
            profileOpen = !profileOpen;
            profileDropdown.classList.toggle('profile-dropdown--active', profileOpen);
        });

        document.addEventListener('click', function(e) {
            if (profileOpen && !profileDropdown.contains(e.target) && !profileBtn.contains(e.target)) {
                profileOpen = false;
                profileDropdown.classList.remove('profile-dropdown--active');
            }
        });

        var logoutBtn = dd.querySelector('.profile-dropdown__logout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', function() {
                AuthHelper.logout();
                window.location.href = '/html/pages/index.html';
            });
        }
    }

    // ---- Init ----
    function initAll() {
        loadConsoles();
        createSearchOverlay();
        createProfileDropdown();

        var searchBtn = document.querySelector('.navbar-search-btn');
        if (searchBtn) searchBtn.addEventListener('click', function(e) { e.preventDefault(); openSearch(); });

        document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
            if (e.key === 'Escape') {
                if (searchVisible) closeSearch();
                if (profileOpen) { profileOpen = false; profileDropdown.classList.remove('profile-dropdown--active'); }
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAll);
    } else {
        initAll();
    }
})();
