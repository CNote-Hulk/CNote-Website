import { I18nModule } from './i18n.js?v=20260909f';
import { AuthModule } from './auth.js';
import { AchievementsModule } from './achievements.js';
import { API_BASE_URL } from '../config.js';
import { NO_IMAGE_PLACEHOLDER } from '../utils/no-image-placeholder.js';

function normalizeAvatarUrl(avatarUrl, preferredSize = 1024) {
    const raw = typeof avatarUrl === 'string' ? avatarUrl.trim() : '';
    if (!raw || raw.startsWith('data:')) return raw;
    if (!/googleusercontent\.com|ggpht\.com/i.test(raw)) return raw;

    let upgraded = raw
        .replace(/[?&]sz=\d+/i, (m) => m.charAt(0) + 'sz=' + preferredSize)
        .replace(/=s\d{2,4}(-c)?(?=&|$)/i, '=s' + preferredSize + '-c')
        .replace(/\/s\d{2,4}(-c)?(?=\/)/i, '/s' + preferredSize + '-c');

    if (upgraded === raw && !/[?&]sz=\d+/i.test(raw)) {
        upgraded += (raw.includes('?') ? '&' : '?') + 'sz=' + preferredSize;
    }
    return upgraded;
}

const QUICK_START_TASKS = [
    {
        id: 'registered',
        xp: 50,
        autoComplete: true,
        modalTitleKey: null,
    },
    {
        id: 'profile_complete',
        xp: 25,
        modalTitleKey: 'qsg_modal_profile_title',
        modalBodyKey:  'qsg_modal_profile_body',
        modalLinkKey:  'qsg_modal_profile_link',
        modalLinkUrl:  '/html/pages/profil.html#profil',
    },
    {
        id: 'lesson_complete',
        xp: 50,
        modalTitleKey: 'qsg_modal_lesson_title',
        modalBodyKey:  'qsg_modal_lesson_body',
        modalLinkKey:  'qsg_modal_lesson_link',
        modalLinkUrl:  '/html/pages/course.html?slug=console-starter-guide',
    },
    {
        id: 'console_3',
        xp: 30,
        modalTitleKey: 'qsg_modal_console_title',
        modalBodyKey:  'qsg_modal_console_body',
        modalLinkKey:  'qsg_modal_console_link',
        modalLinkUrl:  '/html/pages/evolutie.html',
    },
    {
        id: 'first_favorite',
        xp: 5,
        modalTitleKey: 'qsg_modal_favorite_title',
        modalBodyKey:  'qsg_modal_favorite_body',
        modalLinkKey:  'qsg_modal_favorite_link',
        modalLinkUrl:  '/html/pages/evolutie.html',
    },
    {
        id: 'first_chat_message',
        xp: 10,
        modalTitleKey: 'qsg_modal_chat_title',
        modalBodyKey:  'qsg_modal_chat_body',
        modalLinkKey:  'qsg_modal_chat_link',
        modalLinkUrl:  '/html/pages/community.html',
    },
    {
        id: 'first_post',
        xp: 20,
        modalTitleKey: 'qsg_modal_forum_title',
        modalBodyKey:  'qsg_modal_forum_body',
        modalLinkKey:  'qsg_modal_forum_link',
        modalLinkUrl:  '/html/pages/community.html#forum',
    },
];

