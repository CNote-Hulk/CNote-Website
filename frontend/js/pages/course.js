import { AuthModule } from '../modules/auth.js';
import { API_BASE_URL } from '../config.js';

const params = new URLSearchParams(window.location.search);
const slug = params.get('slug');

if (!slug) window.location.href = 'invata.html';

// Access control: non-starter courses require login
const _token = localStorage.getItem('cn_token');
if (slug !== 'starter-guide' && !_token) {
    window.location.href = 'login.html';
}

let completedIds = new Set();
let lessonScores = {};
let allLessons = [];

function esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getCurrentLang() {
    return localStorage.getItem('cnote_lang') || 'en';
}

async function fetchCourse() {
    const headers = {};
    if (_token) headers['Authorization'] = 'Bearer ' + _token;
    const lang = getCurrentLang();
    const res = await fetch(`${API_BASE_URL}/courses/${encodeURIComponent(slug)}?lang=${encodeURIComponent(lang)}`, { headers });
    if (!res.ok) { window.location.href = 'invata.html'; return null; }
    const data = await res.json();
    return data.course;
}

async function fetchProgress() {
    if (!_token) return null;
    try {
        const res = await fetch(`${API_BASE_URL}/courses/${encodeURIComponent(slug)}/progress`, {
            headers: { 'Authorization': 'Bearer ' + _token },
            cache: 'no-store'
        });
        if (!res.ok) return null;
        return res.json();
    } catch { return null; }
}

function getUsername() {
    const user = AuthModule.getCurrentUser();
    return user ? user.username : null;
}

function closePopover() {
    document.querySelectorAll('.crs-popover').forEach(p => p.remove());
    document.removeEventListener('click', _popoverOutsideHandler, true);
}

let _popoverOutsideHandler = null;

function openPopover(anchor, html) {
    closePopover();
    const pop = document.createElement('div');
    pop.className = 'crs-popover';
    pop.innerHTML = html;
    pop.querySelector('.crs-popover__close')?.addEventListener('click', closePopover);

    const wrap = anchor.closest('.crs-hero-actions');
    if (wrap) {
        wrap.style.position = 'relative';
        wrap.appendChild(pop);
    } else {
        anchor.parentElement.style.position = 'relative';
        anchor.parentElement.appendChild(pop);
    }

    requestAnimationFrame(() => pop.classList.add('crs-popover--visible'));

    _popoverOutsideHandler = e => {
        if (!pop.contains(e.target) && e.target !== anchor) closePopover();
    };
    setTimeout(() => document.addEventListener('click', _popoverOutsideHandler, true), 0);
}

function showIncompleteModal(anchor, completed, total) {
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    openPopover(anchor, `
        <div class="crs-popover__icon">🔒</div>
        <h3 class="crs-popover__title">Certificate Locked</h3>
        <p class="crs-popover__text">Complete all lessons to unlock your certificate.</p>
        <div class="crs-popover__prog-header">
            <span>Progress</span><span>${pct}%</span>
        </div>
        <div class="crs-popover__track"><div class="crs-popover__fill" style="width:${pct}%"></div></div>
        <p class="crs-popover__sub">${completed} of ${total} lessons completed</p>
        <button class="crs-popover__close" aria-label="Close">✕</button>
    `);
}

function showCertificateModal(anchor, course, completedCount) {
    const userName = getUsername() || 'Learner';
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    openPopover(anchor, `
        <button class="crs-popover__close" aria-label="Close">✕</button>
        <div class="crs-cert__deco crs-cert__deco--tl"></div>
        <div class="crs-cert__deco crs-cert__deco--br"></div>
        <div class="crs-cert__top">
            <div class="crs-cert__logo-wrap">
                <span class="crs-cert__logo-icon">📜</span>
                <span class="crs-cert__logo-text">Console Notebook</span>
            </div>
            <p class="crs-cert__subtitle">Certificate of Completion</p>
        </div>
        <div class="crs-cert__divider"></div>
        <div class="crs-cert__body">
            <p class="crs-cert__awarded-to">This certifies that</p>
            <h2 class="crs-cert__name">${esc(userName)}</h2>
            <p class="crs-cert__completed-text">has successfully completed</p>
            <h3 class="crs-cert__course">${esc(course.title)}</h3>
            <div class="crs-cert__rank-wrap">
                <div class="crs-cert__rank">
                    <span class="crs-cert__rank-label">Earned Rank</span>
                    <span class="crs-cert__rank-value">Adept</span>
                </div>
            </div>
        </div>
        <div class="crs-cert__divider"></div>
        <div class="crs-cert__footer">
            <div class="crs-cert__date-block">
                <span class="crs-cert__footer-label">Date</span>
                <span class="crs-cert__footer-val">${dateStr}</span>
            </div>
            <div class="crs-cert__lessons-block">
                <span class="crs-cert__footer-label">Completed</span>
                <span class="crs-cert__footer-val">${completedCount} lessons</span>
            </div>
            <div class="crs-cert__sig-block">
                <div class="crs-cert__sig-line"></div>
                <span class="crs-cert__footer-label">Console Notebook</span>
            </div>
        </div>
    `);
}

