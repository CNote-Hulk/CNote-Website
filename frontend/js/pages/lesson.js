import { AuthModule } from '../modules/auth.js';
import { API_BASE_URL } from '../config.js';

const params = new URLSearchParams(window.location.search);
const lessonId = params.get('id');
let courseSlug = params.get('slug') || sessionStorage.getItem('lsn_course_slug') || '';

if (!lessonId) window.location.href = 'invata.html';

let lessonData = null;
let quizAnswers = {};
let quizScore = null;
let currentCourse = null;
let currentLsnIdx = -1;

function esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ─────────────────────────────────────
   EXISTING DATA FETCHERS
───────────────────────────────────── */
function getCurrentLang() {
    return localStorage.getItem('cnote_lang') || 'en';
}

async function fetchLesson() {
    const token = localStorage.getItem('cn_token');
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const lang = getCurrentLang();
    try {
        const res = await fetch(`${API_BASE_URL}/lessons/${encodeURIComponent(lessonId)}?lang=${encodeURIComponent(lang)}`, { headers });
        if (!res.ok) return null;
        const data = await res.json();
        return data.lesson;
    } catch { return null; }
}

async function fetchCourseStructure() {
    if (!courseSlug) return null;
    const lang = getCurrentLang();
    try {
        const res = await fetch(`${API_BASE_URL}/courses/${encodeURIComponent(courseSlug)}?lang=${encodeURIComponent(lang)}`);
        if (!res.ok) return null;
        return (await res.json()).course;
    } catch { return null; }
}

/* ─────────────────────────────────────
   EXISTING RENDERERS (unchanged)
───────────────────────────────────── */
function renderTopbar(lesson, course) {
    const crsCurrent = document.querySelector('.lsn-breadcrumb-current');
    const crsLink = document.querySelector('.lsn-breadcrumb-course');

    if (course) {
        crsLink.textContent = course.title;
        crsLink.href = `course.html?slug=${encodeURIComponent(courseSlug)}`;
    } else {
        crsLink.textContent = 'Course';
        crsLink.href = courseSlug ? `course.html?slug=${encodeURIComponent(courseSlug)}` : 'invata.html';
    }

    if (crsCurrent) crsCurrent.textContent = lesson.title;

    const metaItem = document.querySelector('.lsn-header-meta-item');
    if (metaItem && course) {
        metaItem.lastChild.textContent = course.title;
    }

    if (course) {
        const allLessons = (course.modules || []).flatMap(m => m.lessons || []);
        const idx = allLessons.findIndex(l => l.id === lesson.id);
        if (idx !== -1) {
            const indicator = document.querySelector('.lsn-progress-indicator');
            if (indicator) indicator.textContent = `${idx + 1} / ${allLessons.length}`;

            const next = allLessons[idx + 1];
            if (next) window._lsnNextId = next.id;
        }
    }
}

function renderLesson(lesson, course, lsnIdx) {
    document.title = `${lesson.title} — Console Notebook`;

    // Canonical/og tags were entirely static (bare template URL, no ?id=) — found + fixed
    // alongside the same gap on article.html/console-model.html/course.html. content_html
    // has no dedicated excerpt field, so strip tags for a plain-text description fallback.
    const plainText = (lesson.content_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const desc = plainText ? plainText.slice(0, 200) : lesson.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', desc);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', document.title);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', desc);
    const lessonUrl = `${location.origin}${location.pathname}?id=${encodeURIComponent(lessonId)}${courseSlug ? `&slug=${encodeURIComponent(courseSlug)}` : ''}`;
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', lessonUrl);
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', lessonUrl);

    // Build title with module and lesson number
    let titleText = lesson.title;
    if (course && lsnIdx !== undefined && lsnIdx >= 0) {
        // Find which module this lesson belongs to
        let moduleNum = 1;
        let lessonNumInModule = 1;
        for (let m = 0; m < (course.modules || []).length; m++) {
            const module = course.modules[m];
            const lessonPos = (module.lessons || []).findIndex(l => l.id === lesson.id);
            if (lessonPos >= 0) {
                moduleNum = m + 1;
                lessonNumInModule = lessonPos + 1;
                break;
            }
        }
        titleText = `Module ${moduleNum}, Lesson ${lessonNumInModule} • ${lesson.title}`;
    }
    
    document.querySelector('.lsn-title').textContent = titleText;

    const content = document.querySelector('.lsn-content');
    if (lesson.content_html && lesson.content_html.trim()) {
        content.innerHTML = lesson.content_html;
    } else {
        content.innerHTML = '<p class="lsn-empty-content">Lesson content coming soon.</p>';
    }
}

