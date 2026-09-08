/**
 * Navigation Module
 * Smooth scrolling, active links, mobile hamburger menu
 */

import { DOMUtils } from '../utils/dom.js';
import { I18nModule } from './i18n.js?v=20260908';

export const NavigationModule = {
    init() {
        this.hideMbnIfGuest();
        this.setupSmoothScroll();
        this.setupActiveLinks();
        this.setupMobileMenu();
        this.setupAutoHideNavbar();
        this.setupMbnDropdown();
        this.setupMbnNotifPanel();
    },

    /**
     * Hide the mobile bottom nav for logged-out users
     */
    hideMbnIfGuest() {
        try {
            const s = JSON.parse(localStorage.getItem('cn_session'));
            if (s && s.id) return; // logged in — leave nav visible
        } catch { /* fall through */ }
        const mbn = document.getElementById('mobile-bottom-nav');
        if (mbn) mbn.style.display = 'none';
    },

    /**
     * Smooth scroll for anchor links
     */
    setupSmoothScroll() {
        DOMUtils.onAll('a[href^="#"]', 'click', (e) => {
            const href = e.currentTarget.getAttribute('href');
            if (href !== '#') {
                const target = document.querySelector(href);
                if (target) {
                    e.preventDefault();
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    
                    // Close mobile menu after navigation
                    this.closeMobileMenu();
                }
            }
        });
    },

    /**
     * Mark active link in navbar
     */
    setupActiveLinks() {
        const navLinks = document.querySelectorAll('.nav-links a');
        const logo = document.querySelector('.logo');
        
        // Add active class to logo if on the home page
        if (window.location.pathname.includes('index.html') || window.location.pathname.endsWith('/pages/') || window.location.pathname.endsWith('/pages')) {
            if (logo) {
                logo.classList.add('active');
            }
        }
        
        // Add active class to navbar links
        navLinks.forEach(link => {
            if (link.href === window.location.href) {
                link.classList.add('active');
            }
        });
    },

    /**
     * Mobile Hamburger Menu
     */
    setupMobileMenu() {
        const hamburger = document.querySelector('.hamburger');
        const navLinks = document.querySelector('.nav-links');
        const navLinksItems = document.querySelectorAll('.nav-links a');
        const isCommunityPage = document.body.classList.contains('community-navbar-page');

        // Keep hamburger only on community page.
        if (!isCommunityPage && hamburger) {
            hamburger.remove();
            document.body.classList.remove('menu-open');
        }
        
        if (!isCommunityPage || !hamburger || !navLinks) return;
        
        // Mark that hamburger menu is initialized (to prevent fallback script from re-initializing)
        window.__HAMBURGER_INITIALIZED__ = true;
        
        // Ensure button has explicit type to avoid form submit behavior
        if (hamburger && hamburger.tagName === 'BUTTON' && !hamburger.getAttribute('type')) {
            hamburger.setAttribute('type', 'button');
        }

        // Toggle menu when hamburger is pressed (click + touchstart support for mobile)
        const toggleHandler = (e) => {
            if (e.type === 'touchstart') e.preventDefault();
            this.toggleMobileMenu();
        };

        hamburger.addEventListener('click', toggleHandler);
        hamburger.addEventListener('touchstart', toggleHandler, { passive: false });
        
        // Close menu when a link is pressed
        navLinksItems.forEach(link => {
            link.addEventListener('click', () => {
                this.closeMobileMenu();
            });
        });
        
        // Close menu when ESC is pressed
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && navLinks.classList.contains('active')) {
                this.closeMobileMenu();
            }
        });
        
        // Close menu when clicking outside it
        document.addEventListener('click', (e) => {
            if (navLinks.classList.contains('active') && 
                !navLinks.contains(e.target) && 
                !hamburger.contains(e.target)) {
                this.closeMobileMenu();
            }
        });
    },

    /**
     * Toggle mobile menu
     */
    toggleMobileMenu() {
        const hamburger = document.querySelector('.hamburger');
        const navLinks = document.querySelector('.nav-links');
        
        if (!hamburger || !navLinks) return;
        
        const isActive = navLinks.classList.contains('active');
        
        if (isActive) {
            this.closeMobileMenu();
        } else {
            this.openMobileMenu();
        }
    },

    /**
     * Open mobile menu
     */
    openMobileMenu() {
        const hamburger = document.querySelector('.hamburger');
        const navLinks = document.querySelector('.nav-links');
        
        if (!hamburger || !navLinks) return;
        
        hamburger.classList.add('active');
        navLinks.classList.add('active');
        document.body.classList.add('menu-open');
        
        // Update ARIA
        hamburger.setAttribute('aria-expanded', 'true');
    },

    /**
     * Close mobile menu
     */
    closeMobileMenu() {
        const hamburger = document.querySelector('.hamburger');
        const navLinks = document.querySelector('.nav-links');
        
        if (!hamburger || !navLinks) return;
        
        hamburger.classList.remove('active');
        navLinks.classList.remove('active');
        document.body.classList.remove('menu-open');
        
        // Update ARIA
        hamburger.setAttribute('aria-expanded', 'false');
    },

    /**
     * Mobile bottom navigation — dropdown toggle and active-page marking.
     * Handles pages that use data-mbn-page attributes on nav items.
     */
    setupMbnDropdown() {
        const btn = document.getElementById('mbn-more-btn');
        const dd  = document.getElementById('mbn-dropdown');

        // Mark current page as active in the bottom nav
        const page = location.pathname.split('/').pop().replace('.html', '') || 'home';
        document.querySelectorAll('.mbn-item[data-mbn-page]').forEach(el => {
            if (el.dataset.mbnPage === page) el.classList.add('mbn-item--active');
        });
        document.querySelectorAll('.mbn-dd-item[data-mbn-page]').forEach(el => {
            if (el.dataset.mbnPage === page) {
                el.classList.add('mbn-item--active');
                if (btn) btn.classList.add('mbn-item--active');
            }
        });

        if (!btn || !dd) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = dd.classList.toggle('is-open');
            btn.setAttribute('aria-expanded', String(open));
        });
        document.addEventListener('click', () => {
            dd.classList.remove('is-open');
            btn.setAttribute('aria-expanded', 'false');
        });
        dd.addEventListener('click', (e) => e.stopPropagation());
    },

    /**
     * Inline notification panel inside the mbn-dropdown.
     * Clicking the notification item slides in a sub-panel with notifications.
     */
    setupMbnNotifPanel() {
        const dd = document.getElementById('mbn-dropdown');
        const notifLink = document.getElementById('mbn-notif-link');
        if (!dd || !notifLink) return;

        // Build the panel HTML and inject into the dropdown
        const panel = document.createElement('div');
        panel.className = 'mbn-notif-panel';
        panel.id = 'mbn-notif-panel';
        panel.innerHTML = `
            <div class="mbn-notif-panel__header">
                <button class="mbn-notif-panel__back" id="mbn-notif-back" type="button"
                        data-i18n="notif_panel_back">← Back</button>
                <span class="mbn-notif-panel__title" data-i18n="nav_notifications">Notifications</span>
                <button class="mbn-notif-panel__read-all" id="mbn-notif-read-all" type="button"
                        data-i18n="notif_panel_read_all">Mark all read</button>
            </div>
            <div class="mbn-notif-panel__list" id="mbn-notif-panel-list">
                <div class="mbn-notif-panel__loading" data-i18n="notif_panel_loading">Loading...</div>
            </div>
        `;
        dd.appendChild(panel);
        I18nModule.apply();

        // Collect all the regular dropdown items (not the panel)
        const ddItems = () => dd.querySelectorAll(':scope > :not(#mbn-notif-panel)');

        const openPanel = () => {
            ddItems().forEach(el => el.style.display = 'none');
            panel.classList.add('is-open');
            this._loadMbnNotifs();
        };

        const closePanel = () => {
            panel.classList.remove('is-open');
            ddItems().forEach(el => el.style.display = '');
        };

        notifLink.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openPanel();
        });

        document.getElementById('mbn-notif-back').addEventListener('click', (e) => {
            e.stopPropagation();
            closePanel();
        });

        document.getElementById('mbn-notif-read-all').addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const token = localStorage.getItem('cn_token');
                if (!token) return;
                const { API_BASE_URL } = await import('../config.js');
                await fetch(`${API_BASE_URL}/notifications/read-all`, {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                this._loadMbnNotifs();
                document.getElementById('mbn-notif-badge-dd').style.display = 'none';
            } catch {}
        });

        // Close panel when dropdown closes
        const observer = new MutationObserver(() => {
            if (!dd.classList.contains('is-open')) closePanel();
        });
        observer.observe(dd, { attributes: true, attributeFilter: ['class'] });
    },

    async _loadMbnNotifs() {
        const list = document.getElementById('mbn-notif-panel-list');
        if (!list) return;

        const t = (key, fallback) => I18nModule.t(key) || fallback;

        list.innerHTML = `<div class="mbn-notif-panel__loading">${t('notif_panel_loading', 'Loading...')}</div>`;

        try {
            const token = localStorage.getItem('cn_token');
            if (!token) {
                list.innerHTML = `<div class="mbn-notif-panel__empty">${t('notif_panel_empty', 'No notifications yet')}</div>`;
                return;
            }
            const { API_BASE_URL } = await import('../config.js');
            const res = await fetch(`${API_BASE_URL}/notifications`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!res.ok) throw new Error();
            const data = await res.json();
            const notifs = data.notifications || [];

            if (notifs.length === 0) {
                list.innerHTML = `<div class="mbn-notif-panel__empty">${t('notif_panel_empty', 'No notifications yet')}</div>`;
                return;
            }

            const timeAgo = (iso) => {
                const diff = (Date.now() - new Date(iso)) / 1000;
                if (diff < 60) return 'Just now';
                if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
                if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
                return `${Math.floor(diff / 86400)}d ago`;
            };

            const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            const safeHref = (link) => {
                const s = String(link || '');
                return (s.startsWith('/') || s.startsWith('https://') || s.startsWith('http://')) ? s : '#';
            };

            list.innerHTML = notifs.map(n => `
                <a href="${safeHref(n.link)}" class="mbn-notif-row${n.read ? '' : ' mbn-notif-row--unread'}">
                    <div class="mbn-notif-row__dot"></div>
                    <div class="mbn-notif-row__body">
                        <div class="mbn-notif-row__msg">${esc(n.message)}</div>
                        <div class="mbn-notif-row__time">${timeAgo(n.created_at)}</div>
                    </div>
                </a>
            `).join('');

            // Update badge count
            const unread = notifs.filter(n => !n.read).length;
            const badge = document.getElementById('mbn-notif-badge-dd');
            if (badge) {
                badge.textContent = unread > 9 ? '9+' : String(unread);
                badge.style.display = unread > 0 ? 'inline-flex' : 'none';
            }
        } catch {
            list.innerHTML = `<div class="mbn-notif-panel__empty">${t('notif_panel_empty', 'No notifications yet')}</div>`;
        }
    },

    /**
     * Auto-hide navbar on scroll down, show on scroll up.
     * Mobile only (≤768px). Desktop always shows the navbar.
     * Anti-jitter: ignore moves < 15px, stays visible near top (< 80px).
     */
    setupAutoHideNavbar() {
        const navbar = document.querySelector('.navbar');
        if (!navbar) return;

        const mbn = document.getElementById('mobile-bottom-nav');
        const mq  = window.matchMedia('(max-width: 768px)');

        const showAll = () => {
            navbar.classList.remove('navbar--hidden');
            if (mbn) mbn.classList.remove('mbn--hidden');
        };

        const hideAll = () => {
            navbar.classList.add('navbar--hidden');
            if (mbn) mbn.classList.add('mbn--hidden');
        };

        if (!mq.matches) {
            showAll();
            return;
        }

        let lastScrollY = window.scrollY;
        let ticking = false;

        const onScroll = (currentY) => {
            const delta = currentY - lastScrollY;

            if (document.body.classList.contains('menu-open')) {
                lastScrollY = currentY;
                ticking = false;
                return;
            }

            // A "fullscreen" hub detail view (DM/forum thread/listing) already explicitly
            // hid the navbar/bottom-nav via setMobileFullscreen() — any scroll here (even a
            // stray few px from iOS rubber-banding) must not fight that and re-show them.
            if (document.body.classList.contains('hub-mobile-fullscreen')) {
                lastScrollY = currentY;
                ticking = false;
                return;
            }

            if (currentY < 80) {
                showAll();
                lastScrollY = currentY;
                ticking = false;
                return;
            }

            if (Math.abs(delta) < 15) {
                ticking = false;
                return;
            }

            if (delta > 0) {
                hideAll();
            } else {
                showAll();
            }

            lastScrollY = currentY < 0 ? 0 : currentY;
            ticking = false;
        };

        window.addEventListener('scroll', () => {
            if (!ticking) {
                window.requestAnimationFrame(() => onScroll(window.scrollY));
                ticking = true;
            }
        }, { passive: true });

        // The community hub page (community.html) never scrolls the document itself —
        // .community-page--hub is height:100dvh/overflow:hidden, and every list/detail view
        // (.hub-thread-list, .hub-market-grid, .hub-detail-scroll, .hub-thread-detail, ...)
        // scrolls its OWN inner div instead — so window.scrollY above never changes on this
        // page and the navbar/bottom-nav sat permanently visible no matter how far a user
        // scrolled through a marketplace grid or forum thread list, wasting the space they'd
        // otherwise reclaim by hiding on scroll like everywhere else on the site. `scroll`
        // events don't bubble, but a capturing listener on the shared `.hub-content`
        // ancestor still receives them from whichever descendant is the actual scroller
        // (event.target) — one listener covers every current and future hub view without
        // hardcoding each view's scroll-container class name. Reuses the same `ticking`/
        // `lastScrollY` closure state as the window listener above (onScroll already clears
        // `ticking` itself on every exit path), so switching between document scroll and hub
        // scroll never double-counts a delta.
        const hubContent = document.querySelector('.hub-content');
        if (hubContent) {
            hubContent.addEventListener('scroll', (e) => {
                if (!ticking) {
                    const top = e.target.scrollTop ?? 0;
                    window.requestAnimationFrame(() => onScroll(top));
                    ticking = true;
                }
            }, { capture: true, passive: true });
        }

        mq.addEventListener('change', (e) => {
            if (!e.matches) showAll();
        });
    }
};