function renderHeader(course, progress) {
    document.title = `${course.title} — Console Notebook`;
    document.querySelector('.crs-icon').textContent = course.icon || '📚';
    document.querySelector('.crs-title').textContent = course.title;
    document.querySelector('.crs-description').textContent = course.description || '';
    document.querySelector('.crs-badge').textContent = course.difficulty || '';

    // Canonical/og tags were entirely static (bare template URL, no ?slug=, and meta
    // description was never updated per-course at all) — found + fixed alongside the same
    // gap on article.html/console-model.html/lesson.html.
    const desc = course.description || course.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', desc);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', document.title);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', desc);
    const courseUrl = `${location.origin}${location.pathname}?slug=${encodeURIComponent(slug)}`;
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', courseUrl);
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', courseUrl);
}

function renderHeroStats(course, progress) {
    const inner = document.querySelector('.crs-hero__inner');
    if (!inner) return;

    const total = allLessons.length;
    const completedArr = progress ? (progress.completed_lesson_ids || []) : [];
    const completed = completedArr.length;
    const chapters = (course.modules || []).length;
    const totalMins = total * 5;
    const timeStr = totalMins >= 60 ? `~${Math.round(totalMins / 60)}h` : `~${totalMins}m`;

    const statsEl = document.createElement('div');
    statsEl.className = 'crs-hero-stats';
    statsEl.innerHTML = `
        <div class="crs-hero-stat"><span class="crs-hero-stat-val">${completed}</span><span class="crs-hero-stat-label">Completed</span></div>
        <div class="crs-hero-stat"><span class="crs-hero-stat-val">${total}</span><span class="crs-hero-stat-label">Lessons</span></div>
        <div class="crs-hero-stat"><span class="crs-hero-stat-val">${timeStr}</span><span class="crs-hero-stat-label">Total Time</span></div>
        <div class="crs-hero-stat"><span class="crs-hero-stat-val">${chapters}</span><span class="crs-hero-stat-label">Chapters</span></div>
    `;

    const lastId = progress && progress.last_lesson_id;
    const isCourseCompleted = progress && progress.course_completed;
    let resumeHref = '#';
    let resumeLabel = '▶ Start Course';
    if (allLessons.length > 0) {
        if (isCourseCompleted) {
            resumeLabel = '✓ Completed';
        } else if (lastId) {
            resumeHref = `lesson.html?id=${lastId}&slug=${encodeURIComponent(slug)}`;
            resumeLabel = '▶ Resume Course';
        } else {
            resumeHref = `lesson.html?id=${allLessons[0].id}&slug=${encodeURIComponent(slug)}`;
        }
    }

    const btnsEl = document.createElement('div');
    btnsEl.className = 'crs-hero-actions';
    btnsEl.innerHTML = `
        <a href="${resumeHref}" class="crs-hero-btn crs-hero-btn--primary">${resumeLabel}</a>
        <button type="button" class="crs-hero-btn crs-hero-btn--outline" id="crs-cert-btn">View Certificate</button>
    `;

    const body = inner.querySelector('.crs-hero__body');
    if (body) {
        body.after(btnsEl);
        btnsEl.after(statsEl);
    }

    const certBtn = btnsEl.querySelector('#crs-cert-btn');
    if (certBtn) {
        certBtn.addEventListener('click', e => {
            e.stopPropagation();
            if (isCourseCompleted) {
                showCertificateModal(certBtn, course, completed);
            } else {
                showIncompleteModal(certBtn, completed, total);
            }
        });
    }

    // Populate hero progress card (right column)
    const progressCard = document.getElementById('crs-hero-progress');
    if (progressCard) {
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        const stepsHTML = (course.modules || []).map((mod, i) => {
            const modLessons = mod.lessons || [];
            const doneMod = modLessons.filter(l => completedIds.has(Number(l.id))).length;
            const isDone = doneMod === modLessons.length && modLessons.length > 0;
            const isActive = doneMod > 0 && !isDone;
            const dotClass = isDone ? 'crs-hero-step-dot--done' : isActive ? 'crs-hero-step-dot--active' : '';
            return `<div class="crs-hero-progress-step">
                <div class="crs-hero-step-dot ${dotClass}">${isDone ? '✓' : i + 1}</div>
                <span>${esc(mod.title)}</span>
            </div>`;
        }).join('');

        progressCard.innerHTML = `
            <div class="crs-hero-progress-card">
                <div class="crs-hero-progress-card__header">
                    <span class="crs-hero-progress-card__label">Your Progress</span>
                    <span class="crs-hero-progress-card__pct">${pct}%</span>
                </div>
                <div class="crs-hero-progress-card__track">
                    <div class="crs-hero-progress-card__fill" style="width:0%"></div>
                </div>
                <div class="crs-hero-progress-steps">${stepsHTML}</div>
            </div>
        `;
        requestAnimationFrame(() => {
            const fill = progressCard.querySelector('.crs-hero-progress-card__fill');
            if (fill) fill.style.width = pct + '%';
        });
    }
}

