// Shared "Identify Your Model" hardware directory component.
// Renders MODELS (fetched via loadModels(), ../data/console-models.js — DB-
// backed since 2026-09-06, was a static array before) as searchable/
// filterable clickable model-plate cards linking to console-model.html?code=.
// Used by both console-care.js and console-modding.js so the two guide pages
// share one directory implementation instead of duplicating it.

import { I18nModule } from './i18n.js?v=20260909b';
import { AuthModule } from './auth.js';
import { API_BASE_URL } from '../config.js';
import { loadModels, invalidateModelsCache } from '../data/console-models.js?v=20260906';

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function isAdmin() {
    return AuthModule.getCurrentUser()?.role === 'admin';
}

async function apiModel(method, path, body) {
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

export async function initModelDirectory({
    gridId = 'care-directory-grid',
    searchId = 'care-directory-search',
    tabsSelector = '.care-tab',
    countId = 'care-directory-count',
    emptyId = 'care-directory-empty',
    plateLabelKey = 'care_plate_label',
    fromParam = 'care',
} = {}) {
    const grid = document.getElementById(gridId);
    const searchInput = document.getElementById(searchId);
    const tabs = document.querySelectorAll(tabsSelector);
    const countEl = document.getElementById(countId);
    const emptyEl = document.getElementById(emptyId);

    let activeManufacturer = 'all';
    let models = await loadModels();

    // "Fun facts" deep link from an Evolution console page (console-detail.js) — ?groups=
    // pins the directory to one console's exact hardware-model groups (e.g.
    // "PS3,PS3 Slim,PS3 Super Slim"), bypassing the manufacturer tabs. Search still narrows
    // within that pinned set. A "Show all models →" link (rendered once, above the grid)
    // clears it by dropping the query param.
    const pinnedGroups = (new URLSearchParams(location.search).get('groups') || '')
        .split(',').map(g => g.trim()).filter(Boolean);

    function renderPinnedBanner() {
        if (!pinnedGroups.length) return;
        const tabsWrap = document.querySelector(tabsSelector)?.parentElement;
        if (tabsWrap) tabsWrap.style.display = 'none';
        if (document.getElementById('model-directory-pinned-banner')) return;
        const banner = document.createElement('p');
        banner.id = 'model-directory-pinned-banner';
        banner.className = 'model-directory-pinned-banner';
        const clearUrl = location.pathname + location.hash;
        banner.innerHTML = `${I18nModule.t('care_pinned_showing')} <a href="${clearUrl}">${I18nModule.t('care_pinned_show_all')}</a>`;
        (countEl?.closest('.care-directory__count') || grid)?.before(banner);
    }

    function render() {
        const query = (searchInput?.value || '').trim().toLowerCase();

        const filtered = models.filter(m => {
            if (pinnedGroups.length) {
                if (!pinnedGroups.includes(m.console)) return false;
            } else if (activeManufacturer !== 'all' && m.mfr !== activeManufacturer) {
                return false;
            }
            if (!query) return true;
            return (
                m.code.toLowerCase().includes(query) ||
                m.console.toLowerCase().includes(query) ||
                (m.note || '').toLowerCase().includes(query)
            );
        });

        if (countEl) countEl.textContent = String(filtered.length);
        if (emptyEl) emptyEl.classList.toggle('is-visible', filtered.length === 0);
        if (!grid) return;

        const groups = new Map();
        filtered.forEach(m => {
            if (!groups.has(m.console)) groups.set(m.console, []);
            groups.get(m.console).push(m);
        });

        grid.innerHTML = '';
        groups.forEach((groupModels, consoleName) => {
            const group = document.createElement('div');
            group.className = 'care-group';

            const title = document.createElement('h3');
            title.className = 'care-group__title';
            title.textContent = consoleName;
            group.appendChild(title);

            const gridEl = document.createElement('div');
            gridEl.className = 'care-group__grid';

            groupModels.forEach(m => {
                const plate = document.createElement('a');
                plate.className = 'model-plate model-plate--link';
                plate.href = `console-model.html?code=${encodeURIComponent(m.code)}&from=${fromParam}`;
                plate.innerHTML = `
                    <span class="model-plate__label">${escapeHtml(I18nModule.t(plateLabelKey))}</span>
                    <span class="model-plate__code">${escapeHtml(m.code)}</span>
                    <div class="model-plate__meta"><span class="model-plate__console">${escapeHtml(m.console)}</span>${m.note ? ' — ' + escapeHtml(m.note) : ''}</div>
                `;
                gridEl.appendChild(plate);
            });

            group.appendChild(gridEl);
            grid.appendChild(group);
        });
    }

    function openAddModelForm() {
        if (document.getElementById('model-directory-add-overlay')) return;
        const overlay = document.createElement('div');
        overlay.className = 'model-directory-add-overlay';
        overlay.id = 'model-directory-add-overlay';
        overlay.innerHTML = `
            <div class="model-directory-add-modal">
                <button type="button" class="model-directory-add-modal__close" aria-label="${I18nModule.t('tutorial_cancel')}">&times;</button>
                <h2>${I18nModule.t('model_add_modal_title')}</h2>

                <label class="model-directory-add__label" for="model-add-mfr">${I18nModule.t('model_add_mfr_label')}</label>
                <input type="text" id="model-add-mfr" class="model-directory-add__input" placeholder="${I18nModule.t('model_add_mfr_placeholder')}">

                <label class="model-directory-add__label" for="model-add-console">${I18nModule.t('model_add_console_label')}</label>
                <input type="text" id="model-add-console" class="model-directory-add__input" placeholder="${I18nModule.t('model_add_console_placeholder')}">

                <label class="model-directory-add__label" for="model-add-code">${I18nModule.t('model_add_code_label')}</label>
                <input type="text" id="model-add-code" class="model-directory-add__input" placeholder="${I18nModule.t('model_add_code_placeholder')}">

                <label class="model-directory-add__label" for="model-add-note">${I18nModule.t('model_add_note_label')}</label>
                <textarea id="model-add-note" class="model-directory-add__textarea" rows="3" placeholder="${I18nModule.t('model_add_note_placeholder')}"></textarea>

                <div class="model-directory-add__actions">
                    <button type="button" id="model-add-save" class="hero-button">${I18nModule.t('tutorial_save')}</button>
                    <button type="button" id="model-add-cancel" class="hero-button hero-button--syllabus">${I18nModule.t('tutorial_cancel')}</button>
                </div>
                <p id="model-add-status"></p>
            </div>
        `;
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';

        function close() {
            overlay.remove();
            document.body.style.overflow = '';
        }
        overlay.querySelector('.model-directory-add-modal__close').addEventListener('click', close);
        overlay.querySelector('#model-add-cancel').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        overlay.querySelector('#model-add-save').addEventListener('click', async () => {
            const statusEl = overlay.querySelector('#model-add-status');
            const mfr = document.getElementById('model-add-mfr').value.trim();
            const consoleName = document.getElementById('model-add-console').value.trim();
            const code = document.getElementById('model-add-code').value.trim();
            const note = document.getElementById('model-add-note').value.trim();

            if (!mfr || !consoleName || !code) {
                statusEl.textContent = I18nModule.t('tutorial_save_error');
                return;
            }

            statusEl.textContent = I18nModule.t('tutorial_saving');
            const result = await apiModel('POST', '/console-models', { mfr, console: consoleName, code, note });
            if (!result.success) {
                statusEl.textContent = result.error || I18nModule.t('tutorial_save_error');
                return;
            }

            invalidateModelsCache();
            models = await loadModels();
            render();
            close();
        });
    }

    function initAddModelButton() {
        if (!isAdmin()) return;
        if (document.getElementById('model-directory-add-btn')) return;
        // Anchored right after the "N models" count line, above the grid —
        // a natural toolbar position next to the search/filter controls.
        const anchor = countEl?.closest('.care-directory__count');
        if (!anchor) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'model-directory-add-btn';
        btn.className = 'model-directory-add-trigger';
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>${I18nModule.t('model_add_btn')}</span>`;
        btn.addEventListener('click', openAddModelForm);
        anchor.after(btn);
    }

    searchInput?.addEventListener('input', render);

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('is-active'));
            tab.classList.add('is-active');
            activeManufacturer = tab.dataset.mfr;
            render();
        });
    });

    render();
    renderPinnedBanner();
    initAddModelButton();
    window.addEventListener('cn:language-changed', render);

    return { render };
}