function renderAuthorCard(instructor) {
    const wrap = document.getElementById('lsn-sb-author');
    if (!wrap) return;

    const name = instructor ? esc(instructor.username) : 'Console Notebook';
    const bio  = instructor && instructor.bio ? esc(instructor.bio) : 'The official Console Notebook course team.';
    const avatarHTML = instructor && instructor.avatar
        ? `<img src="${esc(instructor.avatar)}" alt="${name}" class="lsn-sb-author__avatar-img">`
        : `<div class="lsn-sb-author__avatar">${name.charAt(0).toUpperCase()}</div>`;

    const token = localStorage.getItem('cn_token');
    let friendHTML = '';
    if (instructor && token) {
        const st = instructor.friend_status;
        if (st === 'none') {
            friendHTML = `<button class="lsn-sb-friend-btn" data-id="${instructor.id}">+ Add Friend</button>`;
        } else if (st === 'pending_sent') {
            friendHTML = `<button class="lsn-sb-friend-btn lsn-sb-friend-btn--pending" disabled>Request Sent</button>`;
        } else if (st === 'friends') {
            friendHTML = `<span class="lsn-sb-friend-label">✓ Friends</span>`;
        }
    } else if (instructor && !token) {
        friendHTML = `<a href="login.html" class="lsn-sb-friend-btn">+ Add Friend</a>`;
    }

    const profileHref = instructor ? `user-profile.html?username=${encodeURIComponent(instructor.username)}` : null;
    wrap.innerHTML = `
        <div class="lsn-sb-section-label">Created by</div>
        ${profileHref
            ? `<a href="${profileHref}" class="lsn-sb-author__card lsn-sb-author__card--link">`
            : `<div class="lsn-sb-author__card">`}
            ${avatarHTML}
            <div class="lsn-sb-author__info">
                <span class="lsn-sb-author__name">${name}</span>
                <span class="lsn-sb-author__desc">${bio}</span>
            </div>
        ${profileHref ? `</a>` : `</div>`}
        ${friendHTML}
    `;

    const btn = wrap.querySelector('.lsn-sb-friend-btn[data-id]');
    if (btn) {
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = '…';
            try {
                const res = await fetch(`${API_BASE_URL}/friends/request/${btn.dataset.id}`, {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await res.json();
                if (res.ok) {
                    btn.textContent = data.status === 'friends' ? '✓ Friends' : 'Request Sent';
                    btn.classList.add('lsn-sb-friend-btn--pending');
                } else {
                    btn.textContent = data.error || 'Error';
                    setTimeout(() => { btn.textContent = '+ Add Friend'; btn.disabled = false; }, 2000);
                }
            } catch {
                btn.textContent = '+ Add Friend';
                btn.disabled = false;
            }
        });
    }
}

function renderQuiz(questions) {
    const container = document.querySelector('.lsn-quiz');
    container.innerHTML = '';

    if (!questions || !questions.length) {
        quizScore = 0;
        return;
    }

    const header = document.createElement('div');
    header.className = 'lsn-quiz-header';
    const title = document.createElement('h2');
    title.className = 'lsn-quiz-title';
    title.textContent = 'Quiz';
    const badge = document.createElement('span');
    badge.className = 'lsn-quiz-badge';
    badge.textContent = `${questions.length} question${questions.length !== 1 ? 's' : ''}`;
    header.appendChild(title);
    header.appendChild(badge);
    container.appendChild(header);

    questions.forEach((q, qIdx) => {
        const card = document.createElement('div');
        card.className = 'lsn-quiz-card';
        card.dataset.qid = q.id;
        card.dataset.correct = q.correct_option;
        card.dataset.total = questions.length;

        const options = Array.isArray(q.options) ? q.options : Object.values(q.options);

        const label = document.createElement('div');
        label.className = 'lsn-quiz-q-label';
        label.textContent = `Question ${qIdx + 1} of ${questions.length}`;

        const question = document.createElement('p');
        question.className = 'lsn-quiz-question';
        question.textContent = q.question;

        const optionsDiv = document.createElement('div');
        optionsDiv.className = 'lsn-quiz-options';

        options.forEach((opt, i) => {
            const btn = document.createElement('button');
            btn.className = 'lsn-quiz-option';
            btn.dataset.idx = i;
            btn.textContent = String(opt);
            btn.addEventListener('click', () => handleAnswer(btn, card, q, questions.length));
            optionsDiv.appendChild(btn);
        });

        card.appendChild(label);
        card.appendChild(question);
        card.appendChild(optionsDiv);

        if (q.explanation) {
            const explanation = document.createElement('div');
            explanation.className = 'lsn-quiz-explanation';
            explanation.textContent = q.explanation;
            explanation.style.display = 'none';
            card.appendChild(explanation);
        }

        container.appendChild(card);
    });
}

function handleAnswer(btn, card, question, totalQuestions) {
    if (card.dataset.answered) return;
    card.dataset.answered = '1';

    const chosen = parseInt(btn.dataset.idx, 10);
    const correct = parseInt(card.dataset.correct, 10);
    const isCorrect = chosen === correct;
    quizAnswers[question.id] = { chosen, correct, isCorrect };

    card.querySelectorAll('.lsn-quiz-option').forEach((b, i) => {
        b.disabled = true;
        if (i === correct) b.classList.add('correct');
        if (i === chosen && !isCorrect) b.classList.add('selected-wrong');
    });

    const explanation = card.querySelector('.lsn-quiz-explanation');
    if (explanation) explanation.style.display = 'block';

    const answeredCount = Object.keys(quizAnswers).length;
    if (answeredCount >= totalQuestions) {
        showResult(totalQuestions);
    }
}