function buildCourseLayout(course, progress) {
    const container = document.querySelector('.crs-container');
    if (!container) return;

    const main = document.createElement('div');
    main.className = 'crs-main';
    while (container.firstChild) main.appendChild(container.firstChild);
    container.appendChild(main);

    const total = allLessons.length;
    const completedArr = progress ? (progress.completed_lesson_ids || []) : [];
    const completed = completedArr.length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    const lastId = progress && progress.last_lesson_id;
    const isCourseCompleted = progress && progress.course_completed;
    let resumeHref = allLessons.length > 0 ? `lesson.html?id=${allLessons[0].id}&slug=${encodeURIComponent(slug)}` : '#';
    let resumeLabel = 'Start Course';
    if (lastId && !isCourseCompleted) {
        resumeHref = `lesson.html?id=${lastId}&slug=${encodeURIComponent(slug)}`;
        resumeLabel = 'Resume Course';
    } else if (isCourseCompleted) {
        resumeLabel = 'Review Course';
    }

    const learnPoints = Array.isArray(course.learn_points) ? course.learn_points : [];
    const learnHTML = learnPoints.length > 0
        ? learnPoints.map(pt => `<li class="crs-sb-learn__item"><span class="crs-sb-learn__check">✓</span><span>${esc(pt)}</span></li>`).join('')
        : '';

    const instructor = course.instructor;
    const instrName = instructor ? esc(instructor.username) : 'CNote';
    const instrBio = instructor && instructor.bio ? `<p class="crs-sb-instructor__bio">${esc(instructor.bio)}</p>` : '';
    const instrAvatarHTML = instructor && instructor.avatar
        ? `<img src="${esc(instructor.avatar)}" alt="${instrName}" class="crs-sb-instructor__avatar-img">`
        : `<div class="crs-sb-instructor__avatar">${instrName.charAt(0).toUpperCase()}</div>`;
    const instrProfileHref = instructor ? `user-profile.html?username=${encodeURIComponent(instructor.username)}` : null;

    let friendBtnHTML = '';
    if (instructor && _token) {
        const st = instructor.friend_status;
        if (st === 'none') {
            friendBtnHTML = `<button class="crs-sb-friend-btn" data-instructor-id="${instructor.id}" data-action="add">+ Add Friend</button>`;
        } else if (st === 'pending_sent') {
            friendBtnHTML = `<button class="crs-sb-friend-btn crs-sb-friend-btn--pending" disabled>Request Sent</button>`;
        } else if (st === 'friends') {
            friendBtnHTML = `<span class="crs-sb-friend-label">✓ Friends</span>`;
        }
    } else if (instructor && !_token) {
        friendBtnHTML = `<a href="login.html" class="crs-sb-friend-btn">+ Add Friend</a>`;
    }

    const sidebar = document.createElement('aside');
    sidebar.className = 'crs-sidebar';
    sidebar.innerHTML = `
        <div class="crs-sb-progress">
            <span class="crs-sb-label">Progress</span>
            <span class="crs-sb-progress__pct">${pct}%</span>
            <p class="crs-sb-progress__meta">${completed} of ${total} completed</p>
            <div class="crs-sb-progress__track"><div class="crs-sb-progress__fill" id="crs-sb-fill" style="width:0%"></div></div>
            <a href="${resumeHref}" class="crs-sb-progress__btn">${resumeLabel}</a>
        </div>
        <div class="crs-sb-instructor">
            <span class="crs-sb-label">Creator</span>
            ${instrProfileHref
                ? `<a href="${instrProfileHref}" class="crs-sb-instructor__body crs-sb-instructor__body--link">`
                : `<div class="crs-sb-instructor__body">`}
                ${instrAvatarHTML}
                <div class="crs-sb-instructor__info">
                    <p class="crs-sb-instructor__name">${instrName}</p>
                    <p class="crs-sb-instructor__role">Console Notebook</p>
                </div>
            ${instrProfileHref ? `</a>` : `</div>`}
            ${instrBio}
            ${friendBtnHTML}
        </div>
        ${learnHTML ? `<div class="crs-sb-learn"><span class="crs-sb-label">What You'll Learn</span><ul class="crs-sb-learn__list">${learnHTML}</ul></div>` : ''}
    `;

    // Add Friend button handler
    const friendBtn = sidebar.querySelector('.crs-sb-friend-btn[data-action="add"]');
    if (friendBtn) {
        friendBtn.addEventListener('click', async () => {
            friendBtn.disabled = true;
            friendBtn.textContent = '…';
            try {
                const res = await fetch(`${API_BASE_URL}/friends/request/${friendBtn.dataset.instructorId}`, {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + _token }
                });
                const data = await res.json();
                if (res.ok) {
                    friendBtn.textContent = data.status === 'friends' ? '✓ Friends' : 'Request Sent';
                    friendBtn.classList.add('crs-sb-friend-btn--pending');
                } else {
                    friendBtn.textContent = data.error || 'Error';
                    setTimeout(() => { friendBtn.textContent = '+ Add Friend'; friendBtn.disabled = false; }, 2000);
                }
            } catch {
                friendBtn.textContent = '+ Add Friend';
                friendBtn.disabled = false;
            }
        });
    }

    container.appendChild(sidebar);

    requestAnimationFrame(() => {
        const sbFill = document.getElementById('crs-sb-fill');
        if (sbFill) sbFill.style.width = pct + '%';
    });
}

function buildLessonIcon(state) {
    if (state === 'done') {
        return `<span class="crs-lesson-icon crs-lesson-icon--done" aria-label="Completed">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </span>`;
    }
    if (state === 'next') {
        return `<span class="crs-lesson-icon crs-lesson-icon--next" aria-label="Up next">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </span>`;
    }
    if (state === 'locked') {
        return `<span class="crs-lesson-icon crs-lesson-icon--locked" aria-label="Locked">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </span>`;
    }
    return `<span class="crs-lesson-icon crs-lesson-icon--open" aria-label="Not started">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>
    </span>`;
}

function renderModules(course) {
    const list = document.querySelector('.crs-module-list');
    list.innerHTML = '';
    allLessons = [];

    (course.modules || []).forEach(mod => {
        (mod.lessons || []).forEach(l => allLessons.push(l));
    });

    const nextLesson = allLessons.find(l => !completedIds.has(Number(l.id)));
    const nextId = nextLesson ? Number(nextLesson.id) : null;
    const isGuest = !_token;

    (course.modules || []).forEach((mod, modIdx) => {
        const lessons = mod.lessons || [];
        const isModFree = isGuest ? (modIdx === 0) : true;
        const doneInMod = lessons.filter(l => completedIds.has(Number(l.id))).length;
        const isModDone = doneInMod === lessons.length && lessons.length > 0;

        const section = document.createElement('div');
        section.className = 'crs-section';

        // Section header
        const badgeHTML = isGuest
            ? `<span class="crs-module-badge ${isModFree ? 'crs-module-badge--free' : 'crs-module-badge--pro'}">${isModFree ? 'FREE' : 'PRO'}</span>`
            : '';
        section.innerHTML = `
            <div class="crs-section-header">
                <span class="crs-section-num${isModDone ? ' crs-section-num--done' : ''}">${isModDone ? '✓' : modIdx + 1}</span>
                <div class="crs-section-info">
                    <h2 class="crs-section-title">${esc(mod.title)}</h2>
                    <span class="crs-section-meta">${doneInMod}/${lessons.length} lessons</span>
                </div>
                ${badgeHTML}
            </div>
            <div class="crs-lessons-grid"></div>
        `;

        const grid = section.querySelector('.crs-lessons-grid');

        lessons.forEach((lesson, lessonIdx) => {
            const done = completedIds.has(Number(lesson.id));
            const isNext = Number(lesson.id) === nextId;
            const isProLocked = isGuest && !isModFree;

            const card = document.createElement('a');
            card.className = 'crs-lesson-card'
                + (done ? ' crs-lesson-card--done' : '')
                + (isNext ? ' crs-lesson-card--next' : '')
                + (isProLocked ? ' crs-lesson-card--locked' : '');

            card.href = isProLocked
                ? 'login.html'
                : `lesson.html?id=${lesson.id}&slug=${encodeURIComponent(slug)}`;

            const numStr = String(lessonIdx + 1).padStart(2, '0') + '.';
            const score = done ? lessonScores[lesson.id] : null;

            let actionHTML;
            if (done) {
                actionHTML = `<span class="crs-lesson-card__check">✓ Completed</span>`;
            } else if (isProLocked) {
                actionHTML = `<span>🔒 PRO</span>`;
            } else {
                actionHTML = `Check lesson <span class="crs-lesson-card__arrow">›</span>`;
            }

            const scoreHTML = (score != null && score > 0)
                ? `<span class="crs-lesson-card__score${score >= 80 ? ' crs-lesson-card__score--high' : score >= 50 ? ' crs-lesson-card__score--mid' : ' crs-lesson-card__score--low'}">${score}%</span>`
                : '';

            card.innerHTML = `
                <div class="crs-lesson-card__top">
                    <div class="crs-lesson-card__num">${numStr}</div>
                    ${scoreHTML}
                </div>
                <span class="crs-lesson-card__badge">${esc(mod.title)}</span>
                <div class="crs-lesson-card__title">${esc(lesson.title)}</div>
                <div class="crs-lesson-card__action">${actionHTML}</div>
            `;
            grid.appendChild(card);
        });

        list.appendChild(section);
    });
}

function initTabs() {
    const btns = document.querySelectorAll('.crs-tab-btn');
    const panels = document.querySelectorAll('.crs-tab-panel');
    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            btns.forEach(b => b.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.target).classList.add('active');
        });
    });
}

async function init() {
    initTabs();

    // Scroll progress bar
    const sp = document.getElementById('crs-sp');
    if (sp) {
        window.addEventListener('scroll', () => {
            const h = document.documentElement;
            const pct = h.scrollTop / (h.scrollHeight - h.clientHeight) || 0;
            sp.style.transform = `scaleX(${pct})`;
        }, { passive: true });
    }

    const [course, progress] = await Promise.all([fetchCourse(), fetchProgress()]);
    if (!course) return;

    if (progress && progress.completed_lesson_ids) {
        completedIds = new Set(progress.completed_lesson_ids.map(Number));
    }
    if (progress && progress.quiz_scores) {
        lessonScores = progress.quiz_scores;
    }

    // renderModules first — populates allLessons
    renderModules(course);
    renderHeader(course, progress);
    renderHeroStats(course, progress);
    buildCourseLayout(course, progress);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

window.addEventListener('cn:language-changed', async () => {
    const course = await fetchCourse();
    if (!course) return;
    renderModules(course);
    renderHeader(course, null);
});
