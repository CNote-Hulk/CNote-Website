/**
 * Data Loader - Centralized module for loading console data
 * Fetches language-specific data from /api/consoles?lang={lang}
 * and falls back to English or window.CONSOLES_DATA (embedded English).
 */

const LANG_KEY = 'cnote_lang';
let _cache = null;
let _cacheLang = null;
let _loading = null;

/**
 * Get current language from localStorage.
 */
function getCurrentLang() {
    return localStorage.getItem(LANG_KEY) || 'en';
}

/**
 * Load all consoles for the current language from the API.
 * Priority: cache → /api/consoles?lang={lang} → English fallback → window.CONSOLES_DATA
 */
export async function loadConsoles() {
    const lang = getCurrentLang();

    // Return cache if same language
    if (_cache && _cacheLang === lang) return _cache;

    // If already loading for this lang, wait
    if (_loading && _cacheLang === lang) return _loading;

    _cacheLang = lang;

    _loading = (async () => {
        try {
            const response = await fetch(`/api/consoles?lang=${lang}`);
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data) && data.length > 0) {
                    _cache = data;
                    window.CONSOLES_DATA = data;
                    return _cache;
                }
            }
        } catch { /* fall through */ }

        // Fallback to English if requested language failed
        if (lang !== 'en') {
            try {
                const response = await fetch('/api/consoles?lang=en');
                if (response.ok) {
                    const data = await response.json();
                    if (Array.isArray(data) && data.length > 0) {
                        _cache = data;
                        window.CONSOLES_DATA = data;
                        return _cache;
                    }
                }
            } catch { /* fall through */ }
        }

        // Final fallback: use the embedded CONSOLES_DATA (from consoles-data.js script tag)
        if (window.CONSOLES_DATA) {
            _cache = window.CONSOLES_DATA;
            return _cache;
        }

        console.warn('Could not load console data for language:', lang);
        return null;
    })();

    const result = await _loading;
    _loading = null;
    return result;
}

/**
 * Invalidate the cache so next loadConsoles() re-fetches for the new language.
 */
export function invalidateCache() {
    _cache = null;
    _cacheLang = null;
    _loading = null;
}

// Listen for language changes and invalidate cache
window.addEventListener('cn:language-changed', () => {
    invalidateCache();
});

/**
 * Get a single console by ID
 */
export async function getConsoleById(id) {
    const consoles = await loadConsoles();
    if (!consoles) return null;
    return consoles.find(c => c.id === id) || null;
}

/**
 * Get all consoles sorted by year (newest first)
 */
export async function getConsolesSorted() {
    const consoles = await loadConsoles();
    if (!consoles) return [];
    return [...consoles].sort((a, b) => b.release - a.release);
}

/**
 * Get consoles grouped by generation
 */
export async function getConsolesByGeneration() {
    const consoles = await loadConsoles();
    if (!consoles) return {};
    const groups = {};
    consoles.forEach(c => {
        const gen = c.generation;
        if (!groups[gen]) groups[gen] = [];
        groups[gen].push(c);
    });
    Object.values(groups).forEach(arr => arr.sort((a, b) => b.release - a.release));
    return groups;
}

/**
 * Get console ID from URL query parameter or path
 */
export function getConsoleIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const idParam = params.get('id');
    if (idParam) return idParam;

    const path = window.location.pathname;
    const filename = path.split('/').pop().split('\\').pop();
    if (filename && filename.endsWith('.html')) {
        const slug = filename.replace('.html', '');
        if (!['index', 'comparatie', 'evolutie', 'invata', 'fizica', 'informatica', 'console'].includes(slug)) {
            return slug;
        }
    }
    return null;
}

/**
 * Resolve the image path relative to the current page depth. Bundled console images are stored
 * as repo-relative paths ("assets/images/consoles/..."), which is what all the relative-prefix
 * logic below is for — but the admin edit modal's image upload (console-detail.js's
 * openConsoleEditor(), 2026-09-06) writes a full absolute R2 URL into the same `image` field
 * instead (same shape as the presign flow used everywhere else on the site). Passed through
 * that relative-prefixing logic, an absolute URL came out as garbage like
 * "../../../https://pub-xxx.r2.dev/..." — found 2026-09-08 while porting this editor to the
 * Android app, not from a report (no console's image had actually been replaced through the
 * form yet to surface it visibly). Absolute http(s) URLs now pass through unchanged.
 */
export function resolveImagePath(imagePath) {
    const raw = String(imagePath || '');
    if (/^https?:\/\//i.test(raw)) return raw;
    const path = window.location.pathname;
    if (path.includes('/pages/consoles/') || path.includes('\\pages\\consoles\\')) {
        return '../../../' + raw;
    }
    if (path.includes('/pages/') || path.includes('\\pages\\')) {
        return '../../' + raw;
    }
    return '/' + raw.replace(/^\/+/, '');
}
