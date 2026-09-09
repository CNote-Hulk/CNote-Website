/**
 * ConsoleHub Community Module
 * Sidebar navigation, forum, marketplace, repair wizard, direct messages.
 * Vanilla ES module — no frameworks.
 */
import { AuthModule } from '../modules/auth.js';
import { I18nModule } from '../modules/i18n.js?v=20260909c';
import { API_BASE_URL } from '../config.js';
import { confirmModal } from '../utils/confirm-modal.js';
import { shareOrCopy } from '../utils/share.js';
import { NO_IMAGE_PLACEHOLDER } from '../utils/no-image-placeholder.js';

/** Shorthand for I18nModule.t() */
const t = (key) => I18nModule.t(key);

// ── Constants ──────────────────────────────────────────────

const CONSOLES = [
    { id: 'general',  name: 'General',     color: '#D4A24E' },
    { id: 'ps',       name: 'PlayStation', color: '#0070D1' },
    { id: 'xbox',     name: 'Xbox',        color: '#107C10' },
    { id: 'nintendo', name: 'Nintendo',    color: '#E60012' },
    { id: 'pc',       name: 'PC Gaming',   color: '#9B59B6' },
    { id: 'other',    name: 'Other Consoles', color: '#E67E22' },
];

const TAGS = ['All', 'General', 'Help', 'Discussion', 'News', 'Bug', 'Guide', 'Modding'];

// Values are i18n keys, not display strings — resolve with t(CONDITIONS[k]) / t(CATEGORIES[k]).
const CONDITIONS = { new: 'condition_new', like_new: 'condition_like_new', good: 'condition_good', fair: 'condition_fair', parts: 'condition_parts' };
const CATEGORIES  = { consoles: 'category_consoles', games: 'category_games', accessories: 'category_accessories', parts: 'category_parts_repairs' };

const SYMPTOMS_BY_CONSOLE = {
    xbox: [
        'No power', 'Overheating', 'Disc read error', 'No video output',
        'Controller drift', 'Blue screen / crash', 'Slow performance',
        'Network issues', 'Strange noises', 'Eject problems', "Won't update",
        'HDMI port damaged', 'Power supply failure', 'Cosmetic restoration / upgrade'
    ],
    ps: [
        'No power', 'Overheating', 'Disc read error', 'No video output',
        'Controller drift', 'Blue screen / crash', 'Slow performance',
        'Network issues', 'Strange noises', 'Eject problems', "Won't update",
        'HDMI port damaged', 'Rest mode freeze', 'Cosmetic restoration / upgrade'
    ],
    nintendo: [
        'No power', 'Overheating', 'Joy-Con drift', 'No video output',
        'Screen issues', 'Blue screen / crash', 'Slow performance',
        'Network issues', 'Strange noises', 'Charging problems',
        "Won't update", 'Battery drain', 'Cosmetic restoration / upgrade'
    ],
    pc: [
        'No power', 'Overheating', 'Blue screen / crash', 'No video output',
        'Slow performance', 'Network issues', 'Strange noises',
        'Boot loop', 'GPU artifacts', 'RAM errors',
        'Driver issues', 'Storage failure', 'Cosmetic restoration / upgrade'
    ],
    other: [
        'No power', 'Overheating', 'No video output', 'Strange noises',
        "Won't turn on", 'Disc read error', 'Controller issues',
        'Slow performance', 'Network issues', 'Cosmetic restoration / upgrade'
    ]
};

const MODELS_BY_CONSOLE = {
    ps: [
        'PlayStation 1 (PS1)', 'PS One (Slim)',
        'PlayStation 2 (PS2)', 'PS2 Slim',
        'PlayStation 3 (PS3)', 'PS3 Slim', 'PS3 Super Slim',
        'PlayStation 4 (PS4)', 'PS4 Slim', 'PS4 Pro',
        'PlayStation 5 (PS5)', 'PS5 Digital Edition', 'PS5 Slim', 'PS5 Slim Digital',
        'PSP (1000/2000/3000)', 'PSP Go', 'PSP Street (E1000)',
        'PS Vita (OLED)', 'PS Vita Slim (LCD)', 'PS Vita TV'
    ],
    xbox: [
        'Xbox (Original)',
        'Xbox 360', 'Xbox 360 S (Slim)', 'Xbox 360 E',
        'Xbox One', 'Xbox One S', 'Xbox One S All-Digital', 'Xbox One X',
        'Xbox Series S', 'Xbox Series X'
    ],
    nintendo: [
        'NES (Nintendo Entertainment System)', 'SNES (Super Nintendo)',
        'Nintendo 64 (N64)', 'GameCube',
        'Wii', 'Wii Mini', 'Wii U',
        'Nintendo Switch', 'Nintendo Switch Lite', 'Nintendo Switch OLED', 'Nintendo Switch 2',
        'Game Boy', 'Game Boy Color', 'Game Boy Advance', 'Game Boy Advance SP',
        'Nintendo DS', 'Nintendo DS Lite', 'Nintendo DSi',
        'Nintendo 3DS', 'Nintendo 3DS XL', 'Nintendo 2DS', 'New Nintendo 3DS', 'New Nintendo 3DS XL', 'New Nintendo 2DS XL'
    ],
    pc: [
        'Custom Build (Desktop)', 'Pre-built Desktop', 'Gaming Laptop',
        'Mini PC / SFF', 'Steam Deck', 'ROG Ally', 'Legion Go'
    ],
    other: []
};

// ── State ──────────────────────────────────────────────────

const S = {
    view: 'marketplace',
    console: null,
    category: '',
    threadId: null,
    listingId: null,
    dmPartner: null,
    dmPartnerName: '',
    generalChatOpen: false,
    dmMessages: [],
    dmConversations: [],
    dmReplyTo: null,
    dmEditingId: null,
    dmPins: null,
    dmMutes: null,
    dmHidden: null,
    forumTag: 'All',
    marketSearch: '',
    marketSort: 'newest',
    marketCondition: '',
    marketConsole: '',
    marketCountry: '',
    marketCity: '',
    marketPage: 1,
    repairStep: 0,
    repairModel: '',
    repairSymptoms: [],
    repairDesc: '',
    repairResult: null,
    repairCustomProblem: '',
    favoriteIds: new Set(),
};

// ── DOM refs ───────────────────────────────────────────────

const sidebar = document.getElementById('hub-sidebar');
const content = document.getElementById('hub-content');

// ── Helpers ────────────────────────────────────────────────

/** Escape HTML special characters to prevent XSS */
function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Display name for a LOCATION_DATA country entry, translated via i18n (falls back to the raw data name) */
function countryLabel(country) {
    return I18nModule.t('country_' + country.code) || country.name;
}

/** Display name for a city string — most cities have no translation and render as-is; a handful of
 * major cities with a real, established exonym are overridden via window.CITY_NAME_OVERRIDES
 * (frontend/js/data/city-name-overrides.js). The underlying value used for filtering/storage never changes. */
function cityLabel(city) {
    return window.CITY_NAME_OVERRIDES?.[city]?.[I18nModule.lang] || city;
}