function showResult(totalQuestions) {
    const correctCount = Object.values(quizAnswers).filter(a => a.isCorrect).length;
    const score = Math.round((correctCount / totalQuestions) * 100);
    quizScore = score;

    const container = document.querySelector('.lsn-quiz');
    const resultDiv = document.createElement('div');
    resultDiv.className = 'lsn-quiz-result';

    const scoreEl = document.createElement('div');
    scoreEl.className = 'lsn-quiz-score';
    scoreEl.textContent = `${score}%`;

    const labelEl = document.createElement('p');
    labelEl.className = 'lsn-quiz-score-label';
    labelEl.textContent = `${correctCount} out of ${totalQuestions} correct`;

    resultDiv.appendChild(scoreEl);
    resultDiv.appendChild(labelEl);
    container.appendChild(resultDiv);
    resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Unlock the bottom nav "Next lesson" button — it handles saving + navigation
    const nextNavBtn = document.getElementById('lsn-next-nav-btn');
    if (nextNavBtn) {
        nextNavBtn.classList.remove('lsn-nav-btn--disabled');
        nextNavBtn.removeAttribute('aria-disabled');
        nextNavBtn.classList.add('lsn-nav-btn--ready');
    }
}

async function completeAndNavigate(score) {
    const token = localStorage.getItem('cn_token');
    if (token) {
        try {
            await fetch(`${API_BASE_URL}/lessons/${encodeURIComponent(lessonId)}/complete`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify({ quiz_score: score })
            });
        } catch { /* network error — ignore */ }
    }

    const nextId = window._lsnNextId;
    if (nextId) {
        window.location.href = `lesson.html?id=${nextId}&slug=${encodeURIComponent(courseSlug)}`;
    } else {
        showCourseComplete();
    }
}

