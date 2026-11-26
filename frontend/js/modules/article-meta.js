/**
 * Article categories and the console picker shared by articles.html,
 * article.html and the console pages (2026-11-26).
 *
 * The category ids must match backend/routes/articles.js's CATEGORIES.
 */
import { I18nModule } from './i18n.js?v=20261126';
import { getConsolesSorted } from '../data/data-loader.js';

export const ARTICLE_CATEGORIES = [
    { id: 'news', key: 'article_cat_news', fallback: 'News' },
    { id: 'history', key: 'article_cat_history', fallback: 'History' },
    { id: 'special-editions', key: 'article_cat_special_editions', fallback: 'Special Editions' },
    { id: 'speculations', key: 'article_cat_speculations', fallback: 'Speculations' },
    { id: 'fun-facts', key: 'article_cat_fun_facts', fallback: 'Fun Facts' },
];

export function categoryLabel(id) {
    const c = ARTICLE_CATEGORIES.find(x => x.id === id);
    if (!c) return '';
    return I18nModule.t(c.key) || c.fallback;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

/** Small pill with the category name; speculation gets its own look. */
export function categoryBadgeHtml(id) {
    if (!id) return '';
    return `<span class="article-cat article-cat--${escapeHtml(id)}">${escapeHtml(categoryLabel(id))}</span>`;
}

/** Fills a <select> with the categories, `selected` preselected. */
export function fillCategorySelect(select, selected = 'news') {
    select.innerHTML = ARTICLE_CATEGORIES
        .map(c => `<option value="${c.id}">${escapeHtml(categoryLabel(c.id))}</option>`).join('');
    select.value = selected || 'news';
}

let consolesPromise = null;
/** [{ id, name }] for every console, alphabetical. */
export function loadConsoleNames() {
    if (!consolesPromise) {
        consolesPromise = getConsolesSorted()
            .then(list => list.map(c => ({ id: c.id, name: c.name || c.id })).sort((a, b) => a.name.localeCompare(b.name)))
            .catch(() => []);
    }
    return consolesPromise;
}

/**
 * Checkbox list of every console with a filter box, inside `container`.
 * Returns { get(): string[], set(ids) }.
 */
export async function mountConsolePicker(container, selected = []) {
    const consoles = await loadConsoleNames();
    container.innerHTML = `
        <input type="search" class="hub-form-input article-consoles__filter"
            placeholder="${escapeHtml(I18nModule.t('articles_consoles_filter') || 'Filter consoles…')}">
        <div class="article-consoles__list">
            ${consoles.map(c => `
                <label class="article-consoles__item" data-name="${escapeHtml(c.name.toLowerCase())}">
                    <input type="checkbox" value="${escapeHtml(c.id)}">
                    <span>${escapeHtml(c.name)}</span>
                </label>`).join('')}
        </div>`;
    const filter = container.querySelector('.article-consoles__filter');
    filter.addEventListener('input', () => {
        const q = filter.value.trim().toLowerCase();
        container.querySelectorAll('.article-consoles__item').forEach(el => {
            el.hidden = q && !el.dataset.name.includes(q);
        });
    });
    const boxes = () => [...container.querySelectorAll('input[type="checkbox"]')];
    const api = {
        get: () => boxes().filter(b => b.checked).map(b => b.value),
        set: ids => {
            const want = new Set(ids || []);
            boxes().forEach(b => { b.checked = want.has(b.value); });
            filter.value = '';
            filter.dispatchEvent(new Event('input'));
        },
    };
    api.set(selected);
    return api;
}