/** Format a date as a relative time string (Romanian locale) */
function timeAgo(d) {
    const diff = Date.now() - new Date(d).getTime();
    if (diff < 60000)    return 'now';
    if (diff < 3600000)  return Math.floor(diff / 60000) + ' min';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
    return new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

/** Get 2-letter initials from a username */
function ini(n) { return n ? n.slice(0, 2).toUpperCase() : '?'; }

/** Abbreviate a count for display (1234 -> "1.2K"), Reddit-style */
function formatCount(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(n);
    if (n < 1000000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0).replace(/\.0$/, '') + 'K';
    return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
}

/** Build a flat replies array into a parent -> children map for threaded rendering */
function buildReplyTree(replies) {
    const childrenOf = new Map();
    replies.forEach(r => {
        const key = r.reply_to_id || null;
        if (!childrenOf.has(key)) childrenOf.set(key, []);
        childrenOf.get(key).push(r);
    });
    return childrenOf;
}

/** Deterministic per-user avatar color (same palette as the chat module) */
const AVATAR_COLORS = ['#5B8CFF', '#43B581', '#9B59B6', '#FF6B6B', '#F0A830'];
function avatarColor(name) {
    let hash = 0;
    const s = name || '';
    for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** Show a non-blocking toast notification */
function showToast(msg, type) {
    const el = document.createElement('div');
    el.className = 'hub-toast' + (type === 'error' ? ' hub-toast--error' : type === 'success' ? ' hub-toast--success' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('hub-toast--visible'));
    setTimeout(() => {
        el.classList.remove('hub-toast--visible');
        el.addEventListener('transitionend', () => el.remove(), { once: true });
    }, 3000);
}

// ── Custom Select Component ────────────────────────────────

/**
 * Wraps a native <select> with a fully custom dropdown UI.
 * The native select remains hidden in the DOM so form .value reads still work.
 * Dropdown is appended to document.body (position:fixed) to escape overflow:hidden parents.
 */
function createCustomSelect(sel) {
    if (sel._hubCsel) return; // already initialized

    const wrapper = document.createElement('div');
    wrapper.className = 'hub-csel';
    if (sel.classList.contains('hub-market-select')) wrapper.classList.add('hub-csel--inline');
    if (sel.disabled) wrapper.classList.add('hub-csel--disabled');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'hub-csel__trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const valueSpan = document.createElement('span');
    valueSpan.className = 'hub-csel__value';

    const arrowSpan = document.createElement('span');
    arrowSpan.className = 'hub-csel__arrow';
    arrowSpan.innerHTML = `<svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    trigger.appendChild(valueSpan);
    trigger.appendChild(arrowSpan);
    wrapper.appendChild(trigger);

    // Dropdown appended to body — escapes overflow:hidden / CSS transform parents
    const dropdown = document.createElement('div');
    dropdown.className = 'hub-csel__dropdown';
    dropdown.setAttribute('role', 'listbox');
    document.body.appendChild(dropdown);

    let isOpen = false;

    function getSelectedLabel() {
        const opt = sel.options[sel.selectedIndex];
        return opt ? opt.textContent.trim() : '';
    }

    function buildOptions() {
        dropdown.innerHTML = '';
        Array.from(sel.options).forEach((opt, i) => {
            const item = document.createElement('div');
            item.className = 'hub-csel__option';
            item.setAttribute('role', 'option');
            if (opt.disabled) item.classList.add('hub-csel__option--disabled');
            if (i === sel.selectedIndex) {
                item.classList.add('hub-csel__option--selected');
                item.setAttribute('aria-selected', 'true');
            }
            item.textContent = opt.textContent.trim();
            item.dataset.index = i;
            item.addEventListener('mousedown', e => {
                e.preventDefault(); // prevent trigger blur before selection
                if (opt.disabled) return;
                sel.selectedIndex = i;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                valueSpan.textContent = getSelectedLabel();
                close();
            });
            dropdown.appendChild(item);
        });
        valueSpan.textContent = getSelectedLabel();
    }

    function positionDropdown() {
        const rect = trigger.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const dropH = Math.min(dropdown.scrollHeight || 240, 280);
        const goUp = spaceBelow < dropH + 8 && rect.top > dropH + 8;

        dropdown.style.width = rect.width + 'px';
        dropdown.style.left  = rect.left + 'px';

        if (goUp) {
            dropdown.classList.add('hub-csel__dropdown--up');
            dropdown.style.top    = 'auto';
            dropdown.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
        } else {
            dropdown.classList.remove('hub-csel__dropdown--up');
            dropdown.style.bottom = 'auto';
            dropdown.style.top    = (rect.bottom + 4) + 'px';
        }
    }

    function open() {
        if (wrapper.classList.contains('hub-csel--disabled')) return;
        // Close all other open selects first
        document.querySelectorAll('.hub-csel--open').forEach(w => {
            if (w !== wrapper && w._hubCselClose) w._hubCselClose();
        });
        buildOptions();
        isOpen = true;
        wrapper.classList.add('hub-csel--open');
        trigger.setAttribute('aria-expanded', 'true');
        positionDropdown();
        dropdown.classList.add('hub-csel__dropdown--visible');
    }

    function close() {
        isOpen = false;
        wrapper.classList.remove('hub-csel--open');
        trigger.setAttribute('aria-expanded', 'false');
        dropdown.classList.remove('hub-csel__dropdown--visible');
    }

    trigger.addEventListener('click', e => {
        e.stopPropagation();
        isOpen ? close() : open();
    });

    // Close when clicking outside
    function outsideClick(e) {
        if (!wrapper.contains(e.target) && !dropdown.contains(e.target)) close();
    }
    document.addEventListener('click', outsideClick);

    // Keyboard navigation
    trigger.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            isOpen ? close() : open();
        } else if (e.key === 'Escape') {
            close();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!isOpen) open();
            const items = [...dropdown.querySelectorAll('.hub-csel__option:not(.hub-csel__option--disabled)')];
            const cur = dropdown.querySelector('.hub-csel__option--selected');
            const idx = items.indexOf(cur);
            let next;
            if (e.key === 'ArrowDown') next = idx < items.length - 1 ? items[idx + 1] : items[0];
            else next = idx > 0 ? items[idx - 1] : items[items.length - 1];
            if (next) {
                cur?.classList.remove('hub-csel__option--selected');
                next.classList.add('hub-csel__option--selected');
                next.scrollIntoView({ block: 'nearest' });
                // Trigger selection immediately on arrow key
                const i = +next.dataset.index;
                sel.selectedIndex = i;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                valueSpan.textContent = getSelectedLabel();
            }
        }
    });

    // Watch for dynamic option rebuilds (e.g. city list updated after country change)
    const mutObs = new MutationObserver(() => {
        buildOptions();
        if (isOpen) positionDropdown();
    });
    mutObs.observe(sel, { childList: true });

    // Watch for disabled attribute changes (e.g. city disabled until country selected)
    const disabledObs = new MutationObserver(() => {
        const d = sel.disabled;
        wrapper.classList.toggle('hub-csel--disabled', d);
        if (d) close();
    });
    disabledObs.observe(sel, { attributes: true, attributeFilter: ['disabled'] });

    // Sync label when native select value changes programmatically
    sel.addEventListener('change', () => { valueSpan.textContent = getSelectedLabel(); });

    // Insert wrapper before select; move select inside (hidden)
    sel.parentNode.insertBefore(wrapper, sel);
    wrapper.appendChild(sel);
    sel.style.cssText += ';display:none!important';

    buildOptions();

    // Cleanup — restores native select and removes body dropdown
    function destroy() {
        close();
        document.removeEventListener('click', outsideClick);
        mutObs.disconnect();
        disabledObs.disconnect();
        dropdown.remove();
        if (wrapper.parentNode) {
            wrapper.parentNode.insertBefore(sel, wrapper);
            sel.style.cssText = sel.style.cssText.replace(/;?display:none!important/g, '');
            wrapper.remove();
        }
        sel._hubCsel = null;
    }

    sel._hubCsel = { destroy, dropdown };
    wrapper._hubCselClose = close;
}

/** Initialize custom selects for all hub-form-select / hub-market-select in a container */
function initHubSelects(container) {
    container.querySelectorAll('.hub-form-select, .hub-market-select').forEach(sel => {
        createCustomSelect(sel);
    });
}

/** Destroy all custom selects in a container (call before innerHTML wipe or element removal) */
function cleanupHubSelects(container) {
    container.querySelectorAll('.hub-form-select, .hub-market-select').forEach(sel => {
        if (sel._hubCsel) sel._hubCsel.destroy();
    });
}

/** Render avatar: show image if available, fallback to initials with onerror */
function avatarHtml(name, avatarUrl, size, extraStyle) {
    const sz = size || 36;
    const s = extraStyle || '';
    const color = avatarColor(name);
    if (avatarUrl) {
        return `<img src="${esc(avatarUrl)}" alt="" style="width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover;${s}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span style="display:none;width:${sz}px;height:${sz}px;border-radius:50%;align-items:center;justify-content:center;font-size:${sz * 0.022}rem;font-weight:700;text-transform:uppercase;background:${color};color:#fff;${s}">${ini(name)}</span>`;
    }
    return `<span style="display:flex;width:${sz}px;height:${sz}px;border-radius:50%;align-items:center;justify-content:center;font-size:${sz * 0.38}px;font-weight:700;text-transform:uppercase;background:${color};color:#fff;${s}">${ini(name)}</span>`;
}

/** Authenticated API call helper — attaches JWT and returns parsed JSON */
async function api(method, path, body) {
    const token = localStorage.getItem('cn_token');
    const opts = { method, credentials: 'include', headers: {} };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(API_BASE_URL + path, opts);
    return res.json();
}

function user() { return AuthModule.getCurrentUser(); }

// (2026-09-01) Own mute state — AuthModule.getCurrentUser() only ever reads the local
// cn_session snapshot taken at login, so a mute applied mid-session never shows up there.
// This is refreshed from the server periodically instead (see startMuteStatusPolling below,
// piggybacked on the same cadence as startUnreadPolling) and consumed by both the DM
// composer (applyDmMuteUI) and the "New thread" trigger (openNewThreadModal).
let myMutedUntil = null;

/** Hours left on a mute (rounded up, min 1 while active), or null if not muted / expired.
 *  Mirrors the app's ChatViewModel.mutedHoursRemaining(). */
function mutedHoursRemaining() {
    if (!myMutedUntil) return null;
    const until = new Date(myMutedUntil).getTime();
    if (isNaN(until) || until <= Date.now()) return null;
    return Math.max(1, Math.ceil((until - Date.now()) / 3600000));
}

async function refreshMuteStatus() {
    if (!user()) return;
    try {
        const data = await api('GET', '/me');
        if (data.success && data.user) myMutedUntil = data.user.muted_until || null;
    } catch { /* keep previous value on a transient failure */ }
    applyDmMuteUI();
}

function startMuteStatusPolling() {
    refreshMuteStatus();
    setInterval(refreshMuteStatus, 15000);
}

/** Swaps the DM composer for a "muted for Nh" notice, same idea as the app's
 *  MutedComposerNotice — no-ops if no conversation is currently open (#dm-form absent). */
function applyDmMuteUI() {
    const form = document.getElementById('dm-form');
    const notice = document.getElementById('dm-muted-notice');
    if (!form || !notice) return;
    const hours = mutedHoursRemaining();
    form.hidden = hours !== null;
    notice.hidden = hours === null;
    if (hours !== null) {
        notice.querySelector('#dm-muted-text').textContent =
            t('chat_muted_notice').replace('{hours}', hours);
    }
}

// ── View switching ─────────────────────────────────────────

/** Switch the active hub view panel with re-trigger animation */
function showView(id) {
    // Close any open custom dropdowns before switching views
    document.querySelectorAll('.hub-csel--open').forEach(w => {
        if (w._hubCselClose) w._hubCselClose();
    });
    if (S.view === 'dm' && id !== 'dm' && typeof stopDmPolling === 'function') stopDmPolling();
    content.querySelectorAll('.hub-view').forEach(v => v.classList.remove('hub-view--active'));
    const el = document.getElementById('view-' + id);
    if (el) el.classList.add('hub-view--active');
    S.view = id;
    // Forum thread detail and listing detail already have their own in-page back link/button,
    // so on mobile they go fullscreen (site navbar + bottom tab bar hidden) instead of wasting
    // space on chrome that duplicates it. DM's own thread-open state (and, since 2026-09-02,
    // general chat's — see openGeneralChat()/closeGeneralChat()) isn't a distinct `S.view` either
    // (both live inside #view-dm, not a separate view), so both are handled by their own
    // open/close functions calling setMobileFullscreen() directly instead of here.
    setMobileFullscreen(id === 'thread' || id === 'listing');
}

/** Hide the site navbar + mobile bottom tab bar on mobile when a "detail" view (forum thread,
 * listing detail, or an open DM conversation) already provides its own back navigation —
 * reuses the same navbar--hidden/mbn--hidden classes navigation.js's scroll auto-hide uses. */
function setMobileFullscreen(active) {
    // .navbar--hidden has no media-query guard of its own (navigation.js's own scroll-based
    // auto-hide only ever adds it after checking matchMedia itself) — without the same check
    // here, calling this on a desktop-width window would hide the navbar there too.
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const shouldHide = active && isMobile;
    document.querySelector('.navbar')?.classList.toggle('navbar--hidden', shouldHide);
    document.getElementById('mobile-bottom-nav')?.classList.toggle('mbn--hidden', shouldHide);
    document.body.classList.toggle('hub-mobile-fullscreen', shouldHide);
}

// ── Sidebar ────────────────────────────────────────────────

/** Build sidebar: console filter links + category navigation */
function initSidebar() {
    if (!sidebar) return;

    sidebar.addEventListener('click', e => {
        const item = e.target.closest('.hub-sidebar__item');
        if (!item || item.classList.contains('hub-sidebar__item--locked')) return;

        sidebar.querySelectorAll('.hub-sidebar__item').forEach(b => b.classList.remove('hub-sidebar__item--active'));
        item.classList.add('hub-sidebar__item--active');

        // Close mobile sidebar after navigation
        closeMobileSidebar();

        navigate(item.dataset.view, item.dataset.console || null, item.dataset.category ?? '');
    });

    // Mobile sidebar controls are initialized globally at boot.

    // Legacy toggle (for non-mobile fallback)
    const toggle = document.getElementById('hub-sidebar-toggle');
    if (toggle) toggle.addEventListener('click', () => sidebar.classList.toggle('hub-sidebar--open'));
}

function initMobileSidebarControls() {
    const hamburger = document.getElementById('hub-mobile-hamburger');
    const overlay = document.getElementById('hub-mobile-overlay');
    const closeBtn = document.getElementById('hub-sidebar-close');

    applyMobileMenuLayering();

    if (hamburger && !hamburger.dataset.hubMenuBound) {
        hamburger.addEventListener('click', toggleMobileSidebar);
        hamburger.addEventListener('touchstart', (e) => {
            e.preventDefault();
            toggleMobileSidebar();
        }, { passive: false });
        hamburger.dataset.hubMenuBound = '1';
    }

    if (overlay && !overlay.dataset.hubMenuBound) {
        overlay.addEventListener('click', closeMobileSidebar);
        overlay.dataset.hubMenuBound = '1';
    }

    if (closeBtn && !closeBtn.dataset.hubMenuBound) {
        closeBtn.addEventListener('click', closeMobileSidebar);
        closeBtn.dataset.hubMenuBound = '1';
    }
}

function applyMobileMenuLayering() {
    if (!sidebar) return;
    const hamburger = document.getElementById('hub-mobile-hamburger');
    const overlay = document.getElementById('hub-mobile-overlay');

    sidebar.style.zIndex = '5001';
    sidebar.style.opacity = '1';
    sidebar.style.backdropFilter = 'none';
    sidebar.style.webkitBackdropFilter = 'none';

    if (overlay) {
        overlay.style.zIndex = '5000';
        overlay.style.background = 'rgba(0, 0, 0, 0.65)';
    }

    if (hamburger) {
        hamburger.style.zIndex = '5002';
    }
}

function syncOverlayOutsideSidebar() {
    if (!sidebar) return;
    const overlay = document.getElementById('hub-mobile-overlay');
    if (!overlay) return;

    const isOpen = sidebar.classList.contains('hub-sidebar--open');
    if (!isOpen) {
        overlay.style.left = '0';
        overlay.style.right = '0';
        return;
    }

    // Restore calculated value minus 1px (clickas request)
    const sidebarWidth = Math.max(0, Math.ceil(sidebar.getBoundingClientRect().width || 0) - 2);
    overlay.style.left = sidebarWidth + 'px';
    overlay.style.right = '0';
}

function toggleMobileSidebar() {
    if (!sidebar) return;
    const hamburger = document.getElementById('hub-mobile-hamburger');
    const overlay = document.getElementById('hub-mobile-overlay');
    const landing = document.getElementById('community-landing');
    const isOpen = sidebar.classList.contains('hub-sidebar--open');
    if (isOpen) closeMobileSidebar();
    else {
        applyMobileMenuLayering();
        sidebar.classList.add('hub-sidebar--open');
        if (hamburger) hamburger.classList.add('active');
        if (overlay) overlay.classList.add('active');
        if (landing) {
            landing.style.pointerEvents = 'none';
            landing.style.zIndex = '1';
        }
        syncOverlayOutsideSidebar();
        document.body.style.overflow = 'hidden';
    }
}

function closeMobileSidebar() {
    if (!sidebar) return;
    const hamburger = document.getElementById('hub-mobile-hamburger');
    const overlay = document.getElementById('hub-mobile-overlay');
    const landing = document.getElementById('community-landing');
    sidebar.classList.remove('hub-sidebar--open');
    if (hamburger) hamburger.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
    if (landing) {
        landing.style.pointerEvents = '';
        landing.style.zIndex = '50';
    }
    syncOverlayOutsideSidebar();
    document.body.style.overflow = '';
}

/** Navigate to a view, optionally filtering by console and category */
function navigate(view, con, cat) {
    const hashParts = [view];
    if (con) hashParts.push(con);
    if (cat) hashParts.push(cat);
    const newHash = '#' + hashParts.join('/');
    if (window.location.hash !== newHash) {
        history.replaceState(null, '', newHash);
    }
    
    switch (view) {
        case 'forum':
            S.console = con;
            S.forumTag = 'All';
            showView('forum');
            renderForum();
            loadThreads();
            break;
        case 'repair':
            S.console = con;
            Object.assign(S, { repairStep: 0, repairModel: '', repairSymptoms: [], repairDesc: '', repairResult: null, repairCustomProblem: '' });
            showView('repair');
            renderRepair();
            break;
        case 'repair-requests':
            showView('repair-requests');
            renderRepairRequests();
            break;
        case 'repair-admin':
            showView('repair-admin');
            renderRepairAdmin();
            break;
        case 'marketplace':
            S.category = cat || '';
            Object.assign(S, { marketSearch: '', marketSort: 'newest', marketCondition: '', marketConsole: '', marketPage: 1 });
            showView('marketplace');
            renderMarketplace();
            loadListings();
            break;
        case 'dm':
            showView('dm');
            renderDM();
            loadConversations();
            break;
        case 'photos':
            showView('photos');
            renderPhotos();
            loadPhotos();
            break;
    }
}

/* ================================================================
   FORUM
   ================================================================ */

/** Render the forum view: thread list, search bar, tag filters */
function renderForum() {
    const v = document.getElementById('view-forum');
    const cName = CONSOLES.find(c => c.id === S.console)?.name || S.console;
    const u = user();

    v.innerHTML = `
        <div class="hub-view-header">
            <div class="hub-view-header__title">💬 ${esc(cName)} — Community</div>
            ${u ? '<button class="hub-btn hub-btn--primary" id="forum-new-btn">+ New topic</button>' : ''}
        </div>
        <div class="hub-forum-filters" id="forum-filters">
            ${TAGS.map(t => `<button class="hub-filter-btn${S.forumTag === t ? ' hub-filter-btn--active' : ''}" data-tag="${t}">${t}</button>`).join('')}
        </div>
        <div class="hub-thread-list" id="forum-threads"><div class="hub-empty"><div class="hub-empty__icon">⏳</div>Loading…</div></div>`;

    v.querySelector('#forum-filters').addEventListener('click', e => {
        const b = e.target.closest('.hub-filter-btn');
        if (!b) return;
        S.forumTag = b.dataset.tag;
        v.querySelectorAll('.hub-filter-btn').forEach(x => x.classList.remove('hub-filter-btn--active'));
        b.classList.add('hub-filter-btn--active');
        loadThreads();
    });

    v.querySelector('#forum-new-btn')?.addEventListener('click', openNewThreadModal);
}

/** Fetch and display forum threads for current console + tag filter */
async function loadThreads() {
    const list = document.getElementById('forum-threads');
    try {
        const data = await api('GET', `/forum/${S.console}/threads`);
        if (!data.success) throw 0;
        let threads = data.threads || [];
        if (S.forumTag !== 'All') threads = threads.filter(t => t.tag === S.forumTag);

        if (!threads.length) {
            list.innerHTML = '<div class="hub-empty"><div class="hub-empty__icon">💬</div>No topics yet. Be the first!</div>';
            return;
        }
        list.innerHTML = threads.map(t => `
            <div class="hub-thread-item-wrap">
                <div class="hub-thread-card" data-id="${t.id}">
                    <div class="hub-thread-card__meta">
                        <div class="hub-thread-card__avatar">${avatarHtml(t.username, t.avatar, 20)}</div>
                        <span class="hub-tag hub-tag--${(t.tag || 'general').toLowerCase()}">${esc(t.tag || 'General')}</span>
                        <span class="hub-thread-card__dot">•</span>
                        <span>${esc(t.username)}</span>
                        <span class="hub-thread-card__dot">•</span>
                        <span>${timeAgo(t.created_at)}</span>
                        ${t.solved_reply_id ? `<span class="hub-solved-badge">${I18nModule.t('forum_solved_badge')}</span>` : ''}
                    </div>
                    <div class="hub-thread-card__title">${esc(t.title)}</div>
                    ${t.body_snippet ? `<div class="hub-thread-card__preview">${esc(t.body_snippet)}${t.body_snippet.length >= 200 ? '…' : ''}</div>` : ''}
                    ${t.image_url ? `<img class="hub-thread-card__image" src="${esc(t.image_url)}" alt="" loading="lazy">` : ''}
                    <div class="hub-thread-card__actions">
                        <button class="hub-vote-pill" data-upvote="thread" data-id="${t.id}">
                            <span class="hub-vote-pill__arrow">▲</span><span class="hub-vote-pill__count">${formatCount(t.upvotes || 0)}</span>
                        </button>
                        <span class="hub-action-pill">💬 ${formatCount(t.reply_count || 0)}</span>
                        <button class="hub-action-pill hub-action-pill--share" data-share="${t.id}" data-share-title="${esc(t.title)}">↗ Share</button>
                        ${(user() && user().id !== t.user_id) ? `<button class="hub-action-pill report-trigger-btn" data-report-type="forum_thread" data-report-id="${t.id}" data-report-preview="${esc(t.title)}">${I18nModule.t('report_btn_trigger')}</button>` : ''}
                    </div>
                    <div class="hub-thread-card__views">👁 ${formatCount(t.views || 0)} views</div>
                </div>
            </div>`).join('');

        list.addEventListener('click', async e => {
            const reportBtn = e.target.closest('.report-trigger-btn');
            if (reportBtn) {
                e.stopPropagation();
                if (typeof window.openReportModal === 'function') {
                    window.openReportModal({
                        contentType: reportBtn.dataset.reportType,
                        contentId:   reportBtn.dataset.reportId,
                        contentPreview: reportBtn.dataset.reportPreview,
                    });
                }
                return;
            }
            const voteBtn = e.target.closest('.hub-vote-pill');
            if (voteBtn) {
                if (!user()) return;
                const tid = +voteBtn.dataset.id;
                const res = await api('POST', `/forum/${S.console}/threads/${tid}/upvote`);
                if (res.success) voteBtn.querySelector('.hub-vote-pill__count').textContent = formatCount(res.upvotes);
                return;
            }
            const shareBtn = e.target.closest('[data-share]');
            if (shareBtn) {
                const tid = shareBtn.dataset.share;
                const shareUrl = `${location.origin}/html/pages/community.html#forum/${S.console}/thread/${tid}`;
                const result = await shareOrCopy({ title: shareBtn.dataset.shareTitle, text: shareBtn.dataset.shareTitle, url: shareUrl });
                if (result === 'copied') showToast(I18nModule.t('share_link_copied'));
                return;
            }
            const card = e.target.closest('.hub-thread-card');
            if (card) openThread(+card.dataset.id);
        });
    } catch { list.innerHTML = '<div class="hub-empty"><div class="hub-empty__icon">❌</div>Failed to load.</div>'; }
}

/** Open a single thread with its replies and reply form */
/** Render one comment (reply) plus its nested children recursively, Reddit-style */
function renderReplyNode(r, childrenOf, depth, isOwner, solvedReplyId, u) {
    const kids = childrenOf.get(r.id) || [];
    const isSolved = solvedReplyId === r.id;
    return `
        <div class="hub-comment-thread"${depth > 0 ? ' style="margin-left:20px;padding-left:16px;border-left:2px solid var(--border-color)"' : ''}>
            <div class="hub-comment${isSolved ? ' hub-comment--solved' : ''}" data-reply-id="${r.id}">
                <div class="hub-comment__header">
                    <div class="hub-comment__avatar">${avatarHtml(r.username, r.avatar, 24)}</div>
                    <span class="hub-comment__user">${esc(r.username)}</span>
                    <span class="hub-comment__time">${timeAgo(r.created_at)}</span>
                    ${isSolved ? `<span class="hub-solved-badge">${I18nModule.t('forum_solved_badge')}</span>` : ''}
                </div>
                <div class="hub-comment__body">${esc(r.body)}</div>
                <div class="hub-comment__actions">
                    <button class="hub-vote-pill hub-vote-pill--sm" data-upvote="reply" data-id="${r.id}">
                        <span class="hub-vote-pill__arrow">▲</span><span class="hub-vote-pill__count">${formatCount(r.upvotes || 0)}</span>
                    </button>
                    ${u ? `<button class="hub-comment__action" data-reply-to="${r.id}" data-reply-to-user="${esc(r.username)}">${I18nModule.t('forum_reply_to_action')}</button>` : ''}
                    ${isOwner ? `<button class="hub-comment__action" data-solve="${r.id}">${isSolved ? I18nModule.t('forum_unmark_solved') : I18nModule.t('forum_mark_solved')}</button>` : ''}
                    ${(u && u.id !== r.user_id) ? `<button class="hub-comment__action report-trigger-btn" data-report-type="forum_reply" data-report-id="${r.id}" data-report-preview="${esc((r.body || '').substring(0, 60))}">${I18nModule.t('report_btn_trigger')}</button>` : ''}
                </div>
            </div>
            ${kids.map(k => renderReplyNode(k, childrenOf, depth + 1, isOwner, solvedReplyId, u)).join('')}
        </div>`;
}

async function openThread(id) {
    S.threadId = id;
    showView('thread');
    const v = document.getElementById('view-thread');
    v.innerHTML = '<div class="hub-empty"><div class="hub-empty__icon">⏳</div>Loading…</div>';

    let replyTo = null; // { id, username, snippet } — cleared on every (re)render

    try {
        const data = await api('GET', `/forum/${S.console}/threads/${id}`);
        if (!data.success) throw 0;
        const t = data.thread, replies = t.replies || [], u = user();
        const isOwner = u && u.id === t.user_id;

        const childrenOf = buildReplyTree(replies);
        const topLevelReplies = childrenOf.get(null) || [];

        v.innerHTML = `
            <div class="hub-view-header">
                <button class="hub-view-header__back" id="thread-back">← Back</button>
                <div class="hub-view-header__title">${esc(t.title)}${t.solved_reply_id ? ` <span class="hub-solved-badge">${I18nModule.t('forum_solved_badge')}</span>` : ''}</div>
            </div>
            <div class="hub-thread-detail" id="thread-detail">
                <div class="hub-thread-original">
                    <div class="hub-thread-card__meta">
                        <div class="hub-thread-card__avatar">${avatarHtml(t.username, t.avatar, 20)}</div>
                        <span class="hub-tag hub-tag--${(t.tag || 'general').toLowerCase()}">${esc(t.tag || 'General')}</span>
                        <span class="hub-thread-card__dot">•</span>
                        <span>${esc(t.username)}</span>
                        <span class="hub-thread-card__dot">•</span>
                        <span>${timeAgo(t.created_at)}</span>
                    </div>
                    <div class="hub-thread-original__text">${esc(t.body)}</div>
                    ${t.image_url ? `<img class="hub-thread-card__image" src="${esc(t.image_url)}" alt="" loading="lazy">` : ''}
                    <div class="hub-thread-card__actions">
                        <button class="hub-vote-pill" data-upvote="thread" data-id="${t.id}">
                            <span class="hub-vote-pill__arrow">▲</span><span class="hub-vote-pill__count">${formatCount(t.upvotes || 0)}</span>
                        </button>
                        <span class="hub-action-pill">💬 ${formatCount(replies.length)}</span>
                        <button class="hub-action-pill hub-action-pill--share" id="thread-share-btn">↗ Share</button>
                        ${(u && u.id !== t.user_id) ? `<button class="hub-action-pill report-trigger-btn" data-report-type="forum_thread" data-report-id="${t.id}" data-report-preview="${esc(t.title)}">${I18nModule.t('report_btn_trigger')}</button>` : ''}
                    </div>
                    <div class="hub-thread-card__views">👁 ${formatCount(t.views || 0)} views</div>
                </div>

                ${u ? `<div class="hub-reply-context" id="thread-reply-context" hidden></div>
                <form class="hub-reply-form" id="thread-reply-form">
                    <input type="text" placeholder="${I18nModule.t('forum_join_conversation')}" maxlength="2000" required>
                    <button class="hub-btn hub-btn--primary" type="submit">Send</button>
                </form>` : ''}

                <div class="hub-replies-heading">Replies (${replies.length})</div>
                ${topLevelReplies.map(r => renderReplyNode(r, childrenOf, 0, isOwner, t.solved_reply_id, u)).join('')}
            </div>`;

        v.querySelector('#thread-back').addEventListener('click', () => {
            showView('forum'); renderForum(); loadThreads();
        });

        const replyInput = v.querySelector('#thread-reply-form input');
        const replyContext = v.querySelector('#thread-reply-context');

        function setReplyTo(replyId, username, snippet) {
            replyTo = replyId ? { id: replyId, username, snippet } : null;
            if (!replyContext) return;
            if (replyTo) {
                replyContext.hidden = false;
                replyContext.innerHTML = `${I18nModule.t('forum_replying_to')} <b>${esc(username)}</b>: “${esc((snippet || '').slice(0, 80))}” <button type="button" id="thread-reply-cancel">${I18nModule.t('forum_cancel_reply')}</button>`;
                replyContext.querySelector('#thread-reply-cancel').addEventListener('click', () => setReplyTo(null));
                replyInput?.focus();
            } else {
                replyContext.hidden = true;
                replyContext.innerHTML = '';
            }
        }

        v.querySelector('#thread-detail').addEventListener('click', async e => {
            const reportBtn = e.target.closest('.report-trigger-btn');
            if (reportBtn) {
                if (typeof window.openReportModal === 'function') {
                    window.openReportModal({
                        contentType: reportBtn.dataset.reportType,
                        contentId:   reportBtn.dataset.reportId,
                        contentPreview: reportBtn.dataset.reportPreview,
                    });
                }
                return;
            }

            const replyToBtn = e.target.closest('[data-reply-to]');
            if (replyToBtn) {
                const card = replyToBtn.closest('.hub-comment');
                const snippet = card?.querySelector('.hub-comment__body')?.textContent || '';
                setReplyTo(+replyToBtn.dataset.replyTo, replyToBtn.dataset.replyToUser, snippet);
                return;
            }

            const solveBtn = e.target.closest('[data-solve]');
            if (solveBtn) {
                const replyId = +solveBtn.dataset.solve;
                const alreadySolved = t.solved_reply_id === replyId;
                const res = await api('POST', `/forum/${S.console}/threads/${id}/solve`, {
                    reply_id: alreadySolved ? null : replyId,
                });
                if (res.success) openThread(id);
                return;
            }

            const btn = e.target.closest('.hub-vote-pill');
            if (!btn || !u) return;
            const type = btn.dataset.upvote;
            const tid  = +btn.dataset.id;
            const path = type === 'thread'
                ? `/forum/${S.console}/threads/${tid}/upvote`
                : `/forum/${S.console}/replies/${tid}/upvote`;
            const res = await api('POST', path);
            if (res.success) btn.querySelector('.hub-vote-pill__count').textContent = formatCount(res.upvotes);
        });

        v.querySelector('#thread-share-btn')?.addEventListener('click', async () => {
            const shareUrl = `${location.origin}/html/pages/community.html#forum/${S.console}/thread/${id}`;
            const result = await shareOrCopy({ title: t.title, text: t.title, url: shareUrl });
            if (result === 'copied') showToast(I18nModule.t('share_link_copied'));
        });

        v.querySelector('#thread-reply-form')?.addEventListener('submit', async e => {
            e.preventDefault();
            const input = e.target.querySelector('input');
            const body = input.value.trim();
            if (!body) return;
            const res = await api('POST', `/forum/${S.console}/threads/${id}/reply`, {
                body,
                reply_to_id: replyTo ? replyTo.id : undefined,
            });
            if (res.success) {
                window.dispatchEvent(new CustomEvent('cn:message-sent'));
                openThread(id);
            }
        });
    } catch { v.innerHTML = '<div class="hub-empty"><div class="hub-empty__icon">❌</div>Failed to load.</div>'; }
}

/** Open modal dialog to create a new forum thread */
function openNewThreadModal() {
    // (2026-09-01) backend/routes/forum.js already 403s a muted POST /threads — this just
    // skips the wasted round-trip + generic alert, same as the app's onNewThread gate.
    const mutedHours = mutedHoursRemaining();
    if (mutedHours !== null) {
        showToast(t('chat_muted_notice').replace('{hours}', mutedHours), 'error');
        return;
    }
    const _prev = document.querySelector('.hub-modal-overlay');
    if (_prev) { cleanupHubSelects(_prev); _prev.remove(); }

    const overlay = document.createElement('div');
    overlay.className = 'hub-modal-overlay';
    overlay.innerHTML = `
        <div class="hub-modal">
            <div class="hub-modal__header">
                <span class="hub-modal__title">New Topic</span>
                <button class="hub-modal__close">&times;</button>
            </div>
            <form class="hub-modal__body" id="new-thread-form">
                <div class="hub-form-group">
                    <label class="hub-form-label">Title</label>
                    <input class="hub-form-input" name="title" maxlength="200" required placeholder="Topic title…">
                </div>
                <div class="hub-form-group">
                    <label class="hub-form-label">Tag</label>
                    <select class="hub-form-select" name="tag">
                        ${TAGS.filter(t => t !== 'All').map(t => `<option value="${t}">${t}</option>`).join('')}
                    </select>
                </div>
                <div class="hub-form-group">
                    <label class="hub-form-label">Message</label>
                    <textarea class="hub-form-textarea" name="body" maxlength="5000" required rows="5" placeholder="Write here…"></textarea>
                </div>
                <div class="hub-form-group">
                    <label class="hub-form-label">Photo (optional)</label>
                    <div class="hub-upload-zone" id="thread-upload-zone">
                        <input type="file" id="thread-upload-input" accept="image/jpeg,image/png,image/webp" hidden>
                        <span class="hub-upload-zone__icon">📁</span>
                        <span class="hub-upload-zone__text">${esc(t('listing_upload_hint'))}</span>
                    </div>
                    <div class="hub-upload-grid" id="thread-upload-grid"></div>
                </div>
                <div class="hub-modal__footer" style="padding:0;border:none">
                    <button type="button" class="hub-btn hub-btn--secondary hub-modal__cancel">Cancel</button>
                    <button type="submit" class="hub-btn hub-btn--primary">Publish</button>
                </div>
            </form>
        </div>`;

    document.body.appendChild(overlay);
    initHubSelects(overlay);
    const close = () => { cleanupHubSelects(overlay); overlay.remove(); };
    overlay.querySelector('.hub-modal__close').addEventListener('click', close);
    overlay.querySelector('.hub-modal__cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    let selectedThreadImage = null;
    const threadUploadZone = overlay.querySelector('#thread-upload-zone');
    const threadUploadInput = overlay.querySelector('#thread-upload-input');
    const threadUploadGrid = overlay.querySelector('#thread-upload-grid');

    function setThreadImage(file) {
        selectedThreadImage = file;
        threadUploadGrid.innerHTML = file
            ? `<div class="hub-upload-thumb"><img src="${URL.createObjectURL(file)}" alt=""><button type="button" class="hub-upload-thumb__remove">&times;</button></div>`
            : '';
    }

    threadUploadZone.addEventListener('click', () => threadUploadInput.click());
    threadUploadInput.addEventListener('change', () => {
        if (threadUploadInput.files[0]) setThreadImage(threadUploadInput.files[0]);
        threadUploadInput.value = '';
    });
    threadUploadZone.addEventListener('dragover', e => { e.preventDefault(); threadUploadZone.classList.add('hub-upload-zone--drag'); });
    threadUploadZone.addEventListener('dragleave', () => threadUploadZone.classList.remove('hub-upload-zone--drag'));
    threadUploadZone.addEventListener('drop', e => {
        e.preventDefault();
        threadUploadZone.classList.remove('hub-upload-zone--drag');
        if (e.dataTransfer.files[0]) setThreadImage(e.dataTransfer.files[0]);
    });
    threadUploadGrid.addEventListener('click', e => { if (e.target.closest('.hub-upload-thumb__remove')) setThreadImage(null); });

    overlay.querySelector('#new-thread-form').addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target, btn = f.querySelector('[type="submit"]');
        btn.disabled = true;

        let imageKey = null;
        if (selectedThreadImage) {
            try {
                const presign = await api('POST', '/uploads/presign', {
                    kind: 'forum', contentType: selectedThreadImage.type, fileSize: selectedThreadImage.size,
                });
                if (presign.success) {
                    const putRes = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': selectedThreadImage.type }, body: selectedThreadImage });
                    if (putRes.ok) imageKey = presign.key;
                }
            } catch (err) {
                console.error('Thread image upload failed:', err);
            }
        }

        try {
            const res = await api('POST', `/forum/${S.console}/threads`, {
                title: f.title.value.trim(), body: f.body.value.trim(), tag: f.tag.value, image_key: imageKey,
            });
            if (res.success) {
                close();
                window.dispatchEvent(new CustomEvent('cn:message-sent'));
                loadThreads();
            }
            else { btn.disabled = false; showToast(res.error || 'Error.', 'error'); }
        } catch (err) {
            console.error('Thread publish failed:', err);
            btn.disabled = false;
            showToast(t('listing_generic_error'), 'error');
        }
    });
}

/* ================================================================
   MARKETPLACE
   ================================================================ */

