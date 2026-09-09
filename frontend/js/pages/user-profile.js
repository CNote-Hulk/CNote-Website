/**
 * Public User Profile Page
 * Displays another user's profile: progress, achievements,
 * favorites, owned consoles, and friend request controls.
 */
import { AuthModule } from '/js/modules/auth.js';
import { API_BASE_URL } from '/js/config.js';
import { AchievementsModule } from '/js/modules/achievements.js';
import { I18nModule } from '/js/modules/i18n.js?v=20260909c';
import { shareOrCopy } from '/js/utils/share.js';
import { confirmModal, promptModal } from '/js/utils/confirm-modal.js';
import { NO_IMAGE_PLACEHOLDER } from '/js/utils/no-image-placeholder.js';

/** Shortcut pentru traduceri */
const t = key => I18nModule.t(key);


        /** Escape HTML special characters */
        function escapeHtml(s) {
            if (!s) return '';
            return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        /** Extract username from URL path (/user/:username) or query string (?username= or ?user=) */
        function getUsernameFromUrl() {
            const path = window.location.pathname;
            const match = path.match(/\/user\/([^/]+)/);
            if (match) return decodeURIComponent(match[1]);
            const params = new URLSearchParams(window.location.search);
            const q = params.get('username') || params.get('user');
            return q ? q.trim() : null;
        }

        /** Convert numeric rating to star characters (★☆) */
        function renderRatingStars(rating) {
            const full = Math.floor(rating);
            const half = rating - full >= 0.3 && rating - full < 0.8 ? 1 : 0;
            const fullExtra = rating - full >= 0.8 ? 1 : 0;
            const empty = 5 - full - fullExtra - half;
            return '★'.repeat(full + fullExtra) + (half ? '½' : '') + '☆'.repeat(empty);
        }

        function resolveAvatar(profile) {
            if (!profile) return '';
            return AuthModule.normalizeAvatarUrl((profile.avatar || '').trim());
        }

        /** Render the user's dashboard: progress, achievements, ratings, favorites */
        async function renderUserDashboard(profile) {
            // Show dashboard
            document.getElementById('user-dashboard-panel').hidden = false;

            // Progress — fetch from server (localStorage only has the viewer's own data)
            let serverCourses = [];
            try {
                const progRes = await fetch(`${API_BASE_URL}/user/progress/${encodeURIComponent(profile.username)}`);
                const progData = await progRes.json();
                if (progData.success) serverCourses = progData.courses || [];
            } catch { /* fall through with empty */ }

            let totalLessons = 0, completedLessons = 0;
            serverCourses.forEach(c => {
                totalLessons += c.total || 0;
                completedLessons += c.completed || 0;
            });
            const overallPct = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;
            document.getElementById('user-dash-courses-pct').textContent = overallPct + '%';

            const coursePreview = document.getElementById('user-dash-course-preview');
            if (serverCourses.length > 0) {
                const previewCourses = serverCourses.slice(0, 3);
                const previewHtml = previewCourses.map(c => {
                    const done = c.completed || 0;
                    const total = c.total || 0;
                    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                    return `<div class="up-course-row">
                        <div class="up-course-row__top">
                            <span class="up-course-row__name">${escapeHtml(c.title || c.slug)}</span>
                            <span class="up-course-row__count">${done}/${total}</span>
                        </div>
                        <div class="progress-bar"><div class="progress-bar__fill" style="width:${pct}%"></div></div>
                    </div>`;
                }).join('');
                coursePreview.innerHTML = `<div class="up-course-preview-wrap">
                    ${previewHtml}
                    <button class="up-ach-view-all-btn" id="up-course-view-all-btn">${t('home_courses_see_all')} →</button>
                </div>`;
                document.getElementById('up-course-view-all-btn').addEventListener('click', () => {
                    openCoursesModal(serverCourses, completedLessons, totalLessons, t);
                });
            } else {
                coursePreview.innerHTML = '<p class="dash-empty">No courses available.</p>';
            }

            // Achievements — fetch computed dynamically (same logic as authenticated endpoint)
            const CATEGORIES = window.GAMIFICATION_DATA?.CATEGORIES ?? [];
            let badges = [];
            try {
                const achRes = await fetch(`${API_BASE_URL}/achievements/user/${encodeURIComponent(profile.username)}`);
                const achData = await achRes.json();
                badges = achData.achievements || [];
                // Normalise: use `earned` = unlocked for consistency
                badges = badges.map(b => ({ ...b, earned: !!b.unlocked }));
            } catch { /* leave badges empty */ }
            const earnedCount = badges.filter(b => b.earned).length;
            document.getElementById('user-dash-achievements').textContent = `${earnedCount} / ${badges.length}`;

            const achPreview = document.getElementById('user-dash-achievements-preview');
            if (earnedCount === 0) {
                achPreview.innerHTML = `<p class="dash-empty">${t('up_no_achievements')}</p>`;
            } else {
                // Show 6 most recently earned as compact mini-cards
                const recentEarned = badges
                    .filter(b => b.earned)
                    .sort((a, b) => new Date(b.earned_at || 0) - new Date(a.earned_at || 0))
                    .slice(0, 4);
                const miniCards = recentEarned.map(b => `
                    <div class="up-ach-mini" title="${escapeHtml(b.name)}">
                        <div class="up-ach-mini__icon">${b.emoji || b.icon || '🏅'}</div>
                        <div class="up-ach-mini__name">${escapeHtml(b.name)}</div>
                    </div>`).join('');
                const btnLabel = t('ach_see_all').replace('{earned}', earnedCount).replace('{total}', badges.length);
                achPreview.innerHTML = `
                    <div class="up-ach-preview-wrap">
                        <div class="up-ach-mini-grid">${miniCards}</div>
                        <button class="up-ach-view-all-btn" id="up-ach-view-all-btn">${btnLabel}</button>
                    </div>`;
                document.getElementById('up-ach-view-all-btn').addEventListener('click', () => {
                    openAchievementsModal(badges, CATEGORIES, earnedCount, t);
                });
            }

            // Ratings
            try {
                const res = await fetch(`${API_BASE_URL}/ratings/user/public/${encodeURIComponent(profile.username)}`);
                const data = await res.json();
                const ratings = (data.ratings || []);
                document.getElementById('user-dash-ratings').textContent = ratings.length;
                const ratingsPreview = document.getElementById('user-dash-ratings-preview');
                if (ratings.length > 0) {
                    ratingsPreview.innerHTML = ratings.slice(0, 5).map(r => {
                        const name = r.console_id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                        return `<a href="/html/pages/consoles/${encodeURIComponent(r.console_id)}.html" class="dash-rating-row">
                            <span class="dash-rating-row__name">${escapeHtml(name)}</span>
                            <span class="dash-rating-row__stars">${renderRatingStars(r.rating)}</span>
                        </a>`;
                    }).join('');
                } else {
                    ratingsPreview.innerHTML = `<p class="dash-empty">${t('up_no_ratings')}</p>`;
                }
            } catch {
                document.getElementById('user-dash-ratings-preview').innerHTML = `<p class="dash-empty">${t('up_no_ratings')}</p>`;
            }

            // Favorites
            const favCount = (profile.favorite_console_ids || []).length || (profile.favorite_consoles || '').split(',').filter(Boolean).length;
            document.getElementById('user-dash-favorites').textContent = favCount;
        }

        /** Open full achievements modal */
        function openAchievementsModal(badges, CATEGORIES, earnedCount, t) {
            document.getElementById('up-ach-modal')?.remove();

            const grouped = {};
            badges.forEach(b => {
                const cat = b.category || 'other';
                if (!grouped[cat]) grouped[cat] = [];
                grouped[cat].push(b);
            });
            const catOrder = CATEGORIES.map(c => c.id);
            const otherKeys = Object.keys(grouped).filter(k => !catOrder.includes(k));

            const renderCat = (catId) => {
                const items = grouped[catId];
                if (!items) return '';
                const catDef = CATEGORIES.find(c => c.id === catId);
                const earned = items.filter(b => b.earned).length;
                const cards = items.map(b => {
                    const isEarned = b.earned;
                    const dateStr = isEarned && b.earned_at
                        ? new Date(b.earned_at).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' })
                        : '';
                    return `<div class="achievement-badge ${isEarned ? 'earned' : 'locked'}">
                        <div class="achievement-badge__icon">${b.emoji || b.icon || '🏅'}</div>
                        <div class="achievement-badge__name">${escapeHtml(b.name)}</div>
                        <div class="achievement-badge__desc">${escapeHtml(b.description || '')}</div>
                        <div class="achievement-badge__status">${isEarned ? `${t('ach_earned')}${dateStr ? ' ' + dateStr : ''}` : t('ach_locked')}</div>
                    </div>`;
                }).join('');
                return `<div class="ach-category">
                    <div class="ach-category__header">
                        <span class="ach-category__icon">${catDef ? catDef.icon : '🏅'}</span>
                        <span class="ach-category__label">${t('ach_cat_' + catId)}</span>
                        <span class="ach-category__count">${earned}/${items.length}</span>
                    </div>
                    <div class="ach-category__grid">${cards}</div>
                </div>`;
            };

            const modal = document.createElement('div');
            modal.id = 'up-ach-modal';
            modal.className = 'up-ach-modal-overlay';
            modal.innerHTML = `
                <div class="up-ach-modal" role="dialog" aria-modal="true">
                    <div class="up-ach-modal__header">
                        <h3 class="up-ach-modal__title">🏅 ${t('up_tab_achievements')} <span class="up-ach-modal__count">${earnedCount} / ${badges.length}</span></h3>
                        <button class="up-ach-modal__close" aria-label="Close">✕</button>
                    </div>
                    <div class="up-ach-modal__body">
                        <div class="up-ach-modal__grid">
                            ${[...catOrder, ...otherKeys].map(renderCat).join('')}
                        </div>
                    </div>
                </div>`;

            document.body.appendChild(modal);
            requestAnimationFrame(() => modal.classList.add('visible'));

            const close = () => {
                modal.classList.remove('visible');
                setTimeout(() => modal.remove(), 220);
            };
            modal.querySelector('.up-ach-modal__close').addEventListener('click', close);
            modal.addEventListener('click', e => { if (e.target === modal) close(); });
            const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
            document.addEventListener('keydown', onKey);
        }

        /** Open full courses modal */
        function openCoursesModal(courses, completedLessons, totalLessons, t) {
            document.getElementById('up-course-modal')?.remove();

            const overallPct = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

            const courseCards = courses.map(c => {
                const done = c.completed || 0;
                const total = c.total || 0;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                const isComplete = total > 0 && done >= total;
                return `<div class="up-course-modal-row${isComplete ? ' completed' : ''}">
                    <div class="up-course-modal-row__top">
                        <span class="up-course-modal-row__name">${escapeHtml(c.title || c.slug)}</span>
                        <span class="up-course-modal-row__pct">${pct}%</span>
                    </div>
                    <div class="progress-bar up-course-modal-row__bar">
                        <div class="progress-bar__fill" style="width:${pct}%"></div>
                    </div>
                    <div class="up-course-modal-row__count">${done} / ${total} ${t('profile_courses_lessons')}</div>
                </div>`;
            }).join('');

            const modal = document.createElement('div');
            modal.id = 'up-course-modal';
            modal.className = 'up-ach-modal-overlay';
            modal.innerHTML = `
                <div class="up-ach-modal" role="dialog" aria-modal="true">
                    <div class="up-ach-modal__header">
                        <h3 class="up-ach-modal__title">${t('up_course_progress')} <span class="up-ach-modal__count">${overallPct}%</span></h3>
                        <button class="up-ach-modal__close" aria-label="Close">✕</button>
                    </div>
                    <div class="up-ach-modal__body">
                        <div class="up-course-modal-list">${courseCards}</div>
                    </div>
                </div>`;

            document.body.appendChild(modal);
            requestAnimationFrame(() => modal.classList.add('visible'));

            const close = () => {
                modal.classList.remove('visible');
                setTimeout(() => modal.remove(), 220);
            };
            modal.querySelector('.up-ach-modal__close').addEventListener('click', close);
            modal.addEventListener('click', e => { if (e.target === modal) close(); });
            const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
            document.addEventListener('keydown', onKey);
        }

        /** Render social links if user has them and privacy allows */
        function renderSocialLinks(profile) {
            const container = document.getElementById('user-social-links');
            if (!container) return;

            const links = [];
            if (profile.social_discord) links.push({ platform: 'Discord', value: profile.social_discord, icon: '💬' });
            if (profile.social_twitter) links.push({ platform: 'Twitter', value: profile.social_twitter, icon: '🐦' });
            if (profile.social_youtube) links.push({ platform: 'YouTube', value: profile.social_youtube, icon: '📺' });
            if (profile.social_instagram) links.push({ platform: 'Instagram', value: profile.social_instagram, icon: '📷' });

            if (links.length === 0) return;

            container.hidden = false;
            container.innerHTML = links.map(l => {
                const isUrl = l.value.startsWith('http://') || l.value.startsWith('https://');
                if (isUrl) {
                    return `<a href="${escapeHtml(l.value)}" target="_blank" rel="noopener noreferrer" class="user-social-link">
                        <span class="user-social-link__icon">${l.icon}</span>
                        <span class="user-social-link__platform">${escapeHtml(l.platform)}</span>
                    </a>`;
                }
                return `<span class="user-social-link">
                    <span class="user-social-link__icon">${l.icon}</span>
                    <span class="user-social-link__platform">${escapeHtml(l.platform)}</span>
                    <span class="user-social-link__value">${escapeHtml(l.value)}</span>
                </span>`;
            }).join('');
        }

        /** Fetch public profile data by username and render the page */
        async function loadUserProfile() {
            const username = getUsernameFromUrl();
            const loadingEl = document.getElementById('user-profile-loading');

            if (!username) {
                loadingEl.textContent = t('up_invalid_url');
                return;
            }

            try {
                const res = await fetch(`${API_BASE_URL}/users/${encodeURIComponent(username)}`);
                const data = await res.json();

                if (!data.success || !data.user) {
                    loadingEl.textContent = t('up_user_not_found');
                    return;
                }

                const profile = data.user;
                loadingEl.hidden = true;

                // Update page title
                document.title = `${profile.username} — Console Notebook`;

                // Show header
                const headerEl = document.getElementById('user-profile-header');
                headerEl.hidden = false;
                // Show dashboard
                await renderUserDashboard(profile);

                // Avatar
                const avatarImg = document.getElementById('user-avatar-img');
                const avatarFallback = document.getElementById('user-avatar-fallback');
                const resolvedAvatar = resolveAvatar(profile);
                if (resolvedAvatar && resolvedAvatar.length > 10) {
                    avatarImg.src = resolvedAvatar;
                    avatarImg.hidden = false;
                    avatarFallback.hidden = true;
                }

                // Avatar lightbox on click
                const avatarBtn = document.getElementById('user-avatar');
                const currentUser = AuthModule.getCurrentUser();
                const isOwnProfile = !!(currentUser && currentUser.id === profile.id);
                if (avatarBtn) {
                    avatarBtn.addEventListener('click', () => {
                        const src = resolveAvatar(profile) || null;
                        openAvatarLightbox(src, isOwnProfile);
                    });
                }

                // Info
                document.getElementById('user-name').textContent = profile.username;
                document.getElementById('user-bio').textContent = profile.bio || t('up_no_description');
                document.getElementById('user-date').textContent = t('up_member_since') + ' ' + new Date(profile.created_at).toLocaleDateString(I18nModule.lang, { year: 'numeric', month: 'long' });

                // Email — only sent by the API when the user enabled "show email"
                const emailEl = document.getElementById('user-email');
                if (emailEl && profile.email) {
                    emailEl.textContent = '✉️ ' + profile.email;
                    emailEl.hidden = false;
                }

                // Show admin badge if user is admin
                const adminBadge = document.getElementById('user-admin-badge');
                if (adminBadge && profile.role === 'admin') {
                    adminBadge.hidden = false;
                }

                // Level badge — real XP-based level from the backend (null when the user hides stats)
                const userLevelEl = document.getElementById('user-level');
                if (userLevelEl) {
                    if (profile.level) {
                        const lvl = AchievementsModule.computeLevel(profile.level);
                        userLevelEl.textContent = `${lvl.emoji} ${lvl.name}`;
                        userLevelEl.hidden = false;
                    } else {
                        userLevelEl.hidden = true;
                    }
                }

                // Console lists
                const consolesSection = document.getElementById('user-profile-consoles');
                if (consolesSection) {
                    consolesSection.hidden = false;
                }

                // Social links
                renderSocialLinks(profile);

                // Privacy: hide stats if user disabled them
                if (profile.show_stats === false) {
                    const dashPanel = document.getElementById('user-dashboard-panel');
                    const coursesSection = document.getElementById('user-dash-courses-section');
                    const ratingsSection = document.getElementById('user-dash-ratings-section');
                    const achievementsSection = document.getElementById('user-dash-achievements-section');
                    if (dashPanel) dashPanel.hidden = true;
                    if (coursesSection) coursesSection.hidden = true;
                    if (ratingsSection) ratingsSection.hidden = true;
                    if (achievementsSection) achievementsSection.hidden = true;
                }

                // Fetch console names once for both favorite and owned
                let consoleNames = {};
                try {
                    const cRes = await fetch(`${API_BASE_URL}/consoles/list`);
                    const cData = await cRes.json();
                    if (cData.success) {
                        cData.consoles.forEach(c => { consoleNames[c.id] = c.name; });
                    }
                } catch { /* ignore */ }

                // Favorite consoles - use favorite_console_ids from new table, fallback to CSV
                const favContainer = document.getElementById('user-favorite-consoles');
                const favIds = profile.favorite_console_ids || [];
                const favCsv = (profile.favorite_consoles || '').split(',').map(s => s.trim()).filter(Boolean);
                const allFavs = [...new Set([...favIds, ...favCsv])];

                if (allFavs.length > 0) {
                    favContainer.innerHTML = allFavs.map(id => {
                        const name = consoleNames[id] || id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                        return `<span class="profile-console-tag">${escapeHtml(name)}</span>`;
                    }).join('');
                }

                // Owned consoles
                const ownedContainer = document.getElementById('user-owned-consoles');
                const ownedIds = profile.owned_console_ids || [];
                const ownedCsv = (profile.owned_consoles || '').split(',').map(s => s.trim()).filter(Boolean);
                const allOwned = [...new Set([...ownedIds, ...ownedCsv])];

                if (allOwned.length > 0) {
                    ownedContainer.innerHTML = allOwned.map(id => {
                        const name = consoleNames[id] || id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                        return `<span class="profile-console-tag">${escapeHtml(name)}</span>`;
                    }).join('');
                }

                // Friend button
                const actionsEl = document.getElementById('user-profile-actions');

                if (currentUser && currentUser.id !== profile.id) {
                    await renderFriendButton(actionsEl, profile.id);
                    // DSA Art. 16 — report this profile
                    const reportBtn = document.createElement('button');
                    reportBtn.className = 'user-action-btn user-action-btn--remove report-trigger-btn';
                    reportBtn.textContent = t('report_btn_trigger_profile');
                    reportBtn.addEventListener('click', () => {
                        if (typeof window.openReportModal === 'function') {
                            window.openReportModal({
                                contentType: 'user_profile',
                                contentId:   String(profile.id),
                                contentPreview: profile.username,
                            });
                        }
                    });
                    actionsEl.appendChild(reportBtn);

                    // Admin-only ban/mute widget — Andrei: "I'm admin, I should be able to
                    // do this from a user's profile too", not only through a content report.
                    // Direct POST /api/admin/users/{id}/{ban,mute} (admin-stats.js) — same
                    // semantics/prompts as the Admin Reports moderation list.
                    if (currentUser.role === 'admin') {
                        renderAdminModerationWidget(actionsEl, profile.id, profile.username);
                    }
                } else if (currentUser && currentUser.id === profile.id) {
                    actionsEl.innerHTML = `<a href="/html/pages/profil.html#account" class="user-action-btn user-action-btn--edit">${t('up_edit_profile')}</a>`;
                }

                // Share profile button (always available, own or public)
                const shareBtn = document.createElement('button');
                shareBtn.className = 'user-action-btn';
                shareBtn.textContent = '🔗 ' + t('share_profile_btn');
                shareBtn.addEventListener('click', async () => {
                    const result = await shareOrCopy({
                        title: profile.username,
                        text: t('share_profile_text').replace('{username}', profile.username),
                        url: `${location.origin}/user/${encodeURIComponent(profile.username)}`,
                    });
                    if (result === 'copied') {
                        const original = shareBtn.textContent;
                        shareBtn.textContent = '✓ ' + t('share_link_copied');
                        setTimeout(() => { shareBtn.textContent = original; }, 1800);
                    }
                });
                actionsEl.appendChild(shareBtn);

                // Seller review summary (only shown if they have any)
                loadSellerRatingSummary(profile.id);

                // Friends list
                if (profile.show_friends !== false) {
                    await loadFriendsList(profile.username);
                } else {
                    const friendsSection = document.getElementById('user-friends-section');
                    if (friendsSection) friendsSection.hidden = true;
                }

                // Active marketplace listings
                await loadUserListings(profile.id);

                // Forum activity
                await loadForumActivity(profile.username);

            } catch (err) {
                console.error('Profile load error:', err);
                loadingEl.textContent = t('up_load_error');
            }
        }

        /** Render the Add/Remove/Accept Friend button with status checks */
        async function renderFriendButton(container, targetUserId) {
            try {
                const token = localStorage.getItem('cn_token');
                const headers = {};
                if (token) headers['Authorization'] = 'Bearer ' + token;

                const res = await fetch(`${API_BASE_URL}/friends/status/${targetUserId}`, {
                    headers,
                    credentials: 'include'
                });
                const data = await res.json();

                if (!data.success) return;

                switch (data.status) {
                    case 'friends':
                        container.innerHTML = `
                            <span class="user-action-btn user-action-btn--friends">${t('up_friends_status')}</span>
                            <button class="user-action-btn user-action-btn--remove" id="remove-friend-btn">${t('up_remove_friend')}</button>
                        `;
                        document.getElementById('remove-friend-btn').addEventListener('click', async () => {
                            await fetch(`${API_BASE_URL}/friends/${targetUserId}`, {
                                method: 'DELETE',
                                headers,
                                credentials: 'include'
                            });
                            renderFriendButton(container, targetUserId);
                        });
                        break;

                    case 'request_sent':
                        container.innerHTML = `<span class="user-action-btn user-action-btn--pending">${t('up_request_sent')}</span>`;
                        break;

                    case 'request_received':
                        container.innerHTML = `
                            <button class="user-action-btn user-action-btn--accept" id="accept-friend-btn">${t('up_accept_request')}</button>
                            <button class="user-action-btn user-action-btn--reject" id="reject-friend-btn">${t('up_reject')}</button>
                        `;
                        document.getElementById('accept-friend-btn').addEventListener('click', async () => {
                            const res = await fetch(`${API_BASE_URL}/friends/accept/${data.requestId}`, {
                                method: 'POST',
                                headers,
                                credentials: 'include'
                            });
                            if (res.ok) window.dispatchEvent(new CustomEvent('cn:friend-changed'));
                            renderFriendButton(container, targetUserId);
                        });
                        document.getElementById('reject-friend-btn').addEventListener('click', async () => {
                            await fetch(`${API_BASE_URL}/friends/reject/${data.requestId}`, {
                                method: 'POST',
                                headers,
                                credentials: 'include'
                            });
                            renderFriendButton(container, targetUserId);
                        });
                        break;

                    default: // 'none'
                        container.innerHTML = `<button class="user-action-btn user-action-btn--add" id="add-friend-btn">${t('up_add_friend')}</button>`;
                        document.getElementById('add-friend-btn').addEventListener('click', async () => {
                            await fetch(`${API_BASE_URL}/friends/request/${targetUserId}`, {
                                method: 'POST',
                                headers,
                                credentials: 'include'
                            });
                            renderFriendButton(container, targetUserId);
                        });
                        break;
                }
            } catch { /* ignore */ }
        }

        /** Fetch and display the user's seller-review average, if they have any */
        async function loadSellerRatingSummary(userId) {
            try {
                const res = await fetch(`${API_BASE_URL}/marketplace/sellers/${userId}/reviews`);
                const data = await res.json();
                if (!data.success || !data.count) return;
                const tile = document.getElementById('user-dash-seller-rating');
                const valueEl = document.getElementById('user-dash-seller-rating-value');
                if (tile && valueEl) {
                    valueEl.textContent = `⭐ ${data.average} (${data.count})`;
                    tile.hidden = false;
                }
            } catch { /* ignore */ }
        }

        /** Fetch and display user's friends list */
        async function loadFriendsList(username) {
            const section = document.getElementById('user-friends-section');
            const list = document.getElementById('user-friends-list');
            const friendCount = document.getElementById('user-dash-friends');
            if (friendCount) friendCount.textContent = '0';

            try {
                const res = await fetch(`${API_BASE_URL}/users/${encodeURIComponent(username)}/friends`);
                const data = await res.json();

                if (!data.success || !data.friends || data.friends.length === 0) {
                    section.hidden = false;
                    if (list) list.innerHTML = `<p class="user-listings-empty">${t('up_no_friends')}</p>`;
                    return;
                }

                if (friendCount) friendCount.textContent = data.friends.length;

                section.hidden = false;
                list.innerHTML = data.friends.map(f => {
                    const friendAvatar = AuthModule.normalizeAvatarUrl((f.avatar || '').trim());
                    const hasAvatar = friendAvatar && friendAvatar.length > 10;
                    const avatarHtml = hasAvatar
                        ? `<img src="${escapeHtml(friendAvatar)}" alt="" class="friend-card__avatar">`
                        : `<span class="friend-card__avatar friend-card__avatar--fallback">👤</span>`;

                    return `<a href="/user/${encodeURIComponent(f.username)}" class="friend-card">
                        ${avatarHtml}
                        <span class="friend-card__name">${escapeHtml(f.username)}</span>
                    </a>`;
                }).join('');
            } catch {
                section.hidden = false;
                if (list) list.innerHTML = `<p class="user-listings-empty">${t('up_friends_error')}</p>`;
            }
        }

        /** Fetch and display user's active marketplace listings on public profile */
        async function loadUserListings(userId) {
            const section = document.getElementById('user-listings-section');
            const grid = document.getElementById('user-listings-grid');
            if (!section || !grid) return;

            try {
                const res = await fetch(`${API_BASE_URL}/marketplace/listings/user/${userId}`);
                const data = await res.json();

                if (!data.success || !data.listings || data.listings.length === 0) {
                    section.hidden = false;
                    grid.innerHTML = `<p class="user-listings-empty">${t('up_no_listings')}</p>`;
                    return;
                }

                const CONDITIONS = { new: 'Nou', like_new: 'Ca nou', good: 'Bun', fair: 'Acceptabil', parts: 'Piese' };

                section.hidden = false;
                grid.innerHTML = data.listings.map(l => {
                    const imgs = Array.isArray(l.images) ? l.images : [];
                    const condLabels = { new: 'New', like_new: 'Like new', good: 'Good', fair: 'Fair', parts: 'Parts' };
                    return `<a href="/html/pages/community.html#listing-${l.id}" class="user-listing-card">
                        <div class="user-listing-card__img">
                            ${imgs[0] ? `<img src="${escapeHtml(imgs[0])}" alt="" loading="lazy">` : `<img src="${NO_IMAGE_PLACEHOLDER}" alt="" loading="lazy">`}
                        </div>
                        <div class="user-listing-card__info">
                            <div class="user-listing-card__condition">${condLabels[l.condition] || l.condition || ''}</div>
                            <div class="user-listing-card__title">${escapeHtml(l.title)}</div>
                            <div class="user-listing-card__price">${Number(l.price).toFixed(0)} RON</div>
                            ${l.seller_is_official ? `<span class="user-official-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>${t('marketplace_official_badge')}</span>` : ''}
                        </div>
                    </a>`;
                }).join('');
            } catch {
                section.hidden = false;
                grid.innerHTML = `<p class="user-listings-empty">${t('up_listings_error')}</p>`;
            }
        }

        /** Fetch and display user's recent forum threads */
        async function loadForumActivity(username) {
            const section = document.getElementById('user-forum-section');
            const container = document.getElementById('user-forum-activity');
            if (!section || !container) return;

            try {
                const res = await fetch(`${API_BASE_URL}/forum/recent`);
                const data = await res.json();
                if (!data.success || !data.threads) return;

                const userThreads = data.threads.filter(t => t.author === username).slice(0, 5);
                if (userThreads.length === 0) return;

                section.hidden = false;
                container.innerHTML = userThreads.map(t => {
                    const date = new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    const consoleName = (t.console || 'general').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    return `<a href="/html/pages/community.html#forum/${t.console || 'general'}/thread/${t.id}" class="up-forum-row">
                        <div class="up-forum-row__info">
                            <span class="up-forum-row__title">${escapeHtml(t.title)}</span>
                            <span class="up-forum-row__meta">${escapeHtml(consoleName)} · ${date}</span>
                        </div>
                        <span class="up-forum-row__replies">${t.reply_count || 0} 💬</span>
                    </a>`;
                }).join('');
            } catch { /* ignore */ }
        }

        /** Open the avatar lightbox */
        function openAvatarLightbox(avatarSrc, isOwn) {
            const lightbox = document.getElementById('avatar-lightbox');
            const img = document.getElementById('avatar-lightbox-img');
            const fallback = document.getElementById('avatar-lightbox-fallback');
            const actions = document.getElementById('avatar-lightbox-actions');
            const imgWrap = lightbox?.querySelector('.avatar-lightbox__img-wrap');
            if (!lightbox) return;

            if (imgWrap && !imgWrap.dataset.zoomBound) {
                imgWrap.dataset.zoomBound = '1';
                imgWrap.addEventListener('click', (e) => {
                    if (e.target.closest('.avatar-lightbox__close') || e.target.closest('.avatar-lightbox__actions')) return;
                    imgWrap.classList.toggle('is-zoomed');
                });
            }
            if (imgWrap) imgWrap.classList.remove('is-zoomed');

            if (avatarSrc) {
                img.src = avatarSrc;
                img.hidden = false;
                fallback.hidden = true;
            } else {
                img.hidden = true;
                fallback.hidden = false;
            }

            actions.innerHTML = '';
            if (isOwn) {
                actions.innerHTML = `
                    <a href="/html/pages/profil.html#profil" class="avatar-lb-btn avatar-lb-btn--change">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                        Change
                    </a>
                    <button type="button" class="avatar-lb-btn avatar-lb-btn--remove" id="avatar-remove-btn">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                        Remove
                    </button>
                `;
                document.getElementById('avatar-remove-btn').addEventListener('click', async () => {
                    try {
                        const result = await AuthModule.removeAvatar();
                        if (!result || !result.success) return;
                        document.getElementById('user-avatar-img').hidden = true;
                        document.getElementById('user-avatar-fallback').hidden = false;
                        closeAvatarLightbox();
                    } catch { /* ignore */ }
                });
            }

            lightbox.hidden = false;
            lightbox.classList.add('is-open');
            document.body.style.overflow = 'hidden';
        }

        function closeAvatarLightbox() {
            const lightbox = document.getElementById('avatar-lightbox');
            if (lightbox) {
                lightbox.classList.remove('is-open');
                lightbox.querySelector('.avatar-lightbox__img-wrap')?.classList.remove('is-zoomed');
                lightbox.hidden = true;
            }
            document.body.style.overflow = '';
        }

        // Lightbox close handlers
        document.getElementById('avatar-lightbox-close')?.addEventListener('click', closeAvatarLightbox);
        document.getElementById('avatar-lightbox-backdrop')?.addEventListener('click', closeAvatarLightbox);
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAvatarLightbox(); });

        // Tab switcher: Ratings / Achievements
        document.querySelectorAll('.up-reviews-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const type = tab.dataset.rtype;
                document.querySelectorAll('.up-reviews-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.up-reviews-panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                const panel = document.getElementById(`user-dash-${type}-section`);
                if (panel) panel.classList.add('active');
            });
        });

        loadUserProfile();

        /**
         * renderAdminModerationWidget
         * Admin-only ban/mute controls on any profile, direct by user id (not tied to a
         * content report) — POST /api/admin/users/{id}/{ban,mute} (admin-stats.js). Fetches
         * current status first so the buttons reflect reality (e.g. "Unban" instead of "Ban"
         * if already banned).
         */
        async function renderAdminModerationWidget(container, userId, username) {
            const token = localStorage.getItem('cn_token');
            const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

            const box = document.createElement('div');
            box.className = 'up-admin-mod-widget';
            box.innerHTML = `<span class="up-admin-mod-widget__loading">⏳</span>`;
            container.appendChild(box);

            let status = {};
            try {
                const res = await fetch(`${API_BASE_URL}/admin/users/${userId}/status`, { headers, credentials: 'include' });
                const data = await res.json();
                if (data.success) status = data;
            } catch { /* widget just won't render if this fails */ }

            const isBanned = !!status.is_banned;
            const isMuted = !isBanned && status.muted_until && new Date(status.muted_until) > new Date();

            async function call(action, body) {
                box.querySelectorAll('button').forEach(b => b.disabled = true);
                try {
                    const res = await fetch(`${API_BASE_URL}/admin/users/${userId}/${action}`, {
                        method: 'POST',
                        headers: { ...headers, 'Content-Type': 'application/json' },
                        body: body ? JSON.stringify(body) : undefined,
                        credentials: 'include',
                    });
                    const data = await res.json();
                    if (data.success) {
                        renderAdminModerationWidget(container, userId, username);
                        box.remove();
                    } else {
                        box.querySelectorAll('button').forEach(b => b.disabled = false);
                        alert('Error: ' + (data.error || 'Unknown error'));
                    }
                } catch {
                    box.querySelectorAll('button').forEach(b => b.disabled = false);
                }
            }

            if (isBanned || isMuted) {
                box.innerHTML = `
                    <span class="up-admin-mod-widget__status">${isBanned ? '🚫 Banned' : '🔇 Muted'}${status.banned_reason ? ` — "${escapeHtml(status.banned_reason)}"` : ''}</span>
                    <button type="button" class="ar-btn ar-btn--reopen" id="up-admin-lift-btn">↩ ${isBanned ? 'Unban' : 'Unmute'}</button>
                `;
                box.querySelector('#up-admin-lift-btn').addEventListener('click', () => call(isBanned ? 'unban' : 'unmute'));
            } else {
                box.innerHTML = `
                    <button type="button" class="ar-btn ar-btn--ban" id="up-admin-ban-perm-btn">🚫 Ban permanently</button>
                    <button type="button" class="ar-btn ar-btn--ban" id="up-admin-ban-temp-btn">⏳ Ban temporarily</button>
                    <button type="button" class="ar-btn ar-btn--mute" id="up-admin-mute-btn">🔇 Mute</button>
                `;
                box.querySelector('#up-admin-ban-perm-btn').addEventListener('click', async () => {
                    const ok = await confirmOrNativeConfirm(`Ban @${username} permanently?`);
                    if (ok) call('ban', { reason: 'Admin action from profile' });
                });
                box.querySelector('#up-admin-ban-temp-btn').addEventListener('click', async () => {
                    const days = parseInt(await promptModal('Ban for how many days?', { defaultValue: 7 }), 10);
                    if (!days || days <= 0) return;
                    const ok = await confirmOrNativeConfirm(`Ban @${username} for ${days} day(s)?`);
                    if (ok) call('ban', { reason: 'Admin action from profile', hours: days * 24 });
                });
                box.querySelector('#up-admin-mute-btn').addEventListener('click', async () => {
                    const hours = parseInt(await promptModal('Mute for how many hours?', { defaultValue: 72 }), 10);
                    if (!hours || hours <= 0) return;
                    call('mute', { hours });
                });
            }
        }

        // (2026-09-01) Was plain native confirm() — Andrei asked for the same custom-styled
        // dialog everywhere ("fereastra custom sa fie si atunci cand alegi cat dai mute sau
        // ban la user"), so this now goes through the same confirmModal() Admin Reports uses.
        async function confirmOrNativeConfirm(message) {
            return confirmModal(message, { ok: 'Confirm' });
        }