function showCourseComplete() {
    const container = document.querySelector('.lsn-quiz');
    container.innerHTML = '';

    const screen = document.createElement('div');
    screen.className = 'lsn-course-complete';
    screen.innerHTML = `
        <div class="lsn-course-complete__trophy">🏆</div>
        <h2 class="lsn-course-complete__title">Course Complete!</h2>
        <p class="lsn-course-complete__sub">You've finished the <strong>Console Starter Guide</strong>. Great work!</p>
        <div class="lsn-course-complete__actions">
            <a href="course.html?slug=${encodeURIComponent(courseSlug)}" class="lsn-btn-next">View Course →</a>
            <a href="invata.html" class="lsn-btn-secondary">Explore More Courses</a>
        </div>
    `;
    container.appendChild(screen);
    screen.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ─────────────────────────────────────
   TOPBAR (sticky lesson banner)
───────────────────────────────────── */
function buildTopbar(lesson, course, allLessons, lsnIdx) {
    const courseLink = document.getElementById('lsn-course-link');
    const coursePillName = document.getElementById('lsn-course-pill-name');
    const lessonNumEl = document.getElementById('lsn-banner-lesson-num');

    if (courseLink && courseSlug) {
        courseLink.href = `course.html?slug=${encodeURIComponent(courseSlug)}`;
    }
    if (coursePillName && course) {
        coursePillName.textContent = course.title;
    }
    if (lessonNumEl && lsnIdx >= 0) {
        lessonNumEl.textContent = `Lesson ${lsnIdx + 1} / ${allLessons.length}`;
    }

    const indicator = document.querySelector('.lsn-progress-indicator');
    if (indicator && lsnIdx >= 0) {
        indicator.textContent = `${lsnIdx + 1} / ${allLessons.length}`;
    }

    const metaItem = document.querySelector('.lsn-hero__meta-item');
    if (metaItem && course && courseSlug) {
        const link = document.createElement('a');
        link.href = `course.html?slug=${encodeURIComponent(courseSlug)}`;
        link.textContent = course.title;
        link.className = 'lsn-hero__course-link';
        const lastChild = metaItem.lastChild;
        if (lastChild) metaItem.replaceChild(link, lastChild);
        else metaItem.appendChild(link);
    } else if (metaItem && course) {
        metaItem.lastChild.textContent = course.title;
    }
}

/* ─────────────────────────────────────
   THREE-COLUMN LAYOUT
   Left: sidebar | Center: main
───────────────────────────────────── */
function buildTwoColumnLayout() {
    const container = document.querySelector('.lsn-container');
    if (!container || container.querySelector('.lsn-main')) return;
    
    // Center: wrap existing children
    const main = document.createElement('div');
    main.className = 'lsn-main';
    while (container.firstChild) main.appendChild(container.firstChild);

    // Left: sidebar (reading progress + article TOC + author)
    const sidebar = document.createElement('aside');
    sidebar.className = 'lsn-sidebar';
    sidebar.innerHTML = `
        <div class="lsn-sb-progress">
            <div class="lsn-sb-progress__label">
                Reading progress
                <span class="lsn-sb-progress__pct" id="lsn-scroll-pct">0%</span>
            </div>
            <div class="lsn-sb-progress__track">
                <div class="lsn-sb-progress__fill" id="lsn-scroll-fill"></div>
            </div>
        </div>
        <div class="lsn-sb-toc" id="lsn-sb-toc">
            <span class="lsn-sb-section-label">In this lesson</span>
            <div id="lsn-toc-list"></div>
        </div>
        <div class="lsn-sb-author">
            <div class="lsn-sb-section-label">Created by</div>
            <div class="lsn-sb-author__card">
                <div class="lsn-sb-author__avatar">CN</div>
                <div class="lsn-sb-author__info">
                    <span class="lsn-sb-author__name">Console Notebook Team</span>
                    <span class="lsn-sb-author__desc">The official Console Notebook course team.</span>
                </div>
            </div>
        </div>
        <div id="lsn-course-nav-list"></div>
    `;

    container.appendChild(sidebar);
    container.appendChild(main);
}

/* ─────────────────────────────────────
   LEFT SIDEBAR: article h2 TOC
───────────────────────────────────── */
function buildArticleTOC() {
    const tocList = document.getElementById('lsn-toc-list');
    const tocBlock = document.getElementById('lsn-sb-toc');
    if (!tocList) return;

    const headings = document.querySelectorAll('.lsn-content h2');
    if (headings.length === 0) {
        if (tocBlock) tocBlock.style.display = 'none';
        return;
    }

    tocList.innerHTML = '';
    headings.forEach((h, i) => {
        if (!h.id) h.id = 'lsn-h-' + i;
        const item = document.createElement('div');
        item.className = 'lsn-toc-item';
        item.dataset.target = h.id;
        const a = document.createElement('a');
        a.href = '#' + h.id;
        a.textContent = h.textContent;
        item.appendChild(a);
        tocList.appendChild(item);
    });

    const items = tocList.querySelectorAll('.lsn-toc-item');
    window.addEventListener('scroll', () => {
        let active = 0;
        headings.forEach((h, i) => {
            if (h.getBoundingClientRect().top < 140) active = i;
        });
        items.forEach((t, i) => t.classList.toggle('active', i === active));
    }, { passive: true });
}

function renderSidebarTOC(course, completedIds) {
    const container = document.getElementById('lsn-course-nav-list');
    if (!container) return;

    container.innerHTML = '';
    const nav = document.createElement('div');
    nav.className = 'lsn-course-nav';

    if (courseSlug) {
        const backLink = document.createElement('a');
        backLink.className = 'lsn-cnav-back';
        backLink.href = `course.html?slug=${encodeURIComponent(courseSlug)}`;
        backLink.innerHTML = `<svg width="12" height="12" viewBox="0 0 10 10" fill="none"><path d="M6 2L3 5l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> ${course ? course.title : 'Course'}`;
        nav.appendChild(backLink);
    }

    (course.modules || []).forEach(module => {
        const section = document.createElement('div');
        section.className = 'lsn-cnav-section';

        const header = document.createElement('div');
        header.className = 'lsn-cnav-section__header';
        header.textContent = module.title || 'Module';
        section.appendChild(header);

        (module.lessons || []).forEach(lsn => {
            const lessonLink = document.createElement('a');
            lessonLink.className = 'lsn-cnav-lesson';
            lessonLink.href = `lesson.html?id=${encodeURIComponent(lsn.id)}&slug=${encodeURIComponent(courseSlug)}`;
            if (lessonData && lsn.id === lessonData.id) {
                lessonLink.classList.add('lsn-cnav-lesson--active');
            }

            const check = document.createElement('span');
            check.className = 'lsn-cnav-check';
            const isDone = completedIds.has(Number(lsn.id));
            const isCurrent = lessonData && lsn.id === lessonData.id;
            if (isDone) {
                check.classList.add('lsn-cnav-check--done');
                check.textContent = '✓';
            } else if (isCurrent) {
                check.classList.add('lsn-cnav-check--active');
            }
            check.setAttribute('aria-hidden', 'true');
            section.appendChild(lessonLink);
            lessonLink.appendChild(check);

            const label = document.createElement('span');
            label.className = 'lsn-cnav-label';
            label.textContent = lsn.title;
            lessonLink.appendChild(label);
        });

        nav.appendChild(section);
    });

    container.appendChild(nav);
}

/* ─────────────────────────────────────
   NEW: SCROLL PROGRESS
───────────────────────────────────── */
function initScrollProgress() {
    const fill = document.getElementById('lsn-scroll-fill');
    const pct = document.getElementById('lsn-scroll-pct');
    if (!fill) return;

    function update() {
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const progress = docHeight > 0 ? Math.min(100, Math.round((scrollTop / docHeight) * 100)) : 0;
        fill.style.width = progress + '%';
        if (pct) pct.textContent = progress + '%';
    }

    window.addEventListener('scroll', update, { passive: true });
    update();
}

/* ─────────────────────────────────────
   NEW: COURSE PROGRESS (for TOC)
───────────────────────────────────── */
async function fetchCourseProgress() {
    if (!courseSlug) return null;
    const token = localStorage.getItem('cn_token');
    if (!token) return null;
    try {
        const res = await fetch(`${API_BASE_URL}/courses/${encodeURIComponent(courseSlug)}/progress`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) return null;
        return res.json();
    } catch { return null; }
}

/* ─────────────────────────────────────
   NEW: REACTIONS
───────────────────────────────────── */
async function fetchReactionsData() {
    try {
        const token = localStorage.getItem('cn_token');
        const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
        const res = await fetch(`${API_BASE_URL}/lessons/${lessonId}/reactions`, { headers });
        if (!res.ok) return null;
        return res.json();
    } catch { return null; }
}

function renderReactions(data) {
    const main = document.querySelector('.lsn-article') || document.querySelector('.lsn-content-section');
    if (!main) return;

    const token = localStorage.getItem('cn_token');
    const userReactions = new Set(data ? (data.user_reactions || []) : []);
    const counts = {
        like:    data ? (data.like    || 0) : 0,
        save:    data ? (data.save    || 0) : 0,
        helpful: data ? (data.helpful || 0) : 0
    };

    const bar = document.createElement('div');
    bar.className = 'lsn-reactions';
    bar.id = 'lsn-reactions';

    [
        { type: 'like',    emoji: '👍', label: 'Like'    },
        { type: 'save',    emoji: '🔖', label: 'Save'    },
        { type: 'helpful', emoji: '⭐', label: 'Helpful' }
    ].forEach(({ type, emoji, label }) => {
        const btn = document.createElement('button');
        btn.className = 'lsn-reaction-btn' + (userReactions.has(type) ? ' active' : '');
        btn.dataset.type = type;
        btn.innerHTML = `
            <span class="lsn-reaction-btn__emoji">${emoji}</span>
            <span class="lsn-reaction-btn__label">${label}</span>
            <span class="lsn-reaction-btn__count">${counts[type]}</span>
        `;

        btn.addEventListener('click', async () => {
            if (!token) { window.location.href = 'login.html'; return; }
            const wasActive = btn.classList.contains('active');
            btn.classList.toggle('active');
            const countEl = btn.querySelector('.lsn-reaction-btn__count');
            countEl.textContent = wasActive
                ? Math.max(0, parseInt(countEl.textContent, 10) - 1)
                : parseInt(countEl.textContent, 10) + 1;
            try {
                await fetch(`${API_BASE_URL}/lessons/${lessonId}/react`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({ type })
                });
            } catch { /* ignore */ }
        });

        bar.appendChild(btn);
    });

    main.appendChild(bar);
}