/** Render the marketplace view: listing grid, filters, add button */
function renderMarketplace() {
    const v = document.getElementById('view-marketplace');
    cleanupHubSelects(v); // destroy existing custom selects before wiping innerHTML
    const u = user();

    // Count active filters (excluding sort and search)
    const activeFilters = [S.marketCondition, S.marketConsole, S.marketCountry, S.marketCity].filter(Boolean).length;

    v.innerHTML = `
        <div class="hub-view-header">
            <div class="hub-view-header__title">🛒 Marketplace</div>
            <div style="display:flex;gap:8px">
                ${u ? '<button class="hub-btn hub-btn--primary hub-market-add-btn" id="market-add-btn"><span class="hub-market-add-btn__text">+ New listing</span><span class="hub-market-add-btn__icon">+</span></button>' : ''}
                <select class="hub-market-select" id="market-sort" style="min-width:130px">
                    <option value="newest" ${S.marketSort==='newest'?'selected':''}>Newest</option>
                    <option value="oldest" ${S.marketSort==='oldest'?'selected':''}>Oldest</option>
                    <option value="price_asc" ${S.marketSort==='price_asc'?'selected':''}>Price ↑</option>
                    <option value="price_desc" ${S.marketSort==='price_desc'?'selected':''}>Price ↓</option>
                </select>
            </div>
        </div>

        <div class="hub-market-topbar">
            <input class="hub-market-search" id="market-search" placeholder="Search listings…" value="${esc(S.marketSearch)}">
            <button class="hub-btn hub-btn--secondary hub-filter-toggle-btn" id="market-filter-btn">
                ⚙️ Filters
                ${activeFilters > 0 ? `<span class="hub-filter-badge">${activeFilters}</span>` : ''}
            </button>
        </div>

        <!-- Filter Drawer Overlay -->
        <div class="hub-filter-overlay" id="filter-overlay" hidden></div>

        <!-- Filter Drawer -->
        <div class="hub-filter-drawer" id="filter-drawer">
            <div class="hub-filter-drawer__header">
                <span class="hub-filter-drawer__title">⚙️ Filters</span>
                <button class="hub-filter-drawer__close" id="filter-close">&times;</button>
            </div>
            <div class="hub-filter-drawer__body">

                <div class="hub-filter-section">
                    <div class="hub-filter-section__label">Condition</div>
                    <select class="hub-form-select" id="market-condition">
                        <option value="">All</option>
                        ${Object.entries(CONDITIONS).map(([k, val]) => `<option value="${k}" ${S.marketCondition===k?'selected':''}>${esc(t(val))}</option>`).join('')}
                    </select>
                </div>

                <div class="hub-filter-section">
                    <div class="hub-filter-section__label">Console</div>
                    <select class="hub-form-select" id="market-console">
                        <option value="">All</option>
                        ${(window.CONSOLES_DATA || []).slice().sort((a, b) => a.name.localeCompare(b.name)).map(c => `<option value="${c.id}" ${S.marketConsole===c.id?'selected':''}>${c.name}</option>`).join('')}
                    </select>
                </div>

                <div class="hub-filter-section">
                    <div class="hub-filter-section__label">Country</div>
                    <select class="hub-form-select" id="market-country">
                        <option value="">All countries</option>
                        ${window.LOCATION_DATA.countries.map(c => `<option value="${c.code}" ${S.marketCountry===c.code?'selected':''}>${esc(countryLabel(c))}</option>`).join('')}
                    </select>
                </div>

                <div class="hub-filter-section">
                    <div class="hub-filter-section__label">City</div>
                    <select class="hub-form-select" id="market-city" ${!S.marketCountry ? 'disabled' : ''}>
                        <option value="">All cities</option>
                        ${S.marketCountry
                            ? (window.LOCATION_DATA.countries.find(c => c.code === S.marketCountry)?.cities || [])
                            .map(city => `<option value="${city}" ${S.marketCity===city?'selected':''}>${esc(cityLabel(city))}</option>`).join('')
                            : ''}
                    </select>
                    ${!S.marketCountry ? '<div class="hub-filter-hint">Select a country first</div>' : ''}
                </div>

            </div>
            <div class="hub-filter-drawer__footer">
                <button class="hub-btn hub-btn--secondary" id="filter-reset">Reset</button>
                <button class="hub-btn hub-btn--primary" id="filter-apply">Apply filters</button>
            </div>
        </div>

        <div class="hub-market-grid" id="market-grid">
            <div class="hub-empty"><div class="hub-empty__icon">⏳</div>Loading…</div>
        </div>
        <div class="hub-market-pagination" id="market-pagination"></div>`;

    // ── Search ──
    let timer;
    v.querySelector('#market-search').addEventListener('input', e => {
        clearTimeout(timer);
        timer = setTimeout(() => { S.marketSearch = e.target.value.trim(); S.marketPage = 1; loadListings(); }, 300);
    });

    // ── Sort ──
    v.querySelector('#market-sort').addEventListener('change', e => { S.marketSort = e.target.value; S.marketPage = 1; loadListings(); });

    // ── Filter drawer open/close ──
    const drawer = v.querySelector('#filter-drawer');
    const overlay = v.querySelector('#filter-overlay');

    const openDrawer = () => { drawer.classList.add('hub-filter-drawer--open'); overlay.hidden = false; };
    const closeDrawer = () => { drawer.classList.remove('hub-filter-drawer--open'); overlay.hidden = true; };

    v.querySelector('#market-filter-btn').addEventListener('click', openDrawer);
    v.querySelector('#filter-close').addEventListener('click', closeDrawer);
    overlay.addEventListener('click', closeDrawer);

    // ── Country → populate cities ──
    v.querySelector('#market-country').addEventListener('change', e => {
    const code = e.target.value;
    const citySelect = v.querySelector('#market-city');
    const hint = v.querySelector('.hub-filter-hint');
    const country = window.LOCATION_DATA.countries.find(c => c.code === code);
    citySelect.innerHTML = '<option value="">All cities</option>' +
        (country?.cities || []).map(city => `<option value="${city}">${esc(cityLabel(city))}</option>`).join('');
    citySelect.disabled = !code;
    if (hint) hint.style.display = code ? 'none' : 'block';
    });

    // ── Apply filters ──
    v.querySelector('#filter-apply').addEventListener('click', () => {
        S.marketCondition = v.querySelector('#market-condition').value;
        S.marketConsole   = v.querySelector('#market-console').value;
        S.marketCountry   = v.querySelector('#market-country').value;
        S.marketCity      = v.querySelector('#market-city').value;
        S.marketPage = 1;
        closeDrawer();
        renderMarketplace(); // re-render to update badge count
        loadListings();
    });

    // ── Reset filters ──
    v.querySelector('#filter-reset').addEventListener('click', () => {
        S.marketCondition = ''; S.marketConsole = ''; S.marketCountry = ''; S.marketCity = '';
        S.marketPage = 1;
        closeDrawer();
        renderMarketplace();
        loadListings();
    });

    v.querySelector('#market-add-btn')?.addEventListener('click', openAddListingModal);

    // ── Grid click handler — delegated once per render to avoid accumulation on loadListings re-calls ──
    const grid = v.querySelector('#market-grid');
    grid.addEventListener('click', async e => {
        const u = user();
        const favBtn = e.target.closest('.hub-listing-fav-btn');
        if (favBtn) {
            e.stopPropagation();
            if (!u) { showToast('Log in to save favorites'); return; }
            const lid = +favBtn.dataset.favId;
            favBtn.classList.add('hub-listing-fav-btn--pop');
            const res = await api('POST', `/marketplace/listings/${lid}/favorite`);
            if (res.success) {
                if (res.favorited) { S.favoriteIds.add(lid); favBtn.innerHTML = '❤️'; favBtn.classList.add('hub-listing-fav-btn--active'); }
                else { S.favoriteIds.delete(lid); favBtn.innerHTML = '🤍'; favBtn.classList.remove('hub-listing-fav-btn--active'); }
            } else {
                showToast(res.error || 'Could not update favorites.', 'error');
            }
            setTimeout(() => favBtn.classList.remove('hub-listing-fav-btn--pop'), 300);
            return;
        }
        const c = e.target.closest('.hub-listing-card');
        if (c) openListingDetail(+c.dataset.id);
    });

    // ── Pagination click handler — delegated once per render ──
    const pag = v.querySelector('#market-pagination');
    pag.addEventListener('click', e => {
        const b = e.target.closest('.hub-page-btn');
        if (b) { S.marketPage = +b.dataset.page; loadListings(); }
    });

    // ── Custom dropdowns ──
    initHubSelects(v);
}

/** Fetch and display marketplace listings with condition/category filters */
async function loadListings() {
    const grid = document.getElementById('market-grid');
    const pag  = document.getElementById('market-pagination');

    const u = user();
    const p = new URLSearchParams();
    if (S.category)        p.set('category',  S.category);
    if (S.marketCondition) p.set('condition',  S.marketCondition);
    if (S.marketConsole)   p.set('console_type', S.marketConsole);
    if (S.marketSearch)    p.set('search',     S.marketSearch);
    if (S.marketCountry)   p.set('country',    S.marketCountry);
    if (S.marketCity)      p.set('city',       S.marketCity);
    p.set('sort', S.marketSort);
    p.set('page', S.marketPage);

    // Fetch listings and favorite IDs in parallel
    try {
        const [data, favData] = await Promise.all([
            api('GET', '/marketplace/listings?' + p),
            u ? api('GET', '/marketplace/favorites/ids') : Promise.resolve(null),
        ]);
        if (favData && favData.success) S.favoriteIds = new Set(favData.ids);
        if (!data.success) throw 0;
        const listings = data.listings || [];

        if (!listings.length) {
            grid.innerHTML = `<div class="hub-empty" style="grid-column:1/-1"><div class="hub-empty__icon">🛒</div>No listings${S.marketSearch ? ' for “' + esc(S.marketSearch) + '"' : ''}.</div>`;
            pag.innerHTML = '';
            return;
        }

        grid.innerHTML = listings.map(l => {
            const imgs = Array.isArray(l.images) ? l.images : [];
            const isFav = S.favoriteIds.has(l.id);
            return `
                <button class="hub-listing-card" data-id="${l.id}">
                    <div class="hub-listing-img">
                        ${imgs[0] ? `<img src="${esc(imgs[0])}" alt="" loading="lazy">` : `<img src="${NO_IMAGE_PLACEHOLDER}" alt="" loading="lazy" class="hub-listing-img__placeholder-img">`}
                        ${l.sold ? '<div class="hub-listing-sold-overlay"><span class="hub-listing-sold-badge">SOLD</span></div>' : ''}
                        <span class="hub-listing-fav-btn${isFav ? ' hub-listing-fav-btn--active' : ''}" data-fav-id="${l.id}" title="${u ? (isFav ? 'Remove from favorites' : 'Add to favorites') : 'Log in for favorites'}">
                            ${isFav ? '❤️' : '🤍'}
                        </span>
                    </div>
                    <div class="hub-listing-info">
                        <div class="hub-listing-info__title">${esc(l.title)}</div>
                        <div class="hub-listing-info__price">${Number(l.price).toFixed(0)} RON</div>
                        ${l.description ? `<div class="hub-listing-info__desc">${esc(l.description.slice(0, 100))}${l.description.length > 100 ? '…' : ''}</div>` : ''}
                        <div class="hub-listing-info__meta">
                            <span class="hub-condition hub-condition--${l.condition}">${CONDITIONS[l.condition] ? esc(t(CONDITIONS[l.condition])) : esc(l.condition)}</span>
                            <span class="hub-listing-info__seller">${esc(l.seller_name)}${l.location ? ' · ' + esc(cityLabel(l.location)) : ''}</span>
                            ${l.seller_is_official ? `<span class="hub-official-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>${I18nModule.t('marketplace_official_badge')}</span>` : ''}
                        </div>
                    </div>
                </button>`;
        }).join('');

        const total = data.totalPages || 1;
        pag.innerHTML = total > 1
            ? Array.from({ length: total }, (_, i) => i + 1).map(pg =>
                `<button class="hub-page-btn${pg === S.marketPage ? ' hub-page-btn--active' : ''}" data-page="${pg}">${pg}</button>`).join('')
            : '';
    } catch { grid.innerHTML = '<div class="hub-empty" style="grid-column:1/-1"><div class="hub-empty__icon">❌</div>Failed to load.</div>'; }
}

/** Open listing detail view with contact/DM options */
function renderStars(rating) {
    const full = Math.round(rating);
    return Array.from({ length: 5 }, (_, i) => i < full ? '★' : '☆').join('');
}

/** Loads + renders the seller's review summary/list/form inside a listing's detail view */
async function loadSellerReviews(sellerId, viewEl) {
    const card = viewEl.querySelector('#seller-reviews-card');
    const summaryEl = viewEl.querySelector('#seller-rating-summary');
    if (!card) return;

    try {
        const data = await api('GET', `/marketplace/sellers/${sellerId}/reviews`);
        if (!data.success) throw 0;

        if (summaryEl) summaryEl.textContent = data.count ? `⭐ ${data.average} (${data.count})` : 'Seller';

        const u = user();
        const canReview = u && u.id !== sellerId;

        const reviewsHtml = data.reviews.length
            ? data.reviews.map(r => `
                <div class="hub-seller-review">
                    <div class="hub-seller-review__head">
                        <strong>${esc(r.reviewer_username)}</strong>
                        <span>${renderStars(r.rating)}</span>
                    </div>
                    ${r.comment ? `<p class="hub-seller-review__comment">${esc(r.comment)}</p>` : ''}
                </div>`).join('')
            : `<p class="hub-seller-reviews__empty">${I18nModule.t('reviews_empty')}</p>`;

        card.innerHTML = `
            <h3 class="hub-seller-reviews__title">${I18nModule.t('reviews_title')}${data.count ? ` · ⭐ ${data.average} (${data.count})` : ''}</h3>
            ${canReview ? `
                <div class="hub-seller-review-form">
                    <div class="rating-interactive" id="seller-review-stars">
                        ${[1, 2, 3, 4, 5].map(i => `<button type="button" class="star-btn${data.userRating && i <= data.userRating.rating ? ' active' : ''}" data-value="${i}">★</button>`).join('')}
                    </div>
                    <textarea id="seller-review-comment" placeholder="${I18nModule.t('reviews_comment_placeholder')}" maxlength="1000">${data.userRating ? esc(data.userRating.comment) : ''}</textarea>
                    <button class="hub-btn hub-btn--primary" id="seller-review-submit">${I18nModule.t('reviews_submit')}</button>
                </div>` : ''}
            <div class="hub-seller-reviews__list">${reviewsHtml}</div>
        `;

        if (canReview) {
            let selectedRating = data.userRating ? data.userRating.rating : 0;
            const stars = card.querySelectorAll('#seller-review-stars .star-btn');
            stars.forEach(btn => {
                btn.addEventListener('mouseenter', () => {
                    const val = parseInt(btn.dataset.value);
                    stars.forEach(b => b.classList.toggle('hover', parseInt(b.dataset.value) <= val));
                });
                btn.addEventListener('mouseleave', () => stars.forEach(b => b.classList.remove('hover')));
                btn.addEventListener('click', () => {
                    selectedRating = parseInt(btn.dataset.value);
                    stars.forEach(b => b.classList.toggle('active', parseInt(b.dataset.value) <= selectedRating));
                });
            });
            card.querySelector('#seller-review-submit').addEventListener('click', async () => {
                if (!selectedRating) { showToast(I18nModule.t('reviews_select_rating'), 'error'); return; }
                const comment = card.querySelector('#seller-review-comment').value.trim();
                const res = await api('POST', `/marketplace/sellers/${sellerId}/review`, { rating: selectedRating, comment, listingId: S.listingId });
                if (res.success) {
                    showToast(I18nModule.t('reviews_thanks'));
                    loadSellerReviews(sellerId, viewEl);
                } else {
                    showToast(res.error || 'Error', 'error');
                }
            });
        }
    } catch {
        card.innerHTML = '';
    }
}

async function openListingDetail(id) {
    S.listingId = id;
    showView('listing');
    const v = document.getElementById('view-listing');
    v.innerHTML = '<div class="hub-empty"><div class="hub-empty__icon">⏳</div>Loading…</div>';

    try {
        const data = await api('GET', `/marketplace/listings/${id}`);
        if (!data.success) throw 0;
        const l = data.listing, u = user(), own = u && u.id === l.seller_id;
        const imgs = Array.isArray(l.images) ? l.images : [];
        const isFavDetail = S.favoriteIds.has(l.id);
        console.log('[Marketplace] Listing detail:', l);

        // Increment view count (non-owners only, fire-and-forget)
        if (!own) api('PATCH', `/marketplace/listings/${id}/view`).catch(() => {});

        v.innerHTML = `
            <div class="hub-view-header">
                <button class="hub-view-header__back" id="listing-back">← Marketplace</button>
            </div>
            <div class="hub-detail-scroll">
                <div class="hub-detail-inner">
                    ${imgs.length ? `
                        <div class="hub-detail-gallery" id="listing-gallery">
                            <div class="hub-detail-main-img" id="listing-main-img">
                                <img src="${esc(imgs[0])}" alt="">
                                ${imgs.length > 1 ? `
                                    <button class="hub-gallery-arrow hub-gallery-arrow--left" id="gallery-prev" aria-label="Previous image">‹</button>
                                    <button class="hub-gallery-arrow hub-gallery-arrow--right" id="gallery-next" aria-label="Next image">›</button>
                                    <span class="hub-gallery-counter" id="gallery-counter">1 / ${imgs.length}</span>` : ''}
                            </div>
                            ${imgs.length > 1 ? `<div class="hub-detail-thumbs">${imgs.map((im, i) =>
                                `<button class="hub-detail-thumb${i === 0 ? ' hub-detail-thumb--active' : ''}" data-idx="${i}"><img src="${esc(im)}" alt=""></button>`).join('')}</div>` : ''}
                        </div>` : `
                        <div class="hub-detail-gallery">
                            <div class="hub-detail-main-img hub-detail-main-img--placeholder">
                                <span class="hub-placeholder-icon">🖼️</span>
                                <span class="hub-placeholder-text">No photos</span>
                            </div>
                        </div>`}
                    <div class="hub-detail-card hub-detail-card--main">
                        <div class="hub-detail-body">
                            <div class="hub-detail-top">
                                <div style="flex:1;min-width:0">
                                    <h2 class="hub-detail-title">${esc(l.title)}</h2>
                                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px">
                                        <span class="hub-condition hub-condition--${l.condition}">${CONDITIONS[l.condition] ? esc(t(CONDITIONS[l.condition])) : esc(l.condition)}</span>
                                        ${CATEGORIES[l.category] ? `<span style="color:var(--text-gray);font-size:.78rem">${esc(t(CATEGORIES[l.category]))}</span>` : ''}
                                    </div>
                                </div>
                                <div class="hub-detail-price">${Number(l.price).toFixed(0)} RON</div>
                            </div>
                            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:8px">
                                ${u && !own && !l.sold ? `<button class="hub-btn hub-btn--primary" id="listing-buy-btn">🛒 ${esc(t('order_buy_button'))}</button>` : '<span></span>'}
                                <button class="hub-detail-fav-btn${isFavDetail ? ' hub-detail-fav-btn--active' : ''}" id="detail-fav-btn" title="${u ? (isFavDetail ? 'Remove from favorites' : 'Add to favorites') : 'Log in for favorites'}">
                                    ${isFavDetail ? '❤️' : '🤍'}
                                </button>
                            </div>
                            <div class="hub-detail-desc" style="margin-top:16px">${esc(l.description)}</div>
                            ${l.location ? `<div class="hub-detail-location" style="margin-top:10px">📍 ${esc(cityLabel(l.location))}</div>` : ''}
                            <div class="hub-detail-date" style="margin-top:6px">Publicat ${timeAgo(l.created_at)}</div>
                        </div>
                    </div>
                    <div class="hub-detail-card hub-detail-card--seller">
                        <div class="hub-detail-seller-info">
                            <div class="hub-detail-seller-avatar">${avatarHtml(l.seller_name, l.seller_avatar, 48)}</div>
                            <div class="hub-detail-seller-meta">
                                <div class="hub-detail-seller-name">${esc(l.seller_name)}${l.seller_is_official ? `<span class="hub-official-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>${I18nModule.t('marketplace_official_badge')}</span>` : ''}</div>
                                <div class="hub-detail-seller-sub" id="seller-rating-summary">Seller</div>
                            </div>
                        </div>
                        <div class="hub-detail-seller-actions">
                            ${u && !own ? '<button class="hub-btn hub-btn--primary" id="listing-dm-btn">💬 Contact</button>' : ''}
                            ${u ? '<button class="hub-btn hub-btn--secondary" id="listing-share-btn">🔗 Share</button>' : ''}
                            ${u && !own ? `<button class="hub-btn hub-btn--secondary report-trigger-btn" id="listing-report-btn" data-report-type="listing" data-report-id="${l.id}" data-report-preview="${esc(l.title)}">${I18nModule.t('report_btn_trigger_listing')}</button>` : ''}
                        </div>
                    </div>
                    <div class="hub-detail-card hub-detail-card--reviews" id="seller-reviews-card">
                        <div class="hub-seller-reviews__loading">⏳</div>
                    </div>
                    <div class="hub-detail-actions">
                        ${l.phone   ? `<a href="tel:${esc(l.phone)}" class="hub-btn hub-btn--secondary">📞 ${esc(l.phone)}</a>` : ''}
                        ${l.olx_url ? `<a href="${esc(l.olx_url)}" target="_blank" rel="noopener noreferrer" class="hub-btn hub-btn--secondary">🔗 OLX</a>` : ''}
                        ${l.ebay_url ? `<a href="${esc(l.ebay_url)}" target="_blank" rel="noopener noreferrer" class="hub-btn hub-btn--secondary">🔗 eBay</a>` : ''}
                        ${own && !l.sold ? '<button class="hub-btn hub-btn--primary" id="listing-sold-btn">✓ Mark as sold</button>' : ''}
                        ${own && !l.sold ? `<button class="hub-btn hub-btn--secondary" id="listing-active-btn" data-inactive="${l.status === 'inactive'}">${l.status === 'inactive' ? '🔒 Mark as available' : '🚫 Mark as unavailable'}</button>` : ''}
                        ${own ? '<button class="hub-btn hub-btn--secondary" id="listing-edit-btn">✏️ Edit</button>' : ''}
                        ${own ? '<button class="hub-btn hub-btn--danger" id="listing-del-btn">Delete</button>' : ''}
                    </div>
                    <div class="hub-similar-section" id="similar-section">
                        <h3 class="hub-similar-section__title">📋 Similar listings</h3>
                        <div class="hub-similar-grid" id="similar-grid">
                            ${Array.from({length:4}, () => '<div class="hub-listing-card hub-listing-card--skeleton"><div class="hub-listing-img"></div><div class="hub-listing-info"><div class="hub-skeleton-line" style="width:60%"></div><div class="hub-skeleton-line" style="width:80%"></div><div class="hub-skeleton-line" style="width:40%"></div></div></div>').join('')}
                        </div>
                    </div>
                </div>
            </div>`;

        v.querySelector('#listing-back').addEventListener('click', () => { showView('marketplace'); renderMarketplace(); loadListings(); });

        // Gallery navigation state
        let currentImgIdx = 0;
        const updateGalleryImg = (idx) => {
            if (!imgs.length) return;
            currentImgIdx = ((idx % imgs.length) + imgs.length) % imgs.length;
            v.querySelector('#listing-main-img img').src = imgs[currentImgIdx];
            v.querySelectorAll('.hub-detail-thumb').forEach((t, i) => {
                t.classList.toggle('hub-detail-thumb--active', i === currentImgIdx);
            });
            const counter = v.querySelector('#gallery-counter');
            if (counter) counter.textContent = `${currentImgIdx + 1} / ${imgs.length}`;
        };

        v.querySelector('#gallery-prev')?.addEventListener('click', (e) => { e.stopPropagation(); updateGalleryImg(currentImgIdx - 1); });
        v.querySelector('#gallery-next')?.addEventListener('click', (e) => { e.stopPropagation(); updateGalleryImg(currentImgIdx + 1); });

        v.querySelectorAll('.hub-detail-thumb').forEach(thumb => {
            thumb.addEventListener('click', () => updateGalleryImg(+thumb.dataset.idx));
        });

        // ── Fullscreen lightbox (OLX-style) ──
        if (imgs.length) {
            const mainImg = v.querySelector('#listing-main-img');
            mainImg.style.cursor = 'zoom-in';
            mainImg.addEventListener('click', (e) => {
                if (e.target.closest('.hub-gallery-arrow') || e.target.closest('.hub-gallery-counter')) return;
                openLightbox(imgs, currentImgIdx);
            });
        }

        function openLightbox(images, startIdx) {
            let lbIdx = startIdx;
            const lb = document.createElement('div');
            lb.className = 'hub-lightbox';
            lb.innerHTML = `
                <div class="hub-lightbox__backdrop"></div>
                <button class="hub-lightbox__close" aria-label="Close">✕</button>
                <span class="hub-lightbox__counter">${lbIdx + 1} / ${images.length}</span>
                <img class="hub-lightbox__img" src="${images[lbIdx]}" alt="">
                ${images.length > 1 ? `
                    <button class="hub-lightbox__arrow hub-lightbox__arrow--left" aria-label="Previous">‹</button>
                    <button class="hub-lightbox__arrow hub-lightbox__arrow--right" aria-label="Next">›</button>` : ''}`;
            document.body.appendChild(lb);
            document.body.classList.add('modal-open');
            requestAnimationFrame(() => lb.classList.add('hub-lightbox--visible'));

            const lbImg = lb.querySelector('.hub-lightbox__img');
            const lbCounter = lb.querySelector('.hub-lightbox__counter');

            const goTo = (idx) => {
                lbIdx = ((idx % images.length) + images.length) % images.length;
                lbImg.src = images[lbIdx];
                lbCounter.textContent = `${lbIdx + 1} / ${images.length}`;
                updateGalleryImg(lbIdx);
            };

            const close = () => {
                lb.classList.remove('hub-lightbox--visible');
                setTimeout(() => { lb.remove(); document.body.classList.remove('modal-open'); }, 250);
            };

            lb.querySelector('.hub-lightbox__close').addEventListener('click', close);
            lb.querySelector('.hub-lightbox__backdrop').addEventListener('click', close);
            lb.querySelector('.hub-lightbox__arrow--left')?.addEventListener('click', () => goTo(lbIdx - 1));
            lb.querySelector('.hub-lightbox__arrow--right')?.addEventListener('click', () => goTo(lbIdx + 1));

            const onKey = (e) => {
                if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
                else if (e.key === 'ArrowLeft') goTo(lbIdx - 1);
                else if (e.key === 'ArrowRight') goTo(lbIdx + 1);
            };
            document.addEventListener('keydown', onKey);
            lb.addEventListener('transitionend', () => { if (!lb.classList.contains('hub-lightbox--visible')) document.removeEventListener('keydown', onKey); });

            // Swipe support
            let touchStartX = 0;
            lb.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].clientX; }, { passive: true });
            lb.addEventListener('touchend', (e) => {
                const dx = e.changedTouches[0].clientX - touchStartX;
                if (Math.abs(dx) > 50) { dx > 0 ? goTo(lbIdx - 1) : goTo(lbIdx + 1); }
            });
        }

        v.querySelector('#listing-report-btn')?.addEventListener('click', () => {
            if (typeof window.openReportModal === 'function') {
                window.openReportModal({
                    contentType: 'listing',
                    contentId:   String(l.id),
                    contentPreview: l.title,
                });
            }
        });

        v.querySelector('#listing-dm-btn')?.addEventListener('click', () => {
            S.dmPartner = l.seller_id;
            navigate('dm');
            setTimeout(() => openConversation(l.seller_id, l.seller_name), 250);
        });

        v.querySelector('#listing-share-btn')?.addEventListener('click', async () => {
            const shareUrl = `${location.origin}/html/pages/community.html#listing-${id}`;
            const result = await shareOrCopy({ title: l.title, text: l.title, url: shareUrl });
            if (result === 'copied') showToast(I18nModule.t('share_link_copied'));
        });

        loadSellerReviews(l.seller_id, v);

        v.querySelector('#listing-sold-btn')?.addEventListener('click', async () => {
            if ((await api('PATCH', `/marketplace/listings/${id}/sold`)).success) openListingDetail(id);
        });

        v.querySelector('#listing-active-btn')?.addEventListener('click', async e => {
            const wasInactive = e.currentTarget.dataset.inactive === 'true';
            const res = await api('PATCH', `/marketplace/listings/${id}/status`, { status: wasInactive ? 'active' : 'inactive' });
            if (res.success) openListingDetail(id);
        });

        v.querySelector('#listing-del-btn')?.addEventListener('click', async () => {
            if (!(await confirmModal('Are you sure you want to delete this listing?'))) return;
            if ((await api('DELETE', `/marketplace/listings/${id}`)).success) { showView('marketplace'); renderMarketplace(); loadListings(); }
        });

        v.querySelector('#listing-edit-btn')?.addEventListener('click', () => {
            openEditListingFromDetail(id, l);
        });

        v.querySelector('#listing-buy-btn')?.addEventListener('click', () => {
            openBuyListingModal(l);
        });

        // Favorite toggle on detail page
        v.querySelector('#detail-fav-btn')?.addEventListener('click', async () => {
            if (!u) { showToast('Log in to save favorites'); return; }
            const btn = v.querySelector('#detail-fav-btn');
            btn.classList.add('hub-detail-fav-btn--pop');
            const res = await api('POST', `/marketplace/listings/${id}/favorite`);
            if (res.success) {
                if (res.favorited) { S.favoriteIds.add(id); btn.innerHTML = '❤️'; btn.classList.add('hub-detail-fav-btn--active'); }
                else { S.favoriteIds.delete(id); btn.innerHTML = '🤍'; btn.classList.remove('hub-detail-fav-btn--active'); }
            } else {
                showToast(res.error || 'Could not update favorites.', 'error');
            }
            setTimeout(() => btn.classList.remove('hub-detail-fav-btn--pop'), 300);
        });

        // Load similar listings
        loadSimilarListings(id, v);

    } catch { v.innerHTML = '<div class="hub-empty"><div class="hub-empty__icon">❌</div>Failed to load.</div>'; }
}

