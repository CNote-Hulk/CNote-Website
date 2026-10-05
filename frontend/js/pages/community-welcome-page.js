(function() {
        var landing = document.getElementById('community-landing');
        if (!landing) return;

        /* Keep landing as a normal standalone page. */

        var API = (window.CN_API_BASE_URL || '/api').replace(/\/$/, '');
        var CONSOLE_META = {
            ps:       { label: 'PlayStation', color: '#0070D1' },
            xbox:     { label: 'Xbox',        color: '#107C10' },
            nintendo: { label: 'Nintendo',    color: '#E60012' },
            pc:       { label: 'PC Gaming',   color: '#9B59B6' },
            general:  { label: 'General',     color: '#A89F94' },
            other:    { label: 'Other',       color: '#E67E22' }
        };

        /* ── Utility ────────────────────────────────────── */
        function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
        function initials(name) {
            if (!name) return '??';
            var parts = name.trim().split(/\s+/);
            return (parts[0][0] + (parts[1] ? parts[1][0] : parts[0][1] || '')).toUpperCase();
        }
        function timeAgo(dateStr) {
            var diff = Math.max(0, Date.now() - new Date(dateStr).getTime());
            var mins = Math.floor(diff / 60000);
            if (mins < 1) return 'just now';
            if (mins < 60) return mins + ' min ago';
            var hrs = Math.floor(mins / 60);
            if (hrs < 24) return hrs + 'h ago';
            var days = Math.floor(hrs / 24);
            return days + 'd ago';
        }

        function initMobileSidebarControls() {
            var sidebar   = document.getElementById('hub-sidebar');
            var hamburger = document.getElementById('hub-mobile-hamburger');
            var overlay   = document.getElementById('hub-mobile-overlay');
            var closeBtn  = document.getElementById('hub-sidebar-close');
            var lastTouchAt = 0;

            function bindTap(el, handler) {
                if (!el) return;
                el.addEventListener('touchstart', function(e) {
                    lastTouchAt = Date.now();
                    e.preventDefault();
                    handler();
                }, { passive: false });
                el.addEventListener('click', function(e) {
                    if (Date.now() - lastTouchAt < 700) {
                        e.preventDefault();
                        return;
                    }
                    handler();
                });
            }

            function applyMobileMenuLayering() {
                if (!sidebar) return;
                sidebar.style.zIndex = '5001';
                sidebar.style.opacity = '1';
                sidebar.style.visibility = 'visible';
                sidebar.style.display = 'flex';
                sidebar.style.flexDirection = 'column';
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
                if (!sidebar || !overlay) return;
                var isOpen = sidebar.classList.contains('hub-sidebar--open');
                if (!isOpen) {
                    overlay.style.left = '0';
                    overlay.style.right = '0';
                    return;
                }

                var sidebarWidth = Math.ceil(sidebar.getBoundingClientRect().width || 0);
                overlay.style.left = sidebarWidth + 'px';
                overlay.style.right = '0';
            }

            applyMobileMenuLayering();

            function openSidebar() {
                if (!sidebar) return;
                applyMobileMenuLayering();
                if (window.innerWidth <= 768) {
                    sidebar.style.left = '0';
                }
                sidebar.classList.add('hub-sidebar--open');
                if (hamburger) hamburger.classList.add('active');
                if (overlay) overlay.classList.add('active');
                syncOverlayOutsideSidebar();
                document.body.style.overflow = 'hidden';
            }

            function closeSidebar() {
                if (!sidebar) return;
                sidebar.classList.remove('hub-sidebar--open');
                if (window.innerWidth <= 768) {
                    sidebar.style.left = '-100vw';
                }
                if (hamburger) hamburger.classList.remove('active');
                if (overlay) overlay.classList.remove('active');
                syncOverlayOutsideSidebar();
                document.body.style.overflow = '';
            }

            function toggleSidebar() {
                if (!sidebar) return;
                if (sidebar.classList.contains('hub-sidebar--open')) closeSidebar();
                else openSidebar();
            }

            if (hamburger && !hamburger.dataset.hubMenuBound) {
                bindTap(hamburger, toggleSidebar);
                hamburger.dataset.hubMenuBound = '1';
            }

            if (overlay && !overlay.dataset.hubMenuBound) {
                bindTap(overlay, closeSidebar);
                overlay.dataset.hubMenuBound = '1';
            }

            if (closeBtn && !closeBtn.dataset.hubMenuBound) {
                bindTap(closeBtn, closeSidebar);
                closeBtn.dataset.hubMenuBound = '1';
            }
        }

        // Bind menu controls early so they survive later runtime failures.
        initMobileSidebarControls();

        /* ═══════════════════════════════════════════════════
           DATA FETCHING & RENDERING
           ═══════════════════════════════════════════════════ */

        function fetchJSON(path) {
            return fetch(API + path, { credentials: 'include' })
                .then(function(r) { return r.json(); })
                .catch(function() { return { success: false }; });
        }

        /* ── Chat Messages ───────────────────────────── */
        function loadChat() {
            fetchJSON('/chat/messages?limit=3').then(function(data) {
                var container = document.getElementById('cl-chat-messages');
                if (!container || !data.success || !data.messages || !data.messages.length) {
                    if (container) container.innerHTML = '<div class="cl-chat-msg"><div class="cl-chat-msg__text" style="opacity:0.4">No messages yet — be the first to say hi!</div></div>';
                    return;
                }
                var msgs = data.messages.reverse();
                var html = '';
                msgs.forEach(function(m) {
                    var user = m.user || m;
                    var name = esc(user.username || 'User');
                    html += '<div class="cl-chat-msg">'
                        + '<div class="cl-chat-msg__avatar">' + initials(name) + '</div>'
                        + '<div class="cl-chat-msg__body">'
                        + '<div class="cl-chat-msg__user">' + name + '</div>'
                        + '<div class="cl-chat-msg__text">' + esc(m.message) + '</div>'
                        + '<div class="cl-chat-msg__time">' + timeAgo(m.created_at) + '</div>'
                        + '</div></div>';
                });
                container.innerHTML = html;
            });
        }

        /* ── Trending Discussions ────────────────────── */
        function loadTrending() {
            fetchJSON('/forum/recent').then(function(data) {
                var container = document.getElementById('cl-trending-list');
                if (!container || !data.success || !data.threads || !data.threads.length) {
                    if (container) container.innerHTML = '<div class="cl-trending__item" style="opacity:0.4;pointer-events:none"><div class="cl-trending__info"><div class="cl-trending__title">No discussions yet</div></div></div>';
                    return;
                }
                var html = '';
                data.threads.forEach(function(t, i) {
                    var meta = CONSOLE_META[t.console] || CONSOLE_META.other;
                    html += '<button class="cl-trending__item" data-hub-navigate="forum" data-hub-console="' + esc(t.console) + '" type="button">'
                        + '<div class="cl-trending__rank">' + (i + 1) + '</div>'
                        + '<div class="cl-trending__info">'
                        + '<div class="cl-trending__title">' + esc(t.title) + '</div>'
                        + '<div class="cl-trending__meta">'
                        + '<span class="cl-trending__category" style="color:' + meta.color + '">' + meta.label + '</span>'
                        + '<span class="cl-trending__activity">' + timeAgo(t.created_at) + '</span>'
                        + '</div></div></button>';
                });
                container.innerHTML = html;
            });
        }

        /* ── Category Counts ─────────────────────────── */
        var totalThreads = 0;
        function loadCategoryCounts() {
            // 'general' has no tile in the "Browse by platform" grid below (by
            // design — see community-welcome-page.html), but it's still a valid
            // forum category (VALID_CONSOLES in forum.js) that real threads get
            // posted under, so it must stay in this list for the "Forum Threads"
            // stat to be accurate — omitting it previously left that stat stuck
            // at 0 even with real threads in the DB. The missing `cl-cat-general`
            // element below is harmless: the `if (el)` guard just skips it.
            var consoles = ['ps', 'xbox', 'nintendo', 'pc', 'general', 'other'];
            totalThreads = 0;

            consoles.forEach(function(con) {
                fetchJSON('/forum/' + con + '/threads').then(function(data) {
                    var el = document.getElementById('cl-cat-' + con);
                    if (el) {
                        var count = (data.success && Array.isArray(data.threads)) ? data.threads.length : 0;
                        el.textContent = count + ' posts';
                    }

                    if (data.success && Array.isArray(data.threads)) {
                        totalThreads += data.threads.length;
                    }

                    /* Update stats card each time keep in sync */
                    var statEl = document.getElementById('cl-stat-threads');
                    if (statEl) {
                        statEl.setAttribute('data-count', totalThreads);
                        statEl.textContent = totalThreads.toLocaleString();
                    }
                }).catch(function(err) {
                    console.warn('loadCategoryCounts failed:', err);
                    var el = document.getElementById('cl-cat-' + con);
                    if (el) el.textContent = '0 posts';
                });
            });
        }

        /* ── Marketplace Listings ────────────────────── */
        function loadMarketplace() {
            fetchJSON('/marketplace/listings?limit=4&sort=newest').then(function(data) {
                var container = document.getElementById('cl-marketplace-grid');
                if (!container) return;
                if (!data.success || !data.listings || !data.listings.length) {
                    container.innerHTML = '<div style="opacity:0.4;text-align:center;padding:24px 0">No listings yet — be the first to sell something!</div>';
                    return;
                }
                /* Update stats */
                if (data.total) {
                    var statEl = document.getElementById('cl-stat-listings');
                    if (statEl) {
                        statEl.setAttribute('data-count', data.total);
                        statEl.textContent = Number(data.total).toLocaleString();
                    }
                }
                var html = '';
                data.listings.forEach(function(l) {
                    var price = l.price != null ? (Number(l.price).toLocaleString() + (l.currency ? ' ' + esc(l.currency) : ' RON')) : 'N/A';
                    var condition = l.condition ? l.condition.replace(/_/g, ' ') : '';
                    var title = esc(l.title || 'Untitled');
                    var img = l.images && l.images.length ? l.images[0] : '';
                    html += '<button class="cl-marketplace__card" data-hub-navigate="marketplace" type="button">'
                        + (img ? '<div class="cl-marketplace__img" style="background-image:url(\'' + esc(img) + '\')"></div>' : '<div class="cl-marketplace__img cl-marketplace__img--empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="85"><path d="M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2zm-4 8h2v2h-2zm-2 2h2v2h-2zm4 0h2v2h-2zm-8 0h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2z M20 16h2v2h-2zM8 16h2v2H8zm-2 2h2v2H6zM8 6h2v2H8zM6 8h2v2H6zm2 2h2v2H8zm2-2h2v2h-2z"/></svg></div>')
                        + '<div class="cl-marketplace__body">'
                        + '<div class="cl-marketplace__title">' + title + '</div>'
                        + '<div class="cl-marketplace__meta">'
                        + '<span class="cl-marketplace__price">' + price + '</span>'
                        + (condition ? '<span class="cl-marketplace__condition">' + esc(condition) + '</span>' : '')
                        + '</div></div></button>';
                });
                container.innerHTML = html;
            });
        }

        /* ── Active Users Count ──────────────────────── */
        function loadActiveCount() {
            var statEls = [
                document.getElementById('cl-stat-members'),
                document.getElementById('cl-stat-members-2')
            ].filter(Boolean);
            if (!statEls.length) return;

            fetchJSON('/users/active-count').then(function(data) {
                var count = data.success ? Number(data.count || 0) : 0;
                statEls.forEach(function(statEl) {
                    statEl.setAttribute('data-count', count);
                    statEl.textContent = count.toLocaleString();
                });
            }).catch(function(err) {
                console.warn('loadActiveCount failed:', err);
                statEls.forEach(function(statEl) {
                    statEl.textContent = '0';
                    statEl.setAttribute('data-count', '0');
                });
            });
        }

        /* ── Repair Data (requires auth) ─────────────── */
        function loadRepair() {
            var token = localStorage.getItem('cn_token');
            if (!token) {
                showRepairFallback();
                return;
            }
            fetch(API + '/repair', { credentials: 'include', headers: { 'Authorization': 'Bearer ' + token } })
                .then(function(r) { return r.json(); })
                .catch(function() { return { success: false }; })
                .then(function(data) {
                    if (!data.success || !data.requests || !data.requests.length) {
                        showRepairFallback();
                        return;
                    }
                    var pending = data.requests.filter(function(r) { return r.status === 'pending' || r.status === 'in_progress'; }).slice(0, 3);
                    var solved  = data.requests.filter(function(r) { return r.status === 'solved' || r.status === 'completed' || r.status === 'closed'; }).slice(0, 3);
                    renderRepairList('cl-repair-pending', pending, 'pending');
                    renderRepairList('cl-repair-solved', solved, 'solved');
                });
        }

        function renderRepairList(containerId, items, type) {
            var ul = document.getElementById(containerId);
            if (!ul) return;
            if (!items.length) {
                ul.innerHTML = '<li class="cl-repair-list__item" style="opacity:0.4"><span class="cl-repair-list__text">No ' + type + ' requests</span></li>';
                return;
            }
            var html = '';
            items.forEach(function(r) {
                var meta = CONSOLE_META[r.console] || CONSOLE_META.other;
                var desc = esc(r.console_model || meta.label) + ' — ' + esc((r.symptoms || []).slice(0, 2).join(', ') || 'Repair request');
                html += '<li class="cl-repair-list__item">'
                    + '<span class="cl-repair-list__icon cl-repair-list__icon--' + type + '"></span>'
                    + '<span class="cl-repair-list__text">' + desc + '</span>'
                    + '<span class="cl-repair-list__console" style="color:' + meta.color + '">' + meta.label + '</span>'
                    + '</li>';
            });
            ul.innerHTML = html;
        }

        function showRepairFallback() {
            var pending = document.getElementById('cl-repair-pending');
            var solved  = document.getElementById('cl-repair-solved');
            if (pending) pending.innerHTML = '<li class="cl-repair-list__item" style="opacity:0.5"><span class="cl-repair-list__text">Sign in to see repair activity</span></li>';
            if (solved)  solved.innerHTML  = '<li class="cl-repair-list__item" style="opacity:0.5"><span class="cl-repair-list__text">Sign in to see solved repairs</span></li>';
        }

        /* ── Online count in chat header ─────────────── */
        function updateOnlineCount() {
            fetchJSON('/users/active-count').then(function(data) {
                var el = landing.querySelector('.cl-chat-preview__online');
                if (el && data.success) el.textContent = (data.count || 0) + ' online';
            });
        }

        /* ── Community page navbar autohide (Landing scroll) ── */
        function setupCommunityNavbarAutoHide() {
            var navbar = document.querySelector('.navbar');
            var container = document.getElementById('community-landing');
            if (!navbar || !container) return;

            var mbn = document.getElementById('mobile-bottom-nav');
            var lastScrollY = container.scrollTop;
            var ticking = false;

            function onScroll() {
                var currentY = container.scrollTop;
                var delta = currentY - lastScrollY;

                if (document.body.classList.contains('menu-open')) {
                    lastScrollY = currentY;
                    ticking = false;
                    return;
                }

                if (currentY < 80) {
                    navbar.classList.remove('navbar--hidden');
                    if (mbn) mbn.classList.remove('mbn--hidden');
                    lastScrollY = currentY;
                    ticking = false;
                    return;
                }

                if (Math.abs(delta) < 15) {
                    ticking = false;
                    return;
                }

                if (delta > 0) {
                    navbar.classList.add('navbar--hidden');
                    if (mbn) mbn.classList.add('mbn--hidden');
                } else {
                    navbar.classList.remove('navbar--hidden');
                    if (mbn) mbn.classList.remove('mbn--hidden');
                }

                lastScrollY = currentY < 0 ? 0 : currentY;
                ticking = false;
            }

            container.addEventListener('scroll', function() {
                if (!ticking) {
                    window.requestAnimationFrame(onScroll);
                    ticking = true;
                }
            }, { passive: true });
        }

        /* ── Fire All Fetches ────────────────────────── */
        loadChat();
        loadTrending();
        loadCategoryCounts();
        loadMarketplace();
        loadActiveCount();
        loadRepair();
        updateOnlineCount();

        /* ── Live Refresh — "Community in numbers" (Active Now / Forum Threads
           / Marketplace Listings) previously only ever loaded once, so a
           visitor lingering on the landing page never saw them move even as
           the real counts changed elsewhere. Re-fetches on an interval instead;
           skipped while the tab is in the background (a visitor who switched
           tabs) so a public, unauthenticated page doesn't poll pointlessly. ── */
        var LIVE_STATS_REFRESH_MS = 30000;
        setInterval(function() {
            if (document.hidden) return;
            loadActiveCount();
            loadCategoryCounts();
            loadMarketplace();
            updateOnlineCount();
        }, LIVE_STATS_REFRESH_MS);
        setupCommunityNavbarAutoHide();

        var hasIO = 'IntersectionObserver' in window;

        /* ── Scroll Reveal (IntersectionObserver) ────────── */
        if (hasIO) {
            var revealObs = new IntersectionObserver(function(entries) {
                entries.forEach(function(e) {
                    if (e.isIntersecting) {
                        e.target.classList.add('cl-visible');
                        revealObs.unobserve(e.target);
                    }
                });
            }, { threshold: 0.12 });

            landing.querySelectorAll('.cl-reveal').forEach(function(el) {
                revealObs.observe(el);
            });
        } else {
            landing.querySelectorAll('.cl-reveal').forEach(function(el) {
                el.classList.add('cl-visible');
            });
        }

        /* ═══════════════════════════════════════════════════
           PREMIUM TIMELINE ENGINE — Scroll-Driven Sticky
           ═══════════════════════════════════════════════════ */

        var scrollRegion = document.getElementById('cl-timeline-scroll');
        var timeline     = document.getElementById('cl-timeline');
        var progress     = document.getElementById('cl-timeline-progress');
        var ctxInner     = document.getElementById('cl-timeline-ctx-inner');
        var scrollHint   = document.getElementById('cl-timeline-hint');
        var steps        = timeline ? Array.prototype.slice.call(timeline.querySelectorAll('.cl-timeline__step')) : [];
        var activeIdx    = -1;
        var isMobile     = window.innerWidth <= 768;
        var ctxSwapTimer = null;

        /* ── Make steps visible immediately (sticky = always in view) ── */
        steps.forEach(function(s) { s.classList.add('cl-visible'); });

        /* ── Scroll Progress (0 → 1) from the scroll region ── */
        function getScrollProgress() {
            if (!scrollRegion || isMobile) return 0;
            var rect = scrollRegion.getBoundingClientRect();
            var landingRect = landing.getBoundingClientRect();
            /* Region top relative to the landing overlay viewport */
            var regionTop = rect.top - landingRect.top;
            var travel = rect.height - landing.clientHeight;
            if (travel <= 0) return 0;
            var scrolled = -regionTop;
            return Math.max(0, Math.min(1, scrolled / travel));
        }

        /* ── Map progress → active step index ──────────────── */
        function getActiveFromProgress(p) {
            if (p <= 0) return 0;
            if (p >= 1) return steps.length - 1;
            /* Divide into N equal bands */
            var band = 1 / steps.length;
            return Math.min(steps.length - 1, Math.floor(p / band));
        }

        /* ── Context Panel Update ────────────────────────── */
        function updateContext(idx) {
            if (!ctxInner || idx < 0 || idx >= steps.length) return;
            var step = steps[idx];
            var label = step.getAttribute('data-ctx-label') || '';
            var text  = step.getAttribute('data-ctx-text') || '';
            var hint  = step.getAttribute('data-ctx-hint') || '';

            if (ctxSwapTimer) {
                clearTimeout(ctxSwapTimer);
                ctxSwapTimer = null;
            }

            ctxInner.classList.remove('cl-ctx-visible');
            ctxInner.classList.add('cl-ctx-exit');

            ctxSwapTimer = setTimeout(function() {
                var elLabel = ctxInner.querySelector('.cl-timeline__context-label');
                var elText  = ctxInner.querySelector('.cl-timeline__context-text');
                var elHint  = ctxInner.querySelector('.cl-timeline__context-hint');
                if (elLabel) elLabel.textContent = label;
                if (elText)  elText.textContent  = text;
                if (elHint)  elHint.textContent  = hint;

                ctxInner.classList.remove('cl-ctx-exit');
                requestAnimationFrame(function() {
                    ctxInner.classList.add('cl-ctx-visible');
                });
                ctxSwapTimer = null;
            }, 120);
        }

        /* ── Apply Active / Done States ──────────────────── */
        function applyStepStates(idx) {
            steps.forEach(function(s, i) {
                s.classList.remove('cl-step-active', 'cl-step-done');
                if (i < idx)  s.classList.add('cl-step-done');
                if (i === idx) s.classList.add('cl-step-active');
            });
        }

        /* ── Progress Line — driven by scroll progress ───── */
        function updateProgress(p) {
            if (!timeline || !progress) return;
            var pct = Math.max(0, Math.min(100, p * 100));
            progress.style.transform = 'scaleY(' + (pct / 100) + ')';

            if (pct > 2) {
                timeline.classList.add('cl-tl-started');
            } else {
                timeline.classList.remove('cl-tl-started');
            }
        }

        /* ── Scroll Hint ─────────────────────────────────── */
        function updateHint(p) {
            if (!scrollHint) return;
            if (p > 0.08) {
                scrollHint.classList.add('cl-hint-hidden');
            } else {
                scrollHint.classList.remove('cl-hint-hidden');
            }
        }

        /* ── Main Scroll Handler (rAF debounced) ─────────── */
        var rafPending = false;
        function onScroll() {
            if (rafPending) return;
            rafPending = true;
            requestAnimationFrame(function() {
                rafPending = false;
                var p = getScrollProgress();
                updateProgress(p);
                updateHint(p);

                var newIdx = getActiveFromProgress(p);
                if (newIdx !== activeIdx) {
                    activeIdx = newIdx;
                    applyStepStates(activeIdx);
                    updateContext(activeIdx);
                }
            });
        }

        landing.addEventListener('scroll', onScroll, { passive: true });

        /* ── Mobile Fallback: IntersectionObserver-based ─── */
        if (isMobile && hasIO) {
            var stepObs = new IntersectionObserver(function(entries) {
                entries.forEach(function(e) {
                    if (!e.isIntersecting) return;
                    var idx = steps.indexOf(e.target);
                    if (idx !== -1 && idx !== activeIdx) {
                        activeIdx = idx;
                        applyStepStates(idx);
                        updateContext(idx);
                        /* Approximate progress for mobile */
                        var pct = steps.length > 1 ? idx / (steps.length - 1) : 1;
                        updateProgress(pct);
                    }
                });
            }, { threshold: 0.4 });
            steps.forEach(function(s) { stepObs.observe(s); });
        }

        /* ── Clickable Steps ─────────────────────────────── */
        steps.forEach(function(step, i) {
            step.addEventListener('click', function() {
                activeIdx = i;
                applyStepStates(i);
                updateContext(i);
            });
        });

        /* ── Resize handler — recalculate mobile flag ─────── */
        window.addEventListener('resize', function() {
            isMobile = window.innerWidth <= 768;
        });

        /* ── Initial State ───────────────────────────────── */
        setTimeout(function() {
            var p = getScrollProgress();
            updateProgress(p);
            activeIdx = 0;
            applyStepStates(0);
            ctxInner.classList.add('cl-ctx-visible');
        }, 700);

        /* ═══════════════════════════════════════════════════
           COUNTER ANIMATION
           ═══════════════════════════════════════════════════ */

        if (hasIO) {
            var counterObs = new IntersectionObserver(function(entries) {
                entries.forEach(function(e) {
                    if (!e.isIntersecting) return;
                    var el = e.target;
                    var target = parseInt(el.getAttribute('data-count'), 10);
                    if (!target) return;
                    counterObs.unobserve(el);
                    var dur = 1400, start = performance.now();
                    function tick(now) {
                        var p = Math.min((now - start) / dur, 1);
                        var eased = 1 - Math.pow(1 - p, 3);
                        el.textContent = Math.round(target * eased).toLocaleString();
                        if (p < 1) requestAnimationFrame(tick);
                    }
                    requestAnimationFrame(tick);
                });
            }, { threshold: 0.45 });

            landing.querySelectorAll('[data-count]').forEach(function(el) {
                counterObs.observe(el);
            });
        }

        /* ═══════════════════════════════════════════════════
           ENTER HUB
           ═══════════════════════════════════════════════════ */

        function enterHub(view, con, cat) {
            if (!localStorage.getItem('cn_token')) {
                window.location.href = 'login.html';
                return;
            }
            var hash = '#' + view + (con ? '/' + con : '') + (cat ? '/' + cat : '');
            window.location.href = 'community.html' + hash;
        }

        landing.addEventListener('click', function(e) {
            var btn = e.target.closest('[data-hub-navigate]');
            if (!btn) return;
            enterHub(btn.dataset.hubNavigate, btn.dataset.hubConsole || '', btn.dataset.category || '');
        });

        // Sidebar menu from welcome page should open the same sections in community page.
        document.addEventListener('click', function(e) {
            var item = e.target.closest('.hub-sidebar__item');
            if (!item || item.classList.contains('hub-sidebar__item--locked')) return;
            if (!item.dataset.view) return;
            e.preventDefault();
            e.stopPropagation();
            enterHub(item.dataset.view, item.dataset.console || '', item.dataset.category || '');
        });
    })();