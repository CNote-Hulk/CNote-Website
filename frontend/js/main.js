/**
 * Main JavaScript Entry Point
 * Initializes all modules
 */

// Import modules
import { NavigationModule } from './modules/navigation.js';
import { AnimationsModule } from './modules/animations.js';
import { ContactFormModule } from './modules/contact-form.js';
import { DiacriticsModule } from './modules/diacritics.js';
import { SearchModule } from './modules/search.js';
import { ProfileDropdownModule } from './modules/profile-dropdown.js';
import { AuthModule } from './modules/auth.js';
import { I18nModule } from './modules/i18n.js?v=20260909b';
import { initAchievementSocket } from './modules/achievement-socket.js';
import { NotificationsModule } from './modules/notifications.js';

/**
 * App Class - Orchestrates all modules
 */
class App {
    constructor() {
        this._navbarOffsetRaf = null;
        this.init();
    }

    init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.initializeModules());
        } else {
            this.initializeModules();
        }
    }

    /**
     * Initialize all modules
     */
    initializeModules() {
        console.log('🚀 Initializing Console Notebook App...');
        this.initGlobalNavbarOffset();
        
        try {
            NavigationModule.init();
            console.log('✓ Navigation module initialized');
            
            I18nModule.init();
            console.log('✓ i18n module initialized');

            AnimationsModule.init();
            console.log('✓ Animations module initialized');

            ContactFormModule.init();
            console.log('✓ Contact form module initialized');

            DiacriticsModule.init();
            console.log('✓ Diacritics module initialized');

            SearchModule.init();
            console.log('✓ Search module initialized');

            ProfileDropdownModule.init();
            console.log('✓ Profile dropdown module initialized');

            NotificationsModule.init();
            console.log('✓ Notifications module initialized');

            const user = AuthModule.getCurrentUser();

            if (user) {
                AuthModule.startSessionWatch();
                console.log('✓ Session watch initialized');
                // Load socket.io client dynamically then init achievement socket
                if (!window.io) {
                    const s = document.createElement('script');
                    s.src = '/socket.io/socket.io.js';
                    s.onload  = () => { initAchievementSocket(user.id); };
                    s.onerror = () => { console.warn('socket.io client failed to load'); };
                    document.head.appendChild(s);
                } else {
                    initAchievementSocket(user.id);
                }
            }

            this.initAchievements();
            console.log('✓ Achievements module initialized');

            this.initQuickGuide();
            console.log('✓ Quick guide tracking initialized');
            
            console.log('✅ All modules initialized successfully');
            this.initMathRendering();

            // Expose re-init hook for components.js (async navbar injection)
            window.__cn_reinit_navbar = () => {
                try { ProfileDropdownModule.init(); } catch(e) {}
                try { SearchModule.init(); } catch(e) {}
                try { NotificationsModule.init(); } catch(e) {}
                try { NavigationModule.setupActiveLinks(); } catch(e) {}
                try { NavigationModule.setupAutoHideNavbar(); } catch(e) {}
                try { I18nModule.apply(); } catch(e) {}
            };
            if (window.__cn_navbar_ready) window.__cn_reinit_navbar();

        } catch (error) {
            console.error('❌ Error initializing modules:', error);
        }
    }

    initGlobalNavbarOffset() {
        const updateOffset = () => {
            const navbar = document.querySelector('.navbar');
            if (!navbar) return;
            const rect = navbar.getBoundingClientRect();
            const height = Math.max(0, Math.ceil(rect.height));
            document.documentElement.style.setProperty('--cn-nav-offset', `${height}px`);
        };

        const scheduleOffsetUpdate = () => {
            if (this._navbarOffsetRaf !== null) return;
            this._navbarOffsetRaf = window.requestAnimationFrame(() => {
                this._navbarOffsetRaf = null;
                updateOffset();
            });
        };

        scheduleOffsetUpdate();
        window.addEventListener('resize', scheduleOffsetUpdate);
        window.addEventListener('orientationchange', scheduleOffsetUpdate);
        window.addEventListener('load', scheduleOffsetUpdate);
        window.addEventListener('cn:language-changed', scheduleOffsetUpdate);
    }

    initAchievements() {

        // Notificările de achievements se trimit doar de la backend prin socket.io
        // Nu mai calculăm local, totul vine din backend
        // Dacă vrei să afișezi achievements noi, ascultă doar evenimentele de la backend
        const fetchAndCheck = () => {};

        // Run on page load (non-blocking)
        fetchAndCheck();

        // Re-run whenever relevant user actions fire
        window.addEventListener('cn:console-visited',  fetchAndCheck);
        window.addEventListener('cn:favorite-changed', fetchAndCheck);
        window.addEventListener('cn:friend-changed',   fetchAndCheck);
        window.addEventListener('cn:owned-changed',    fetchAndCheck);
        // lesson/quiz kept for when those features ship
        window.addEventListener('cn:lesson-completed', fetchAndCheck);
        window.addEventListener('cn:quiz-finished',    fetchAndCheck);
    }

    /**
     * Track quick guide step completion across all pages.
     * Steps: 0=encyclopedia, 1=compare, 2=community, 3=send message, 4=rate console
     */
    initQuickGuide() {
        if (!AuthModule.getCurrentUser()) return;

        const page = window.location.pathname.split('/').pop() || '';

        // Auto-complete steps based on page visit
        const pageStepMap = {
            'evolutie.html': 0,
            'comparatie.html': 1,
            'community.html': 2
        };
        if (page in pageStepMap) {
            this.markQuickGuideStep(pageStepMap[page]);
        }

        // Listen for activity-based step completion
        window.addEventListener('cn:message-sent', () => this.markQuickGuideStep(3));
        window.addEventListener('cn:rating-submitted', () => this.markQuickGuideStep(4));
    }

    markQuickGuideStep(stepIndex) {
        try {
            var data = JSON.parse(localStorage.getItem('cn_quickguide')) || { completed: [] };
            if (!Array.isArray(data.completed)) data.completed = [];
            if (data.completed.indexOf(stepIndex) === -1) {
                data.completed.push(stepIndex);
                localStorage.setItem('cn_quickguide', JSON.stringify(data));
            }
        } catch (e) { /* ignore */ }
    }

    initMathRendering() {
        if (typeof renderMathInElement === 'undefined') return;

        renderMathInElement(document.body, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '$', right: '$', display: false }
            ]
        });
    }
}

// Initialize app
new App();
