/**
 * "Articles" section on a console page (2026-11-26): every published article
 * tagged with this console, with one tab per category that has any (News,
 * History, Special Editions, Speculations, Fun Facts).
 *
 * Hidden when the console has no article - except for an admin, who gets a
 * link to write the first one (articles.html?console=<id> preselects it).
 * The cards reuse articles.css's .article-card, loaded on demand since the
 * console pages don't link that stylesheet.
 */
import { AuthModule } from './auth.js?v=20261005';
import { I18nModule } from './i18n.js?v=20261127r';
import { API_BASE_URL } from '../config.js';
import { ARTICLE_CATEGORIES, categoryLabel, categoryBadgeHtml } from './article-meta.js?v=20261126j';

const PER_TAB = 6;
const ARTICLES_CSS = '/css/pages/articles.css?v=20261126j';

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

function ensureStylesheet() {
    if (document.querySelector('link[data-articles-css]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = ARTICLES_CSS;
    link.dataset.articlesCss = '';
    document.head.appendChild(link);
}

function formatDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function cardHtml(a) {
    return `
        <a class="article-card" href="/html/pages/article.html?slug=${encodeURIComponent(a.slug)}">
            ${a.cover_image_url
                ? `<img class="article-card__cover" src="${escapeHtml(a.cover_image_url)}" alt="" loading="lazy">`
                : '<div class="article-card__cover article-card__cover--placeholder">📰</div>'}
            <div class="article-card__body">
                ${categoryBadgeHtml(a.category)}
                <h3 class="article-card__title">${escapeHtml(a.title)}</h3>
                ${a.excerpt ? `<p class="article-card__excerpt">${escapeHtml(a.excerpt)}</p>` : ''}
                <div class="article-card__meta"><span>${formatDate(a.created_at)}</span></div>
            </div>
        </a>`;
}

let cache = { consoleId: null, articles: null };

async function fetchArticles(consoleId) {
    if (cache.consoleId === consoleId && cache.articles) return cache.articles;
    const res = await fetch(`${API_BASE_URL}/articles?console=${encodeURIComponent(consoleId)}&limit=50`);
    const data = await res.json();
    cache = { consoleId, articles: data.success ? data.articles : [] };
    return cache.articles;
}

function getSection() {
    let section = document.querySelector('.console-articles-section');
    if (section) return section;
    section = document.createElement('section');
    section.className = 'section console-articles-section';
    section.id = 'articles';
    // After the specs, before the video montage.
    const specs = document.querySelector('.specs-section');
    if (specs) specs.after(section);
    else document.querySelector('main')?.appendChild(section);
    return section;
}

async function render(consoleId) {
    let articles;
    try {
        articles = await fetchArticles(consoleId);
    } catch (err) {
        console.warn('Console articles failed to load:', err);
        return;
    }
    const isAdmin = AuthModule.getCurrentUser()?.role === 'admin';
    const existing = document.querySelector('.console-articles-section');
    if (!articles.length && !isAdmin) { existing?.remove(); return; }

    ensureStylesheet();
    const section = getSection();
    const present = ARTICLE_CATEGORIES.filter(c => articles.some(a => a.category === c.id));
    const tabs = present.length > 1 ? [{ id: null }, ...present] : present;
    // Keep the open tab across re-renders (language change), if it still exists.
    const saved = section.dataset.active;
    let active = saved !== undefined && tabs.some(t => (t.id || '') === saved) ? (saved || null) : (tabs[0]?.id ?? null);

    const draw = () => {
        const shown = articles.filter(a => !active || a.category === active);
        const seeAll = `/html/pages/articles.html?console=${encodeURIComponent(consoleId)}${active ? `&category=${active}` : ''}`;
        section.dataset.active = active || '';
        section.innerHTML = `
            <div class="container">
                <div class="console-articles__head">
                    <h2 class="section-title">${escapeHtml(I18nModule.t('console_articles_title') || 'Articles')}</h2>
                    ${shown.length > PER_TAB ? `<a class="console-articles__all" href="${seeAll}">${escapeHtml(I18nModule.t('home_articles_see_all') || 'See all →')}</a>` : ''}
                </div>
                ${tabs.length > 1 ? `<div class="articles-filters" role="tablist">${tabs.map(t => `
                    <button type="button" role="tab" class="articles-filter${(t.id || null) === active ? ' is-active' : ''}"
                        aria-selected="${(t.id || null) === active}" data-cat="${t.id || ''}">
                        ${escapeHtml(t.id ? categoryLabel(t.id) : (I18nModule.t('articles_filter_all') || 'All'))}
                        <span class="articles-filter__count">${t.id ? articles.filter(a => a.category === t.id).length : articles.length}</span>
                    </button>`).join('')}</div>` : ''}
                ${shown.length
                    ? `<div class="articles-grid articles-grid--console">${shown.slice(0, PER_TAB).map(cardHtml).join('')}</div>`
                    : `<p class="console-articles__empty">${escapeHtml(I18nModule.t('console_articles_empty') || 'No articles about this console yet.')}</p>`}
                ${isAdmin ? `<a class="hero-button hero-button--syllabus console-articles__write" href="/html/pages/articles.html?console=${encodeURIComponent(consoleId)}">${escapeHtml(I18nModule.t('console_articles_write') || '✎ Write an article about this console')}</a>` : ''}
            </div>`;
        section.querySelectorAll('button[data-cat]').forEach(btn => btn.addEventListener('click', () => {
            active = btn.dataset.cat || null;
            draw();
        }));
    };
    draw();
}

export const ConsoleArticlesModule = { render };