/* ─────────────────────────────────────
   NEW: COMMENTS
───────────────────────────────────── */
async function fetchCommentsData() {
    try {
        const token = localStorage.getItem('cn_token');
        const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
        const res = await fetch(`${API_BASE_URL}/lessons/${lessonId}/comments`, { headers });
        if (!res.ok) return null;
        return res.json();
    } catch { return null; }
}

function formatTimeAgo(date) {
    const seconds = Math.floor((Date.now() - new Date(date)) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

function buildCommentEl(comment, userCommentLikes) {
    const token = localStorage.getItem('cn_token');
    const el = document.createElement('div');
    el.className = 'lsn-comment';
    el.dataset.id = comment.id;

    const initials = (comment.username || 'U').slice(0, 2).toUpperCase();
    const liked = userCommentLikes.has(comment.id);

    el.innerHTML = `
        <div class="lsn-comment__avatar">${initials}</div>
        <div class="lsn-comment__body">
            <div class="lsn-comment__meta">
                <span class="lsn-comment__author">${esc(comment.username || 'User')}</span>
                <span class="lsn-comment__time">${formatTimeAgo(comment.created_at)}</span>
            </div>
            <p class="lsn-comment__content">${esc(comment.content)}</p>
            <button class="lsn-comment__like${liked ? ' active' : ''}" data-comment-id="${comment.id}">
                ♥ <span class="lsn-comment__like-count">${comment.like_count || 0}</span>
            </button>
        </div>
    `;

    el.querySelector('.lsn-comment__like').addEventListener('click', async () => {
        if (!token) { window.location.href = 'login.html'; return; }
        const likeBtn = el.querySelector('.lsn-comment__like');
        const wasLiked = likeBtn.classList.contains('active');
        likeBtn.classList.toggle('active');
        const countEl = likeBtn.querySelector('.lsn-comment__like-count');
        countEl.textContent = wasLiked
            ? Math.max(0, parseInt(countEl.textContent, 10) - 1)
            : parseInt(countEl.textContent, 10) + 1;
        try {
            await fetch(`${API_BASE_URL}/comments/${comment.id}/like`, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token }
            });
        } catch { /* ignore */ }
    });

    return el;
}