/** Fetch and render similar listings below the detail view */
async function loadSimilarListings(listingId, container) {
    const section = container.querySelector('#similar-section');
    const grid = container.querySelector('#similar-grid');
    try {
        const data = await api('GET', `/marketplace/listings/${listingId}/similar`);
        if (!data.success || !data.listings || data.listings.length === 0) {
            section.hidden = true;
            return;
        }
        const u = user();
        grid.innerHTML = data.listings.map(l => {
            const simImgs = Array.isArray(l.images) ? l.images : [];
            const isFav = S.favoriteIds.has(l.id);
            return `
                <button class="hub-listing-card" data-id="${l.id}">
                    <div class="hub-listing-img">
                        ${simImgs[0] ? `<img src="${esc(simImgs[0])}" alt="" loading="lazy">` : `<img src="${NO_IMAGE_PLACEHOLDER}" alt="" loading="lazy" class="hub-listing-img__placeholder-img">`}
                        <span class="hub-listing-fav-btn${isFav ? ' hub-listing-fav-btn--active' : ''}" data-fav-id="${l.id}" title="${u ? (isFav ? 'Remove from favorites' : 'Add to favorites') : 'Log in for favorites'}">
                            ${isFav ? '❤️' : '🤍'}
                        </span>
                    </div>
                    <div class="hub-listing-info">
                        <div class="hub-listing-info__title">${esc(l.title)}</div>
                        <div class="hub-listing-info__price">${Number(l.price).toFixed(0)} RON</div>
                        <div class="hub-listing-info__meta">
                            <span class="hub-condition hub-condition--${l.condition}">${CONDITIONS[l.condition] ? esc(t(CONDITIONS[l.condition])) : esc(l.condition)}</span>
                            <span class="hub-listing-info__seller">${esc(l.seller_name)}${l.location ? ' · ' + esc(cityLabel(l.location)) : ''}</span>
                            ${l.seller_is_official ? `<span class="hub-official-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>${I18nModule.t('marketplace_official_badge')}</span>` : ''}
                        </div>
                    </div>
                </button>`;
        }).join('');

        // Click handlers for similar listing cards
        grid.addEventListener('click', async e => {
            const favBtn = e.target.closest('.hub-listing-fav-btn');
            if (favBtn) {
                e.stopPropagation();
                if (!u) { showToast('Log in to save favorites'); return; }
                const lid = +favBtn.dataset.favId;
                favBtn.classList.add('hub-listing-fav-btn--pop');
                const res = await api('POST', `/marketplace/listings/${lid}/favorite`);
                if (res.success) {
                    if (res.favorited) { S.favoriteIds.add(lid); favBtn.innerHTML = '❤️'; favBtn.classList.add('hub-listing-fav-btn--active'); }
                    else { S.favoriteIds.delete(lid); favBtn.innerHTML = '🤍'; favBtn.classList.remove('hub-listing-fav-btn--active'); }
                } else {
                    showToast(res.error || 'Could not update favorites.', 'error');
                }
                setTimeout(() => favBtn.classList.remove('hub-listing-fav-btn--pop'), 300);
                return;
            }
            const c = e.target.closest('.hub-listing-card');
            if (c) openListingDetail(+c.dataset.id);
        });
    } catch {
        section.hidden = true;
    }
}

/** Open modal dialog to create a new marketplace listing */
function openAddListingModal() {
    const _prev = document.querySelector('.hub-modal-overlay');
    if (_prev) { cleanupHubSelects(_prev); _prev.remove(); }

    const MAX_IMAGES = 8;
    let selectedFiles = [];

    const overlay = document.createElement('div');
    overlay.className = 'hub-modal-overlay';
    overlay.innerHTML = `
        <div class="hub-modal">
            <div class="hub-modal__header">
                <span class="hub-modal__title">${esc(t('listing_new_title'))}</span>
                <button class="hub-modal__close">&times;</button>
            </div>
            <form class="hub-modal__body" id="new-listing-form">
                <div class="hub-form-group">
                    <label class="hub-form-label">${esc(t('listing_field_title'))}</label>
                    <input class="hub-form-input" name="title" maxlength="200" required placeholder="${esc(t('listing_title_placeholder'))}">
                </div>
                <div class="hub-form-row">
                    <div class="hub-form-group">
                        <label class="hub-form-label">${esc(t('listing_field_price'))}</label>
                        <input class="hub-form-input" name="price" type="number" min="0" step="1" required placeholder="0">
                    </div>
                    <div class="hub-form-group">
                        <label class="hub-form-label">${esc(t('listing_field_condition'))}</label>
                        <select class="hub-form-select" name="condition">
                            ${Object.entries(CONDITIONS).map(([k, v]) => `<option value="${k}"${k === 'good' ? ' selected' : ''}>${esc(t(v))}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="hub-form-group">
                    <label class="hub-form-label">${esc(t('listing_field_category'))}</label>
                    <select class="hub-form-select" name="category">
                        ${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${esc(t(v))}</option>`).join('')}
                    </select>
                </div>
                <div class="hub-form-group">
                    <label class="hub-form-label">${esc(t('listing_field_console'))}</label>
                    <select class="hub-form-select" name="console_type">
                        <option value="">${esc(t('listing_console_placeholder'))}</option>
                        ${(window.CONSOLES_DATA || []).slice().sort((a, b) => a.name.localeCompare(b.name)).map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                    </select>
                </div>
                <div class="hub-form-group">
                    <label class="hub-form-label">${esc(t('listing_field_description'))}</label>
                    <textarea class="hub-form-textarea" name="description" maxlength="3000" required rows="4" placeholder="${esc(t('listing_description_placeholder'))}"></textarea>
                </div>
                <div class="hub-form-row">
                    <div class="hub-form-group">
                        <label class="hub-form-label">${esc(t('listing_field_country'))}</label>
                        <select class="hub-form-select" name="country" required>
                            <option value="">${esc(t('listing_country_placeholder'))}</option>
                            ${window.LOCATION_DATA.countries.map(c => `<option value="${c.code}">${esc(countryLabel(c))}</option>`).join('')}
                        </select>
                    </div>
                    <div class="hub-form-group">
                        <label class="hub-form-label">${esc(t('listing_field_city'))}</label>
                        <select class="hub-form-select" name="location" required disabled>
                            <option value="">${esc(t('listing_city_placeholder_before'))}</option>
                        </select>
                    </div>
                </div>
                <div class="hub-form-group">
                    <label class="hub-form-label">${esc(t('listing_field_phone'))}</label>
                    <input class="hub-form-input" name="phone" maxlength="20" required placeholder="+40…">
                </div>
                <div class="hub-form-group">
                    <label class="hub-form-label">${esc(t('listing_field_olx'))}</label>
                    <input class="hub-form-input" name="olx_url" type="url" placeholder="https://www.olx.ro/…">
                </div>
                <div class="hub-form-group">
                    <label class="hub-form-label">${esc(t('listing_field_ebay'))}</label>
                    <input class="hub-form-input" name="ebay_url" type="url" placeholder="https://www.ebay.com/…">
                </div>
                <div class="hub-form-group">
                    <label class="hub-form-label">${esc(t('listing_field_images').replace('{max}', MAX_IMAGES))}</label>
                    <div class="hub-upload-zone" id="upload-zone">
                        <input type="file" id="upload-input" accept="image/jpeg,image/png,image/webp" multiple hidden>
                        <span class="hub-upload-zone__icon">📁</span>
                        <span class="hub-upload-zone__text">${esc(t('listing_upload_hint'))}</span>
                    </div>
                    <div class="hub-upload-counter" id="upload-counter">${esc(t('listing_upload_counter').replace('{count}', '0').replace('{max}', MAX_IMAGES))}</div>
                    <div class="hub-upload-grid" id="upload-grid"></div>
                </div>
                <div class="hub-modal__footer" style="padding:0;border:none">
                    <button type="button" class="hub-btn hub-btn--secondary hub-modal__cancel">${esc(t('tutorial_cancel'))}</button>
                    <button type="submit" class="hub-btn hub-btn--primary">${esc(t('listing_publish'))}</button>
                </div>
            </form>
        </div>`;

    document.body.appendChild(overlay);
    initHubSelects(overlay);
    const close = () => { cleanupHubSelects(overlay); overlay.remove(); };
    overlay.querySelector('.hub-modal__close').addEventListener('click', close);
    overlay.querySelector('.hub-modal__cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('[name="country"]').addEventListener('change', e => {
        const citySelect = overlay.querySelector('[name="location"]');
        const country = window.LOCATION_DATA.countries.find(c => c.code === e.target.value);
        citySelect.innerHTML = `<option value="">${esc(t('listing_city_placeholder'))}</option>` +
            (country?.cities || []).map(c => `<option value="${c}">${esc(cityLabel(c))}</option>`).join('');
        citySelect.disabled = !e.target.value;
    });

    const uploadZone = overlay.querySelector('#upload-zone');
    const uploadInput = overlay.querySelector('#upload-input');
    const uploadGrid = overlay.querySelector('#upload-grid');
    const uploadCounter = overlay.querySelector('#upload-counter');

    function updatePreviews() {
        uploadGrid.innerHTML = '';
        selectedFiles.forEach((file, i) => {
            const thumb = document.createElement('div');
            thumb.className = 'hub-upload-thumb';
            thumb.innerHTML = `<img src="${URL.createObjectURL(file)}" alt=""><button type="button" class="hub-upload-thumb__remove" data-idx="${i}">&times;</button>`;
            uploadGrid.appendChild(thumb);
        });
        uploadCounter.textContent = t('listing_upload_counter').replace('{count}', selectedFiles.length).replace('{max}', MAX_IMAGES);
    }

    function addFiles(files) {
        for (const file of files) {
            if (selectedFiles.length >= MAX_IMAGES) break;
            if (!file.type.match(/^image\/(jpeg|png|webp)$/)) continue;
            if (file.size > 10 * 1024 * 1024) continue;
            selectedFiles.push(file);
        }
        updatePreviews();
    }

    uploadZone.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', () => { addFiles(uploadInput.files); uploadInput.value = ''; });

    uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('hub-upload-zone--drag'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('hub-upload-zone--drag'));
    uploadZone.addEventListener('drop', e => { e.preventDefault(); uploadZone.classList.remove('hub-upload-zone--drag'); addFiles(e.dataTransfer.files); });

    uploadGrid.addEventListener('click', e => {
        const btn = e.target.closest('.hub-upload-thumb__remove');
        if (!btn) return;
        const idx = parseInt(btn.dataset.idx, 10);
        selectedFiles.splice(idx, 1);
        updatePreviews();
    });

    /** Resize an image file to max 800px and return a JPEG Blob */
    function resizeImage(file) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                const MAX = 800;
                let w = img.width, h = img.height;
                if (w > MAX || h > MAX) {
                    if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                    else { w = Math.round(w * MAX / h); h = MAX; }
                }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                canvas.toBlob(blob => { resolve(blob); URL.revokeObjectURL(img.src); }, 'image/jpeg', 0.75);
            };
            img.src = URL.createObjectURL(file);
        });
    }

    /** Upload a resized image blob via a presigned URL, returning its storage key — never throws, returns null on any failure so one bad photo can't block publishing the listing */
    async function uploadListingImage(blob) {
        if (!blob) return null;
        try {
            const presign = await api('POST', '/uploads/presign', { kind: 'listing', contentType: 'image/jpeg', fileSize: blob.size });
            if (!presign.success) return null;
            const putRes = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
            return putRes.ok ? presign.key : null;
        } catch (err) {
            console.error('Listing image upload failed:', err);
            return null;
        }
    }

    overlay.querySelector('#new-listing-form').addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target, btn = f.querySelector('[type="submit"]');
        btn.disabled = true;
        btn.textContent = t('listing_publishing');

        let finalImages = [];
        try {
            const resizedBlobs = await Promise.all(selectedFiles.map(resizeImage));
            finalImages = (await Promise.all(resizedBlobs.map(uploadListingImage))).filter(Boolean);
        } catch (err) {
            console.error('Listing image processing failed:', err);
        }

        // Default image: if no images uploaded but a console is selected, use console image
        if (finalImages.length === 0 && f.console_type.value) {
            const consoleDef = (window.CONSOLES_DATA || []).find(c => c.id === f.console_type.value);
            if (consoleDef && consoleDef.image) finalImages = [consoleDef.image];
        }

        try {
            const res = await api('POST', '/marketplace/listings', {
                title: f.title.value.trim(),
                description: f.description.value.trim(),
                price: parseFloat(f.price.value),
                condition: f.condition.value,
                category: f.category.value,
                console_type: f.console_type.value,
                location: f.location.value.trim(),
                phone: f.phone.value.trim(),
                olx_url: f.olx_url.value.trim(),
                ebay_url: f.ebay_url.value.trim(),
                images: finalImages,
            });
            if (res.success) { close(); loadListings(); }
            else { btn.disabled = false; btn.textContent = t('listing_publish'); showToast(res.error || t('listing_generic_error'), 'error'); }
        } catch (err) {
            console.error('Listing publish failed:', err);
            btn.disabled = false;
            btn.textContent = t('listing_publish');
            showToast(t('listing_generic_error'), 'error');
        }
    });
}


/** Open modal dialog to edit an existing listing (from detail view) */
function openEditListingFromDetail(id, l) {
    const _prev = document.querySelector('.hub-modal-overlay');
    if (_prev) { cleanupHubSelects(_prev); _prev.remove(); }

    const overlay = document.createElement('div');
    overlay.className = 'hub-modal-overlay';
    overlay.innerHTML = `
        <div class="hub-modal">
            <div class="hub-modal__header">
                <span class="hub-modal__title">${esc(t('listing_edit_title'))}</span>
                <button class="hub-modal__close">&times;</button>
            </div>
            <form class="hub-modal__body" id="edit-listing-form">
                <div class="hub-form-group">
                    <label class="hub-form-label">${esc(t('listing_field_title'))}</label>
                    <input class="hub-form-input" name="title" maxlength="200" required value="${esc(l.title)}">
                </div>
                <div class="hub-form-row">
                    <div class="hub-form-group">
                        <label class="hub-form-label">${esc(t('listing_field_price'))}</label>
                        <input class="hub-form-input" name="price" type="number" min="0" step="1" required value="${l.price}">
                    </div>
                    <div class="hub-form-group">
                        <label class="hub-form-label">${esc(t('listing_field_condition'))}</label>
                        <select class="hub-form-select" name="condition">
                            ${Object.entries(CONDITIONS).map(([k, v]) => `<option value="${k}"${k === l.condition ? ' selected' : ''}>${esc(t(v))}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="hub-form-group">
                    <label class="hub-form-label">${esc(t('listing_field_category'))}</label>
                    <select class="hub-form-select" name="category">
                        ${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}"${k === l.category ? ' selected' : ''}>${esc(t(v))}</option>`).join('')}
                    </select>
                </div>
                <div class="hub-form-group">
                    <label class="hub-form-label">${esc(t('listing_field_console'))}</label>
                    <select class="hub-form-select" name="console_type">
                        <option value="">${esc(t('listing_console_placeholder'))}</option>
                        ${(window.CONSOLES_DATA || []).slice().sort((a, b) => a.name.localeCompare(b.name)).map(c => `<option value="${c.id}"${c.id === (l.console_type || '') ? ' selected' : ''}>${c.name}</option>`).join('')}
                    </select>
                </div>
                <div class="hub-form-group">
                    <label class="hub-form-label">${esc(t('listing_field_description'))}</label>
                    <textarea class="hub-form-textarea" name="description" maxlength="3000" required rows="4">${esc(l.description)}</textarea>
                </div>
                <div class="hub-form-row">
                    <div class="hub-form-group">
                        <label class="hub-form-label">${esc(t('listing_field_country'))}</label>
                        <select class="hub-form-select" name="country" required>
                            <option value="">${esc(t('listing_country_placeholder'))}</option>
                            ${(window.LOCATION_DATA?.countries || []).map(c => `<option value="${c.code}"${c.code === (l.country || '') ? ' selected' : ''}>${esc(countryLabel(c))}</option>`).join('')}
                        </select>
                    </div>
                    <div class="hub-form-group">
                        <label class="hub-form-label">${esc(t('listing_field_city'))}</label>
                        <select class="hub-form-select" name="location" required ${!l.country ? 'disabled' : ''}>
                            <option value="">${esc(t('listing_city_placeholder_before'))}</option>
                            ${l.country
                                ? ((window.LOCATION_DATA?.countries || []).find(c => c.code === l.country)?.cities || [])
                                    .map(city => `<option value="${city}"${city === l.location ? ' selected' : ''}>${esc(cityLabel(city))}</option>`).join('')
                                : ''}
                        </select>
                    </div>
                </div>
                <div class="hub-form-group">
                    <label class="hub-form-label">${esc(t('listing_field_phone'))}</label>
                    <input class="hub-form-input" name="phone" maxlength="20" required value="${esc(l.phone || '')}">
                </div>
                <div class="hub-form-group">
                    <label class="hub-form-label">${esc(t('listing_field_olx'))}</label>
                    <input class="hub-form-input" name="olx_url" type="url" value="${esc(l.olx_url || '')}">
                </div>
                <div class="hub-form-group">
                    <label class="hub-form-label">${esc(t('listing_field_ebay'))}</label>
                    <input class="hub-form-input" name="ebay_url" type="url" value="${esc(l.ebay_url || '')}">
                </div>
                <div class="hub-modal__footer" style="padding:0;border:none">
                    <button type="button" class="hub-btn hub-btn--secondary hub-modal__cancel">${esc(t('tutorial_cancel'))}</button>
                    <button type="submit" class="hub-btn hub-btn--primary">${esc(t('tutorial_save'))}</button>
                </div>
            </form>
        </div>`;

    document.body.appendChild(overlay);
    initHubSelects(overlay);
    const close = () => { cleanupHubSelects(overlay); overlay.remove(); };
    overlay.querySelector('.hub-modal__close').addEventListener('click', close);
    overlay.querySelector('.hub-modal__cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // Populate cities on country change
    overlay.querySelector('[name="country"]').addEventListener('change', e => {
        const citySelect = overlay.querySelector('[name="location"]');
        const country = window.LOCATION_DATA?.countries.find(c => c.code === e.target.value);
        citySelect.innerHTML = `<option value="">${esc(t('listing_city_placeholder'))}</option>` +
            (country?.cities || []).map(city => `<option value="${city}">${esc(cityLabel(city))}</option>`).join('');
        citySelect.disabled = !e.target.value;
    });

    overlay.querySelector('#edit-listing-form').addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target, btn = f.querySelector('[type="submit"]');
        btn.disabled = true; btn.textContent = t('listing_saving');
        const res = await api('PUT', `/marketplace/listings/${id}`, {
            title: f.title.value.trim(),
            description: f.description.value.trim(),
            price: parseFloat(f.price.value),
            condition: f.condition.value,
            category: f.category.value,
            console_type: f.console_type.value,
            country: f.country.value,
            location: f.location.value.trim(),
            phone: f.phone.value.trim(),
            olx_url: f.olx_url.value.trim(),
            ebay_url: f.ebay_url.value.trim(),
        });
        if (res.success) { close(); openListingDetail(id); } // reload detail
        else { btn.disabled = false; btn.textContent = t('tutorial_save'); showToast(res.error || t('listing_generic_error'), 'error'); }
    });
}

// Romania's 41 counties + Bucharest — Sameday only ships domestically, so this
// is a plain static list rather than the multi-country LOCATION_DATA used for
// marketplace search filters.
const ROMANIAN_COUNTIES = [
    'Alba', 'Arad', 'Argeș', 'Bacău', 'Bihor', 'Bistrița-Năsăud', 'Botoșani', 'Brăila', 'Brașov',
    'București', 'Buzău', 'Caraș-Severin', 'Călărași', 'Cluj', 'Constanța', 'Covasna', 'Dâmbovița',
    'Dolj', 'Galați', 'Giurgiu', 'Gorj', 'Harghita', 'Hunedoara', 'Ialomița', 'Iași', 'Ilfov',
    'Maramureș', 'Mehedinți', 'Mureș', 'Neamț', 'Olt', 'Prahova', 'Satu Mare', 'Sălaj', 'Sibiu',
    'Suceava', 'Teleorman', 'Timiș', 'Tulcea', 'Vaslui', 'Vâlcea', 'Vrancea'
];
const ORDER_SHIPPING_PRICE = { address: 25, easybox: 20 };

/**
 * Buy modal — no-payment checkout ported to the app's mirror feature request:
 * buyer submits Sameday shipping data (address or Easybox), sees the fixed
 * total (listing price + flat shipping fee), and the order lands in the
 * seller's own "My Orders" queue for manual Sameday AWB creation. Payment
 * itself stays off-platform, arranged directly with the seller.
 */
function openBuyListingModal(l) {
    const _prev = document.querySelector('.hub-modal-overlay');
    if (_prev) { cleanupHubSelects(_prev); _prev.remove(); }

    const overlay = document.createElement('div');
    overlay.className = 'hub-modal-overlay';
    overlay.innerHTML = `
        <div class="hub-modal">
            <div class="hub-modal__header">
                <span class="hub-modal__title">🛒 ${esc(t('order_modal_title'))}</span>
                <button class="hub-modal__close">&times;</button>
            </div>
            <form class="hub-modal__body" id="buy-listing-form">
                <div class="hub-form-row">
                    <div class="hub-form-group">
                        <label class="hub-form-label">${esc(t('order_field_last_name'))}</label>
                        <input class="hub-form-input" name="recipient_last_name" maxlength="100" required>
                    </div>
                    <div class="hub-form-group">
                        <label class="hub-form-label">${esc(t('order_field_first_name'))}</label>
                        <input class="hub-form-input" name="recipient_first_name" maxlength="100" required>
                    </div>
                </div>
                <div class="hub-form-row">
                    <div class="hub-form-group">
                        <label class="hub-form-label">${esc(t('order_field_phone'))}</label>
                        <input class="hub-form-input" name="recipient_phone" type="tel" maxlength="30" required>
                    </div>
                    <div class="hub-form-group">
                        <label class="hub-form-label">${esc(t('order_field_email'))}</label>
                        <input class="hub-form-input" name="recipient_email" type="email" maxlength="150">
                    </div>
                </div>
                <div class="hub-form-group">
                    <label class="hub-form-label">${esc(t('order_field_method'))}</label>
                    <div class="order-method-toggle">
                        <button type="button" class="order-method-btn order-method-btn--active" data-method="address">📍 ${esc(t('order_method_address'))} (+${ORDER_SHIPPING_PRICE.address} RON)</button>
                        <button type="button" class="order-method-btn" data-method="easybox">📦 ${esc(t('order_method_easybox'))} (+${ORDER_SHIPPING_PRICE.easybox} RON)</button>
                    </div>
                </div>
                <div id="buy-address-fields">
                    <div class="hub-form-row">
                        <div class="hub-form-group">
                            <label class="hub-form-label">${esc(t('order_field_county'))}</label>
                            <select class="hub-form-select" name="county">
                                <option value="">${esc(t('order_field_county_placeholder'))}</option>
                                ${ROMANIAN_COUNTIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
                            </select>
                        </div>
                        <div class="hub-form-group">
                            <label class="hub-form-label">${esc(t('order_field_city'))}</label>
                            <input class="hub-form-input" name="city" maxlength="100">
                        </div>
                    </div>
                    <div class="hub-form-group">
                        <label class="hub-form-label">${esc(t('order_field_address'))}</label>
                        <textarea class="hub-form-textarea" name="address" rows="2" maxlength="300"></textarea>
                    </div>
                    <div class="hub-form-group">
                        <label class="hub-form-label">${esc(t('order_field_address2'))}</label>
                        <input class="hub-form-input" name="address_line2" maxlength="150" placeholder="${esc(t('order_field_address2_placeholder'))}">
                    </div>
                </div>
                <div id="buy-easybox-fields" hidden>
                    <div class="hub-form-group">
                        <label class="hub-form-label">${esc(t('order_field_easybox'))}</label>
                        <input class="hub-form-input" name="easybox_name" maxlength="200" placeholder="${esc(t('order_field_easybox_placeholder'))}">
                    </div>
                </div>
                <div class="hub-form-group">
                    <label class="hub-form-label">${esc(t('order_field_notes'))}</label>
                    <textarea class="hub-form-textarea" name="notes" rows="2" maxlength="500"></textarea>
                </div>
                <div class="order-summary">
                    <div class="order-summary__row"><span>${esc(t('order_summary_product'))}</span><span>${Number(l.price).toFixed(0)} RON</span></div>
                    <div class="order-summary__row"><span>${esc(t('order_summary_shipping'))}</span><span id="buy-shipping-price">${ORDER_SHIPPING_PRICE.address} RON</span></div>
                    <div class="order-summary__row order-summary__row--total"><span>${esc(t('order_summary_total'))}</span><span id="buy-total-price">${(Number(l.price) + ORDER_SHIPPING_PRICE.address).toFixed(0)} RON</span></div>
                </div>
                <p class="order-payment-note">💬 ${esc(t('order_payment_note'))}</p>
                <div class="hub-modal__footer" style="padding:0;border:none">
                    <button type="button" class="hub-btn hub-btn--secondary hub-modal__cancel">${esc(t('tutorial_cancel'))}</button>
                    <button type="submit" class="hub-btn hub-btn--primary">${esc(t('order_place_button'))}</button>
                </div>
            </form>
        </div>`;

    document.body.appendChild(overlay);
    initHubSelects(overlay);
    const close = () => { cleanupHubSelects(overlay); overlay.remove(); };
    overlay.querySelector('.hub-modal__close').addEventListener('click', close);
    overlay.querySelector('.hub-modal__cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    let method = 'address';
    const addressFields = overlay.querySelector('#buy-address-fields');
    const easyboxFields = overlay.querySelector('#buy-easybox-fields');
    const shippingEl = overlay.querySelector('#buy-shipping-price');
    const totalEl = overlay.querySelector('#buy-total-price');

    overlay.querySelectorAll('.order-method-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            method = btn.dataset.method;
            overlay.querySelectorAll('.order-method-btn').forEach(b => b.classList.toggle('order-method-btn--active', b === btn));
            addressFields.hidden = method !== 'address';
            easyboxFields.hidden = method !== 'easybox';
            const shipping = ORDER_SHIPPING_PRICE[method];
            shippingEl.textContent = `${shipping} RON`;
            totalEl.textContent = `${(Number(l.price) + shipping).toFixed(0)} RON`;
        });
    });

    overlay.querySelector('#buy-listing-form').addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target, btn = f.querySelector('[type="submit"]');
        btn.disabled = true; btn.textContent = t('order_placing');
        const res = await api('POST', '/orders', {
            listing_id: l.id,
            delivery_method: method,
            recipient_first_name: f.recipient_first_name.value.trim(),
            recipient_last_name: f.recipient_last_name.value.trim(),
            recipient_phone: f.recipient_phone.value.trim(),
            recipient_email: f.recipient_email.value.trim(),
            county: method === 'address' ? f.county.value : '',
            city: method === 'address' ? f.city.value.trim() : '',
            address: method === 'address' ? f.address.value.trim() : '',
            address_line2: method === 'address' ? f.address_line2.value.trim() : '',
            easybox_name: method === 'easybox' ? f.easybox_name.value.trim() : '',
            notes: f.notes.value.trim(),
        });
        if (res.success) {
            close();
            showToast(t('order_success_toast'), 'success');
            openListingDetail(l.id);
        } else {
            btn.disabled = false;
            btn.textContent = t('order_place_button');
            showToast(res.error || t('listing_generic_error'), 'error');
        }
    });
}

/* ================================================================
   REPAIR WIZARD
   ================================================================ */

/** Status badge HTML */
function repairStatusBadge(status) {
    const map = {
        pending:     { label: '🟡 Pending',     cls: 'hub-status--pending' },
        in_progress: { label: '🔵 In Progress', cls: 'hub-status--in-progress' },
        resolved:    { label: '🟢 Resolved',    cls: 'hub-status--resolved' }
    };
    const s = map[status] || { label: status, cls: '' };
    return `<span class="hub-status-badge ${s.cls}">${esc(s.label)}</span>`;
}

/** Render the repair wizard: model → symptoms → description → submit */
function renderRepair() {
    const v = document.getElementById('view-repair');
    if (!user()) {
        v.innerHTML = `<div class="hub-empty"><div class="hub-empty__icon">🔒</div>${esc(t('repair_login_text'))}<br><a href="login.html" style="color:var(--accent-color)">${esc(t('repair_login_link'))}</a></div>`;
        return;
    }
    const cName = CONSOLES.find(c => c.id === S.console)?.name || S.console;
    const models = MODELS_BY_CONSOLE[S.console] || [];
    const symptoms = SYMPTOMS_BY_CONSOLE[S.console] || [];
    const step = S.repairStep;

    const bars = [0, 1, 2, 3].map(i =>
        `<div class="hub-repair-progress__bar${i <= step ? ' hub-repair-progress__bar--done' : ''}"></div>`).join('');

    let body = '';

    if (step === 0) {
        /* ── Step 0: Model selection (or text input for "other") ── */
        if (S.console === 'other') {
            body = `
                <div class="hub-repair-question">${esc(t('repair_other_model_question'))}</div>
                <div class="hub-repair-hint">${esc(t('repair_other_model_hint'))}</div>
                <input type="text" class="hub-repair-textarea" id="repair-other-model" maxlength="200" placeholder="${esc(t('repair_other_model_placeholder'))}" value="${esc(S.repairModel)}" style="padding:10px;font-size:.92rem">
                <button class="hub-btn hub-btn--primary" id="repair-next"${S.repairModel.trim() ? '' : ' disabled'}>${esc(t('repair_continue'))}</button>`;
        } else {
            body = `
                <div class="hub-repair-question">${esc(t('repair_model_question').replace('{console}', cName))}</div>
                <div class="hub-repair-hint">${esc(t('repair_model_hint'))}</div>
                <div class="hub-symptom-grid">
                    ${models.map(m => `<button class="hub-symptom-btn${S.repairModel === m ? ' hub-symptom-btn--selected' : ''}" data-model="${esc(m)}">${esc(m)}</button>`).join('')}
                </div>
                <button class="hub-btn hub-btn--primary" id="repair-next"${S.repairModel ? '' : ' disabled'}>${esc(t('repair_continue'))}</button>`;
        }
    } else if (step === 1) {
        /* ── Step 1: Symptom selection ── */
        const hasCustom = S.repairSymptoms.includes('__custom__');
        const canProceed = S.repairSymptoms.length > 0 && (!hasCustom || S.repairCustomProblem.trim());
        body = `
            <div class="hub-repair-question">${esc(t('repair_symptom_question').replace('{console}', cName))}</div>
            <div class="hub-repair-hint">${esc(t('repair_symptom_hint'))}</div>
            <div class="hub-symptom-grid">
                ${symptoms.map(s => `<button class="hub-symptom-btn${S.repairSymptoms.includes(s) ? ' hub-symptom-btn--selected' : ''}" data-s="${esc(s)}">${esc(s)}</button>`).join('')}
                <button class="hub-symptom-btn hub-symptom-btn--custom${hasCustom ? ' hub-symptom-btn--selected' : ''}" id="repair-custom-btn">${esc(t('repair_other_issue'))}</button>
            </div>
            ${hasCustom ? `<div class="hub-repair-custom-wrap">
                <textarea class="hub-repair-textarea" id="repair-custom-text" rows="4" maxlength="500" placeholder="${esc(t('repair_custom_placeholder'))}">${esc(S.repairCustomProblem)}</textarea>
                <div class="hub-repair-char-count"><span id="repair-custom-count">${S.repairCustomProblem.length}</span> / 500</div>
            </div>` : ''}
            <div style="display:flex;gap:8px">
                <button class="hub-btn hub-btn--secondary" id="repair-prev">${esc(t('repair_back'))}</button>
                <button class="hub-btn hub-btn--primary" id="repair-next"${canProceed ? '' : ' disabled'}>${esc(t('repair_continue'))}</button>
            </div>`;
    } else if (step === 2) {
        /* ── Step 2: Description ── */
        body = `
            <div class="hub-repair-question">${esc(t('repair_desc_question'))}</div>
            <div class="hub-repair-hint">${esc(t('repair_desc_hint'))}</div>
            <textarea class="hub-repair-textarea" id="repair-desc" rows="6" maxlength="2000" placeholder="${esc(t('repair_desc_placeholder'))}">${esc(S.repairDesc)}</textarea>
            <div style="display:flex;gap:8px">
                <button class="hub-btn hub-btn--secondary" id="repair-prev">${esc(t('repair_back'))}</button>
                <button class="hub-btn hub-btn--primary" id="repair-submit">${esc(t('repair_submit_btn'))}</button>
            </div>`;
    } else {
        /* ── Step 3: Success ── */
        body = `
            <div class="hub-repair-success">
                <div class="hub-repair-success__icon">✅</div>
                <div style="color:var(--text-light);font-size:1.1rem;font-weight:600">${esc(t('repair_submitted_title'))}</div>
                <div style="color:var(--text-gray);font-size:.88rem">${esc(t('repair_submitted_desc'))}</div>
                <div style="display:flex;gap:8px;justify-content:center;margin-top:16px">
                    <button class="hub-btn hub-btn--secondary" id="repair-new">${esc(t('repair_new_request'))}</button>
                    <button class="hub-btn hub-btn--primary" id="repair-view-requests">${esc(t('repair_view_requests'))}</button>
                </div>
            </div>`;
    }

    v.innerHTML = `
        <div class="hub-view-header"><div class="hub-view-header__title">${t('repair_header').replace('{console}', esc(cName))}</div></div>
        <div class="hub-repair-progress">${bars}</div>
        <div class="hub-repair-body"><div class="hub-repair-inner">${body}</div></div>`;

    // Events per step
    if (step === 0) {
        if (S.console === 'other') {
            const inp = v.querySelector('#repair-other-model');
            if (inp) {
                inp.addEventListener('input', e => {
                    S.repairModel = e.target.value;
                    v.querySelector('#repair-next').disabled = !e.target.value.trim();
                });
                inp.focus();
            }
        } else {
            v.querySelectorAll('.hub-symptom-btn[data-model]').forEach(b => b.addEventListener('click', () => {
                S.repairModel = b.dataset.model;
                renderRepair();
            }));
        }
        v.querySelector('#repair-next')?.addEventListener('click', () => { S.repairStep = 1; renderRepair(); });
    }
    if (step === 1) {
        v.querySelectorAll('.hub-symptom-btn[data-s]').forEach(b => b.addEventListener('click', () => {
            const s = b.dataset.s;
            const i = S.repairSymptoms.indexOf(s);
            if (i >= 0) S.repairSymptoms.splice(i, 1); else S.repairSymptoms.push(s);
            renderRepair();
        }));
        v.querySelector('#repair-custom-btn')?.addEventListener('click', () => {
            const i = S.repairSymptoms.indexOf('__custom__');
            if (i >= 0) { S.repairSymptoms.splice(i, 1); S.repairCustomProblem = ''; }
            else S.repairSymptoms.push('__custom__');
            renderRepair();
        });
        const cta = v.querySelector('#repair-custom-text');
        if (cta) {
            cta.addEventListener('input', e => {
                S.repairCustomProblem = e.target.value;
                v.querySelector('#repair-custom-count').textContent = e.target.value.length;
                const ok = S.repairSymptoms.length > 0 && (!S.repairSymptoms.includes('__custom__') || S.repairCustomProblem.trim());
                v.querySelector('#repair-next').disabled = !ok;
            });
            cta.focus();
        }
        v.querySelector('#repair-prev')?.addEventListener('click', () => { S.repairStep = 0; renderRepair(); });
        v.querySelector('#repair-next')?.addEventListener('click', () => { S.repairStep = 2; renderRepair(); });
    }
    if (step === 2) {
        v.querySelector('#repair-desc')?.addEventListener('input', e => { S.repairDesc = e.target.value; });
        v.querySelector('#repair-prev')?.addEventListener('click', () => { S.repairStep = 1; renderRepair(); });
        v.querySelector('#repair-submit')?.addEventListener('click', submitRepair);
    }
    if (step === 3) {
        v.querySelector('#repair-new')?.addEventListener('click', () => {
            Object.assign(S, { repairStep: 0, repairModel: '', repairSymptoms: [], repairDesc: '', repairResult: null, repairCustomProblem: '' });
            renderRepair();
        });
        v.querySelector('#repair-view-requests')?.addEventListener('click', () => {
            navigate('repair-requests', null, '');
        });
    }
}

/** Submit the repair request directly */
async function submitRepair() {
    const btn = document.querySelector('#repair-submit');
    if (btn) { btn.disabled = true; btn.textContent = t('repair_submitting'); }

    const actualSymptoms = S.repairSymptoms.filter(s => s !== '__custom__');
    try {
        const data = await api('POST', '/repair', {
            consoleType: S.console,
            consoleModel: S.repairModel,
            symptoms: actualSymptoms,
            customSymptom: S.repairCustomProblem || '',
            description: S.repairDesc
        });
        if (data.success) {
            S.repairStep = 3;
            renderRepair();
        } else {
            if (btn) { btn.disabled = false; btn.textContent = t('repair_submit_btn'); }
            showToast(data.error || t('repair_submit_error'), 'error');
        }
    } catch {
        if (btn) { btn.disabled = false; btn.textContent = t('repair_submit_btn'); }
        showToast(t('repair_submit_error'), 'error');
    }
}

/* ================================================================
   REPAIR — MY REQUESTS
   ================================================================ */

/** Render the user's own repair requests */
async function renderRepairRequests() {
    const v = document.getElementById('view-repair-requests');
    if (!user()) {
        v.innerHTML = '<div class="hub-empty"><div class="hub-empty__icon">🔒</div>You must be logged in.<br><a href="login.html" style="color:var(--accent-color)">Log in</a></div>';
        return;
    }
    v.innerHTML = `
        <div class="hub-view-header"><div class="hub-view-header__title">📋 ${t('repair_my_title')}</div></div>
        <div class="hub-repair-body"><div class="hub-empty"><div class="hub-empty__icon">⏳</div>${t('repair_loading')}</div></div>`;

    try {
        const data = await api('GET', '/repair');
        if (!data.success) throw 0;
        const requests = data.requests || [];

        if (!requests.length) {
            v.innerHTML = `
                <div class="hub-view-header"><div class="hub-view-header__title">📋 ${t('repair_my_title')}</div></div>
                <div class="hub-repair-body"><div class="hub-empty"><div class="hub-empty__icon">📭</div>${t('repair_no_requests')}</div></div>`;
            return;
        }

        const cards = requests.map(r => {
            const consoleName = CONSOLES.find(c => c.id === r.console)?.name || r.console;
            const symptomList = r.symptoms ? r.symptoms.split(', ').map(s => `<span class="hub-repair-tag">${esc(s)}</span>`).join('') : '';
            return `
                <div class="hub-repair-card">
                    <div class="hub-repair-card__header">
                        <div>
                            <strong style="color:var(--text-light)">${esc(consoleName)}</strong>
                            ${r.console_model ? `<span style="color:var(--text-gray);font-size:.82rem;margin-left:6px">${esc(r.console_model)}</span>` : ''}
                            <span style="color:var(--text-gray);font-size:.8rem;margin-left:8px">#${r.id}</span>
                        </div>
                        ${repairStatusBadge(r.status)}
                    </div>
                    <div class="hub-repair-card__symptoms">${symptomList}</div>
                    ${r.custom_symptom ? `<div style="color:var(--text-gray);font-size:.84rem;font-style:italic">${t('repair_custom_label')}: ${esc(r.custom_symptom)}</div>` : ''}
                    ${r.description ? `<div style="color:var(--text-gray);font-size:.84rem;margin-top:4px">${esc(r.description)}</div>` : ''}
                    ${r.admin_reply ? `
                        <div class="hub-repair-card__reply">
                            <div style="font-size:.76rem;color:var(--accent-color);font-weight:600;margin-bottom:4px">${t('repair_admin_reply_title')}</div>
                            <div style="color:var(--text-light);font-size:.88rem;line-height:1.5">${esc(r.admin_reply)}</div>
                        </div>` : ''}
                    <div style="color:var(--text-gray);font-size:.76rem;margin-top:8px">${new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                </div>`;
        }).join('');

        v.innerHTML = `
            <div class="hub-view-header"><div class="hub-view-header__title">📋 ${t('repair_my_title')}</div></div>
            <div class="hub-repair-body"><div class="hub-repair-list">${cards}</div></div>`;
    } catch {
        v.innerHTML = `
            <div class="hub-view-header"><div class="hub-view-header__title">📋 ${t('repair_my_title')}</div></div>
            <div class="hub-repair-body"><div class="hub-empty"><div class="hub-empty__icon">❌</div>${t('repair_load_error')}</div></div>`;
    }
}

/* ================================================================
   REPAIR — ADMIN VIEW
   ================================================================ */

/** Render admin view of all repair requests with inline editing */
async function renderRepairAdmin() {
    const v = document.getElementById('view-repair-admin');
    const u = user();
    if (!u || u.role !== 'admin') {
        v.innerHTML = `<div class="hub-empty"><div class="hub-empty__icon">🔒</div>${t('repair_admin_access')}</div>`;
        return;
    }
    v.innerHTML = `
        <div class="hub-view-header"><div class="hub-view-header__title">🛠️ ${t('repair_admin_title')}</div></div>
        <div class="hub-repair-body"><div class="hub-empty"><div class="hub-empty__icon">⏳</div>${t('repair_loading')}</div></div>`;

    try {
        const data = await api('GET', '/repair/all');
        if (!data.success) throw 0;
        const requests = data.requests || [];

        if (!requests.length) {
            v.innerHTML = `
                <div class="hub-view-header"><div class="hub-view-header__title">🛠️ ${t('repair_admin_title')}</div></div>
                <div class="hub-repair-body"><div class="hub-empty"><div class="hub-empty__icon">📭</div>${t('repair_admin_no_requests')}</div></div>`;
            return;
        }

        const cards = requests.map(r => {
            const consoleName = CONSOLES.find(c => c.id === r.console)?.name || r.console;
            const symptomList = r.symptoms ? r.symptoms.split(', ').map(s => `<span class="hub-repair-tag">${esc(s)}</span>`).join('') : '';
            return `
                <div class="hub-repair-card hub-repair-card--admin" data-rid="${r.id}">
                    <div class="hub-repair-card__header">
                        <div>
                            <strong style="color:var(--text-light)">${esc(r.username || 'User #' + r.user_id)}</strong>
                            <span style="color:var(--text-gray);font-size:.8rem;margin-left:8px">${esc(consoleName)}${r.console_model ? ' · ' + esc(r.console_model) : ''} · #${r.id}</span>
                        </div>
                        ${repairStatusBadge(r.status)}
                    </div>
                    <div class="hub-repair-card__symptoms">${symptomList}</div>
                    ${r.custom_symptom ? `<div style="color:var(--text-gray);font-size:.84rem;font-style:italic">${t('repair_custom_label')}: ${esc(r.custom_symptom)}</div>` : ''}
                    ${r.description ? `<div style="color:var(--text-gray);font-size:.84rem;margin-top:4px">${esc(r.description)}</div>` : ''}
                    <div class="hub-repair-admin-controls">
                        <div class="hub-repair-admin-row">
                            <label style="color:var(--text-gray);font-size:.8rem">${t('repair_admin_status_label')}</label>
                            <select class="hub-repair-select" data-field="status">
                                <option value="pending"${r.status === 'pending' ? ' selected' : ''}>${t('repair_admin_status_pending')}</option>
                                <option value="in_progress"${r.status === 'in_progress' ? ' selected' : ''}>${t('repair_admin_status_in_progress')}</option>
                                <option value="resolved"${r.status === 'resolved' ? ' selected' : ''}>${t('repair_admin_status_resolved')}</option>
                            </select>
                        </div>
                        <div class="hub-repair-admin-row">
                            <label style="color:var(--text-gray);font-size:.8rem">${t('repair_admin_reply_label')}</label>
                            <textarea class="hub-repair-textarea" data-field="reply" rows="3" maxlength="2000" placeholder="${t('repair_admin_reply_placeholder')}">${esc(r.admin_reply || '')}</textarea>
                        </div>
                        <button class="hub-btn hub-btn--primary hub-btn--sm" data-action="save-repair">${t('repair_admin_save')}</button>
                    </div>
                    <div style="color:var(--text-gray);font-size:.76rem;margin-top:8px">${new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                </div>`;
        }).join('');

        v.innerHTML = `
            <div class="hub-view-header"><div class="hub-view-header__title">🛠️ ${t('repair_admin_title')} (${requests.length})</div></div>
            <div class="hub-repair-body"><div class="hub-repair-list">${cards}</div></div>`;

        // Admin save event delegation
        v.addEventListener('click', async e => {
            const btn = e.target.closest('[data-action="save-repair"]');
            if (!btn) return;
            const card = btn.closest('.hub-repair-card');
            const rid = card.dataset.rid;
            const status = card.querySelector('[data-field="status"]').value;
            const adminReply = card.querySelector('[data-field="reply"]').value.trim();

            btn.disabled = true; btn.textContent = t('repair_admin_saving');
            try {
                const res = await api('PATCH', `/repair/${rid}`, { status, adminReply });
                if (res.success) {
                    btn.textContent = t('repair_admin_saved');
                    // Update the badge inline
                    const header = card.querySelector('.hub-repair-card__header');
                    const oldBadge = header.querySelector('.hub-status-badge');
                    if (oldBadge) oldBadge.outerHTML = repairStatusBadge(status);
                    setTimeout(() => { btn.disabled = false; btn.textContent = t('repair_admin_save'); }, 1500);
                } else {
                    btn.disabled = false; btn.textContent = t('repair_admin_save');
                    showToast(res.error || 'Failed to save.', 'error');
                }
            } catch {
                btn.disabled = false; btn.textContent = t('repair_admin_save');
                showToast('Failed to save.', 'error');
            }
        });
    } catch {
        v.innerHTML = `
            <div class="hub-view-header"><div class="hub-view-header__title">🛠️ ${t('repair_admin_title')}</div></div>
            <div class="hub-repair-body"><div class="hub-empty"><div class="hub-empty__icon">❌</div>${t('repair_load_error')}</div></div>`;
    }
}

/* ================================================================
   DIRECT MESSAGES
   ================================================================ */

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

// One playing voice note at a time, shared across every bubble/conversation.
let activeVoiceAudio = null;
let activeVoiceEl = null;

// Polling handle for the currently-open DM thread (there's no realtime transport for DM —
// see CLAUDE.md: Socket.io is achievement/notification-only — so mirror chat.js's own
// polling pattern instead of building a new one).
const DM_POLL_INTERVAL_MS = 4000;
let dmPollTimer = null;

function stopDmPolling() {
    if (dmPollTimer) { clearInterval(dmPollTimer); dmPollTimer = null; }
}

/** Poll the open conversation for new/edited/deleted/reacted messages sent from elsewhere
 * (the other party, or this same account on another tab/device) and reconcile the DOM
 * in place — new messages are appended, edits/reactions re-render just that row, and
 * messages removed server-side are dropped from the list. Never touches compose/reply state. */
async function syncDmMessages(partnerId) {
    if (S.dmPartner !== partnerId) return; // conversation switched away since this was scheduled
    try {
        const data = await api('GET', `/dm/messages/${partnerId}`);
        if (!data.success || S.dmPartner !== partnerId) return;
        const incoming = data.messages || [];
        const existingById = new Map(S.dmMessages.map(x => [x.id, x]));
        const incomingIds = new Set(incoming.map(m => m.id));

        const removedIds = S.dmMessages.filter(m => !incomingIds.has(m.id)).map(m => m.id);
        if (removedIds.length) {
            S.dmMessages = S.dmMessages.filter(m => incomingIds.has(m.id));
            removedIds.forEach(id => document.querySelector(`.hub-dm-msg-row[data-msg-id="${id}"]`)?.remove());
        }

        for (const m of incoming) {
            const existing = existingById.get(m.id);
            if (!existing) continue;
            const changed = existing.message !== m.message || existing.edited_at !== m.edited_at ||
                JSON.stringify(existing.reactions || []) !== JSON.stringify(m.reactions || []);
            if (changed) {
                Object.assign(existing, m);
                updateMessageInPlace(existing);
            }
        }

        const newOnes = incoming.filter(m => !existingById.has(m.id));
        for (const m of newOnes) appendMessageToThread(m);
    } catch (err) {
        console.error('DM sync failed:', err);
    }
}

/** Local-only conversation state (pin/mute/hide) — mirrors ChatViewModel.kt's own
 * DataStore-backed pinnedIds/mutedIds/hiddenIds (no backend concept on Android either),
 * namespaced per logged-in user id since multiple accounts can share a browser. */
function dmLocalKey(suffix) {
    const u = user();
    return `cn_dm_${suffix}_${u ? u.id : 'anon'}`;
}
function loadDmSet(suffix) {
    try { return new Set(JSON.parse(localStorage.getItem(dmLocalKey(suffix)) || '[]')); }
    catch { return new Set(); }
}
function saveDmSet(suffix, set) {
    localStorage.setItem(dmLocalKey(suffix), JSON.stringify([...set]));
}
function loadDmHidden() {
    try { return new Map(Object.entries(JSON.parse(localStorage.getItem(dmLocalKey('hidden')) || '{}'))); }
    catch { return new Map(); }
}
function saveDmHidden(map) {
    localStorage.setItem(dmLocalKey('hidden'), JSON.stringify(Object.fromEntries(map)));
}
function ensureDmLocalPrefsLoaded() {
    if (!S.dmPins) S.dmPins = loadDmSet('pins');
    if (!S.dmMutes) S.dmMutes = loadDmSet('mutes');
    if (!S.dmHidden) S.dmHidden = loadDmHidden();
}

/** Fallback label for an attachment-only message — mirrors ChatViewModel.kt's previewText() */
function previewText(m) {
    if (m?.message) return m.message;
    if (m?.attachment?.type === 'voice') return t('dm_preview_voice');
    if (m?.attachment?.type === 'sticker') return t('dm_preview_sticker');
    if (m?.attachment?.type === 'image') return t('dm_preview_photo');
    return '';
}

function hashStr(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return h;
}

/** Custom waveform voice player markup — replaces the native <audio controls> element.
 * The bar heights are a deterministic pseudo-pattern seeded by the message id (same idea
 * as VoiceMessageBubble in ChatScreen.kt — not real decoded amplitude, just a stable per-message look). */
function renderVoicePlayerHtml(url, durationMs, seedKey) {
    let seed = Math.abs(hashStr(seedKey || url || ''));
    const bars = Array.from({ length: 24 }, () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return 0.3 + (seed % 1000) / 1000 * 0.7;
    });
    const totalSec = Math.max(0, Math.round((durationMs || 0) / 1000));
    const label = `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
    return `<div class="hub-dm-voice" data-voice-url="${esc(url)}" data-voice-duration="${durationMs || 0}">
        <button type="button" class="hub-dm-voice__toggle" data-voice-toggle aria-label="${esc(t('dm_play_voice'))}">▶</button>
        <div class="hub-dm-voice__bars" data-voice-bars>${bars.map(h => `<span class="hub-dm-voice__bar" style="height:${Math.round(h * 100)}%"></span>`).join('')}</div>
        <span class="hub-dm-voice__time" data-voice-time>${label}</span>
    </div>`;
}

function resetVoiceUi(voiceEl) {
    if (!voiceEl) return;
    const toggleBtn = voiceEl.querySelector('[data-voice-toggle]');
    if (toggleBtn) { toggleBtn.textContent = '▶'; toggleBtn.setAttribute('aria-label', t('dm_play_voice')); }
    voiceEl.querySelectorAll('.hub-dm-voice__bar').forEach(b => b.classList.remove('hub-dm-voice__bar--played'));
    const totalSec = Math.round((parseInt(voiceEl.dataset.voiceDuration) || 0) / 1000);
    const timeEl = voiceEl.querySelector('[data-voice-time]');
    if (timeEl) timeEl.textContent = `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
    if (activeVoiceEl === voiceEl) { activeVoiceAudio = null; activeVoiceEl = null; }
}

function stopActiveVoice() {
    if (activeVoiceAudio) activeVoiceAudio.pause();
    if (activeVoiceEl) resetVoiceUi(activeVoiceEl);
}

function toggleVoicePlayback(voiceEl) {
    if (!voiceEl) return;
    if (activeVoiceEl === voiceEl && activeVoiceAudio) {
        if (activeVoiceAudio.paused) {
            activeVoiceAudio.play().catch(() => {});
            voiceEl.querySelector('[data-voice-toggle]').textContent = '⏸';
        } else {
            activeVoiceAudio.pause();
            voiceEl.querySelector('[data-voice-toggle]').textContent = '▶';
        }
        return;
    }
    if (activeVoiceAudio) stopActiveVoice();

    const url = voiceEl.dataset.voiceUrl;
    const audio = new Audio(url);
    activeVoiceAudio = audio;
    activeVoiceEl = voiceEl;
    const toggleBtn = voiceEl.querySelector('[data-voice-toggle]');
    const bars = voiceEl.querySelectorAll('.hub-dm-voice__bar');
    const timeEl = voiceEl.querySelector('[data-voice-time]');
    toggleBtn.textContent = '⏸';
    toggleBtn.setAttribute('aria-label', t('dm_pause_voice'));
    audio.addEventListener('timeupdate', () => {
        const dur = audio.duration || (parseInt(voiceEl.dataset.voiceDuration) / 1000) || 0;
        const progress = dur > 0 ? audio.currentTime / dur : 0;
        const playedCount = Math.round(progress * bars.length);
        bars.forEach((b, i) => b.classList.toggle('hub-dm-voice__bar--played', i < playedCount));
        const sec = Math.floor(audio.currentTime);
        if (timeEl) timeEl.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    });
    audio.addEventListener('ended', () => resetVoiceUi(voiceEl));
    audio.play().catch(() => {});
}

function seekVoice(barsEl, clientX) {
    const voiceEl = barsEl.closest('.hub-dm-voice');
    if (activeVoiceEl !== voiceEl || !activeVoiceAudio || !activeVoiceAudio.duration) return;
    const rect = barsEl.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    activeVoiceAudio.currentTime = frac * activeVoiceAudio.duration;
}

/** Build one message bubble's full HTML — reply quote, attachment, text, edited label, reactions. */
function renderMessageHtml(m, myId, partnerName, msgsById, prevMsg, nextMsg) {
    const mine = m.sender_id === myId;
    const stacked = !!(prevMsg && prevMsg.sender_id === m.sender_id && (new Date(m.created_at) - new Date(prevMsg.created_at)) < 5 * 60000);
    const tail = !nextMsg || nextMsg.sender_id !== m.sender_id;
    const repliedMsg = m.reply_to ? msgsById.get(m.reply_to) : null;
    const isSticker = m.attachment?.type === 'sticker';

    let replyHtml = '';
    if (repliedMsg) {
        const authorLabel = repliedMsg.sender_id === myId ? (user()?.username || '') : partnerName;
        const isImg = (repliedMsg.attachment?.type === 'image' || repliedMsg.attachment?.type === 'sticker') && repliedMsg.attachment.url;
        replyHtml = `<div class="hub-dm-reply-quote" data-jump-to="${repliedMsg.id}">
            <div class="hub-dm-reply-quote__bar"></div>
            <div class="hub-dm-reply-quote__body">
                <div class="hub-dm-reply-quote__author">${esc(authorLabel)}</div>
                ${isImg
                    ? `<img class="hub-dm-reply-quote__thumb" src="${esc(repliedMsg.attachment.url)}" alt="">`
                    : `<span class="hub-dm-reply-quote__text">${esc(previewText(repliedMsg))}</span>`}
            </div>
        </div>`;
    }

    let attachmentHtml = '';
    if (m.attachment?.type === 'image') {
        attachmentHtml = `<img class="hub-dm-msg__image" src="${esc(m.attachment.url)}" alt="" loading="lazy" data-viewable="1">`;
    } else if (m.attachment?.type === 'voice') {
        attachmentHtml = renderVoicePlayerHtml(m.attachment.url, m.attachment.duration_ms, 'dm-' + m.id);
    } else if (isSticker) {
        attachmentHtml = `<img class="hub-dm-msg__sticker-img" src="${esc(m.attachment.url)}" alt="" data-viewable="1">`;
    }

    const reactions = m.reactions || [];
    const reactionsHtml = reactions.length ? `<div class="hub-dm-reactions">${reactions.map(r => `
        <button type="button" class="hub-dm-reaction-chip${r.mine ? ' hub-dm-reaction-chip--mine' : ''}" data-react-emoji="${esc(r.emoji)}">
            <span>${r.emoji}</span>${r.count > 1 ? `<span class="hub-dm-reaction-chip__count">${r.count}</span>` : ''}
        </button>`).join('')}</div>` : '';

    const reportBtn = !mine ? `<button class="report-trigger-btn" data-report-type="direct_message" data-report-id="${m.id}" data-report-preview="${esc((m.message || '').substring(0, 60))}" title="${esc(t('report_btn_trigger_dm_title'))}">⚑</button>` : '';

    return `<div class="hub-dm-msg-row hub-dm-msg-row--${mine ? 'mine' : 'theirs'}${stacked ? ' hub-dm-msg-row--stacked' : ''}" data-msg-id="${m.id}" data-mine="${mine ? '1' : '0'}">
        <div class="hub-dm-msg hub-dm-msg--${mine ? 'mine' : 'theirs'}${isSticker ? ' hub-dm-msg--sticker' : ''}${tail ? ' hub-dm-msg--tail' : ''}" data-msg-id="${m.id}">
            ${replyHtml}
            ${attachmentHtml}
            ${m.message ? `<div class="hub-dm-msg__text">${esc(m.message)}</div>` : ''}
            ${m.edited_at ? `<div class="hub-dm-msg__edited">${esc(t('dm_edited'))}</div>` : ''}
            ${reportBtn}
        </div>
        ${reactionsHtml}
        <div class="hub-dm-msg__time">${timeAgo(m.created_at)}</div>
    </div>`;
}

/** Re-render a single message row in place (after a reaction/edit), preserving scroll position. */
function updateMessageInPlace(m) {
    const row = document.querySelector(`.hub-dm-msg-row[data-msg-id="${m.id}"]`);
    if (!row) return;
    const idx = S.dmMessages.findIndex(x => x.id === m.id);
    const prevMsg = idx > 0 ? S.dmMessages[idx - 1] : null;
    const nextMsg = idx >= 0 && idx < S.dmMessages.length - 1 ? S.dmMessages[idx + 1] : null;
    row.outerHTML = renderMessageHtml(m, user().id, S.dmPartnerName, new Map(S.dmMessages.map(x => [x.id, x])), prevMsg, nextMsg);
}

/** Append a freshly-sent message to the open thread without a full reload. */
function appendMessageToThread(m) {
    const el = document.getElementById('dm-messages');
    if (!el) return;
    const prevMsg = S.dmMessages.length ? S.dmMessages[S.dmMessages.length - 1] : null;
    S.dmMessages.push(m);
    el.querySelector('.hub-dm-empty')?.remove();
    const msgsById = new Map(S.dmMessages.map(x => [x.id, x]));
    el.insertAdjacentHTML('beforeend', renderMessageHtml(m, user().id, S.dmPartnerName, msgsById, prevMsg, null));
    if (prevMsg && prevMsg.sender_id === m.sender_id) updateMessageInPlace(prevMsg); // it's no longer the tail
    el.scrollTop = el.scrollHeight;
    window.dispatchEvent(new CustomEvent('cn:message-sent'));
}

/** Toggle a reaction on a message — optimistic, mirrors ChatViewModel.kt's toggleReaction(). */
async function toggleReaction(m, emoji) {
    const existing = (m.reactions || []).find(r => r.emoji === emoji);
    const wasMine = !!existing?.mine;
    if (wasMine) {
        if (existing.count <= 1) m.reactions = (m.reactions || []).filter(r => r.emoji !== emoji);
        else { existing.count--; existing.mine = false; }
    } else if (existing) {
        existing.count++; existing.mine = true;
    } else {
        m.reactions = [...(m.reactions || []), { emoji, count: 1, mine: true }];
    }
    updateMessageInPlace(m);
    try {
        if (wasMine) await api('DELETE', `/dm/${m.id}/react?emoji=${encodeURIComponent(emoji)}`);
        else await api('POST', `/dm/${m.id}/react`, { emoji });
    } catch (err) { console.error('Reaction failed:', err); }
}

/** Delete own message — optimistic, mirrors ChatViewModel.kt's deleteMessage(). */
async function deleteDmMessage(m) {
    document.querySelector(`.hub-dm-msg-row[data-msg-id="${m.id}"]`)?.remove();
    S.dmMessages = S.dmMessages.filter(x => x.id !== m.id);
    try {
        const res = await api('DELETE', `/dm/${m.id}`);
        if (!res.success) showToast(res.error || t('dm_delete_failed'), 'error');
    } catch { showToast(t('dm_delete_failed'), 'error'); }
}

/** Rebuild the reply/edit banner above the compose form from current S.dmReplyTo/dmEditingId. */
function renderComposeBanner() {
    const el = document.getElementById('dm-compose-banner');
    if (!el) return;
    if (S.dmEditingId) {
        const m = S.dmMessages.find(x => x.id === S.dmEditingId);
        el.hidden = false;
        el.innerHTML = `<div class="hub-dm-reply-banner__body">
                <div class="hub-dm-reply-banner__label">${esc(t('dm_edit'))}</div>
                <div class="hub-dm-reply-banner__text">${esc(m?.message || '')}</div>
            </div>
            <button type="button" class="hub-dm-reply-banner__close" data-cancel-compose aria-label="${esc(t('dm_cancel'))}">&times;</button>`;
    } else if (S.dmReplyTo) {
        const label = S.dmReplyTo.mine ? (user()?.username || '') : S.dmReplyTo.partnerName;
        el.hidden = false;
        el.innerHTML = `<div class="hub-dm-reply-banner__body">
                <div class="hub-dm-reply-banner__label">${esc(t('dm_replying_to'))} ${esc(label)}</div>
                <div class="hub-dm-reply-banner__text">${esc(previewText(S.dmReplyTo))}</div>
            </div>
            <button type="button" class="hub-dm-reply-banner__close" data-cancel-compose aria-label="${esc(t('dm_cancel'))}">&times;</button>`;
    } else {
        el.hidden = true;
        el.innerHTML = '';
        return;
    }
    el.querySelector('[data-cancel-compose]').addEventListener('click', () => {
        const wasEditing = !!S.dmEditingId;
        S.dmReplyTo = null; S.dmEditingId = null;
        renderComposeBanner();
        if (wasEditing) {
            const input = document.querySelector('.hub-dm-form__input');
            if (input) input.value = '';
            syncComposerSendIcon(false);
        }
    });
}

/** Toggle the merged mic/send button's icon from module-level code that can't reach
 * openConversation()'s own `updateComposerButton()` closure (startEdit/cancel-compose). */
function syncComposerSendIcon(hasContent) {
    const btn = document.getElementById('dm-mic-send-btn');
    if (!btn) return;
    btn.classList.toggle('hub-dm-form__mic-send-btn--send', hasContent);
    btn.textContent = hasContent ? '↑' : '🎤';
    btn.setAttribute('aria-label', hasContent ? t('dm_send') : t('dm_record_voice'));
}

function startReply(m, partnerName) {
    S.dmEditingId = null;
    S.dmReplyTo = { id: m.id, mine: m.sender_id === user()?.id, partnerName, message: m.message, attachment: m.attachment };
    renderComposeBanner();
    document.querySelector('.hub-dm-form__input')?.focus();
}

function startEdit(m) {
    S.dmReplyTo = null;
    S.dmEditingId = m.id;
    renderComposeBanner();
    const input = document.querySelector('.hub-dm-form__input');
    if (input) { input.value = m.message || ''; input.focus(); }
    syncComposerSendIcon(!!(m.message || '').trim());
}

async function submitEdit(newText) {
    const id = S.dmEditingId;
    S.dmEditingId = null;
    renderComposeBanner();
    const m = S.dmMessages.find(x => x.id === id);
    if (!m || !newText) return;
    try {
        const res = await api('PATCH', `/dm/${id}`, { message: newText });
        if (res.success) {
            m.message = res.message.message;
            m.edited_at = res.message.edited_at;
            updateMessageInPlace(m);
        } else {
            showToast(res.error || t('dm_edit_failed'), 'error');
        }
    } catch { showToast(t('dm_edit_failed'), 'error'); }
}

function closeAnyContextMenu() {
    document.querySelector('.hub-ctx-scrim')?.remove();
    document.querySelector('.hub-ctx-menu')?.remove();
}

/** Position a floating context menu near (x, y), clamped to stay on-screen. */
function positionCtxMenu(menu, x, y) {
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(Math.max(14, x), window.innerWidth - rect.width - 14);
    // Prefer opening downward from the click point; flip to open upward instead when
    // there isn't enough room below (matches native context-menu behavior) — otherwise
    // a click near the bottom of the viewport pushes the menu off-screen.
    let top = (y + rect.height + 14 > window.innerHeight) ? y - rect.height : y;
    top = Math.min(Math.max(14, top), window.innerHeight - rect.height - 14);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
}

/** Right-click menu on a message bubble — quick reactions + Reply/Forward/Copy/Edit/Delete,
 * matching ChatScreen.kt's MessageActionsMenu (minus the Compose-only animation/blur). */
function openMessageContextMenu(x, y, m, mine, partnerName) {
    closeAnyContextMenu();
    const scrim = document.createElement('div');
    scrim.className = 'hub-ctx-scrim';
    document.body.appendChild(scrim);

    const menu = document.createElement('div');
    menu.className = 'hub-ctx-menu';

    const reactionsRow = QUICK_REACTIONS.map(emoji => {
        const isMine = (m.reactions || []).some(r => r.emoji === emoji && r.mine);
        return `<button type="button" class="hub-ctx-menu__reaction-btn${isMine ? ' hub-ctx-menu__reaction-btn--mine' : ''}" data-emoji="${emoji}">${emoji}</button>`;
    }).join('');

    const rows = [`<button type="button" class="hub-ctx-menu__row" data-action="reply"><span>${esc(t('dm_reply'))}</span><span>↩</span></button>`,
        `<button type="button" class="hub-ctx-menu__row" data-action="forward"><span>${esc(t('dm_forward'))}</span><span>➜</span></button>`];
    if (m.message) rows.push(`<button type="button" class="hub-ctx-menu__row" data-action="copy"><span>${esc(t('dm_copy'))}</span><span>⧉</span></button>`);
    if (mine && m.message) rows.push(`<button type="button" class="hub-ctx-menu__row" data-action="edit"><span>${esc(t('dm_edit'))}</span><span>✎</span></button>`);
    if (mine) rows.push(`<button type="button" class="hub-ctx-menu__row hub-ctx-menu__row--destructive" data-action="delete"><span>${esc(t('dm_delete'))}</span><span>🗑</span></button>`);

    menu.innerHTML = `<div class="hub-ctx-menu__reactions">${reactionsRow}</div><div class="hub-ctx-menu__actions">${rows.join('')}</div>`;
    positionCtxMenu(menu, x, y);

    const close = () => { scrim.remove(); menu.remove(); };
    scrim.addEventListener('click', close);
    menu.querySelectorAll('[data-emoji]').forEach(btn => {
        btn.addEventListener('click', () => { close(); toggleReaction(m, btn.dataset.emoji); });
    });
    menu.querySelector('[data-action="reply"]')?.addEventListener('click', () => { close(); startReply(m, partnerName); });
    menu.querySelector('[data-action="forward"]')?.addEventListener('click', () => { close(); openForwardPicker(m); });
    menu.querySelector('[data-action="copy"]')?.addEventListener('click', () => {
        close();
        navigator.clipboard?.writeText(m.message || '').then(() => showToast(t('dm_copied'), 'success')).catch(() => {});
    });
    menu.querySelector('[data-action="edit"]')?.addEventListener('click', () => { close(); startEdit(m); });
    menu.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
        close();
        const ok = await confirmModal(t('dm_delete_message_confirm'), { ok: t('dm_delete'), cancel: t('dm_cancel') });
        if (ok) deleteDmMessage(m);
    });
}

/** Right-click menu on a conversation row — Pin/Mute/Delete chat, matching ChatScreen.kt's
 * ConversationActionsOverlay. All three are local-only (no backend concept on Android either). */
function openConversationContextMenu(x, y, conv) {
    ensureDmLocalPrefsLoaded();
    closeAnyContextMenu();
    const scrim = document.createElement('div');
    scrim.className = 'hub-ctx-scrim';
    document.body.appendChild(scrim);

    const menu = document.createElement('div');
    menu.className = 'hub-ctx-menu';
    const key = String(conv.partner_id);
    const pinned = S.dmPins.has(key);
    const muted = S.dmMutes.has(key);
    menu.innerHTML = `<div class="hub-ctx-menu__actions">
        <button type="button" class="hub-ctx-menu__row" data-action="pin"><span>${esc(pinned ? t('dm_unpin') : t('dm_pin'))}</span><span>📌</span></button>
        <button type="button" class="hub-ctx-menu__row" data-action="mute"><span>${esc(muted ? t('dm_unmute') : t('dm_mute'))}</span><span>🔕</span></button>
        <button type="button" class="hub-ctx-menu__row hub-ctx-menu__row--destructive" data-action="delete"><span>${esc(t('dm_delete_chat'))}</span><span>🗑</span></button>
    </div>`;
    positionCtxMenu(menu, x, y);

    const close = () => { scrim.remove(); menu.remove(); };
    scrim.addEventListener('click', close);
    menu.querySelector('[data-action="pin"]').addEventListener('click', () => {
        close();
        if (pinned) S.dmPins.delete(key); else S.dmPins.add(key);
        saveDmSet('pins', S.dmPins);
        loadConversations();
    });
    menu.querySelector('[data-action="mute"]').addEventListener('click', () => {
        close();
        if (muted) S.dmMutes.delete(key); else S.dmMutes.add(key);
        saveDmSet('mutes', S.dmMutes);
        loadConversations();
    });
    menu.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        close();
        const ok = await confirmModal(t('dm_delete_chat_confirm').replace('{name}', conv.partner_name), { ok: t('dm_delete'), cancel: t('dm_cancel') });
        if (!ok) return;
        S.dmHidden.set(key, conv.last_time);
        saveDmHidden(S.dmHidden);
        if (S.dmPartner === conv.partner_id) {
            S.dmPartner = null;
            document.getElementById('dm-layout')?.classList.remove('hub-dm-layout--thread-open');
            setMobileFullscreen(false);
            const thread = document.getElementById('dm-thread');
            if (thread) thread.innerHTML = `<div class="hub-dm-empty">${esc(t('dm_select_conversation'))}</div>`;
        }
        loadConversations();
    });
}

/** Forward a message (text and/or attachment, same storage key — no re-upload) into another
 * DM conversation. Mirrors ChatViewModel.kt's forwardMessage() — DMs only, never general chat. */
async function openForwardPicker(m) {
    document.querySelector('.hub-modal-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'hub-modal-overlay';
    overlay.innerHTML = `
        <div class="hub-modal">
            <div class="hub-modal__header">
                <span class="hub-modal__title">${esc(t('dm_forward_title'))}</span>
                <button class="hub-modal__close">&times;</button>
            </div>
            <div class="hub-modal__body">
                <div class="hub-forward-list" id="forward-list"><div class="hub-dm-list__empty">${esc(t('dm_loading'))}</div></div>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.hub-modal__close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    const listEl = overlay.querySelector('#forward-list');
    try {
        const data = await api('GET', '/dm/conversations');
        const convs = data.conversations || [];
        if (!convs.length) { listEl.innerHTML = `<div class="hub-dm-list__empty">${esc(t('dm_no_conversations'))}</div>`; return; }
        listEl.innerHTML = convs.map(c => `
            <button type="button" class="hub-forward-conv" data-id="${c.partner_id}" data-name="${esc(c.partner_name)}">
                <div class="hub-dm-conv__avatar">${avatarHtml(c.partner_name, c.partner_avatar, 32)}</div>
                <span>${esc(c.partner_name)}</span>
            </button>`).join('');
        listEl.querySelectorAll('.hub-forward-conv').forEach(btn => {
            btn.addEventListener('click', async () => {
                listEl.querySelectorAll('.hub-forward-conv').forEach(b => b.disabled = true);
                const toId = +btn.dataset.id;
                try {
                    const body = { receiverId: toId, message: m.message || '' };
                    if (m.attachment) {
                        body.attachment_key = m.attachment.key;
                        body.attachment_type = m.attachment.type;
                        body.attachment_size = m.attachment.size;
                        body.attachment_duration_ms = m.attachment.duration_ms;
                    }
                    const res = await api('POST', '/dm/send', body);
                    if (res.success) {
                        showToast(t('dm_forward_sent'), 'success');
                        close();
                        if (S.dmPartner === toId) appendMessageToThread(res.message);
                        else loadConversations();
                    } else {
                        showToast(res.error || t('dm_forward_error'), 'error');
                        listEl.querySelectorAll('.hub-forward-conv').forEach(b => b.disabled = false);
                    }
                } catch {
                    showToast(t('dm_forward_error'), 'error');
                    listEl.querySelectorAll('.hub-forward-conv').forEach(b => b.disabled = false);
                }
            });
        });
    } catch {
        listEl.innerHTML = `<div class="hub-dm-list__empty">${esc(t('dm_load_failed'))}</div>`;
    }
}

/** Full-screen pinch-zoom/pan image viewer, opened by clicking an image/sticker bubble.
 * Plain fixed-position overlay (not a modal "window"), so the edge-to-edge top/bottom fade
 * just works — the exact class of bug the Android Dialog-based viewer fought for six rounds
 * doesn't exist here since the browser has no separate window/inset system to fight. */
function openImageViewer(m, partnerId, partnerName) {
    stopActiveVoice();
    document.querySelector('.hub-img-viewer')?.remove();
    const url = m.attachment.url;
    const viewer = document.createElement('div');
    viewer.className = 'hub-img-viewer';
    viewer.innerHTML = `
        <div class="hub-img-viewer__top">
            <button type="button" class="hub-img-viewer__btn" id="viewer-close" aria-label="${esc(t('dm_close_viewer'))}">←</button>
            <span class="hub-img-viewer__name">${esc(partnerName || '')}</span>
            <button type="button" class="hub-img-viewer__btn" id="viewer-forward" aria-label="${esc(t('dm_forward'))}">➜</button>
        </div>
        <div class="hub-img-viewer__stage" id="viewer-stage">
            <img class="hub-img-viewer__img" id="viewer-img" src="${esc(url)}" alt="" draggable="false">
        </div>
        <div class="hub-img-viewer__bottom">
            <input class="hub-img-viewer__reply-input" id="viewer-reply-input" type="text" maxlength="2000" placeholder="${esc(t('dm_write_placeholder'))}">
            <button class="hub-btn hub-btn--primary hub-img-viewer__reply-send" id="viewer-reply-send" type="button">${esc(t('dm_send'))}</button>
        </div>`;
    document.body.appendChild(viewer);

    const close = () => { document.removeEventListener('keydown', onKey); viewer.remove(); };
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    viewer.querySelector('#viewer-close').addEventListener('click', close);
    viewer.querySelector('#viewer-forward').addEventListener('click', () => openForwardPicker(m));

    const img = viewer.querySelector('#viewer-img');
    const stage = viewer.querySelector('#viewer-stage');
    let scale = 1, tx = 0, ty = 0, dragging = false, lastX = 0, lastY = 0, dismissDrag = 0;

    function applyTransform() { img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; }
    function clampPan() {
        const maxX = Math.max(0, (img.clientWidth * scale - stage.clientWidth) / 2);
        const maxY = Math.max(0, (img.clientHeight * scale - stage.clientHeight) / 2);
        tx = Math.min(maxX, Math.max(-maxX, tx));
        ty = Math.min(maxY, Math.max(-maxY, ty));
    }

    stage.addEventListener('wheel', e => {
        e.preventDefault();
        scale = Math.min(4, Math.max(1, scale - e.deltaY * 0.0015));
        if (scale === 1) { tx = 0; ty = 0; }
        clampPan();
        applyTransform();
    }, { passive: false });

    stage.addEventListener('dblclick', () => {
        scale = scale > 1 ? 1 : 2;
        tx = 0; ty = 0;
        applyTransform();
    });

    stage.addEventListener('pointerdown', e => {
        dragging = true; dismissDrag = 0;
        lastX = e.clientX; lastY = e.clientY;
        stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', e => {
        if (!dragging) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        if (scale > 1) {
            tx += dx; ty += dy;
            clampPan();
            applyTransform();
        } else if (dy > 0 || dismissDrag > 0) {
            dismissDrag += dy;
            viewer.style.opacity = String(Math.max(0.4, 1 - dismissDrag / 300));
            img.style.transform = `translateY(${dismissDrag}px)`;
        }
    });
    stage.addEventListener('pointerup', () => {
        dragging = false;
        if (scale === 1 && dismissDrag > 120) { close(); return; }
        if (scale === 1) { dismissDrag = 0; viewer.style.opacity = '1'; applyTransform(); }
    });

    const replyInput = viewer.querySelector('#viewer-reply-input');
    viewer.querySelector('#viewer-reply-send').addEventListener('click', async () => {
        const msg = replyInput.value.trim();
        if (!msg) return;
        replyInput.disabled = true;
        try {
            // Sending from inside the viewer is always a reply to the photo being looked at —
            // matches the app's own bottom reply bar, which quotes the viewed image.
            const res = await api('POST', '/dm/send', { receiverId: partnerId, message: msg, reply_to: m.id });
            if (res.success) { close(); appendMessageToThread(res.message); }
            else showToast(res.error || t('dm_error_generic'), 'error');
        } catch { showToast(t('dm_error_generic'), 'error'); }
        replyInput.disabled = false;
    });
    replyInput.addEventListener('keydown', e => { if (e.key === 'Enter') viewer.querySelector('#viewer-reply-send').click(); });
}

/** Reset the conversation-list + thread-pane *content* for the DM/general-chat view. The outer
 * .hub-dm-layout/#dm-list/#dm-thread/#chat-thread elements themselves are static (community.html)
 * and never rebuilt here — chat.js binds to #chat-thread's children once at module load, and the
 * page-level login gate above this whole script already guarantees `user()` by the time this
 * runs, so there's no "not logged in" case left to render here either. */
function renderDM() {
    const layout = document.getElementById('dm-layout');
    const list = document.getElementById('dm-list');
    const thread = document.getElementById('dm-thread');
    if (!layout || !list || !thread) return;
    list.innerHTML = `<div class="hub-dm-list__empty">${esc(t('dm_loading'))}</div>`;
    thread.innerHTML = `<div class="hub-dm-empty">${esc(t('dm_select_conversation'))}</div>`;
    thread.hidden = false;
    document.getElementById('chat-thread')?.setAttribute('hidden', '');
    layout.classList.remove('hub-dm-layout--thread-open');
}

/** Open general chat in the thread pane — the merged list's pinned "General" row leads here.
 * Shares .hub-dm-layout's thread slot with #dm-thread (only one of the two is ever visible,
 * see closeGeneralChat()/openConversation()), so on desktop it sits beside the conversation
 * list exactly like an open DM does, and on mobile it goes fullscreen the same way too — not a
 * separate full-page view any more (that was the pre-2026-09-02 design). chat.js already polls
 * independently and binds to #chat-thread's children once at module load, so there's nothing to
 * (re)render here beyond toggling visibility. */
function openGeneralChat() {
    stopActiveVoice();
    stopDmPolling();
    S.dmPartner = null;
    S.generalChatOpen = true;
    document.querySelectorAll('.hub-dm-conv').forEach(c => c.classList.toggle('hub-dm-conv--active', c.dataset.id === 'general'));
    document.getElementById('dm-thread')?.setAttribute('hidden', '');
    const chatThread = document.getElementById('chat-thread');
    if (chatThread) chatThread.hidden = false;
    document.getElementById('dm-layout')?.classList.add('hub-dm-layout--thread-open');
    setMobileFullscreen(true);
}

/** Close general chat back to the conversation list — chat.js's #chat-back button calls this via
 * window.cnCommunityBackToChatList(). Mirrors an open DM thread's own back button. */
function closeGeneralChat() {
    S.generalChatOpen = false;
    document.getElementById('chat-thread')?.setAttribute('hidden', '');
    const thread = document.getElementById('dm-thread');
    if (thread) thread.hidden = false;
    document.getElementById('dm-layout')?.classList.remove('hub-dm-layout--thread-open');
    setMobileFullscreen(false);
    document.querySelectorAll('.hub-dm-conv--general').forEach(c => c.classList.remove('hub-dm-conv--active'));
}

/** One-line preview of the latest general-chat message, for its row in the merged chat list
 * (mirrors the Android app's ChatListPage, which folds general chat into the same conversation
 * list as a pinned row with GENERAL_ID — see ChatViewModel.kt). Never throws. */
async function fetchGeneralPreview() {
    try {
        const data = await api('GET', '/chat/messages?limit=1');
        const m = data.messages?.[0];
        if (!m) return '';
        const who = m.user?.username ? `${m.user.username}: ` : '';
        return who + (m.message || '');
    } catch { return ''; }
}

/** Fetch DM conversation list (grouped by partner), with the general community chat pinned
 * as the first row — clicking it opens general chat in the shared thread pane (see
 * openGeneralChat()), clicking a real conversation opens its thread the same way as before. */
async function loadConversations() {
    const list = document.getElementById('dm-list');
    if (!list) return;
    ensureDmLocalPrefsLoaded();

    // Bound once per render — #dm-list is a fresh element every time renderDM() runs, so this
    // never accumulates duplicate listeners across navigations.
    list.addEventListener('click', e => {
        const c = e.target.closest('.hub-dm-conv');
        if (!c) return;
        if (c.dataset.id === 'general') { openGeneralChat(); return; }
        openConversation(+c.dataset.id, c.dataset.name, c.dataset.avatar);
    });
    list.addEventListener('contextmenu', e => {
        const c = e.target.closest('.hub-dm-conv');
        if (!c || c.dataset.id === 'general') return;
        e.preventDefault();
        const conv = S.dmConversations.find(cv => cv.partner_id === +c.dataset.id);
        if (conv) openConversationContextMenu(e.clientX, e.clientY, conv);
    });

    const generalRow = `
        <button class="hub-dm-conv hub-dm-conv--general${S.generalChatOpen ? ' hub-dm-conv--active' : ''}" data-id="general">
            <div class="hub-dm-conv__avatar">💬</div>
            <div class="hub-dm-conv__body">
                <div class="hub-dm-conv__name">${esc(t('community_chat_header'))}</div>
                <div class="hub-dm-conv__preview" id="dm-general-preview">${esc(t('community_chat_status_active'))}</div>
            </div>
        </button>`;

    try {
        const [data, generalPreview] = await Promise.all([api('GET', '/dm/conversations'), fetchGeneralPreview()]);
        if (!data.success) throw 0;
        let convs = data.conversations || [];

        // Local-only "delete chat": hide until a message newer than the delete-time arrives
        convs = convs.filter(c => {
            const hiddenAt = S.dmHidden.get(String(c.partner_id));
            if (!hiddenAt) return true;
            if (new Date(c.last_time) > new Date(hiddenAt)) {
                S.dmHidden.delete(String(c.partner_id));
                saveDmHidden(S.dmHidden);
                return true;
            }
            return false;
        });

        // Local-only "pin": pinned conversations float to the top
        convs.sort((a, b) => {
            const pa = S.dmPins.has(String(a.partner_id)) ? 1 : 0;
            const pb = S.dmPins.has(String(b.partner_id)) ? 1 : 0;
            if (pa !== pb) return pb - pa;
            return new Date(b.last_time) - new Date(a.last_time);
        });

        S.dmConversations = convs;

        const convsHtml = convs.map(c => {
            const pinned = S.dmPins.has(String(c.partner_id));
            const muted = S.dmMutes.has(String(c.partner_id));
            return `
            <button class="hub-dm-conv${S.dmPartner === c.partner_id ? ' hub-dm-conv--active' : ''}" data-id="${c.partner_id}" data-name="${esc(c.partner_name)}" data-avatar="${esc(c.partner_avatar || '')}">
                <div class="hub-dm-conv__avatar">${avatarHtml(c.partner_name, c.partner_avatar, 36)}</div>
                <div class="hub-dm-conv__body">
                    <div class="hub-dm-conv__name">${pinned ? '📌 ' : ''}${esc(c.partner_name)}${muted ? ' 🔕' : ''}</div>
                    <div class="hub-dm-conv__preview">${esc(c.last_message)}</div>
                </div>
                ${c.unread > 0 ? `<span class="hub-badge hub-badge--count">${c.unread}</span>` : ''}
            </button>`;
        }).join('');

        list.innerHTML = generalRow + (convsHtml || `<div class="hub-dm-list__empty">${esc(t('dm_no_conversations'))}</div>`);
        if (generalPreview) document.getElementById('dm-general-preview').textContent = generalPreview;

        if (S.generalChatOpen) {
            openGeneralChat();
        } else if (S.dmPartner) {
            const found = convs.find(c => c.partner_id === S.dmPartner);
            if (found) openConversation(S.dmPartner, found.partner_name, found.partner_avatar);
        }
    } catch {
        S.dmConversations = [];
        list.innerHTML = generalRow + `<div class="hub-dm-list__empty">${esc(t('dm_load_failed'))}</div>`;
    }
}

/** Open a DM conversation thread with a specific user */
async function openConversation(partnerId, partnerName, partnerAvatar) {
    stopActiveVoice();
    stopDmPolling();
    S.dmPartner = partnerId;
    S.dmReplyTo = null;
    S.dmEditingId = null;
    S.generalChatOpen = false;
    const thread = document.getElementById('dm-thread');
    if (!thread) return;
    document.getElementById('chat-thread')?.setAttribute('hidden', '');
    thread.hidden = false;

    document.querySelectorAll('.hub-dm-conv').forEach(c => {
        c.classList.toggle('hub-dm-conv--active', +c.dataset.id === partnerId);
        if (+c.dataset.id === partnerId) {
            if (!partnerName) partnerName = c.dataset.name;
            if (!partnerAvatar) partnerAvatar = c.dataset.avatar;
        }
    });
    S.dmPartnerName = partnerName || t('dm_unknown_user');

    document.getElementById('dm-layout')?.classList.add('hub-dm-layout--thread-open');
    setMobileFullscreen(true);

    const u = user();
    thread.innerHTML = `
        <div class="hub-dm-thread__header">
            <button class="hub-dm-back-btn" id="dm-back-btn" aria-label="${esc(t('dm_back_aria'))}" type="button">←</button>
            <div class="hub-dm-conv__avatar" style="width:30px;height:30px;font-size:.7rem">${avatarHtml(partnerName, partnerAvatar, 30)}</div>
            <span style="color:var(--text-light);font-weight:600;font-size:.9rem">${esc(S.dmPartnerName)}</span>
        </div>
        <div class="hub-dm-messages" id="dm-messages"><div class="hub-empty"><div class="hub-empty__icon">⏳</div>${esc(t('dm_loading'))}</div></div>
        <div class="hub-dm-compose-dock" id="dm-compose-dock">
            <div class="hub-dm-reply-banner" id="dm-compose-banner" hidden></div>
            <div class="hub-dm-sticker-panel" id="dm-sticker-panel" hidden></div>
            <div class="hub-dm-pending" id="dm-pending" hidden></div>
            <div class="chat-login-notice" id="dm-muted-notice" hidden><p><span id="dm-muted-text"></span></p></div>
            <form class="hub-dm-form" id="dm-form">
                <input type="file" id="dm-image-input" accept="image/jpeg,image/png,image/webp,image/gif" hidden>
                <button type="button" class="hub-dm-form__round-btn" id="dm-attach-btn" title="${esc(t('dm_attach_image'))}">+</button>
                <button type="button" class="hub-dm-form__round-btn" id="dm-sticker-btn" title="${esc(t('dm_sticker_btn'))}">😊</button>
                <div class="hub-dm-form__field" id="dm-field">
                    <input class="hub-dm-form__input" type="text" placeholder="${esc(t('dm_write_placeholder'))}" maxlength="2000">
                    <button type="button" class="hub-dm-form__mic-send-btn" id="dm-mic-send-btn" aria-label="${esc(t('dm_record_voice'))}">🎤</button>
                </div>
            </form>
        </div>`;
    applyDmMuteUI();

    thread.querySelector('#dm-back-btn').addEventListener('click', () => {
        stopActiveVoice();
        stopDmPolling();
        S.dmPartner = null;
        S.dmReplyTo = null;
        S.dmEditingId = null;
        document.getElementById('dm-layout')?.classList.remove('hub-dm-layout--thread-open');
        setMobileFullscreen(false);
        document.querySelectorAll('.hub-dm-conv').forEach(c => c.classList.remove('hub-dm-conv--active'));
        thread.innerHTML = `<div class="hub-dm-empty">${esc(t('dm_select_conversation'))}</div>`;
    });

    const dmMessagesEl = document.getElementById('dm-messages');
    try {
        const data = await api('GET', `/dm/messages/${partnerId}`);
        const msgs = data.messages || [];
        S.dmMessages = msgs;
        if (!msgs.length) {
            dmMessagesEl.innerHTML = `<div class="hub-dm-empty" style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-gray)">${esc(t('dm_first_message'))}</div>`;
        } else {
            const msgsById = new Map(msgs.map(x => [x.id, x]));
            dmMessagesEl.innerHTML = msgs.map((m, i) => renderMessageHtml(m, u.id, S.dmPartnerName, msgsById, msgs[i - 1] || null, msgs[i + 1] || null)).join('');
            dmMessagesEl.scrollTop = dmMessagesEl.scrollHeight;
        }
    } catch {
        S.dmMessages = [];
        dmMessagesEl.innerHTML = `<div class="hub-empty"><div class="hub-empty__icon">❌</div>${esc(t('dm_error_generic'))}</div>`;
    }

    dmPollTimer = setInterval(() => syncDmMessages(partnerId), DM_POLL_INTERVAL_MS);

    dmMessagesEl.addEventListener('click', e => {
        const reportBtn = e.target.closest('.report-trigger-btn');
        if (reportBtn && typeof window.openReportModal === 'function') {
            window.openReportModal({
                contentType: reportBtn.dataset.reportType,
                contentId:   reportBtn.dataset.reportId,
                contentPreview: reportBtn.dataset.reportPreview,
            });
            return;
        }
        const voiceToggle = e.target.closest('[data-voice-toggle]');
        if (voiceToggle) { toggleVoicePlayback(voiceToggle.closest('.hub-dm-voice')); return; }
        const voiceBars = e.target.closest('[data-voice-bars]');
        if (voiceBars) { seekVoice(voiceBars, e.clientX); return; }
        const reactBtn = e.target.closest('[data-react-emoji]');
        if (reactBtn) {
            const row = reactBtn.closest('.hub-dm-msg-row');
            const m = S.dmMessages.find(x => x.id === +row.dataset.msgId);
            if (m) toggleReaction(m, reactBtn.dataset.reactEmoji);
            return;
        }
        const jump = e.target.closest('[data-jump-to]');
        if (jump) {
            const target = document.querySelector(`.hub-dm-msg-row[data-msg-id="${jump.dataset.jumpTo}"]`);
            target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        const viewable = e.target.closest('[data-viewable]');
        if (viewable) {
            const row = viewable.closest('.hub-dm-msg-row');
            const m = S.dmMessages.find(x => x.id === +row.dataset.msgId);
            if (m?.attachment) openImageViewer(m, partnerId, S.dmPartnerName);
        }
    });

    dmMessagesEl.addEventListener('contextmenu', e => {
        const row = e.target.closest('.hub-dm-msg-row');
        if (!row) return;
        e.preventDefault();
        const m = S.dmMessages.find(x => x.id === +row.dataset.msgId);
        if (m) openMessageContextMenu(e.clientX, e.clientY, m, row.dataset.mine === '1', S.dmPartnerName);
    });

    const dmTextInput = thread.querySelector('.hub-dm-form__input');
    const dmImageInput = document.getElementById('dm-image-input');
    const dmAttachBtn = document.getElementById('dm-attach-btn');
    const dmStickerBtn = document.getElementById('dm-sticker-btn');
    const dmStickerPanel = document.getElementById('dm-sticker-panel');
    const dmField = document.getElementById('dm-field');
    const dmMicSendBtn = document.getElementById('dm-mic-send-btn');
    const dmPendingEl = document.getElementById('dm-pending');
    let pendingImageFile = null;
    let isRecording = false;

    // Merged mic/send button, iMessage-style (Composer in ChatScreen.kt): shows the mic while
    // the field is empty, swaps to a send arrow the moment there's text or a pending image.
    function updateComposerButton() {
        if (isRecording) return;
        const hasContent = !!(dmTextInput.value.trim() || pendingImageFile);
        dmMicSendBtn.classList.toggle('hub-dm-form__mic-send-btn--send', hasContent);
        dmMicSendBtn.textContent = hasContent ? '↑' : '🎤';
        dmMicSendBtn.setAttribute('aria-label', hasContent ? t('dm_send') : t('dm_record_voice'));
    }
    dmTextInput.addEventListener('input', updateComposerButton);

    function setPendingImage(file) {
        pendingImageFile = file;
        if (file) {
            dmPendingEl.hidden = false;
            dmPendingEl.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="">
                <span class="hub-dm-pending__name">${esc(file.name)}</span>
                <button type="button" class="hub-dm-pending__remove" aria-label="Remove">&times;</button>`;
            dmPendingEl.querySelector('.hub-dm-pending__remove').addEventListener('click', () => setPendingImage(null));
        } else {
            dmPendingEl.hidden = true;
            dmPendingEl.innerHTML = '';
        }
        updateComposerButton();
    }

    dmAttachBtn.addEventListener('click', () => dmImageInput.click());
    dmImageInput.addEventListener('change', () => {
        if (dmImageInput.files[0]) setPendingImage(dmImageInput.files[0]);
        dmImageInput.value = '';
    });

    dmStickerBtn.addEventListener('click', async () => {
        const opening = dmStickerPanel.hidden;
        dmStickerPanel.hidden = !opening;
        if (!opening || dmStickerPanel.dataset.loaded) return;
        dmStickerPanel.innerHTML = `<div class="hub-dm-sticker-panel__empty">${esc(t('dm_loading'))}</div>`;
        try {
            const data = await api('GET', '/stickers');
            const stickers = data.stickers || [];
            dmStickerPanel.innerHTML = stickers.length
                ? stickers.map(s => `<img class="hub-dm-sticker-panel__item" src="${esc(s.url)}" data-sticker-key="${esc(s.key)}" alt="">`).join('')
                : `<div class="hub-dm-sticker-panel__empty">${esc(t('dm_stickers_empty'))}</div>`;
            dmStickerPanel.dataset.loaded = '1';
            dmStickerPanel.querySelectorAll('[data-sticker-key]').forEach(imgEl => {
                imgEl.addEventListener('click', async () => {
                    try {
                        const res = await api('POST', '/dm/send', {
                            receiverId: partnerId, message: '',
                            attachment_key: imgEl.dataset.stickerKey, attachment_type: 'sticker',
                        });
                        if (res.success) appendMessageToThread(res.message);
                        else showToast(res.error || t('dm_error_generic'), 'error');
                    } catch { showToast(t('dm_error_generic'), 'error'); }
                });
            });
        } catch {
            dmStickerPanel.innerHTML = `<div class="hub-dm-sticker-panel__empty">${esc(t('dm_load_failed'))}</div>`;
        }
    });

    let mediaRecorder = null;
    let recordedChunks = [];
    let recordStart = 0;

    function toggleRecording() {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            return;
        }
        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            const mimeType = ['audio/webm', 'audio/ogg', 'audio/mp4'].find(m => window.MediaRecorder?.isTypeSupported(m)) || '';
            mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            recordedChunks = [];
            recordStart = Date.now();
            isRecording = true;
            dmField.classList.add('hub-dm-form__field--recording');
            dmMicSendBtn.classList.add('hub-dm-form__mic-send-btn--recording');
            dmMicSendBtn.textContent = '⏹';
            mediaRecorder.addEventListener('dataavailable', ev => { if (ev.data.size > 0) recordedChunks.push(ev.data); });
            mediaRecorder.addEventListener('stop', async () => {
                stream.getTracks().forEach(tr => tr.stop());
                isRecording = false;
                dmField.classList.remove('hub-dm-form__field--recording');
                dmMicSendBtn.classList.remove('hub-dm-form__mic-send-btn--recording');
                updateComposerButton();
                const durationMs = Date.now() - recordStart;
                const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
                if (blob.size === 0) return;
                try {
                    const presign = await api('POST', '/uploads/presign', { kind: 'voice', contentType: blob.type, fileSize: blob.size });
                    if (!presign.success) throw new Error(presign.error || 'Presign failed');
                    const putRes = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob });
                    if (!putRes.ok) throw new Error('Upload failed');
                    const res = await api('POST', '/dm/send', {
                        receiverId: partnerId, message: '',
                        attachment_key: presign.key, attachment_type: 'voice',
                        attachment_size: blob.size, attachment_duration_ms: durationMs,
                        reply_to: S.dmReplyTo?.id || undefined,
                    });
                    S.dmReplyTo = null; renderComposeBanner();
                    if (res.success) appendMessageToThread(res.message);
                    else showToast(res.error || t('listing_generic_error'), 'error');
                } catch (err) {
                    console.error('Voice message failed:', err);
                    showToast(t('listing_generic_error'), 'error');
                }
            });
            mediaRecorder.start();
        }).catch(err => {
            console.error('Mic access failed:', err);
            showToast(t('dm_mic_denied'), 'error');
        });
    }

    dmMicSendBtn.addEventListener('click', () => {
        if (isRecording) { toggleRecording(); return; }
        const hasContent = dmTextInput.value.trim() || pendingImageFile;
        if (hasContent) document.getElementById('dm-form').requestSubmit();
        else toggleRecording();
    });

    document.getElementById('dm-form').addEventListener('submit', async e => {
        e.preventDefault();
        const msg = dmTextInput.value.trim();

        if (S.dmEditingId) {
            if (!msg) return;
            dmTextInput.value = '';
            updateComposerButton();
            await submitEdit(msg);
            return;
        }

        if (!msg && !pendingImageFile) return;
        dmMicSendBtn.disabled = true;
        const imageFile = pendingImageFile;

        try {
            let attachmentKey = null;
            if (imageFile) {
                try {
                    const presign = await api('POST', '/uploads/presign', { kind: 'image', contentType: imageFile.type, fileSize: imageFile.size });
                    if (!presign.success) throw new Error(presign.error || 'Presign failed');
                    const putRes = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': imageFile.type }, body: imageFile });
                    if (!putRes.ok) throw new Error('Upload failed');
                    attachmentKey = presign.key;
                } catch (err) {
                    // Keep the pending image + typed text + reply state intact so the user can
                    // retry — silently falling back to a text-only send here (as this used to)
                    // meant a failed upload looked exactly like "it ignored my photo".
                    console.error('DM image upload failed:', err);
                    showToast(t('dm_image_upload_failed'), 'error');
                    dmMicSendBtn.disabled = false;
                    return;
                }
            }

            dmTextInput.value = '';
            setPendingImage(null);
            const replyToId = S.dmReplyTo?.id;
            S.dmReplyTo = null; renderComposeBanner();

            const body = { receiverId: partnerId, message: msg };
            if (attachmentKey) {
                body.attachment_key = attachmentKey;
                body.attachment_type = 'image';
                body.attachment_size = imageFile.size;
            }
            if (replyToId) body.reply_to = replyToId;
            const res = await api('POST', '/dm/send', body);
            if (res.success) appendMessageToThread(res.message);
            else showToast(res.error || t('listing_generic_error'), 'error');
        } catch (err) {
            console.error('DM send failed:', err);
            showToast(t('listing_generic_error'), 'error');
        } finally {
            dmMicSendBtn.disabled = false;
        }
    });
}

/* ================================================================
   COMMUNITY PHOTOS
   ================================================================ */

let photosState = { page: 1, items: [] };

function renderPhotos() {
    const v = document.getElementById('view-photos');
    if (!v) return;
    const u = user();
    v.innerHTML = `
        <div class="hub-view-header">
            <h2 class="hub-view-header__title">${I18nModule.t('photos_title')}</h2>
            ${u ? `<button class="hub-btn hub-btn--primary" id="photos-upload-btn">📸 ${I18nModule.t('photos_upload_btn')}</button>` : ''}
        </div>
        <div class="hub-photos-grid" id="photos-grid"></div>
        <div class="hub-photos-loadmore" id="photos-loadmore" hidden>
            <button class="hub-btn hub-btn--secondary" id="photos-loadmore-btn">${I18nModule.t('photos_load_more')}</button>
        </div>
    `;

    v.querySelector('#photos-upload-btn')?.addEventListener('click', openPhotoUploadModal);
    v.querySelector('#photos-loadmore-btn')?.addEventListener('click', () => loadPhotos(true));
}

/** Open modal dialog to upload a new community photo — mirrors openAddListingModal()'s singleton overlay + dropzone pattern */
function openPhotoUploadModal() {
    const _prev = document.querySelector('.hub-modal-overlay');
    if (_prev) _prev.remove();

    let selectedFile = null;

    const overlay = document.createElement('div');
    overlay.className = 'hub-modal-overlay';
    overlay.innerHTML = `
        <div class="hub-modal">
            <div class="hub-modal__header">
                <span class="hub-modal__title">${I18nModule.t('photos_upload_title')}</span>
                <button class="hub-modal__close" aria-label="Close">&times;</button>
            </div>
            <div class="hub-modal__body">
                <div class="hub-form-group">
                    <div class="hub-upload-zone" id="photo-upload-zone">
                        <input type="file" id="photo-upload-file" accept="image/jpeg,image/png,image/webp,image/gif" hidden>
                        <span class="hub-upload-zone__icon">📸</span>
                        <span class="hub-upload-zone__text" id="photo-upload-zone-text">${I18nModule.t('photos_no_file')}</span>
                    </div>
                </div>
                <div class="hub-form-group">
                    <label class="hub-form-label">${I18nModule.t('photos_caption_placeholder')}</label>
                    <textarea class="hub-form-textarea" id="photo-upload-caption" maxlength="300" rows="2"></textarea>
                </div>
                <p class="hub-form-status" id="photo-upload-status"></p>
            </div>
            <div class="hub-modal__footer">
                <button type="button" class="hub-btn hub-btn--secondary hub-modal__cancel">Cancel</button>
                <button type="button" class="hub-btn hub-btn--primary" id="photo-upload-submit">${I18nModule.t('photos_upload_submit')}</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.hub-modal__close').addEventListener('click', close);
    overlay.querySelector('.hub-modal__cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    const zone = overlay.querySelector('#photo-upload-zone');
    const fileInput = overlay.querySelector('#photo-upload-file');
    const zoneText = overlay.querySelector('#photo-upload-zone-text');

    function setFile(file) {
        selectedFile = file || null;
        zoneText.textContent = selectedFile ? selectedFile.name : I18nModule.t('photos_no_file');
    }

    zone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => setFile(fileInput.files[0]));
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('hub-upload-zone--drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('hub-upload-zone--drag'));
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('hub-upload-zone--drag');
        setFile(e.dataTransfer.files[0]);
    });

    overlay.querySelector('#photo-upload-submit').addEventListener('click', () => submitPhotoUpload(overlay, () => selectedFile, close));
}

async function loadPhotos(append) {
    const grid = document.getElementById('photos-grid');
    if (!grid) return;

    if (!append) {
        photosState = { page: 1, items: [] };
        grid.innerHTML = '<div class="hub-empty"><div class="hub-empty__icon">⏳</div></div>';
    }

    try {
        const data = await api('GET', `/community/photos?page=${photosState.page}`);
        if (!data.success) throw 0;
        photosState.items.push(...data.photos);

        if (!photosState.items.length) {
            grid.innerHTML = `<div class="hub-empty"><div class="hub-empty__icon">📸</div><p>${I18nModule.t('photos_empty')}</p></div>`;
            document.getElementById('photos-loadmore').hidden = true;
            return;
        }

        const u = user();
        grid.innerHTML = photosState.items.map(p => `
            <div class="hub-photo-card">
                <img src="${esc(p.imageUrl)}" alt="${esc(p.caption)}" loading="lazy">
                <div class="hub-photo-card__meta">
                    <span class="hub-photo-card__user">${esc(p.username)}</span>
                    ${u && u.id === p.userId ? `<button class="hub-photo-card__delete" data-id="${p.id}" title="${I18nModule.t('photos_delete')}">🗑</button>` : ''}
                </div>
                ${p.caption ? `<p class="hub-photo-card__caption">${esc(p.caption)}</p>` : ''}
            </div>
        `).join('');

        document.getElementById('photos-loadmore').hidden = data.photos.length < 24;
        photosState.page++;

        grid.querySelectorAll('.hub-photo-card__delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!(await confirmModal(I18nModule.t('photos_delete_confirm')))) return;
                const res = await api('DELETE', `/community/photos/${btn.dataset.id}`);
                if (res.success) loadPhotos(false);
            });
        });
    } catch {
        if (!photosState.items.length) grid.innerHTML = `<div class="hub-empty"><p>${I18nModule.t('photos_error')}</p></div>`;
    }
}

async function submitPhotoUpload(overlay, getFile, close) {
    const captionInput = overlay.querySelector('#photo-upload-caption');
    const statusEl = overlay.querySelector('#photo-upload-status');
    const submitBtn = overlay.querySelector('#photo-upload-submit');
    const file = getFile();
    if (!file) { statusEl.textContent = I18nModule.t('photos_no_file'); return; }

    submitBtn.disabled = true;
    statusEl.textContent = I18nModule.t('photos_uploading');

    try {
        const presign = await api('POST', '/uploads/presign', {
            kind: 'gallery',
            contentType: file.type,
            fileSize: file.size,
        });
        if (!presign.success) throw new Error(presign.error || 'Presign failed');

        const putRes = await fetch(presign.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': file.type },
            body: file,
        });
        if (!putRes.ok) throw new Error('Upload failed');

        const meta = await api('POST', '/community/photos', {
            imageKey: presign.key,
            caption: captionInput.value.trim(),
        });
        if (!meta.success) throw new Error(meta.error || 'Save failed');

        close();
        loadPhotos(false);
    } catch (err) {
        statusEl.textContent = err.message || I18nModule.t('photos_upload_error');
    } finally {
        submitBtn.disabled = false;
    }
}

/* ================================================================
   UNREAD BADGE POLLING
   ================================================================ */

/** Poll for unread DM count and update sidebar badge */
function startUnreadPolling() {
    const badge = document.getElementById('dm-unread-badge');
    if (!badge) return;

    async function tick() {
        if (!user()) return;
        try {
            const d = await api('GET', '/dm/unread-count');
            if (d.success && d.count > 0) { badge.textContent = d.count; badge.hidden = false; }
            else badge.hidden = true;
        } catch { /* ignore */ }
    }
    tick();
    setInterval(tick, 15000);
}

/* ================================================================
   BOOT
   ================================================================ */

// Always initialize mobile controls, even if later logic exits early.
initMobileSidebarControls();

// Login gate: block community if not logged in
// Gate only the actual hub page (community.html); the welcome/landing page (#community-landing) is public.
const _isWelcomePage = !!document.getElementById('community-landing');
if (!user() && !_isWelcomePage) {
    const page = document.querySelector('.community-page');
    if (page) {
        page.innerHTML = `
            <div class="hub-login-gate">
                <div class="hub-login-gate__icon">🔒</div>
                <h2 class="hub-login-gate__title">${t('community_login_required_title')}</h2>
                <p class="hub-login-gate__text">${t('community_login_required_text')}</p>
                <a href="login.html" class="hub-login-gate__btn">${t('community_login_required_btn')}</a>
            </div>`;
    }
} else {

// Exposed for chat.js (a separate module scope) so its own #chat-back button can close general
// chat back to the conversation list, mirroring an open DM thread's own back button.
window.cnCommunityBackToChatList = () => closeGeneralChat();

initSidebar();
startUnreadPolling();
startMuteStatusPolling();

// Hide admin-only sidebar items for non-admin users
(function initAdminVisibility() {
    const u = user();
    const isAdminUser = u && u.role === 'admin';
    document.querySelectorAll('.hub-sidebar__admin-only').forEach(el => {
        el.style.display = isAdminUser ? '' : 'none';
    });
})();

// Deep link: handles hash-based navigation on load and hash changes
function handleHashNavigation() {
    const hash = window.location.hash;

    // Deep link listing: #listing-123
    const listingMatch = hash.match(/^#listing-(\d+)$/);
    if (listingMatch) {
        showView('marketplace');
        openListingDetail(+listingMatch[1]);
        return;
    }

    // Deep link forum thread: #forum/ps/thread/123
    const threadDeepMatch = hash.match(/^#forum\/([^/]+)\/thread\/(\d+)$/);
    if (threadDeepMatch) {
        const con = threadDeepMatch[1];
        const tid = +threadDeepMatch[2];
        const validConsoles = ['ps', 'xbox', 'nintendo', 'pc', 'general', 'other'];
        if (validConsoles.includes(con)) {
            S.console = con;
            renderForum();
            openThread(tid);
            return;
        }
    }

    // Deep link: open the "New listing" modal directly (used by the "Add listing"
    // button in Home's Collection panel, which links to community.html#marketplace/new)
    if (hash === '#marketplace/new') {
        navigate('marketplace', null, '');
        if (user()) openAddListingModal();
        return;
    }

    // Deep link: #chat — general chat lives inside the DM view now (openGeneralChat()), not a
    // view of its own, but the hash is kept working in case anything still links to it.
    if (hash === '#chat') {
        navigate('dm', null, '');
        openGeneralChat();
        return;
    }

    // Section: #marketplace, #marketplace/consoles, #forum/ps, etc.
    if (hash && hash.length > 1) {
        const parts = hash.slice(1).split('/');
        const view = parts[0];
        const con  = parts[1] || null;
        const cat  = parts[2] || '';

        const validViews = ['forum', 'marketplace', 'repair', 'repair-requests', 'repair-admin', 'dm', 'photos'];
        if (validViews.includes(view)) {
            // Mark the active sidebar item
            sidebar?.querySelectorAll('.hub-sidebar__item').forEach(item => {
                const match = item.dataset.view === view &&
                    (item.dataset.console || null) === con &&
                    (item.dataset.category ?? '') === cat;
                item.classList.toggle('hub-sidebar__item--active', match);
            });
            navigate(view, con, cat);
            return;
        }
    }

    // Default route
    navigate('marketplace', null, '');
}
handleHashNavigation();
window.addEventListener('hashchange', handleHashNavigation);

} // end login gate else

// ── Mobile bottom nav — community view routing ───────────────
(function initMbnTabs() {
    const btn = document.getElementById('mbn-more-btn');
    const dd  = document.getElementById('mbn-dropdown');

    function switchView(view, con, cat) {
        navigate(view || 'dm', con || null, cat || '');

        // Sync active state on MBN items
        document.querySelectorAll('.mbn-item[data-mbn-view], .mbn-dd-item[data-mbn-view]').forEach(el => {
            const match = el.dataset.mbnView === view &&
                (el.dataset.mbnConsole || '') === (con || '') &&
                (el.dataset.mbnCategory || '') === (cat || '');
            el.classList.toggle('mbn-item--active', match);
        });
    }

    function buildDropdown() {
        if (!dd) return;
        dd.innerHTML = '';

        // Collect data from sidebar sections
        const consoles = [];
        const flatSections = [];

        document.querySelectorAll('.hub-sidebar__section').forEach(section => {
            const heading = section.querySelector('.hub-sidebar__heading');
            if (!heading) return;

            const consoleGroups = section.querySelectorAll('.hub-sidebar__console');
            if (consoleGroups.length) {
                consoleGroups.forEach(cg => {
                    const nameEl = cg.querySelector('.hub-sidebar__console-name');
                    const consoleName = nameEl ? nameEl.textContent.replace(/\s+/g, ' ').trim() : '';
                    const color = nameEl ? (nameEl.style.getPropertyValue('--console-color') || '') : '';
                    const first = cg.querySelector('.hub-sidebar__item');
                    consoles.push({ name: consoleName, color, slug: first?.dataset.console || '' });
                });
                return;
            }

            const items = [];
            section.querySelectorAll('.hub-sidebar__item').forEach(item => {
                if (item.classList.contains('hub-sidebar__item--locked')) return;
                if (window.getComputedStyle(item).display === 'none') return;
                items.push({ el: item, label: item.textContent.replace(/\s+/g, ' ').trim() });
            });
            if (items.length) flatSections.push({ heading: heading.textContent.replace(/\s+/g, ' ').trim(), items });
        });

        // Flat sections (General Chat, Repair, Marketplace, Messages)
        flatSections.forEach(sec => {
            const h = document.createElement('div');
            h.className = 'mbn-dd-heading';
            h.textContent = sec.heading;
            dd.appendChild(h);

            sec.items.forEach(it => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'mbn-dd-item';
                b.dataset.mbnView = it.el.dataset.view || '';
                if (it.el.dataset.console) b.dataset.mbnConsole = it.el.dataset.console;
                if (typeof it.el.dataset.category === 'string') b.dataset.mbnCategory = it.el.dataset.category;
                b.innerHTML = `<span>${it.label}</span>`;
                b.addEventListener('click', () => {
                    switchView(b.dataset.mbnView, b.dataset.mbnConsole || '', b.dataset.mbnCategory || '');
                    dd.classList.remove('is-open');
                    btn.setAttribute('aria-expanded', 'false');
                });
                dd.appendChild(b);
            });
        });

        // Console chip rows (Community + Repair)
        if (consoles.length) {
            [{ heading: 'Community', view: 'forum' }, { heading: 'Repair', view: 'repair' }].forEach(g => {
                const h = document.createElement('div');
                h.className = 'mbn-dd-heading';
                h.textContent = g.heading;
                dd.appendChild(h);

                const row = document.createElement('div');
                row.className = 'mbn-dd-consoles';
                consoles.forEach(c => {
                    const chip = document.createElement('button');
                    chip.type = 'button';
                    chip.className = 'mbn-dd-chip';
                    chip.dataset.mbnView = g.view;
                    chip.dataset.mbnConsole = c.slug;
                    chip.innerHTML = `<span class="mbn-dd-dot" style="background:${c.color}"></span><span>${c.name}</span>`;
                    chip.addEventListener('click', () => {
                        switchView(g.view, c.slug, '');
                        dd.classList.remove('is-open');
                        btn.setAttribute('aria-expanded', 'false');
                    });
                    row.appendChild(chip);
                });
                dd.appendChild(row);
            });
        }

        // Static links at bottom
        const sep = document.createElement('div');
        sep.className = 'mbn-dd-sep';
        dd.appendChild(sep);

        [{ href: 'profil.html', icon: '👤', label: 'Profile' },
         { href: 'evolutie.html', icon: '🕹️', label: 'Consoles' }].forEach(s => {
            const a = document.createElement('a');
            a.href = s.href;
            a.className = 'mbn-dd-item';
            a.innerHTML = `<span class="mbn-dd-icon">${s.icon}</span><span>${s.label}</span>`;
            dd.appendChild(a);
        });
    }

    // Wire up static MBN items
    document.querySelectorAll('.mbn-item[data-mbn-view]').forEach(el => {
        el.addEventListener('click', () => {
            switchView(el.dataset.mbnView, el.dataset.mbnConsole || '', el.dataset.mbnCategory || '');
        });
    });

    buildDropdown();

    // Sync MBN active state to current hash without navigating
    const _initView = (window.location.hash.slice(1).split('/')[0]) || 'dm';
    document.querySelectorAll('.mbn-item[data-mbn-view]').forEach(el => {
        el.classList.toggle('mbn-item--active', el.dataset.mbnView === _initView);
    });
}());