document.addEventListener('DOMContentLoaded', async () => {

    // =========================
    // SESSION
    // =========================
    let currentUser = null;
    try {
        const raw = localStorage.getItem('cn_session');
        if (raw) currentUser = JSON.parse(raw);
    } catch {}

    const restoredUser = await AuthModule.refreshSession();
    if (restoredUser) {
        currentUser = AuthModule.getCurrentUser() || restoredUser;
    }

    if (!currentUser) return;

    const username = currentUser.username || currentUser.email || 'user';

    // =========================
    // API HELPER
    // =========================
    async function apiFetch(url, options = {}) {
        try {
            const token = localStorage.getItem('cn_token');
            const res = await fetch(url, {
                ...options,
                headers: {
                    ...(options.headers || {}),
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                credentials: 'include'
            });
            if (res.status === 401 || res.status === 403) {
                localStorage.removeItem('cn_session');
                localStorage.removeItem('cn_token');
                localStorage.removeItem('cn_session_token');
            }
            if (!res.ok) return null;
            return await res.json();
        } catch {
            return null;
        }
    }

    function escapeHtml(s) {
        if (!s) return '';
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // Same behavior as community.js's local timeAgo() — not shared between the two
    // pages, so duplicated here rather than introducing a new shared module for one fn.
    function timeAgo(d) {
        const diff = Date.now() - new Date(d).getTime();
        if (diff < 60000)    return 'now';
        if (diff < 3600000)  return Math.floor(diff / 60000) + ' min';
        if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
        return new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    }

    // =========================
    // SIDEBAR — User info
    // =========================
    function renderSidebar(user) {
        const nameEl = document.getElementById('profile-name');
        const bioEl = document.getElementById('profile-bio');
        const avatarImg = document.getElementById('profile-avatar-img');
        const avatarFallback = document.getElementById('profile-avatar-fallback');
        const adminBadge = document.getElementById('profile-admin-badge');

        const freshName = user.username || currentUser.username;
        if (nameEl) nameEl.textContent = freshName;
        if (bioEl) bioEl.textContent = user.bio || currentUser.bio || '';

        // Also update mobile hero (sidebar is hidden on mobile)
        const welcomeTitle = document.getElementById('welcome-title');
        if (welcomeTitle) welcomeTitle.textContent = freshName;

        if (avatarImg && avatarFallback) {
            const avatar = normalizeAvatarUrl(user.avatar || currentUser.avatar || '');
            if (avatar) {
                avatarImg.src = avatar;
                avatarImg.hidden = false;
                avatarFallback.hidden = true;
            }
        }

        if (adminBadge && (user.role === 'admin' || currentUser.role === 'admin')) {
            adminBadge.hidden = false;
        }

        // Level badge
        let levelEl = document.getElementById('profile-level');
        if (!levelEl) {
            levelEl = document.createElement('span');
            levelEl.id = 'profile-level';
            levelEl.className = 'profile-level-badge';
            const onlineDot = document.querySelector('.profile-online-dot');
            if (onlineDot) onlineDot.after(levelEl);
            else if (nameEl && nameEl.parentElement) nameEl.parentElement.appendChild(levelEl);
        }
        const storedLevel = (() => { try { return JSON.parse(localStorage.getItem('cn_user_level') || 'null'); } catch { return null; } })();
        if (storedLevel && levelEl) {
            levelEl.textContent = `${storedLevel.emoji} ${storedLevel.name}`;
            levelEl.hidden = false;
        }

        // Edit shortcuts → go to settings
        const editNameBtn = document.getElementById('edit-username-shortcut');
        const editBioBtn = document.getElementById('edit-bio-shortcut');
        if (editNameBtn) editNameBtn.addEventListener('click', () => { window.location.href = 'profil.html#account'; });
        if (editBioBtn) editBioBtn.addEventListener('click', () => { window.location.href = 'profil.html#account'; });

        // Avatar click → go to profile settings
        const avatarBtn = document.getElementById('profile-avatar');
        if (avatarBtn) avatarBtn.addEventListener('click', () => { window.location.href = 'profil.html#profil'; });
    }

    // =========================
    // WELCOME
    // =========================
    const welcomeTitle = document.getElementById('welcome-title');
    if (welcomeTitle) welcomeTitle.textContent = username;

    // Set hero date
    const dateEl = document.getElementById('home-date');
    if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
        }).toUpperCase();
    }

    // =========================
    // DASHBOARD DATA
    // =========================
    // getLocalAchievements removed. Use AchievementsModule.BADGES if needed for static badge info.

    // Inițializare dashboard la încărcare
    await populateDashboard();

    // Re-populează dashboard la schimbarea panelului (hashchange)
    window.addEventListener('hashchange', () => {
        populateDashboard();
    });

    async function populateDashboard() {
        try {
            const userRes = await apiFetch(`/api/users/${encodeURIComponent(username)}`);
            if (!userRes.success) throw new Error('User fetch failed');

            const user = userRes.user;

            // Render sidebar with user data
            renderSidebar(user);

            // parallel fetch
            const sf = { success: false };
            const [ratingsRes, favoritesRes, friendsRes, friendRequestsRes, forumRes, myPostsRes, likedPostsRes, achievementsRes, starterProgressRes, visitedRes, myListingsRes, favListingsRes, levelRes, qsgRes, articlesRes, trendingListingsRes, myOrdersRes] = (await Promise.all([
                apiFetch('/api/ratings/user/all').catch(() => null),
                apiFetch('/api/favorites').catch(() => null),
                apiFetch('/api/friends').catch(() => null),
                apiFetch('/api/friends/requests').catch(() => null),
                apiFetch('/api/forum/recent').catch(() => null),
                apiFetch('/api/forum/my-posts').catch(() => null),
                apiFetch('/api/forum/liked').catch(() => null),
                apiFetch('/api/achievements').catch(() => null),
                apiFetch('/api/courses/starter-guide/progress').catch(() => null),
                apiFetch('/api/consoles/visited').catch(() => null),
                apiFetch('/api/marketplace/listings/mine').catch(() => null),
                apiFetch('/api/marketplace/favorites').catch(() => null),
                apiFetch('/api/me/level').catch(() => null),
                apiFetch('/api/me/quick-start-status').catch(() => null),
                apiFetch('/api/articles?limit=3').catch(() => null),
                apiFetch('/api/marketplace/listings?limit=4').catch(() => null),
                apiFetch('/api/orders/mine').catch(() => null),
            ])).map(r => r ?? sf);

            // =========================
            // PROGRESS — real course data
            // =========================
            {
                const sp = starterProgressRes;
                const totalLessons = sp && sp.total_lessons > 0 ? sp.total_lessons : 0;
                const completedIds = sp && Array.isArray(sp.completed_lesson_ids) ? sp.completed_lesson_ids : [];
                const doneCount = completedIds.length;
                const lastId = sp && sp.last_lesson_id;
                const courseComplete = sp && sp.course_completed;
                const pct = totalLessons > 0 ? Math.round((doneCount / totalLessons) * 100) : 0;
                const CIRC = 2 * Math.PI * 42;

                const continueHref = courseComplete
                    ? 'course.html?slug=starter-guide'
                    : lastId
                        ? `lesson.html?id=${lastId}&slug=starter-guide`
                        : 'course.html?slug=starter-guide';

                // Hero continue-card
                const continueProgress = document.getElementById('continue-progress');
                const activeProgress = document.getElementById('active-progress');
                const continueTitle = document.getElementById('home-continue-title');
                const homeContinueBtn = document.getElementById('home-continue-btn');
                if (continueTitle) continueTitle.textContent = sp && sp.course_title ? sp.course_title : 'Console Starter Guide';
                if (continueProgress) continueProgress.textContent = totalLessons > 0 ? `${doneCount}/${totalLessons}` : '—';
                if (activeProgress) setTimeout(() => { activeProgress.style.width = pct + '%'; }, 80);
                if (homeContinueBtn) {
                    homeContinueBtn.href = continueHref;
                    homeContinueBtn.textContent = courseComplete ? 'Review →' : doneCount > 0 ? 'Continue →' : 'Start →';
                }

                // Progress ring (progress panel)
                const progressRingArc = document.getElementById('progress-ring-arc');
                const progressRingPct = document.getElementById('progress-ring-pct');
                const progressContinueText = document.getElementById('progress-continue-text');
                const progressBarFill = document.getElementById('progress-bar-fill');
                const progressPanelBtn = document.getElementById('progress-panel-continue-btn');
                const progressPanelTitle = document.getElementById('progress-panel-title');
                if (progressPanelTitle) progressPanelTitle.textContent = sp && sp.course_title ? sp.course_title : 'Console Starter Guide';
                if (progressRingArc) {
                    progressRingArc.style.strokeDasharray = CIRC;
                    setTimeout(() => { progressRingArc.style.strokeDashoffset = CIRC * (1 - pct / 100); }, 80);
                }
                if (progressRingPct) progressRingPct.textContent = pct + '%';
                if (progressContinueText) progressContinueText.textContent = totalLessons > 0 ? `${doneCount}/${totalLessons} lessons` : '—';
                if (progressBarFill) setTimeout(() => { progressBarFill.style.width = pct + '%'; }, 80);
                if (progressPanelBtn) {
                    progressPanelBtn.href = continueHref;
                    progressPanelBtn.textContent = courseComplete ? '✓ Review course' : doneCount > 0 ? '▶ Continue' : '▶ Start course';
                }


                // Milestones
                const milestonesEl = document.getElementById('progress-milestones');
                if (milestonesEl) {
                    const m = (done, label) =>
                        `<div class="milestone-item${done ? ' milestone-item--done' : ''}">
                            <span class="milestone-dot"></span>
                            <span class="milestone-label">${label}</span>
                        </div>`;
                    milestonesEl.innerHTML =
                        m(true,            'Created your account') +
                        m(doneCount > 0,   'Started first lesson') +
                        m(doneCount >= 10, 'Completed 10 lessons') +
                        m(doneCount >= 20, 'Completed 20 lessons') +
                        m(courseComplete,  'Finished your first course');
                }
            }

            // =========================
            // STATS
            // =========================
            if (ratingsRes.success) {
                setStat('stat-ratings', `<strong>${ratingsRes.ratings.length}</strong>`);
            }

            if (favoritesRes.success) {
                setStat('stat-favorites', `<strong>${favoritesRes.favorites.length}</strong>`);
            }

            if (friendsRes.success) {
                setStat('stat-friends', `<strong>${friendsRes.friends.length}</strong>`);
            }

            function setStat(id, value) {
                const el = document.getElementById(id);
                if (el) el.innerHTML = value;
            }

            // =========================
            // COLLECTION
            // =========================
            const collectionGrid = document.getElementById('collection-grid');

            if (collectionGrid && Array.isArray(user.owned_console_ids)) {
                const allConsoles = window.CONSOLES_DATA || [];

                collectionGrid.innerHTML = '';

                const emojis = ['🎮','🕹️','🔥','⚡','🌟','🎯'];

                user.owned_console_ids.forEach((cid, idx) => {
                    const c = allConsoles.find(x => x.id === cid);
                    if (!c) return;

                    const btn = document.createElement('button');
                    btn.className = 'console-card';
                    btn.dataset.console = c.name;

                    const emoji = emojis[idx % emojis.length];

                    btn.innerHTML = `${emoji} <span>${c.name}</span>`;

                    btn.addEventListener('click', () => {
                        window.location.href = `consoles/${c.id}.html`;
                    });

                    collectionGrid.appendChild(btn);
                });

                // Update collection count badge
                const collectionCount = document.getElementById('collection-count');
                if (collectionCount) {
                    const n = user.owned_console_ids.length;
                    collectionCount.textContent = n + (n === 1 ? ' console' : ' consoles');
                }
            }

            // =========================
            // MY LISTINGS (in collection panel)
            // =========================
            const myListingsGrid = document.getElementById('my-listings-grid');
            if (myListingsGrid) {
                const listings = (myListingsRes.success && myListingsRes.listings) || [];
                if (listings.length > 0) {
                    renderMyListingCards(myListingsGrid, listings);
                } else {
                    myListingsGrid.innerHTML = myListingsEmptyStateHtml();
                }
            }

            function myListingsEmptyStateHtml() {
                return `<div class="dash-empty-state">
                    <span class="dash-empty-state__icon">🛒</span>
                    <p class="dash-empty-state__text">${escapeHtml(I18nModule.t('home_no_listings_text'))}</p>
                    <p class="dash-empty-state__hint">${escapeHtml(I18nModule.t('home_no_listings_hint'))}</p>
                </div>`;
            }

            function renderMyListingCards(grid, listings) {
                grid.innerHTML = listings.map(l => {
                    const imgs = Array.isArray(l.images) ? l.images : [];
                    const img = imgs[0] || NO_IMAGE_PLACEHOLDER;
                    const isSold = l.sold || l.status === 'sold';
                    const isInactive = !isSold && l.status === 'inactive';
                    return `<div class="home-listing-card" data-id="${l.id}">
                        <a href="community.html#listing-${l.id}" class="home-listing-card__media">
                            <img src="${escapeHtml(img)}" alt="" loading="lazy">
                            ${isSold ? '<span class="home-listing-card__sold">SOLD</span>' : ''}
                            ${isInactive ? '<span class="home-listing-card__sold" style="background:rgba(100,100,100,.8)">INACTIVE</span>' : ''}
                        </a>
                        <div class="home-listing-card__info">
                            <div class="home-listing-card__title">${escapeHtml(l.title)}</div>
                            <div class="home-listing-card__price">${Number(l.price).toFixed(0)} RON</div>
                        </div>
                        <div class="home-listing-card__actions">
                            <a href="community.html#listing-${l.id}" class="hlc-btn hlc-btn--edit" title="Edit listing">✏️</a>
                            <button class="hlc-btn hlc-btn--active" data-id="${l.id}" data-inactive="${isInactive}" title="${isInactive ? 'Mark as available' : 'Mark as unavailable'}">
                                ${isInactive ? '🔒' : '🚫'}
                            </button>
                            <button class="hlc-btn hlc-btn--sold" data-id="${l.id}" data-sold="${isSold}" title="${isSold ? 'Mark as unsold' : 'Mark as sold'}">
                                ${isSold ? '↩️' : '✅'}
                            </button>
                            <button class="hlc-btn hlc-btn--delete" data-id="${l.id}" title="Delete listing">🗑️</button>
                        </div>
                    </div>`;
                }).join('');

                grid.querySelectorAll('.hlc-btn--active').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const id = btn.dataset.id;
                        const wasInactive = btn.dataset.inactive === 'true';
                        const newStatus = wasInactive ? 'active' : 'inactive';
                        const res = await apiFetch(`/api/marketplace/listings/${id}/status`, {
                            method: 'PATCH',
                            body: JSON.stringify({ status: newStatus })
                        });
                        if (res && res.success) {
                            const card = grid.querySelector(`.home-listing-card[data-id="${id}"]`);
                            if (card) {
                                const soldBtn = card.querySelector('.hlc-btn--sold');
                                const isSold = soldBtn?.dataset.sold === 'true';
                                const overlay = card.querySelector('.home-listing-card__sold');
                                if (newStatus === 'inactive') {
                                    btn.textContent = '🔒';
                                    btn.dataset.inactive = 'true';
                                    btn.title = 'Mark as available';
                                    if (!isSold) {
                                        if (!overlay) {
                                            const media = card.querySelector('.home-listing-card__media');
                                            const span = document.createElement('span');
                                            span.className = 'home-listing-card__sold';
                                            span.style.background = 'rgba(100,100,100,.8)';
                                            span.textContent = 'INACTIVE';
                                            media.appendChild(span);
                                        } else {
                                            overlay.textContent = 'INACTIVE';
                                            overlay.style.background = 'rgba(100,100,100,.8)';
                                        }
                                    }
                                } else {
                                    btn.textContent = '🚫';
                                    btn.dataset.inactive = 'false';
                                    btn.title = 'Mark as unavailable';
                                    if (!isSold && overlay) overlay.remove();
                                }
                            }
                        }
                    });
                });

                grid.querySelectorAll('.hlc-btn--sold').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const id = btn.dataset.id;
                        const wasSold = btn.dataset.sold === 'true';
                        const newStatus = wasSold ? 'active' : 'sold';
                        const res = await apiFetch(`/api/marketplace/listings/${id}/status`, {
                            method: 'PATCH',
                            body: JSON.stringify({ status: newStatus })
                        });
                        if (res && res.success) {
                            const card = grid.querySelector(`.home-listing-card[data-id="${id}"]`);
                            if (card) {
                                const overlay = card.querySelector('.home-listing-card__sold');
                                if (newStatus === 'sold') {
                                    btn.textContent = '↩️';
                                    btn.dataset.sold = 'true';
                                    btn.title = 'Mark as unsold';
                                    if (!overlay) {
                                        const media = card.querySelector('.home-listing-card__media');
                                        const span = document.createElement('span');
                                        span.className = 'home-listing-card__sold';
                                        span.textContent = 'SOLD';
                                        media.appendChild(span);
                                    } else {
                                        overlay.textContent = 'SOLD';
                                        overlay.style.background = '';
                                    }
                                } else {
                                    btn.textContent = '✅';
                                    btn.dataset.sold = 'false';
                                    btn.title = 'Mark as sold';
                                    if (overlay) overlay.remove();
                                }
                            }
                        }
                    });
                });

                grid.querySelectorAll('.hlc-btn--delete').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        if (!confirm('Delete this listing?')) return;
                        const id = btn.dataset.id;
                        const res = await apiFetch(`/api/marketplace/listings/${id}`, { method: 'DELETE' });
                        if (res && res.success) {
                            const card = grid.querySelector(`.home-listing-card[data-id="${id}"]`);
                            if (card) { card.style.opacity = '0'; card.style.transition = 'opacity .2s'; setTimeout(() => { card.remove(); if (!grid.querySelector('.home-listing-card')) grid.innerHTML = myListingsEmptyStateHtml(); }, 200); }
                        }
                    });
                });
            }

            // =========================
            // MY ORDERS (seller queue — no-payment Sameday checkout)
            // =========================
            const ordersGrid = document.getElementById('orders-grid');
            if (ordersGrid) {
                const orders = (myOrdersRes.success && myOrdersRes.orders) || [];

                const ordersCount = document.getElementById('orders-count');
                if (ordersCount) ordersCount.textContent = String(orders.length);

                const newCount = orders.filter(o => o.status === 'new').length;
                const ordersBadge = document.getElementById('orders-new-badge');
                if (ordersBadge) {
                    ordersBadge.textContent = String(newCount);
                    ordersBadge.hidden = newCount === 0;
                }

                if (orders.length > 0) {
                    renderOrderCards(ordersGrid, orders);
                } else {
                    ordersGrid.innerHTML = `<div class="dash-empty-state">
                        <span class="dash-empty-state__icon">📦</span>
                        <p class="dash-empty-state__text">${escapeHtml(I18nModule.t('order_empty_text'))}</p>
                        <p class="dash-empty-state__hint">${escapeHtml(I18nModule.t('order_empty_hint'))}</p>
                    </div>`;
                }
            }

            async function copyOrderField(text, btn) {
                try {
                    await navigator.clipboard.writeText(text || '');
                    const original = btn.textContent;
                    btn.textContent = '✓';
                    btn.classList.add('order-copy-btn--done');
                    setTimeout(() => { btn.textContent = original; btn.classList.remove('order-copy-btn--done'); }, 1200);
                } catch {
                    // Clipboard permission denied or unavailable — silently ignore,
                    // same failure mode as the existing share-link copy helper.
                }
            }

            function renderOrderCards(grid, orders) {
                const fieldRow = (label, value, id) => value ? `
                    <div class="order-card__row">
                        <div class="order-card__field">
                            <span class="order-card__label">${escapeHtml(label)}</span>
                            <span class="order-card__value">${escapeHtml(value)}</span>
                        </div>
                        <button type="button" class="order-copy-btn" data-copy-id="${id}" title="${escapeHtml(I18nModule.t('order_copy_field'))}">📋</button>
                    </div>` : '';

                grid.innerHTML = orders.map(o => {
                    const isShipped = o.status === 'shipped';
                    const methodLabel = o.delivery_method === 'easybox'
                        ? `📦 ${I18nModule.t('order_method_easybox')}`
                        : `📍 ${I18nModule.t('order_method_address')}`;
                    const deliveryValue = o.delivery_method === 'easybox'
                        ? o.easybox_name
                        : [o.address, o.address_line2, o.city, o.county].filter(Boolean).join(', ');
                    const copyValues = {
                        name: o.recipient_name,
                        phone: o.recipient_phone,
                        email: o.recipient_email,
                        delivery: deliveryValue,
                        total: `${Number(o.total_price).toFixed(0)} RON`,
                    };
                    return `<div class="order-card" data-id="${o.id}">
                        <div class="order-card__top">
                            <span class="order-card__status order-card__status--${o.status}">${isShipped ? '✅ ' + escapeHtml(I18nModule.t('order_status_shipped')) : '🆕 ' + escapeHtml(I18nModule.t('order_status_new'))}</span>
                            <span class="order-card__date">${timeAgo(o.created_at)}</span>
                        </div>
                        <div class="order-card__product">${escapeHtml(o.listing_title)} · <strong>${Number(o.total_price).toFixed(0)} RON</strong></div>
                        <div class="order-card__buyer">${escapeHtml(I18nModule.t('order_buyer_label'))}: ${escapeHtml(o.buyer_name)}</div>
                        ${fieldRow(I18nModule.t('order_field_name'), o.recipient_name, `${o.id}-name`)}
                        ${fieldRow(I18nModule.t('order_field_phone'), o.recipient_phone, `${o.id}-phone`)}
                        ${fieldRow(I18nModule.t('order_field_email'), o.recipient_email, `${o.id}-email`)}
                        ${fieldRow(methodLabel, deliveryValue, `${o.id}-delivery`)}
                        ${o.notes ? fieldRow(I18nModule.t('order_field_notes'), o.notes, `${o.id}-notes`) : ''}
                        <div class="order-card__actions">
                            <button type="button" class="hlc-btn order-copy-all-btn" data-id="${o.id}" title="${escapeHtml(I18nModule.t('order_copy_all'))}">📋 ${escapeHtml(I18nModule.t('order_copy_all'))}</button>
                            <button type="button" class="hlc-btn order-ship-btn" data-id="${o.id}" data-shipped="${isShipped}" title="${isShipped ? escapeHtml(I18nModule.t('order_mark_new')) : escapeHtml(I18nModule.t('order_mark_shipped'))}">
                                ${isShipped ? '↩️' : '✅'}
                            </button>
                        </div>
                        <div class="order-card__copy-values" hidden data-copy-store='${escapeHtml(JSON.stringify(copyValues))}'></div>
                    </div>`;
                }).join('');

                grid.querySelectorAll('.order-copy-btn').forEach(btn => {
                    const [orderId, field] = btn.dataset.copyId.split('-');
                    btn.addEventListener('click', () => {
                        const card = grid.querySelector(`.order-card[data-id="${orderId}"]`);
                        const store = JSON.parse(card.querySelector('.order-card__copy-values').dataset.copyStore || '{}');
                        copyOrderField(store[field], btn);
                    });
                });

                grid.querySelectorAll('.order-copy-all-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const card = grid.querySelector(`.order-card[data-id="${btn.dataset.id}"]`);
                        const store = JSON.parse(card.querySelector('.order-card__copy-values').dataset.copyStore || '{}');
                        const block = [store.name, store.phone, store.email, store.delivery, store.total].filter(Boolean).join('\n');
                        copyOrderField(block, btn);
                    });
                });

                grid.querySelectorAll('.order-ship-btn').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const id = btn.dataset.id;
                        const wasShipped = btn.dataset.shipped === 'true';
                        const newStatus = wasShipped ? 'new' : 'shipped';
                        const res = await apiFetch(`/api/orders/${id}/status`, {
                            method: 'PATCH',
                            body: JSON.stringify({ status: newStatus })
                        });
                        if (res && res.success) populateDashboard();
                    });
                });
            }

            // =========================
            // ACTIVITY FEED
            // =========================
            const activityList = document.getElementById('activity-list');

            if (activityList) {
                const allConsoles = window.CONSOLES_DATA || [];
                const events = [];

                // Ratings
                if (ratingsRes.success && Array.isArray(ratingsRes.ratings)) {
                    ratingsRes.ratings.forEach(r => {
                        const c = allConsoles.find(x => x.id === r.console_id);
                        if (!c) return;
                        const stars = '★'.repeat(r.rating || 0) + '☆'.repeat(5 - (r.rating || 0));
                        events.push({
                            ts: r.created_at ? new Date(r.created_at) : null,
                            icon: '⭐',
                            html: `Rated <a href="consoles/${escapeHtml(c.id)}.html"><strong>${escapeHtml(c.name)}</strong></a> <span class="activity-stars">${stars}</span>`
                        });
                    });
                }

                // Forum posts
                if (myPostsRes.success && Array.isArray(myPostsRes.posts)) {
                    myPostsRes.posts.forEach(p => {
                        events.push({
                            ts: p.created_at ? new Date(p.created_at) : null,
                            icon: '💬',
                            html: `Posted in forum: <strong>${escapeHtml(p.title)}</strong>`
                        });
                    });
                }

                // Marketplace listings
                if (myListingsRes.success && Array.isArray(myListingsRes.listings)) {
                    myListingsRes.listings.forEach(l => {
                        events.push({
                            ts: l.created_at ? new Date(l.created_at) : null,
                            icon: '🏪',
                            html: `Listed <strong>${escapeHtml(l.title)}</strong> for ${Number(l.price).toFixed(0)} RON`
                        });
                    });
                }

                // Console visits (most recent 5 only — noisy otherwise)
                if (visitedRes.success && Array.isArray(visitedRes.visits)) {
                    visitedRes.visits.slice(0, 5).forEach(v => {
                        const c = allConsoles.find(x => x.id === v.console_id);
                        if (!c) return;
                        events.push({
                            ts: v.visited_at ? new Date(v.visited_at) : null,
                            icon: '👁️',
                            html: `Visited <a href="consoles/${escapeHtml(c.id)}.html"><strong>${escapeHtml(c.name)}</strong></a>`
                        });
                    });
                }

                // Friends
                if (friendsRes.success && Array.isArray(friendsRes.friends)) {
                    friendsRes.friends.forEach(f => {
                        events.push({
                            ts: f.friends_since ? new Date(f.friends_since) : null,
                            icon: '🤝',
                            html: `Became friends with <a href="user-profile.html?u=${encodeURIComponent(f.username)}"><strong>${escapeHtml(f.username)}</strong></a>`
                        });
                    });
                }

                // Sort by timestamp descending, nulls last
                events.sort((a, b) => {
                    if (!a.ts && !b.ts) return 0;
                    if (!a.ts) return 1;
                    if (!b.ts) return -1;
                    return b.ts - a.ts;
                });

                const INITIAL_SHOW = 5;

                if (events.length === 0) {
                    activityList.innerHTML = '<li class="activity-empty">No activity yet — start exploring consoles!</li>';
                } else {
                    activityList.innerHTML = events.map((e, i) => {
                        const timeStr = e.ts ? `<time class="activity-time" title="${e.ts.toLocaleString()}">${relativeTime(e.ts)}</time>` : '';
                        const hiddenClass = i >= INITIAL_SHOW ? ' activity-hidden' : '';
                        return `<li class="${hiddenClass}"><span class="activity-icon">${e.icon}</span><span class="activity-text">${e.html}</span>${timeStr}</li>`;
                    }).join('');

                    // Remove stale button from previous render
                    const staleBtn = activityList.nextElementSibling;
                    if (staleBtn && staleBtn.classList.contains('activity-show-more')) staleBtn.remove();

                    if (events.length > INITIAL_SHOW) {
                        const btn = document.createElement('button');
                        btn.className = 'activity-show-more';
                        const remaining = events.length - INITIAL_SHOW;
                        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Show ${remaining} more`;
                        let expanded = false;
                        const extraItems = activityList.querySelectorAll('li.activity-hidden');
                        btn.addEventListener('click', () => {
                            expanded = !expanded;
                            extraItems.forEach(li => li.classList.toggle('activity-hidden', !expanded));
                            if (expanded) {
                                btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg> Show less`;
                            } else {
                                btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Show ${remaining} more`;
                            }
                        });
                        activityList.after(btn);
                    }
                }
            }

            function relativeTime(date) {
                const diff = Date.now() - date.getTime();
                const mins = Math.floor(diff / 60000);
                const hours = Math.floor(diff / 3600000);
                const days = Math.floor(diff / 86400000);
                if (mins < 1) return 'just now';
                if (mins < 60) return `${mins}m ago`;
                if (hours < 24) return `${hours}h ago`;
                if (days < 7) return `${days}d ago`;
                return date.toLocaleDateString();
            }

            // =========================
            // LEVEL CARD (home preview + progress panel)
            // =========================
            if (levelRes?.level) {
                const lvl = AchievementsModule.computeLevel(levelRes);

                // Stats card — level
                setStat('stat-level', lvl.name);
                const statLevelEmoji = document.getElementById('stat-level-emoji');
                if (statLevelEmoji) statLevelEmoji.textContent = lvl.emoji;

                // Home panel: mini preview
                const homeLevelCard = document.getElementById('home-level-card');
                if (homeLevelCard) {
                    homeLevelCard.innerHTML = `<div class="level-preview"><span class="level-badge level-${lvl.level}">${lvl.emoji} ${lvl.name}</span></div>`;
                }

                // Progress panel: full level card
                const progressLevelCard = document.getElementById('progress-level-card');
                if (progressLevelCard) {
                    const t = k => I18nModule.t(k);
                    const xpLabel = lvl.isMaxLevel ? t('level_max_label') : `${lvl.xp} / ${lvl.xpForNext} XP`;
                    const nextLvlName = lvl.nextLevel ? (t('level_name_' + lvl.nextLevel.level) || lvl.nextLevel.name) : '';
                    const nextHtml = (lvl.isMaxLevel || !lvl.nextLevel)
                        ? `<p class="prog-level-next" style="color:var(--accent-color);font-weight:600;">${t('level_max_reached')}</p>`
                        : `<p class="prog-level-next">${t('level_next_label')}: <strong>${lvl.nextLevel.emoji} ${nextLvlName}</strong> — ${lvl.xpNeeded} ${t('level_xp_needed')}</p>`;
                    progressLevelCard.innerHTML = `
                        <div class="prog-level-emoji">${lvl.emoji}</div>
                        <p class="prog-level-name">${lvl.name}</p>
                        <div class="prog-level-score-bar">
                            <span class="prog-level-score-label">${xpLabel}</span>
                            <div class="prog-level-bar-track">
                                <div class="prog-level-bar-fill" style="width:0%"></div>
                            </div>
                        </div>
                        ${nextHtml}
                    `;
                    setTimeout(() => {
                        const fill = progressLevelCard.querySelector('.prog-level-bar-fill');
                        if (fill) fill.style.width = lvl.progressPercent + '%';
                    }, 100);
                }

                // Save to localStorage for other pages
                localStorage.setItem('cn_user_level', JSON.stringify({ level: lvl.level, name: lvl.name, emoji: lvl.emoji }));

                // ── Expandable levels panel ──
                renderHomeLevelsPanel(lvl);
                loadProgressLeaderboardPreview();
                const progressLevelCardEl = document.getElementById('progress-level-card');
                const homeLevelsPanel = document.getElementById('home-levels-panel');
                if (progressLevelCardEl && homeLevelsPanel) {
                    const toggleLevels = () => {
                        const open = homeLevelsPanel.hidden;
                        homeLevelsPanel.hidden = !open;
                        progressLevelCardEl.setAttribute('aria-expanded', String(open));
                        const hint = progressLevelCardEl.querySelector('.prog-level-hint');
                        if (hint) hint.textContent = open ? '▲ ' + I18nModule.t('level_hide') : '▼ ' + I18nModule.t('level_see_all');
                        if (open) homeLevelsPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    };
                    progressLevelCardEl.addEventListener('click', toggleLevels);
                    progressLevelCardEl.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleLevels(); }
                    });
                    // Append expand hint to card
                    if (progressLevelCardEl.querySelector('.prog-level-hint') === null) {
                        const hint = document.createElement('span');
                        hint.className = 'prog-level-hint';
                        hint.textContent = '▼ ' + I18nModule.t('level_see_all');
                        progressLevelCardEl.appendChild(hint);
                    }
                }
            }

            // =========================
            // ACHIEVEMENTS
            // =========================
            if (achievementsRes.success) {
                const earned = achievementsRes.achievements.filter(a => a.unlocked).length;
                const total_ach = achievementsRes.achievements.length;
                setStat('stat-achievements', `<strong>${earned}</strong> / <strong>${total_ach}</strong>`);

                // Update achievements count badge and progress bar
                const achievementsCount = document.getElementById('achievements-count');
                if (achievementsCount) achievementsCount.textContent = `${earned} / ${total_ach}`;
                const achievementsProgressFill = document.getElementById('achievements-progress-fill');
                if (achievementsProgressFill) achievementsProgressFill.style.width = `${total_ach > 0 ? Math.round((earned / total_ach) * 100) : 0}%`;

                const achievementsGrid = document.getElementById('achievements-grid');
                if (achievementsGrid) {
                    achievementsGrid.innerHTML = '';
                    const ACH_CATEGORIES = AchievementsModule.CATEGORIES;
                    const grouped = {};
                    achievementsRes.achievements.forEach(a => {
                        const cat = a.category || 'other';
                        if (!grouped[cat]) grouped[cat] = [];
                        grouped[cat].push(a);
                    });
                    ACH_CATEGORIES.forEach(cat => {
                        const items = grouped[cat.id];
                        if (!items || items.length === 0) return;
                        const catEarned = items.filter(a => a.unlocked).length;
                        const section = document.createElement('div');
                        section.className = 'ach-category';
                        section.innerHTML = `
                            <div class="ach-category__header">
                                <span class="ach-category__icon">${cat.icon}</span>
                                <span class="ach-category__label">${I18nModule.t('ach_cat_' + cat.id)}</span>
                                <span class="ach-category__count">${catEarned}/${items.length}</span>
                            </div>
                            <div class="ach-category__grid"></div>
                        `;
                        const catGrid = section.querySelector('.ach-category__grid');
                        items.forEach(a => {
                            const earnedDate = a.unlocked && a.earned_at
                                ? new Date(a.earned_at).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' })
                                : '';
                            const div = document.createElement('div');
                            div.className = 'achievement-card' + (a.unlocked ? ' achievement-card--unlocked' : ' achievement-card--locked');
                            div.innerHTML = `
                                <span class="achievement-card__icon">${a.emoji || a.icon || '🏅'}</span>
                                <strong class="achievement-card__name">${escapeHtml(a.name)}</strong>
                                <span class="achievement-card__desc">${escapeHtml(a.description || '')}</span>
                                <span class="achievement-card__status">${a.unlocked ? `${I18nModule.t('ach_earned')}${earnedDate ? ' ' + earnedDate : ''}` : I18nModule.t('ach_locked')}</span>
                            `;
                            catGrid.appendChild(div);
                        });
                        achievementsGrid.appendChild(section);
                    });
                }
            }

            // =========================
            // FAVORITES SECTION
            // =========================
            const favoritesGrid = document.getElementById('favorites-grid');
            if (favoritesGrid) {
                const allConsoles = window.CONSOLES_DATA || [];
                if (favoritesRes.success && Array.isArray(favoritesRes.favorites) && favoritesRes.favorites.length > 0) {
                    favoritesGrid.innerHTML = '';
                    const emojis = ['❤️','🌟','⚡','🔥','🎯','🎮'];
                    favoritesRes.favorites.forEach((cid, idx) => {
                        const c = allConsoles.find(x => x.id === cid);
                        if (!c) return;
                        const btn = document.createElement('button');
                        btn.className = 'console-card';
                        btn.innerHTML = `${emojis[idx % emojis.length]} <span>${escapeHtml(c.name)}</span>`;
                        btn.addEventListener('click', () => { window.location.href = `consoles/${c.id}.html`; });
                        favoritesGrid.appendChild(btn);
                    });
                    // Update favorites count badge
                    const favCount = document.getElementById('favorites-count');
                    if (favCount) favCount.textContent = favoritesRes.favorites.length;
                } else {
                    favoritesGrid.innerHTML = `
                        <div class="dash-empty-state">
                            <span class="dash-empty-state__icon">❤️</span>
                            <p class="dash-empty-state__text">No favorites yet</p>
                            <p class="dash-empty-state__hint">Visit any console page and click the heart icon to add it here.</p>
                            <a href="evolutie.html" class="dash-empty-state__link">Browse consoles →</a>
                        </div>`;
                }
            }

            // =========================
            // FAVORITE LISTINGS (in favorites panel)
            // =========================
            const favListingsSection = document.getElementById('fav-listings-section');
            const favListingsGrid = document.getElementById('fav-listings-grid');
            if (favListingsSection && favListingsGrid && favListingsRes.success && favListingsRes.listings && favListingsRes.listings.length > 0) {
                favListingsSection.hidden = false;
                favListingsGrid.innerHTML = favListingsRes.listings.map(l => {
                    const imgs = Array.isArray(l.images) ? l.images : [];
                    const img = imgs[0] || NO_IMAGE_PLACEHOLDER;
                    return `<a href="community.html#listing-${l.id}" class="home-listing-card">
                        <div class="home-listing-card__img">
                            <img src="${escapeHtml(img)}" alt="" loading="lazy">
                            ${l.sold ? '<span class="home-listing-card__sold">SOLD</span>' : ''}
                        </div>
                        <div class="home-listing-card__info">
                            <div class="home-listing-card__title">${escapeHtml(l.title)}</div>
                            <div class="home-listing-card__price">${Number(l.price).toFixed(0)} RON</div>
                            <div class="home-listing-card__seller">${escapeHtml(l.seller_name || '')}${l.seller_is_official ? `<span class="home-official-badge"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>${I18nModule.t('marketplace_official_badge')}</span>` : ''}</div>
                        </div>
                    </a>`;
                }).join('');
            }

            // =========================
            // FRIENDS — pending requests
            // =========================
            const friendsRequests = document.getElementById('home-friends-requests');
            if (friendsRequests && friendRequestsRes.success && Array.isArray(friendRequestsRes.requests) && friendRequestsRes.requests.length > 0) {
                friendsRequests.innerHTML = `
                    <div class="dash-requests">
                        <p class="dash-requests__label">Friend Requests (${friendRequestsRes.requests.length})</p>
                        ${friendRequestsRes.requests.map(r => `
                            <div class="dash-request-item">
                                <span class="dash-request-name">${escapeHtml(r.username)}</span>
                                <div class="dash-request-actions">
                                    <button class="dash-request-btn dash-request-btn--accept btn primary" data-request-id="${r.request_id}">Accept</button>
                                    <button class="dash-request-btn dash-request-btn--decline btn secondary" data-request-id="${r.request_id}">Decline</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
                friendsRequests.querySelectorAll('.dash-request-btn--accept').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const res = await apiFetch(`/api/friends/accept/${encodeURIComponent(btn.dataset.requestId)}`, { method: 'POST' });
                        if (res && res.success !== false) window.dispatchEvent(new CustomEvent('cn:friend-changed'));
                        btn.closest('.dash-request-item').remove();
                    });
                });
                friendsRequests.querySelectorAll('.dash-request-btn--decline').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        await apiFetch(`/api/friends/reject/${encodeURIComponent(btn.dataset.requestId)}`, { method: 'POST' });
                        btn.closest('.dash-request-item').remove();
                    });
                });
            }

            // =========================
            // FRIENDS PREVIEW
            // =========================
            const friendsPreview = document.getElementById('home-friends-preview');
            if (friendsPreview) {
                if (friendsRes.success && friendsRes.friends.length > 0) {
                    // Update friends count badge
                    const friendsCount = document.getElementById('friends-count');
                    if (friendsCount) friendsCount.textContent = friendsRes.friends.length;

                    const preview = friendsRes.friends.slice(0, 8);
                    friendsPreview.innerHTML = `
                        <div class="dash-friends-list">
                            ${preview.map(f => `
                                <a href="user-profile.html?username=${encodeURIComponent(f.username)}" class="dash-friend-item">
                                    <span class="dash-friend-avatar">${f.avatar ? `<img src="${escapeHtml(f.avatar)}" alt="">` : '<span class="dash-friend-fallback">👤</span>'}</span>
                                    <span class="dash-friend-name">${escapeHtml(f.username)}</span>
                                </a>
                            `).join('')}
                        </div>
                        ${friendsRes.friends.length > 8 ? `<a href="profil.html#profil" class="dash-see-all">${I18nModule.t('home_friends_see_all').replace('{count}', friendsRes.friends.length)}</a>` : ''}
                    `;
                } else {
                    friendsPreview.innerHTML = `
                        <div class="dash-empty-state">
                            <span class="dash-empty-state__icon">👥</span>
                            <p class="dash-empty-state__text">No friends yet</p>
                            <p class="dash-empty-state__hint">Join the community and connect with other console enthusiasts!</p>
                            <a href="community.html" class="dash-empty-state__link">Join community →</a>
                        </div>`;
                }
            }

            // =========================
            // MY COURSES
            // =========================
            const coursesContent = document.getElementById('home-courses-content');
            if (coursesContent) {
                const sp = starterProgressRes;
                const totalLessons = sp && sp.total_lessons > 0 ? sp.total_lessons : 19;
                const completedIds = sp && Array.isArray(sp.completed_lesson_ids) ? sp.completed_lesson_ids : [];
                const doneCount = completedIds.length;
                const lastId = sp && sp.last_lesson_id;
                const courseComplete = sp && sp.course_completed;

                if (courseComplete) {
                    coursesContent.innerHTML = `
                        <div class="dash-course-card dash-course-card--complete">
                            <div class="dash-course-card__icon">🏆</div>
                            <div class="dash-course-card__body">
                                <div class="dash-course-card__title">Console Starter Guide</div>
                                <div class="dash-course-card__sub">Course complete — ${totalLessons}/${totalLessons} lessons</div>
                            </div>
                            <a href="course.html?slug=starter-guide" class="dash-course-card__btn">Review →</a>
                        </div>
                        <p class="dash-empty" style="margin-top:18px;text-align:center;">More courses coming soon.</p>`;
                } else if (doneCount > 0) {
                    const pct = Math.round((doneCount / totalLessons) * 100);
                    const continueHref = lastId
                        ? `lesson.html?id=${lastId}&slug=starter-guide`
                        : `course.html?slug=starter-guide`;
                    coursesContent.innerHTML = `
                        <div class="dash-course-card">
                            <div class="dash-course-card__icon">🎮</div>
                            <div class="dash-course-card__body">
                                <div class="dash-course-card__title">Console Starter Guide</div>
                                <div class="dash-course-card__progress-bar"><div class="dash-course-card__progress-fill" style="width:${pct}%"></div></div>
                                <div class="dash-course-card__sub">${doneCount} / ${totalLessons} lessons · ${pct}%</div>
                            </div>
                            <a href="${continueHref}" class="dash-course-card__btn">Continue →</a>
                        </div>`;
                } else {
                    coursesContent.innerHTML = `
                        <div class="dash-course-card">
                            <div class="dash-course-card__icon">🎮</div>
                            <div class="dash-course-card__body">
                                <div class="dash-course-card__title">Console Starter Guide</div>
                                <div class="dash-course-card__sub">Everything you need to know about gaming consoles</div>
                            </div>
                            <a href="course.html?slug=starter-guide" class="dash-course-card__btn">Start →</a>
                        </div>`;
                }
            }

            // Overview course stat
            const overviewCourseStat = document.getElementById('home-overview-course-stat');
            if (overviewCourseStat && starterProgressRes && starterProgressRes.total_lessons > 0) {
                const done = (starterProgressRes.completed_lesson_ids || []).length;
                const total = starterProgressRes.total_lessons;
                overviewCourseStat.textContent = `${done}/${total}`;
            }

            // Progress panel course stat
            const progressPanelCourseStat = document.getElementById('progress-panel-course-stat');
            if (progressPanelCourseStat && starterProgressRes && starterProgressRes.total_lessons > 0) {
                const done = (starterProgressRes.completed_lesson_ids || []).length;
                const total = starterProgressRes.total_lessons;
                progressPanelCourseStat.textContent = `${done}/${total}`;
            }

            // =========================
            // MY POSTS
            // =========================
            const postsPreview = document.getElementById('home-posts-preview');
            if (postsPreview) {
                if (myPostsRes.success && Array.isArray(myPostsRes.posts) && myPostsRes.posts.length > 0) {
                    postsPreview.innerHTML = `
                        <div class="dash-posts-list">
                            ${myPostsRes.posts.slice(0, 5).map(p => `
                                <a href="community.html#forum/${p.console}/thread/${p.id}" class="dash-post-item">
                                    <span class="dash-post-title">${escapeHtml(p.title || p.content || 'Post')}</span>
                                    <span class="dash-post-meta">${p.replies || 0} replies</span>
                                </a>
                            `).join('')}
                        </div>
                        <a href="community.html" class="dash-see-all">See all posts</a>
                    `;
                } else {
                    postsPreview.innerHTML = `
                        <div class="dash-empty-state">
                            <span class="dash-empty-state__icon">📝</span>
                            <p class="dash-empty-state__text">No posts yet</p>
                            <p class="dash-empty-state__hint">Start a discussion or ask a question in the community forum.</p>
                            <a href="community.html" class="dash-empty-state__link">Create your first post →</a>
                        </div>`;
                }
            }

            // =========================
            // LIKED POSTS
            // =========================
            const likedPreview = document.getElementById('home-liked-preview');
            if (likedPreview) {
                const likedItems = likedPostsRes.liked || likedPostsRes.posts || [];
                if (likedPostsRes.success && Array.isArray(likedItems) && likedItems.length > 0) {
                    likedPreview.innerHTML = `
                        <div class="dash-posts-list">
                            ${likedItems.slice(0, 5).map(p => `
                                <a href="community.html#forum/${p.console}/thread/${p.id}" class="dash-post-item">
                                    <span class="dash-post-title">${escapeHtml(p.title || p.content || 'Post')}</span>
                                    <span class="dash-post-meta">by ${escapeHtml(p.username || '')}</span>
                                </a>
                            `).join('')}
                        </div>
                        <a href="community.html" class="dash-see-all">See all liked posts</a>
                    `;
                } else {
                    likedPreview.innerHTML = `
                        <div class="dash-empty-state">
                            <span class="dash-empty-state__icon">👍</span>
                            <p class="dash-empty-state__text">No liked posts yet</p>
                            <p class="dash-empty-state__hint">Explore the community forum and upvote posts you find helpful.</p>
                            <a href="community.html" class="dash-empty-state__link">Explore community →</a>
                        </div>`;
                }
            }

            // =========================
            // RECENT RATINGS PREVIEW
            // =========================
            const ratingsPreview = document.getElementById('home-ratings-preview');
            if (ratingsPreview) {
                if (ratingsRes.success && ratingsRes.ratings.length > 0) {
                    const recent = ratingsRes.ratings.slice(0, 3);
                    const allConsoles = window.CONSOLES_DATA || [];
                    ratingsPreview.innerHTML = `
                        <div class="dash-ratings-list">
                            ${recent.map(r => {
                                const c = allConsoles.find(x => x.id === r.console_id);
                                const name = c ? c.name : r.console_id;
                                const stars = '★'.repeat(r.rating || 0) + '☆'.repeat(5 - (r.rating || 0));
                                return `<div class="dash-rating-item">
                                    <span class="dash-rating-name">${escapeHtml(name)}</span>
                                    <span class="dash-rating-stars">${stars}</span>
                                </div>`;
                            }).join('')}
                        </div>
                    `;
                } else {
                    ratingsPreview.innerHTML = `
                        <div class="dash-empty-state">
                            <span class="dash-empty-state__icon">⭐</span>
                            <p class="dash-empty-state__text">${I18nModule.t('home_ratings_empty')}</p>
                            <p class="dash-empty-state__hint">Rate your favorite consoles to keep track here.</p>
                            <a href="evolutie.html" class="dash-empty-state__link">Browse consoles →</a>
                        </div>`;
                }
            }

            // =========================
            // COMMUNITY / TRENDING
            // =========================
            const communityGrid = document.querySelector('.community-grid');

            if (communityGrid && forumRes.success) {
                communityGrid.innerHTML = '';

                if (forumRes.threads && forumRes.threads.length > 0) {
                    forumRes.threads.slice(0, 6).forEach((t) => {
                        const card = document.createElement('article');
                        card.className = 'community-card';
                        card.innerHTML = `
                            <h3>${escapeHtml(t.title)}</h3>
                            <p>By ${escapeHtml(t.username)}</p>
                        `;
                        card.addEventListener('click', () => { window.location.href = `community.html#forum/${t.console}/thread/${t.id}`; });
                        communityGrid.appendChild(card);
                    });
                } else {
                    communityGrid.innerHTML = `
                        <div class="dash-empty-state">
                            <span class="dash-empty-state__icon">💬</span>
                            <p class="dash-empty-state__text">No trending posts yet</p>
                            <p class="dash-empty-state__hint">Be the first to start a discussion!</p>
                            <a href="community.html" class="dash-empty-state__link">Go to community →</a>
                        </div>`;
                }
            }

            // =========================
            // MARKETPLACE PREVIEW (newest listings)
            // =========================
            const marketplacePreview = document.getElementById('home-marketplace-preview');
            if (marketplacePreview) {
                if (trendingListingsRes.success && trendingListingsRes.listings?.length > 0) {
                    marketplacePreview.innerHTML = trendingListingsRes.listings.slice(0, 4).map(l => {
                        const imgs = Array.isArray(l.images) ? l.images : [];
                        const img = imgs[0] || NO_IMAGE_PLACEHOLDER;
                        return `<div class="home-listing-card" data-id="${l.id}">
                            <a href="community.html#listing-${l.id}" class="home-listing-card__media">
                                <img src="${escapeHtml(img)}" alt="" loading="lazy">
                            </a>
                            <div class="home-listing-card__info">
                                <div class="home-listing-card__title">${escapeHtml(l.title)}</div>
                                <div class="home-listing-card__price">${Number(l.price).toFixed(0)} RON</div>
                            </div>
                        </div>`;
                    }).join('');
                } else {
                    marketplacePreview.innerHTML = `
                        <div class="dash-empty-state">
                            <span class="dash-empty-state__icon">🛒</span>
                            <p class="dash-empty-state__text">No listings yet</p>
                            <p class="dash-empty-state__hint">Be the first to post something for sale!</p>
                            <a href="community.html#marketplace/new" class="dash-empty-state__link">+ Add listing →</a>
                        </div>`;
                }
            }

            // =========================
            // ARTICLES PREVIEW
            // =========================
            const articlesPreview = document.getElementById('home-articles-preview');
            if (articlesPreview) {
                if (articlesRes.success && articlesRes.articles.length > 0) {
                    articlesPreview.innerHTML = articlesRes.articles.slice(0, 3).map(a => `
                        <a href="article.html?slug=${encodeURIComponent(a.slug)}" class="article-card">
                            ${a.cover_image_url ? `<img class="article-card__cover" src="${escapeHtml(a.cover_image_url)}" alt="" loading="lazy">` : '<div class="article-card__cover article-card__cover--placeholder">📰</div>'}
                            <div class="article-card__body">
                                <h3 class="article-card__title">${escapeHtml(a.title)}</h3>
                                ${a.excerpt ? `<p class="article-card__excerpt">${escapeHtml(a.excerpt)}</p>` : ''}
                            </div>
                        </a>
                    `).join('');
                } else {
                    articlesPreview.innerHTML = `
                        <div class="dash-empty-state">
                            <span class="dash-empty-state__icon">📰</span>
                            <p class="dash-empty-state__text">${I18nModule.t('home_articles_empty')}</p>
                            <a href="articles.html" class="dash-empty-state__link">${I18nModule.t('home_articles_see_all')}</a>
                        </div>`;
                }
            }

            // =========================
            // HOME PANEL — Collection preview
            // =========================
            const homeCollectionPreview = document.getElementById('home-collection-preview');
            if (homeCollectionPreview && Array.isArray(user.owned_console_ids)) {
                const allConsoles = window.CONSOLES_DATA || [];
                if (user.owned_console_ids.length > 0) {
                    homeCollectionPreview.innerHTML = '';
                    const emojis = ['🎮','🕹️','🔥','⚡','🌟','🎯'];
                    user.owned_console_ids.slice(0, 6).forEach((cid, idx) => {
                        const c = allConsoles.find(x => x.id === cid);
                        if (!c) return;
                        const btn = document.createElement('button');
                        btn.className = 'console-card';
                        btn.innerHTML = `${emojis[idx % emojis.length]} <span>${escapeHtml(c.name)}</span>`;
                        btn.addEventListener('click', () => { window.location.href = `consoles/${c.id}.html`; });
                        homeCollectionPreview.appendChild(btn);
                    });
                } else {
                    homeCollectionPreview.innerHTML = `
                        <div class="dash-empty-state">
                            <span class="dash-empty-state__icon">📦</span>
                            <p class="dash-empty-state__text">No consoles in your collection</p>
                            <p class="dash-empty-state__hint">Browse the console library and start building your collection.</p>
                            <a href="evolutie.html" class="dash-empty-state__link">Browse consoles →</a>
                        </div>`;
                }
            }

            // =========================
            // HOME PANEL — Achievements preview
            // =========================
            const homeAchievementsPreview = document.getElementById('home-achievements-preview');
            if (homeAchievementsPreview && achievementsRes.success) {
                const badges = achievementsRes.achievements || [];
                const earnedBadges = badges.filter(b => b.unlocked)
                    .sort((a, b) => new Date(b.earned_at || 0) - new Date(a.earned_at || 0));
                if (badges.length > 0) {
                    homeAchievementsPreview.innerHTML = '';
                    // Up to 4 most recently earned, fill remainder with next locked
                    const recentEarned = earnedBadges.slice(0, 4);
                    const lockedFill = badges.filter(b => !b.unlocked).slice(0, 4 - recentEarned.length);
                    const preview = [...recentEarned, ...lockedFill];
                    preview.forEach(a => {
                        const earnedDate = a.unlocked && a.earned_at
                            ? new Date(a.earned_at).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' })
                            : '';
                        const div = document.createElement('div');
                        div.className = 'achievement-card' + (a.unlocked ? ' achievement-card--unlocked' : ' achievement-card--locked');
                        div.innerHTML = `
                            <span class="achievement-card__icon">${a.emoji || a.icon || '🏅'}</span>
                            <strong class="achievement-card__name">${escapeHtml(a.name)}</strong>
                            <span class="achievement-card__desc">${escapeHtml(a.description || '')}</span>
                            <span class="achievement-card__status">${a.unlocked ? `${I18nModule.t('ach_earned')}${earnedDate ? ' ' + earnedDate : ''}` : I18nModule.t('ach_locked')}</span>
                        `;
                        homeAchievementsPreview.appendChild(div);
                    });
                    const parent = homeAchievementsPreview.parentElement;
                    if (parent) parent.querySelectorAll('.dash-see-all').forEach(el => el.remove());
                    const seeAll = document.createElement('a');
                    seeAll.href = '#achievements';
                    seeAll.className = 'dash-see-all btn btn--primary';
                    seeAll.innerHTML = I18nModule.t('ach_see_all').replace('{earned}', earnedBadges.length).replace('{total}', badges.length);
                    if (parent) parent.appendChild(seeAll);
                } else {
                    homeAchievementsPreview.innerHTML = `
                        <div class="dash-empty-state">
                            <span class="dash-empty-state__icon">🏆</span>
                            <p class="dash-empty-state__text">No achievements yet</p>
                            <p class="dash-empty-state__hint">Complete lessons and interact with the community to earn badges.</p>
                            <a href="invata.html" class="dash-empty-state__link">Start learning →</a>
                        </div>`;
                }
            }

            // =========================
            // HOME PANEL — Friends preview
            // =========================
            const homeFriendsPreview = document.getElementById('home-friends-home-preview');
            if (homeFriendsPreview) {
                if (friendsRes.success && friendsRes.friends.length > 0) {
                    const preview = friendsRes.friends.slice(0, 8);
                    homeFriendsPreview.innerHTML = `
                        <div class="dash-friends-list">
                            ${preview.map(f => `
                                <a href="user-profile.html?username=${encodeURIComponent(f.username)}" class="dash-friend-item">
                                    <span class="dash-friend-avatar">${f.avatar ? `<img src="${escapeHtml(f.avatar)}" alt="">` : '<span class="dash-friend-fallback">👤</span>'}</span>
                                    <span class="dash-friend-name">${escapeHtml(f.username)}</span>
                                </a>
                            `).join('')}
                        </div>
                    `;
                } else {
                    homeFriendsPreview.innerHTML = `
                        <div class="dash-empty-state">
                            <span class="dash-empty-state__icon">👥</span>
                            <p class="dash-empty-state__text">No friends yet</p>
                            <p class="dash-empty-state__hint">Join the community and connect with console enthusiasts!</p>
                            <a href="community.html" class="dash-empty-state__link">Join community →</a>
                        </div>`;
                }
            }

            // =========================
            // QUICK START GUIDE
            // =========================
            try {
                if (qsgRes && qsgRes.success) {
                    if (qsgRes.show) {
                        renderQuickStart(qsgRes);
                        maybeStartOnboardingTour(qsgRes);
                    } else {
                        renderQuickStartCompleted(qsgRes);
                    }
                }
            } catch (qsgErr) {
                console.warn('QSG render error:', qsgErr);
            }

        } catch (err) {
            console.error('Dashboard error:', err);
        }
    }

    // RUN
    populateDashboard();

    // =========================
    // CONTINUE BUTTON
    // =========================
    const continueButton = document.getElementById('continue-btn');

    if (continueButton) {
        continueButton.addEventListener('click', () => {
            window.location.href = 'invata.html';
        });
    }

    // =========================
    // QUICK START GUIDE
    // =========================
    const QSG_OVERLAY_ID = 'qsg-overlay';

    function ensureQsgOverlay() {
        let overlay = document.getElementById(QSG_OVERLAY_ID);
        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.className = 'qsg-overlay';
        overlay.id = QSG_OVERLAY_ID;
        overlay.innerHTML = `
            <div class="qsg-modal-content">
                <button class="qsg-modal-close" id="qsg-modal-close" aria-label="Închide">✕</button>
                <span id="qsg-tour-step" class="qsg-tour-step" hidden></span>
                <h3 id="qsg-modal-title"></h3>
                <p id="qsg-modal-body"></p>
                <a id="qsg-modal-link" class="qsg-modal-link" href="#"></a>
                <div id="qsg-tour-controls" class="qsg-tour-controls" hidden>
                    <button id="qsg-tour-skip" class="qsg-tour-btn qsg-tour-btn--skip"></button>
                    <button id="qsg-tour-next" class="qsg-tour-btn qsg-tour-btn--next"></button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeQsgModal();
        });
        document.getElementById('qsg-modal-close').addEventListener('click', closeQsgModal);

        return overlay;
    }

    function openQsgModal(task, tourCtx) {
        const overlay = ensureQsgOverlay();
        document.getElementById('qsg-modal-title').textContent = I18nModule.t(task.modalTitleKey);
        document.getElementById('qsg-modal-body').textContent = I18nModule.t(task.modalBodyKey).trim();
        const linkEl = document.getElementById('qsg-modal-link');
        linkEl.textContent = I18nModule.t(task.modalLinkKey);
        linkEl.href = task.modalLinkUrl;

        const stepEl = document.getElementById('qsg-tour-step');
        const controlsEl = document.getElementById('qsg-tour-controls');
        if (tourCtx) {
            stepEl.hidden = false;
            stepEl.textContent = I18nModule.t('qsg_tour_step_x_of_y')
                .replace('{current}', tourCtx.index).replace('{total}', tourCtx.total);
            controlsEl.hidden = false;
            const nextBtn = document.getElementById('qsg-tour-next');
            const skipBtn = document.getElementById('qsg-tour-skip');
            nextBtn.textContent = tourCtx.index < tourCtx.total ? I18nModule.t('qsg_tour_next') : I18nModule.t('qsg_tour_finish');
            skipBtn.textContent = I18nModule.t('qsg_tour_skip');
            nextBtn.onclick = tourCtx.onNext;
            skipBtn.onclick = tourCtx.onSkip;
        } else {
            stepEl.hidden = true;
            controlsEl.hidden = true;
        }

        overlay.classList.add('is-open');
    }

    function closeQsgModal() {
        const overlay = document.getElementById(QSG_OVERLAY_ID);
        if (overlay) overlay.classList.remove('is-open');
    }

    // =========================
    // ONBOARDING TOUR (sequential walk through incomplete QSG tasks)
    // =========================
    const TOUR_DISMISSED_KEY = 'cn_onboarding_tour_dismissed';

    function maybeStartOnboardingTour(data) {
        if (localStorage.getItem(TOUR_DISMISSED_KEY) === '1') return;
        const incomplete = QUICK_START_TASKS.filter(t => data.tasks[t.id] !== true && t.modalTitleKey);
        if (!incomplete.length) return;
        startOnboardingTour(incomplete);
    }

    function startOnboardingTour(tasks) {
        let idx = 0;

        function finishTour() {
            localStorage.setItem(TOUR_DISMISSED_KEY, '1');
            closeQsgModal();
        }

        function showStep() {
            openQsgModal(tasks[idx], {
                index: idx + 1,
                total: tasks.length,
                onNext: () => {
                    idx++;
                    if (idx < tasks.length) showStep();
                    else finishTour();
                },
                onSkip: finishTour,
            });
        }

        showStep();
    }

    function renderQuickStart(data) {
        const section = document.getElementById('quick-start-guide');
        if (!section) return;

        section.hidden = false;

        const taskLabelKeys = {
            registered:        'qsg_task_registered',
            profile_complete:  'qsg_task_profile_complete',
            lesson_complete:   'qsg_task_lesson_complete',
            console_3:         'qsg_task_console_3',
            first_favorite:    'qsg_task_first_favorite',
            first_chat_message:'qsg_task_first_chat',
            first_post:        'qsg_task_first_post',
        };

        const doneTasks = QUICK_START_TASKS.filter(t => data.tasks[t.id] === true);
        const nextTask  = QUICK_START_TASKS.find(t => data.tasks[t.id] !== true);
        const doneCount = doneTasks.length;
        const totalCount = QUICK_START_TASKS.length;

        const xpLabel = (I18nModule.t('qsg_xp_progress') || '{xp} / 150 XP').replace('{xp}', data.xp);
        const counterLabel = `${doneCount} / ${totalCount}`;

        let currentTaskHtml = '';
        if (nextTask) {
            const label = I18nModule.t(taskLabelKeys[nextTask.id]);
            const btn = nextTask.modalTitleKey
                ? `<button class="qsg-task-btn" data-task="${nextTask.id}">${I18nModule.t('qsg_btn_open')}</button>`
                : '';
            currentTaskHtml = `<div class="qsg-task qsg-task--current">
                <span class="qsg-task-check"></span>
                <span class="qsg-task-label">${escapeHtml(label)}</span>
                <span class="qsg-task-xp">+${nextTask.xp} XP</span>
                ${btn}
            </div>`;
        }

        section.innerHTML = `
            <div class="qsg-header">
                <div class="qsg-header-top">
                    <div>
                        <span class="qsg-title">${I18nModule.t('qsg_title')}</span>
                        <span class="qsg-subtitle">${I18nModule.t('qsg_subtitle')}</span>
                    </div>
                    <div class="qsg-header-right">
                        <span class="qsg-counter">${counterLabel}</span>
                        <span class="qsg-xp-badge">${xpLabel}</span>
                    </div>
                </div>
                <div class="qsg-progress-bar">
                    <div class="qsg-progress-fill" style="width: 0%"></div>
                </div>
            </div>
            <div class="qsg-tasks">${currentTaskHtml}</div>
        `;

        setTimeout(() => {
            const fill = section.querySelector('.qsg-progress-fill');
            if (fill) fill.style.width = data.progressPercent + '%';
        }, 80);

        section.querySelectorAll('.qsg-task-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const taskId = btn.dataset.task;
                const task = QUICK_START_TASKS.find(t => t.id === taskId);
                if (task && task.modalTitleKey) openQsgModal(task);
            });
        });

        // ── Populate progress panel QSG (all tasks) ──
        renderProgressQsg(data, taskLabelKeys);
    }

    function renderProgressQsg(data, taskLabelKeys) {
        const section = document.getElementById('progress-qsg-section');
        const container = document.getElementById('progress-qsg-tasks');
        if (!section || !container) return;

        section.hidden = false;

        const allTasksHtml = QUICK_START_TASKS.map(task => {
            const done = data.tasks[task.id] === true;
            const doneClass = done ? ' qsg-task--done' : '';
            const label = I18nModule.t(taskLabelKeys[task.id]);
            const btn = (!done && task.modalTitleKey)
                ? `<button class="qsg-task-btn" data-task="${task.id}">${I18nModule.t('qsg_btn_open')}</button>`
                : '';
            return `<div class="qsg-task${doneClass}">
                <span class="qsg-task-check">${done ? '✓' : ''}</span>
                <span class="qsg-task-label">${escapeHtml(label)}</span>
                <span class="qsg-task-xp">+${task.xp} XP</span>
                ${btn}
            </div>`;
        }).join('');

        container.innerHTML = `<div class="qsg-tasks">${allTasksHtml}</div>`;

        container.querySelectorAll('.qsg-task-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const taskId = btn.dataset.task;
                const task = QUICK_START_TASKS.find(t => t.id === taskId);
                if (task && task.modalTitleKey) openQsgModal(task);
            });
        });
    }

    function renderHomeLevelsPanel(currentLevel) {
        const list = document.getElementById('home-levels-list');
        if (!list || !AchievementsModule.LEVELS?.length) return;

        const currentIdx = AchievementsModule.LEVELS.findIndex(l => l.name === currentLevel.name);

        list.innerHTML = AchievementsModule.LEVELS.map((lvl, idx) => {
            const isCurrent = idx === currentIdx;
            const isPast    = idx < currentIdx;

            let statusIcon, statusClass;
            if (isPast)         { statusIcon = '✓';       statusClass = 'level-row--done'; }
            else if (isCurrent) { statusIcon = lvl.emoji; statusClass = 'level-row--current'; }
            else                { statusIcon = '🔒';      statusClass = 'level-row--locked'; }

            const t = k => I18nModule.t(k);
            const translatedName = t('level_name_' + lvl.level) || lvl.name;
            const desc = lvl.xpRequired === 0
                ? t('level_starting')
                : t('level_requires_xp').replace('{xp}', lvl.xpRequired.toLocaleString());

            let barHtml = '';
            if (isCurrent && currentLevel.nextLevel) {
                barHtml = `
                    <div class="level-row__bar"><div class="level-row__bar-fill" style="width:${currentLevel.progressPercent}%"></div></div>
                    <span class="level-row__bar-label">${currentLevel.xp} / ${currentLevel.xpForNext} XP — ${currentLevel.progressPercent}% ${t('level_towards')} ${currentLevel.nextLevel.emoji} ${t('level_name_' + currentLevel.nextLevel.level) || currentLevel.nextLevel.name}</span>`;
            } else if (isPast) {
                barHtml = `<div class="level-row__bar"><div class="level-row__bar-fill" style="width:100%"></div></div>`;
            }

            return `
                <div class="level-row ${statusClass}">
                    <div class="level-row__status">${statusIcon}</div>
                    <div class="level-row__info">
                        <div class="level-row__header">
                            <strong class="level-row__name">${lvl.emoji} ${translatedName}</strong>
                        </div>
                        ${desc ? `<div class="level-row__desc">${desc}</div>` : ''}
                        ${barHtml}
                    </div>
                </div>`;
        }).join('');
    }

    function leaderboardAvatarHtml(u) {
        if (u.avatar) {
            return `<img class="idx-leaderboard__avatar" src="${escapeHtml(u.avatar)}" alt="" loading="lazy">`;
        }
        const initial = (u.username || '?').charAt(0).toUpperCase();
        return `<div class="idx-leaderboard__avatar">${escapeHtml(initial)}</div>`;
    }

    async function loadProgressLeaderboardPreview() {
        const list = document.getElementById('progress-leaderboard-list');
        if (!list) return;
        try {
            const res = await apiFetch(`${API_BASE_URL}/leaderboard?limit=5`);
            if (!res || !res.success || !res.users || res.users.length === 0) {
                list.innerHTML = `<div class="idx-leaderboard__empty">${I18nModule.t('leaderboard_empty')}</div>`;
                return;
            }
            list.innerHTML = res.users.map(u => `
                <a class="idx-leaderboard__row" href="/user/${encodeURIComponent(u.username)}">
                    <span class="idx-leaderboard__rank">${u.rank <= 3 ? ['🥇', '🥈', '🥉'][u.rank - 1] : '#' + u.rank}</span>
                    ${leaderboardAvatarHtml(u)}
                    <span class="idx-leaderboard__username">${escapeHtml(u.username)}</span>
                    <span class="idx-leaderboard__xp">${u.xp.toLocaleString()} XP</span>
                </a>
            `).join('');
        } catch {
            list.innerHTML = `<div class="idx-leaderboard__empty">${I18nModule.t('leaderboard_error')}</div>`;
        }
    }

    function renderQuickStartCompleted(data) {
        // Home card — show completed state, then fade out after 4s
        const section = document.getElementById('quick-start-guide');
        if (section) {
            section.hidden = false;
            section.innerHTML = `
                <div class="qsg-completed">
                    <span class="qsg-completed-icon">🎉</span>
                    <div>
                        <span class="qsg-completed-title">${I18nModule.t('qsg_completed_title')}</span>
                        <span class="qsg-completed-sub">${I18nModule.t('qsg_completed_sub')}</span>
                    </div>
                </div>
            `;
        }

        // Progress panel — always show all tasks as done
        const taskLabelKeys = {
            registered:        'qsg_task_registered',
            profile_complete:  'qsg_task_profile_complete',
            lesson_complete:   'qsg_task_lesson_complete',
            console_3:         'qsg_task_console_3',
            first_favorite:    'qsg_task_first_favorite',
            first_chat_message:'qsg_task_first_chat',
            first_post:        'qsg_task_first_post',
        };
        renderProgressQsg(data, taskLabelKeys);
    }

    async function initQuickStart() {
        const data = await apiFetch('/api/me/quick-start-status');
        if (!data || !data.success) return;

        if (!data.show) {
            renderQuickStartCompleted(data);
        } else {
            renderQuickStart(data);
        }
    }

    window.addEventListener('cn:xp-update', () => initQuickStart());

});

// ── Panel hash routing ────────────────────────────────────────
(function initPanelRouting() {
    const PANELS = ['home','collection','favorites','progress','achievements','courses','friends','posts','liked','orders'];
    const DEFAULT = 'home';

    function activatePanel(hash) {
        const name = PANELS.includes((hash || '').replace('#', ''))
            ? hash.replace('#', '')
            : DEFAULT;
        document.querySelectorAll('.home-panel').forEach(p => {
            p.classList.toggle('active', p.dataset.panel === name);
        });
        document.querySelectorAll('.sidebar-link[data-panel]').forEach(a => {
            a.classList.toggle('active', a.dataset.panel === name);
        });
    }

    activatePanel(location.hash);
    window.addEventListener('hashchange', () => activatePanel(location.hash));
}());