function renderComments(data) {
    const main = document.querySelector('.lsn-article') || document.querySelector('.lsn-content-section');
    if (!main) return;

    const token = localStorage.getItem('cn_token');
    const comments = data ? (data.comments || []) : [];
    const userCommentLikes = new Set(data ? (data.user_comment_likes || []) : []);

    const section = document.createElement('section');
    section.className = 'lsn-comments';
    section.id = 'lsn-comments';

    const header = document.createElement('div');
    header.className = 'lsn-comments__header';
    header.innerHTML = `
        <h2 class="lsn-comments__title">Comments</h2>
        <span class="lsn-comments__count">${comments.length}</span>
    `;
    section.appendChild(header);

    if (token) {
        const form = document.createElement('div');
        form.className = 'lsn-comment-form';

        const textarea = document.createElement('textarea');
        textarea.className = 'lsn-comment-input';
        textarea.placeholder = 'Share your thoughts…';
        textarea.rows = 3;

        const submitBtn = document.createElement('button');
        submitBtn.className = 'lsn-comment-submit';
        submitBtn.textContent = 'Post comment';

        submitBtn.addEventListener('click', async () => {
            const content = textarea.value.trim();
            if (!content) return;
            submitBtn.disabled = true;
            try {
                const res = await fetch(`${API_BASE_URL}/lessons/${lessonId}/comments`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({ content })
                });
                if (res.ok) {
                    const newData = await res.json();
                    textarea.value = '';
                    const listEl = section.querySelector('.lsn-comments__list');
                    if (listEl && newData.comment) {
                        listEl.prepend(buildCommentEl(newData.comment, new Set()));
                        const countEl = section.querySelector('.lsn-comments__count');
                        if (countEl) countEl.textContent = parseInt(countEl.textContent || '0', 10) + 1;
                    }
                }
            } catch { /* ignore */ }
            submitBtn.disabled = false;
        });

        form.appendChild(textarea);
        form.appendChild(submitBtn);
        section.appendChild(form);
    } else {
        const loginBanner = document.createElement('div');
        loginBanner.className = 'lsn-comment-login';
        loginBanner.innerHTML = `<a href="login.html">Log in</a> to leave a comment.`;
        section.appendChild(loginBanner);
    }

    const list = document.createElement('div');
    list.className = 'lsn-comments__list';
    comments.forEach(c => list.appendChild(buildCommentEl(c, userCommentLikes)));
    section.appendChild(list);

    main.appendChild(section);
}

/* ─────────────────────────────────────
   PREV / NEXT NAV BUTTONS (card style)
───────────────────────────────────── */
function renderNavButtons(allLessons, lsnIdx, hasQuiz) {
    const quizSection = document.querySelector('.lsn-quiz-section');
    if (!quizSection) return;

    const prevLesson = lsnIdx > 0 ? allLessons[lsnIdx - 1] : null;
    const nextLesson = lsnIdx >= 0 && lsnIdx < allLessons.length - 1 ? allLessons[lsnIdx + 1] : null;
    const isLastLesson = !nextLesson;
    const total = allLessons.length;

    const nav = document.createElement('div');
    nav.className = 'lsn-nav-buttons';

    const prevBtn = document.createElement('a');
    prevBtn.className = 'lsn-nav-btn lsn-nav-btn--prev';
    if (prevLesson) {
        prevBtn.href = '#';
        prevBtn.innerHTML = `
            <div class="lsn-nav-btn__direction">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M6 2L3 5l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
                Previous
            </div>
            <div class="lsn-nav-btn__title">${esc(prevLesson.title)}</div>
            <div class="lsn-nav-btn__num">Lesson ${lsnIdx} of ${total}</div>
        `;
        prevBtn.addEventListener('click', e => {
            e.preventDefault();
            window.location.href = `lesson.html?id=${prevLesson.id}&slug=${encodeURIComponent(courseSlug)}`;
        });
    } else {
        prevBtn.href = '#';
        prevBtn.innerHTML = `
            <div class="lsn-nav-btn__direction">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M6 2L3 5l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
                Previous
            </div>
            <div class="lsn-nav-btn__title">Course overview</div>
        `;
        prevBtn.addEventListener('click', e => {
            e.preventDefault();
            window.location.href = courseSlug
                ? `course.html?slug=${encodeURIComponent(courseSlug)}`
                : 'invata.html';
        });
    }

    const nextBtn = document.createElement('a');
    nextBtn.className = 'lsn-nav-btn lsn-nav-btn--next';
    nextBtn.id = 'lsn-next-nav-btn';

    const resolvedNextHref = isLastLesson
        ? (courseSlug ? `course.html?slug=${encodeURIComponent(courseSlug)}` : 'invata.html')
        : `lesson.html?id=${nextLesson.id}&slug=${encodeURIComponent(courseSlug)}`;

    const nextTitle = isLastLesson ? 'View course overview' : esc(nextLesson.title);
    const nextNum = !isLastLesson
        ? `<div class="lsn-nav-btn__num">Lesson ${lsnIdx + 2} of ${total}</div>` : '';

    nextBtn.innerHTML = `
        <div class="lsn-nav-btn__direction">
            Next lesson
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M4 2l3 3-3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        </div>
        <div class="lsn-nav-btn__title">${nextTitle}</div>
        ${nextNum}
    `;

    nextBtn.href = '#';
    nextBtn.addEventListener('click', e => {
        e.preventDefault();
        if (nextBtn.classList.contains('lsn-nav-btn--disabled')) return;
        completeAndNavigate(quizScore ?? 0);
    });

    if (hasQuiz) {
        nextBtn.classList.add('lsn-nav-btn--disabled');
        nextBtn.setAttribute('aria-disabled', 'true');
    }

    nav.appendChild(prevBtn);
    nav.appendChild(nextBtn);
    quizSection.appendChild(nav);
}

/* ═══════════════════════════════════════════════════
   ADMIN EDIT MODAL (2026-09-06) — full-content editor for a lesson's
   title/content_html/quiz questions. lessons.title/content_html ARE the EN
   canonical row (lesson_translations holds every other language separately,
   untouched by this — same convention as console_mod_tutorials this same
   day). Mirrors console-detail.js's openConsoleEditor() shape.
   ═══════════════════════════════════════════════════ */

