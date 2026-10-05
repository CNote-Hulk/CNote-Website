/**
 * Learn Page Script (invata.html)
 * Fetches real course progress from the API for logged-in users
 * and updates course card progress bars.
 */
import { AuthModule } from '../modules/auth.js?v=20261005';
import { API_BASE_URL } from '../config.js';

async function initCourseCardsProgress() {
    const user = AuthModule.getCurrentUser();
    if (!user) return;

    const token = localStorage.getItem('cn_token');
    if (!token) return;

    const cards = document.querySelectorAll('[data-course-slug]');
    if (!cards.length) return;

    await Promise.all([...cards].map(async (card) => {
        const slug = card.dataset.courseSlug;
        if (!slug) return;

        try {
            const res = await fetch(`${API_BASE_URL}/courses/${encodeURIComponent(slug)}/progress`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!res.ok) return;
            const data = await res.json();

            const completed = (data.completed_lesson_ids || []).length;
            const total     = data.total_lessons || 0;
            const pct       = total > 0 ? Math.round((completed / total) * 100) : 0;

            const wrap  = card.querySelector('[data-course-progress-wrap]');
            const fill  = card.querySelector('[data-course-progress-fill]');
            const label = card.querySelector('[data-course-progress-label]');
            const cta   = card.querySelector('[data-course-cta]');

            if (fill)  setTimeout(() => { fill.style.width = pct + '%'; }, 80);
            if (label) label.textContent = `${completed} / ${total} (${pct}%)`;
            if (wrap && completed > 0) wrap.style.display = 'block';

            // Change button text if user has already started
            if (cta && completed > 0) {
                cta.textContent = data.course_completed ? 'Review Course →' : 'Continue →';
                if (data.last_lesson_id) {
                    cta.href = `lesson.html?id=${data.last_lesson_id}&slug=${encodeURIComponent(slug)}`;
                }
            }
        } catch { /* network error — ignore */ }
    }));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCourseCardsProgress);
} else {
    initCourseCardsProgress();
}