function isAdmin() {
    return AuthModule.getCurrentUser()?.role === 'admin';
}

async function apiLesson(method, path, body) {
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

function lessonEditOptionRow(value, isCorrect, radioName) {
    const row = document.createElement('div');
    row.className = 'lesson-edit__quiz-option-row';
    row.innerHTML = `
        <input type="radio" name="${radioName}" class="lesson-edit__option-correct" ${isCorrect ? 'checked' : ''} title="Correct answer">
        <input type="text" class="lesson-edit__option-text" value="${esc(value || '')}">
        <button type="button" class="lesson-edit__array-remove">&times;</button>
    `;
    row.querySelector('.lesson-edit__array-remove').addEventListener('click', () => row.remove());
    return row;
}

function lessonEditQuestionRow(q) {
    const radioName = 'lesson-edit-correct-' + Math.random().toString(36).slice(2);
    const row = document.createElement('div');
    row.className = 'lesson-edit__quiz-card';
    row.innerHTML = `
        <textarea class="lesson-edit__quiz-question" rows="2" placeholder="Question">${esc(q?.question || '')}</textarea>
        <div class="lesson-edit__quiz-options"></div>
        <button type="button" class="lesson-edit__add-btn lesson-edit__add-option">+ Add option</button>
        <textarea class="lesson-edit__quiz-explanation" rows="2" placeholder="Explanation (shown after answering)">${esc(q?.explanation || '')}</textarea>
        <button type="button" class="lesson-edit__remove-btn lesson-edit__remove-question">Remove question</button>
    `;
    const optionsWrap = row.querySelector('.lesson-edit__quiz-options');
    const options = Array.isArray(q?.options) && q.options.length ? q.options : ['', ''];
    options.forEach((opt, i) => optionsWrap.appendChild(lessonEditOptionRow(opt, i === q?.correct_option, radioName)));
    row.querySelector('.lesson-edit__add-option').addEventListener('click', () => {
        optionsWrap.appendChild(lessonEditOptionRow('', optionsWrap.children.length === 0, radioName));
    });
    row.querySelector('.lesson-edit__remove-question').addEventListener('click', () => row.remove());
    return row;
}

function readLessonEditQuiz() {
    return Array.from(document.querySelectorAll('#lesson-edit-quiz .lesson-edit__quiz-card')).map(card => {
        const optionRows = Array.from(card.querySelectorAll('.lesson-edit__quiz-option-row'));
        const options = optionRows.map(r => r.querySelector('.lesson-edit__option-text').value.trim());
        let correct_option = optionRows.findIndex(r => r.querySelector('.lesson-edit__option-correct').checked);
        if (correct_option === -1) correct_option = 0;
        return {
            question: card.querySelector('.lesson-edit__quiz-question').value.trim(),
            options,
            correct_option,
            explanation: card.querySelector('.lesson-edit__quiz-explanation').value.trim(),
        };
    }).filter(q => q.question && q.options.filter(Boolean).length >= 2);
}

function openLessonEditor() {
    if (!lessonData) return;
    const l = lessonData;

    const overlay = document.createElement('div');
    overlay.className = 'lesson-edit-overlay';
    overlay.innerHTML = `
        <div class="lesson-edit-modal">
            <button type="button" class="lesson-edit-modal__close" aria-label="Cancel">&times;</button>
            <h2>Edit Lesson</h2>

            <label class="lesson-edit__label" for="lesson-edit-title">Title</label>
            <input type="text" id="lesson-edit-title" class="lesson-edit__input" value="${esc(l.title)}">

            <label class="lesson-edit__label" for="lesson-edit-content">Content (HTML)</label>
            <textarea id="lesson-edit-content" class="lesson-edit__textarea" rows="14">${esc(l.content_html || '')}</textarea>

            <label class="lesson-edit__label">Quiz questions</label>
            <div id="lesson-edit-quiz"></div>
            <button type="button" id="lesson-edit-add-question" class="lesson-edit__add-btn">+ Add question</button>

            <div class="lesson-edit__actions">
                <button type="button" id="lesson-edit-save" class="hero-button">Save</button>
                <button type="button" id="lesson-edit-cancel" class="hero-button hero-button--syllabus">Cancel</button>
            </div>
            <p id="lesson-edit-status"></p>
        </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const quizWrap = overlay.querySelector('#lesson-edit-quiz');
    (l.quiz_questions || []).forEach(q => quizWrap.appendChild(lessonEditQuestionRow(q)));
    overlay.querySelector('#lesson-edit-add-question').addEventListener('click', () => quizWrap.appendChild(lessonEditQuestionRow()));

    function closeEditor() {
        overlay.remove();
        document.body.style.overflow = '';
    }
    overlay.querySelector('.lesson-edit-modal__close').addEventListener('click', closeEditor);
    overlay.querySelector('#lesson-edit-cancel').addEventListener('click', closeEditor);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeEditor(); });

    overlay.querySelector('#lesson-edit-save').addEventListener('click', async () => {
        const statusEl = overlay.querySelector('#lesson-edit-status');
        const title = overlay.querySelector('#lesson-edit-title').value.trim();
        const content_html = overlay.querySelector('#lesson-edit-content').value;
        if (!title) {
            statusEl.textContent = 'Title is required.';
            return;
        }

        statusEl.textContent = 'Saving…';
        const lessonResult = await apiLesson('PUT', `/lessons/${encodeURIComponent(lessonId)}`, { title, content_html });
        if (!lessonResult.success) {
            statusEl.textContent = lessonResult.error || 'Could not save lesson.';
            return;
        }

        const quizResult = await apiLesson('PUT', `/lessons/${encodeURIComponent(lessonId)}/quiz`, { questions: readLessonEditQuiz() });
        if (!quizResult.success) {
            statusEl.textContent = quizResult.error || 'Lesson saved, but the quiz could not be saved.';
            return;
        }

        lessonData = { ...lessonData, title: lessonResult.lesson.title, content_html: lessonResult.lesson.content_html, quiz_questions: quizResult.questions };
        renderLesson(lessonData, currentCourse, currentLsnIdx);
        renderQuiz(lessonData.quiz_questions);
        closeEditor();
    });
}

const EDIT_PENCIL_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

function initLessonAdminEditButton() {
    if (!isAdmin()) return;
    // Anchored after the meta row (course name / progress indicator), not
    // the title itself — reads as a page-level admin action rather than
    // crowding the heading.
    const anchor = document.querySelector('.lsn-hero__meta');
    if (!anchor || document.getElementById('lesson-edit-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'lesson-edit-btn';
    btn.className = 'lesson-edit-trigger';
    btn.innerHTML = `${EDIT_PENCIL_SVG}<span>Edit lesson</span>`;
    btn.addEventListener('click', openLessonEditor);
    anchor.after(btn);
}

/* ─────────────────────────────────────
   INIT
───────────────────────────────────── */
async function init() {
    const token = localStorage.getItem('cn_token');

    const lesson = await fetchLesson();

    if (!lesson) {
        document.querySelector('.lsn-title').textContent = 'Lesson not found';
        document.querySelector('.lsn-content').innerHTML = '<p class="lsn-empty-content">This lesson could not be loaded.</p>';
        return;
    }

    const resolvedSlug = lesson.course_slug || courseSlug;
    if (resolvedSlug !== 'starter-guide' && !token) {
        window.location.href = 'login.html';
        return;
    }

    if (resolvedSlug) {
        courseSlug = resolvedSlug;
        sessionStorage.setItem('lsn_course_slug', resolvedSlug);
    }

    if (!token) {
        const bannerSection = document.querySelector('.lsn-guest-banner-section');
        if (bannerSection) bannerSection.style.display = 'block';

        const bottomBanner = document.querySelector('.lsn-bottom-banner');
        if (bottomBanner) bottomBanner.style.display = 'flex';
    }

    lessonData = lesson;
    renderAuthorCard(lesson.instructor);
    renderQuiz(lesson.quiz_questions || []);

    const course = await fetchCourseStructure();

    const allLessons = course ? (course.modules || []).flatMap(m => m.lessons || []) : [];
    const lsnIdx = allLessons.findIndex(l => l.id === lesson.id);
    currentCourse = course;
    currentLsnIdx = lsnIdx;

    // Render lesson content first, then build TOC from the rendered headings
    renderLesson(lesson, course, lsnIdx);
    buildArticleTOC();
    initLessonAdminEditButton();
    const hasQuiz = (lesson.quiz_questions || []).length > 0;

    // Set _lsnNextId for showResult()
    const nextLesson = lsnIdx >= 0 && lsnIdx < allLessons.length - 1 ? allLessons[lsnIdx + 1] : null;
    window._lsnNextId = nextLesson ? nextLesson.id : null;

    buildTopbar(lesson, course, allLessons, lsnIdx);
    renderNavButtons(allLessons, lsnIdx, hasQuiz);

    // ── Fetch sidebar progress + reactions + comments in parallel ──
    const progressData = await fetchCourseProgress();

    const completedIds = new Set((progressData?.completed_lesson_ids || []).map(Number));
    if (course) renderSidebarTOC(course, completedIds);

    // Update banner progress bar
    if (allLessons.length > 0) {
        const pct = Math.round((completedIds.size / allLessons.length) * 100);
        const bannerFill = document.getElementById('lsn-banner-fill');
        const bannerPct = document.getElementById('lsn-banner-pct');
        if (bannerFill) bannerFill.style.width = pct + '%';
        if (bannerPct) bannerPct.textContent = pct + '%';
    }

    initScrollProgress();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

window.addEventListener('cn:language-changed', async () => {
    const [lesson, course] = await Promise.all([fetchLesson(), fetchCourseStructure()]);
    if (!lesson) return;
    lessonData = lesson;

    const allLessons = course ? (course.modules || []).flatMap(m => m.lessons || []) : [];
    const lsnIdx = allLessons.findIndex(l => l.id === lesson.id);
    currentCourse = course;
    currentLsnIdx = lsnIdx;

    renderLesson(lesson, course, lsnIdx);
    buildArticleTOC();
    initLessonAdminEditButton();

    if (course) {
        const progressData = await fetchCourseProgress();
        const completedIds = new Set((progressData?.completed_lesson_ids || []).map(Number));
        renderSidebarTOC(course, completedIds);
    }
});
