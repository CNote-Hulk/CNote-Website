import { MOD_OPTIONS, flashTypesForModel, loadModels, invalidateModelsCache } from '../data/console-models.js?v=20260909d';
import { I18nModule } from '../modules/i18n.js?v=20260909f';
import { AuthModule } from '../modules/auth.js';
import { API_BASE_URL } from '../config.js';

function codeFromUrl() {
    return new URLSearchParams(location.search).get('code');
}

function findModel(models) {
    const code = codeFromUrl();
    if (!code) return null;
    return models.find(m => m.code === code) || null;
}

// Which directory the visitor arrived from (?from=care|modding) so the
// "back to directory" links return them to the guide they came from
// instead of always defaulting to console-care.html.
function backLink() {
    const from = new URLSearchParams(location.search).get('from');
    return from === 'modding' ? 'console-modding.html#identify' : 'console-care.html#identify';
}

function applyBackLinks() {
    // #model-back-link carries data-i18n directly, so i18n only replaces its
    // text content — setting .href here is safe regardless of translation timing.
    const back = document.getElementById('model-back-link');
    if (back) back.href = backLink();
}

// #model-notfound-link sits INSIDE a data-i18n'd parent whose whole innerHTML
// (including a fresh <a>) gets replaced by every translation pass, so any
// .href set directly on it can be clobbered by a later i18n run. Click
// delegation on document sidesteps that: it works no matter how many times
// the node underneath gets recreated.
document.addEventListener('click', (e) => {
    if (e.target.closest?.('#model-notfound-link')) {
        e.preventDefault();
        location.href = backLink();
    }
});

async function api(method, path, body) {
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

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function isAdmin() {
    return AuthModule.getCurrentUser()?.role === 'admin';
}

// Physical manufacture date-code stamps that meaningfully split this one
// model code (e.g. PS3 CECH-2500A: only 0C/0D-dated units run Custom
// Firmware, 1A/1B don't) — rendered as pills right under the title, same
// visual language as the Evolution page's .console-models pills, but its own
// class names since console-model.html doesn't link console-detail.css.
function renderDateCodes(model) {
    const wrap = document.getElementById('model-date-codes');
    if (!wrap) return;
    const codes = Array.isArray(model?.date_codes) ? model.date_codes : [];
    if (!codes.length) {
        wrap.style.display = 'none';
        wrap.innerHTML = '';
        return;
    }
    wrap.innerHTML = codes
        .map(dc => `<span class="model-date-code-item">${escapeHtml(dc.code)}${dc.note ? `<em>${escapeHtml(dc.note)}</em>` : ''}</span>`)
        .join('');
    wrap.style.display = '';
}

let currentModel = null;

// ── Admin edit: the model's own mfr/console/code/note (Phase 3 of the
// site-wide admin-editing task, 2026-09-06) — separate from the disassembly/
// modding tutorial content below, which already had its own admin editors. ──

// One add/remove row for a single date-code entry in the edit form, mirroring
// console-detail.js's consoleEditModelRow() (same shape of problem — a small
// array of {code, note} pairs the admin can grow/shrink).
function dateCodeEditRow(dc) {
    const row = document.createElement('div');
    row.className = 'model-edit__date-code-row';
    row.innerHTML = `
        <input type="text" class="model-edit__date-code-code" placeholder="${I18nModule.t('model_date_code_placeholder_code')}" value="${escapeHtml(dc?.code || '')}">
        <input type="text" class="model-edit__date-code-note" placeholder="${I18nModule.t('model_date_code_placeholder_note')}" value="${escapeHtml(dc?.note || '')}">
        <button type="button" class="model-edit__array-remove">${I18nModule.t('console_edit_remove_item')}</button>
    `;
    row.querySelector('.model-edit__array-remove').addEventListener('click', () => row.remove());
    return row;
}

function readDateCodeRows() {
    return Array.from(document.querySelectorAll('#model-edit-date-codes .model-edit__date-code-row')).map(row => ({
        code: row.querySelector('.model-edit__date-code-code').value.trim(),
        note: row.querySelector('.model-edit__date-code-note').value.trim(),
    })).filter(dc => dc.code);
}

function openModelEditor() {
    if (!currentModel) return;
    const m = currentModel;

    const overlay = document.createElement('div');
    overlay.className = 'model-directory-add-overlay';
    overlay.innerHTML = `
        <div class="model-directory-add-modal">
            <button type="button" class="model-directory-add-modal__close" aria-label="${I18nModule.t('tutorial_cancel')}">&times;</button>
            <h2>${I18nModule.t('model_edit_modal_title')}</h2>

            <label class="model-directory-add__label" for="model-edit-mfr">${I18nModule.t('model_add_mfr_label')}</label>
            <input type="text" id="model-edit-mfr" class="model-directory-add__input" value="${escapeHtml(m.mfr)}">

            <label class="model-directory-add__label" for="model-edit-console">${I18nModule.t('model_add_console_label')}</label>
            <input type="text" id="model-edit-console" class="model-directory-add__input" value="${escapeHtml(m.console)}">

            <label class="model-directory-add__label" for="model-edit-code">${I18nModule.t('model_add_code_label')}</label>
            <input type="text" id="model-edit-code" class="model-directory-add__input" value="${escapeHtml(m.code)}">
            <p class="model-edit__code-warning">${I18nModule.t('model_edit_code_warning')}</p>

            <label class="model-directory-add__label" for="model-edit-note">${I18nModule.t('model_add_note_label')}</label>
            <textarea id="model-edit-note" class="model-directory-add__textarea" rows="3">${escapeHtml(m.note || '')}</textarea>

            <label class="model-directory-add__label">${I18nModule.t('model_date_codes_label')}</label>
            <div id="model-edit-date-codes"></div>
            <button type="button" id="model-edit-add-date-code" class="model-edit__add-btn">${I18nModule.t('console_edit_add_item')}</button>

            <div class="model-directory-add__actions">
                <button type="button" id="model-edit-save" class="hero-button">${I18nModule.t('tutorial_save')}</button>
                <button type="button" id="model-edit-cancel" class="hero-button hero-button--syllabus">${I18nModule.t('tutorial_cancel')}</button>
            </div>
            <p id="model-edit-status"></p>
        </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const dateCodesWrap = overlay.querySelector('#model-edit-date-codes');
    (Array.isArray(m.date_codes) ? m.date_codes : []).forEach(dc => dateCodesWrap.appendChild(dateCodeEditRow(dc)));
    overlay.querySelector('#model-edit-add-date-code').addEventListener('click', () => dateCodesWrap.appendChild(dateCodeEditRow()));

    function closeEditor() {
        overlay.remove();
        document.body.style.overflow = '';
    }
    overlay.querySelector('.model-directory-add-modal__close').addEventListener('click', closeEditor);
    overlay.querySelector('#model-edit-cancel').addEventListener('click', closeEditor);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeEditor(); });

    overlay.querySelector('#model-edit-save').addEventListener('click', async () => {
        const statusEl = overlay.querySelector('#model-edit-status');
        const mfr = document.getElementById('model-edit-mfr').value.trim();
        const consoleName = document.getElementById('model-edit-console').value.trim();
        const code = document.getElementById('model-edit-code').value.trim();
        const note = document.getElementById('model-edit-note').value.trim();
        const date_codes = readDateCodeRows();

        if (!mfr || !consoleName || !code) {
            statusEl.textContent = I18nModule.t('tutorial_save_error');
            return;
        }

        statusEl.textContent = I18nModule.t('tutorial_saving');
        const result = await api('PUT', `/console-models/${m.id}`, { mfr, console: consoleName, code, note, date_codes });
        if (!result.success) {
            statusEl.textContent = result.error || I18nModule.t('tutorial_save_error');
            return;
        }

        invalidateModelsCache();
        closeEditor();

        // The URL's ?code= identifies which model this page shows — if the
        // code changed, that param is now stale, so navigate to the new one
        // instead of trying to re-render the old page in place.
        if (result.model.code !== m.code) {
            const params = new URLSearchParams(location.search);
            params.set('code', result.model.code);
            location.href = `console-model.html?${params.toString()}`;
            return;
        }

        currentModel = result.model;
        document.getElementById('model-plate-code').textContent = currentModel.code;
        document.getElementById('model-plate-console').textContent = currentModel.console;
        document.getElementById('model-mfr').textContent = currentModel.mfr;
        document.getElementById('model-console-name').textContent = currentModel.console;
        renderDateCodes(currentModel);
        document.getElementById('model-note').textContent = currentModel.note || '';
    });
}

function initModelAdminEditButton() {
    if (!isAdmin()) return;
    if (document.getElementById('model-edit-btn')) return;
    const anchor = document.getElementById('model-note');
    if (!anchor) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'model-edit-btn';
    btn.className = 'model-edit-trigger';
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>${I18nModule.t('model_edit_btn')}</span>`;
    btn.addEventListener('click', openModelEditor);
    anchor.after(btn);
}

// ── Shared read-view markup, used by both the disassembly tutorial and the
// modding guide (either the single row, or whichever combo is selected). ──
function renderTutorialMarkup(data, { titleField, introField, stepsField }) {
    const stepsHtml = (data[stepsField] || []).map((s, i) => `
        <div class="tutorial-step">
            <div class="tutorial-step__num">${i + 1}</div>
            <div class="tutorial-step__body">
                ${s.heading ? `<h3 class="tutorial-step__heading">${escapeHtml(s.heading)}</h3>` : ''}
                ${s.image_url ? `<img class="tutorial-step__image" src="${escapeHtml(s.image_url)}" alt="${escapeHtml(s.heading || '')}" loading="lazy">` : ''}
                ${s.description ? `<p class="tutorial-step__desc">${escapeHtml(s.description)}</p>` : ''}
            </div>
        </div>
    `).join('');

    return `
        ${data[titleField] ? `<h2 class="tutorial-title">${escapeHtml(data[titleField])}</h2>` : ''}
        ${data[introField] ? `<p class="tutorial-intro">${escapeHtml(data[introField])}</p>` : ''}
        <div class="tutorial-steps">${stepsHtml}</div>
    `;
}

// ── Shared step editor row (heading/description/photo upload) — no
// idPrefix-specific ids, only classes, so it works unmodified for both the
// disassembly editor and the modding editor. ──
function stepEditorRow(step) {
    const row = document.createElement('div');
    row.className = 'tutorial-editor__step';
    row.innerHTML = `
        <input type="text" class="tutorial-editor__step-heading" placeholder="${I18nModule.t('tutorial_step_heading_placeholder')}" value="${escapeHtml(step?.heading || '')}">
        <textarea class="tutorial-editor__step-desc" rows="3" placeholder="${I18nModule.t('tutorial_step_desc_placeholder')}">${escapeHtml(step?.description || '')}</textarea>
        <div class="tutorial-editor__step-photo">
            <img class="tutorial-editor__step-preview" src="${escapeHtml(step?.image_url || '')}" style="${step?.image_url ? '' : 'display:none;'}">
            <input type="hidden" class="tutorial-editor__step-image-url" value="${escapeHtml(step?.image_url || '')}">
            <label class="hero-button hero-button--syllabus tutorial-editor__upload-btn">
                <span data-i18n="tutorial_upload_photo">Upload photo</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none;">
            </label>
            <span class="tutorial-editor__upload-status"></span>
        </div>
        <button type="button" class="tutorial-editor__step-remove" data-i18n="tutorial_remove_step">Remove step</button>
    `;

    const fileInput = row.querySelector('input[type="file"]');
    const statusEl = row.querySelector('.tutorial-editor__upload-status');
    const preview = row.querySelector('.tutorial-editor__step-preview');
    const urlField = row.querySelector('.tutorial-editor__step-image-url');

    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        statusEl.textContent = I18nModule.t('tutorial_uploading');
        try {
            const presign = await api('POST', '/uploads/presign', {
                kind: 'tutorial',
                contentType: file.type,
                fileSize: file.size,
            });
            if (!presign.success) throw new Error(presign.error || 'Presign failed');
            const putRes = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
            if (!putRes.ok) throw new Error('Upload failed');
            urlField.value = presign.publicUrl;
            preview.src = presign.publicUrl;
            preview.style.display = '';
            statusEl.textContent = '';
        } catch (err) {
            statusEl.textContent = err.message || I18nModule.t('tutorial_upload_error');
        }
    });

    row.querySelector('.tutorial-editor__step-remove').addEventListener('click', () => row.remove());

    return row;
}

function readStepsFromEditor(stepsWrapId) {
    return Array.from(document.querySelectorAll(`#${stepsWrapId} .tutorial-editor__step`)).map(row => ({
        heading: row.querySelector('.tutorial-editor__step-heading').value.trim(),
        description: row.querySelector('.tutorial-editor__step-desc').value.trim(),
        image_url: row.querySelector('.tutorial-editor__step-image-url').value.trim(),
    }));
}

// ── Disassembly tutorial section — single row per model, unchanged behaviour. ──

function createTutorialSection({ idPrefix, titleField, introField, stepsField }) {
    let data = null; // { [titleField]: ..., [introField]: ..., [stepsField]: [...] }

    function el(suffix) {
        return document.getElementById(`${idPrefix}-${suffix}`);
    }

    function renderView() {
        const comingSoon = el('coming-soon');
        const content = el('content');
        if (!data || (!data[titleField] && !data[introField] && !data[stepsField]?.length)) {
            comingSoon.style.display = '';
            content.style.display = 'none';
            content.innerHTML = '';
            return;
        }
        comingSoon.style.display = 'none';
        content.style.display = '';
        content.innerHTML = renderTutorialMarkup(data, { titleField, introField, stepsField });
    }

    function openEditor() {
        el('view-wrap').style.display = 'none';
        const editor = el('editor');
        editor.style.display = '';
        editor.innerHTML = `
            <input type="text" id="${idPrefix}-editor-title" placeholder="${I18nModule.t('tutorial_title_placeholder')}" value="${escapeHtml(data?.[titleField] || '')}">
            <textarea id="${idPrefix}-editor-intro" rows="3" placeholder="${I18nModule.t('tutorial_intro_placeholder')}">${escapeHtml(data?.[introField] || '')}</textarea>
            <div id="${idPrefix}-editor-steps"></div>
            <button type="button" id="${idPrefix}-add-step" class="care-back-link" data-i18n="tutorial_add_step">+ Add step</button>
            <div class="tutorial-editor__actions">
                <button type="button" id="${idPrefix}-save" class="hero-button" data-i18n="tutorial_save">Save</button>
                <button type="button" id="${idPrefix}-cancel" class="hero-button hero-button--syllabus" data-i18n="tutorial_cancel">Cancel</button>
                ${data ? `<button type="button" id="${idPrefix}-delete" class="hero-button hero-button--syllabus" data-i18n="tutorial_delete">Delete tutorial</button>` : ''}
            </div>
            <p id="${idPrefix}-save-status"></p>
        `;

        const stepsWrap = el('editor-steps');
        (data?.[stepsField]?.length ? data[stepsField] : [{}]).forEach(s => stepsWrap.appendChild(stepEditorRow(s)));

        el('add-step').addEventListener('click', () => stepsWrap.appendChild(stepEditorRow()));
        el('cancel').addEventListener('click', closeEditor);
        el('save').addEventListener('click', save);
        el('delete')?.addEventListener('click', del);
    }

    function closeEditor() {
        el('editor').style.display = 'none';
        el('editor').innerHTML = '';
        el('view-wrap').style.display = '';
    }

    async function save() {
        const statusEl = el('save-status');
        const title = document.getElementById(`${idPrefix}-editor-title`).value.trim();
        const intro = document.getElementById(`${idPrefix}-editor-intro`).value.trim();
        const steps = readStepsFromEditor(`${idPrefix}-editor-steps`);

        statusEl.textContent = I18nModule.t('tutorial_saving');
        const result = await api('PUT', `/console-tutorials/${encodeURIComponent(currentModel.code)}`, { title, intro, steps });
        if (!result.success) {
            statusEl.textContent = result.error || I18nModule.t('tutorial_save_error');
            return;
        }
        applyRow(result.tutorial);
        closeEditor();
        renderView();
        renderAdminControls();
    }

    async function del() {
        if (!confirm(I18nModule.t('tutorial_delete_confirm'))) return;
        await api('DELETE', `/console-tutorials/${encodeURIComponent(currentModel.code)}`);
        data = null;
        closeEditor();
        renderView();
        renderAdminControls();
    }

    function renderAdminControls() {
        const wrap = el('admin-controls');
        if (!wrap) return;
        if (!isAdmin()) { wrap.innerHTML = ''; return; }
        wrap.innerHTML = `<button type="button" id="${idPrefix}-write-btn" class="hero-button hero-button--syllabus">${data ? I18nModule.t('tutorial_edit_btn') : I18nModule.t('tutorial_write_btn')}</button>`;
        el('write-btn').addEventListener('click', openEditor);
    }

    function applyRow(row) {
        if (!row || (!row[titleField] && !row[introField] && !row[stepsField]?.length)) {
            data = null;
            return;
        }
        data = { [titleField]: row[titleField], [introField]: row[introField], [stepsField]: row[stepsField] };
    }

    return { applyRow, renderView, renderAdminControls };
}

// ── Modding guide section — MULTIPLE rows per model, one per
// (flash_type, firmware_version) combination, selected via two dropdowns. ──

// The selector's first field is called "flash type" everywhere in code (it
// started as a PS3-only NAND/NOR/eMMC chip picker), but the same mechanism
// now also covers Xbox 360 S's Trinity/Corona motherboard split — a real
// axis a visitor picks along, just not a "flash type" in any literal sense.
// Per-console-line label overrides so the UI says something that's actually
// true instead of always reading "Flash type".
const MOD_FLASH_FIELD_LABEL_OVERRIDES = {
    'Xbox 360 S': 'mod_board_revision_label',
    'Xbox 360': 'mod_method_label',
    'Xbox (original)': 'mod_method_label',
    'PS1': 'mod_method_label',
    'PSone': 'mod_method_label',
    'PS Vita': 'mod_method_label',
    'PS Vita Slim': 'mod_method_label',
    'PS4': 'mod_method_label',
    'PS4 Slim': 'mod_method_label',
    'PS4 Pro': 'mod_method_label',
    'PS5': 'mod_method_label',
    'PS5 Slim': 'mod_method_label',
    'PS5 Pro': 'mod_method_label',
    'Switch': 'mod_method_label',
    'Switch Lite': 'mod_method_label',
    'Switch OLED': 'mod_method_label',
    'GameCube': 'mod_method_label',
    'Wii U': 'mod_method_label',
    'Wii': 'mod_method_label',
    'Wii Mini': 'mod_method_label',
    'Nintendo DS': 'mod_method_label',
    'Nintendo DS Lite': 'mod_method_label',
    'Nintendo DSi': 'mod_method_label',
    'Nintendo DSi XL': 'mod_method_label',
    'Nintendo 3DS': 'mod_method_label',
    'Nintendo 3DS XL': 'mod_method_label',
    'Nintendo 2DS': 'mod_method_label',
    'New Nintendo 3DS': 'mod_method_label',
    'New Nintendo 3DS XL': 'mod_method_label',
    'New Nintendo 2DS XL': 'mod_method_label',
};

function createModTutorialSection() {
    let combos = [];
    let staticOptions = null; // { flashTypes, firmwareVersions } from MOD_OPTIONS, or null
    let selectedFlash = null;
    let selectedVersion = null;
    let currentConsoleName = null;

    function el(id) {
        return document.getElementById(id);
    }

    // Flash types/firmware versions a visitor can pick from are the UNION of
    // this console's static option list (MOD_OPTIONS — just a menu, no
    // compatibility claim) and whatever real write-ups already exist. This
    // is what makes the selector visible from the first visit to a model
    // page, not only once an admin has written something for it.
    function flashTypes() {
        const staticFlashes = staticOptions?.flashTypes || [];
        return [...new Set([...staticFlashes, ...combos.map(c => c.flash_type)])];
    }

    function versionsForFlash(flash) {
        const staticVersions = staticOptions?.firmwareVersions || [];
        const comboVersions = combos.filter(c => c.flash_type === flash).map(c => c.firmware_version);
        return [...new Set([...staticVersions, ...comboVersions])];
    }

    function findCombo(flash, version) {
        return combos.find(c => c.flash_type === flash && c.firmware_version === version) || null;
    }

    function renderSelectors() {
        const flashSelect = el('mod-flash-select');
        const flashStatic = el('mod-flash-static');
        const versionSelect = el('mod-version-select');
        const flashLabel = el('mod-flash-field-label');

        const overrideKey = MOD_FLASH_FIELD_LABEL_OVERRIDES[currentConsoleName];
        if (flashLabel) flashLabel.textContent = I18nModule.t(overrideKey || 'mod_flash_type_label');

        const flashes = flashTypes();
        if (!flashes.includes(selectedFlash)) selectedFlash = flashes[0];
        // A real board only ever has ONE flash type (flashTypesForModel()
        // already narrows this per model code) — a <select> with a single,
        // unchangeable option reads as broken UI ("what am I picking?"), so
        // it only renders as a dropdown once there's genuinely more than one
        // choice; a single flash type shows as plain static text instead.
        if (flashes.length <= 1) {
            flashSelect.hidden = true;
            flashStatic.hidden = false;
            flashStatic.textContent = flashes[0] || '';
        } else {
            flashSelect.hidden = false;
            flashStatic.hidden = true;
            flashSelect.innerHTML = flashes
                .map(f => `<option value="${escapeHtml(f)}"${f === selectedFlash ? ' selected' : ''}>${escapeHtml(f)}</option>`)
                .join('');
        }

        const versions = versionsForFlash(selectedFlash);
        if (!versions.includes(selectedVersion)) selectedVersion = versions[0];
        versionSelect.innerHTML = versions
            .map(v => `<option value="${escapeHtml(v)}"${v === selectedVersion ? ' selected' : ''}>${escapeHtml(v)}</option>`)
            .join('');
    }

    function renderView() {
        const comingSoon = el('mod-coming-soon');
        const selectorsWrap = el('mod-selectors');
        const comboMissing = el('mod-combo-missing');
        const content = el('mod-content');

        // Selector is visible whenever there's ANYTHING to choose from — this
        // console's static option menu (MOD_OPTIONS), or a real write-up left
        // over from before this model had a static list. Only when neither
        // exists does the page fall back to the old flat "coming soon".
        if (!flashTypes().length) {
            comingSoon.style.display = '';
            selectorsWrap.style.display = 'none';
            comboMissing.style.display = 'none';
            content.style.display = 'none';
            content.innerHTML = '';
            return;
        }
        comingSoon.style.display = 'none';
        selectorsWrap.style.display = '';
        renderSelectors();

        const combo = findCombo(selectedFlash, selectedVersion);
        if (!combo) {
            comboMissing.style.display = '';
            content.style.display = 'none';
            content.innerHTML = '';
            return;
        }
        comboMissing.style.display = 'none';
        content.style.display = '';
        content.innerHTML = renderTutorialMarkup(combo, { titleField: 'title', introField: 'intro', stepsField: 'steps' });
    }

    // For a brand-new combo: if this console has a known option menu (or
    // existing combos to draw from), let the admin PICK flash type/version
    // from that same list instead of free-typing it — avoids creating a
    // near-duplicate combo from a typo (e.g. a stray dash character). Falls
    // back to free-text inputs when there's nothing to pick from yet.
    function newComboFieldsMarkup() {
        const flashes = flashTypes();
        if (!flashes.length) {
            return `
                <input type="text" id="mod-editor-flash-type" placeholder="${I18nModule.t('mod_flash_type_placeholder')}" value="">
                <input type="text" id="mod-editor-firmware-version" placeholder="${I18nModule.t('mod_firmware_version_placeholder')}" value="">
            `;
        }
        // Pre-select whatever the admin is currently browsing in the
        // read-view selector — if they clicked "Add tutorial" while looking
        // at an empty NAND/4.90, for example, the form should already say
        // NAND/4.90 instead of resetting to the first option in the list.
        const flashOptions = flashes
            .map(f => `<option value="${escapeHtml(f)}"${f === selectedFlash ? ' selected' : ''}>${escapeHtml(f)}</option>`)
            .join('');
        return `
            <select id="mod-editor-flash-type" class="tutorial-select">${flashOptions}</select>
            <select id="mod-editor-firmware-version" class="tutorial-select"></select>
        `;
    }

    function wireNewComboFields() {
        const flashField = el('mod-editor-flash-type');
        const versionField = el('mod-editor-firmware-version');
        if (!flashField || flashField.tagName !== 'SELECT') return; // free-text fallback needs no wiring
        const populateVersions = () => {
            versionField.innerHTML = versionsForFlash(flashField.value)
                .map(v => `<option value="${escapeHtml(v)}"${v === selectedVersion && flashField.value === selectedFlash ? ' selected' : ''}>${escapeHtml(v)}</option>`)
                .join('');
        };
        populateVersions();
        flashField.addEventListener('change', populateVersions);
    }

    function openEditor(isNew) {
        el('mod-view-wrap').style.display = 'none';
        const editor = el('mod-editor');
        editor.style.display = '';
        const lang = I18nModule.lang;
        const existing = isNew ? null : findCombo(selectedFlash, selectedVersion);
        // Editing an existing combo while browsing a non-EN language edits that
        // language's translation instead of the EN canonical row (see save()) —
        // `existing` here is already the effective (translation-or-EN-fallback)
        // content from applyCombos(), so it's a sensible prefill either way.
        // Deleting only makes sense when there's something to delete: the whole
        // combo in EN mode, or — in translation mode — an actual override
        // (not just the EN fallback masquerading as "existing").
        const canDelete = !isNew && existing && (lang === 'en' || existing.has_translation);

        editor.innerHTML = `
            ${isNew ? newComboFieldsMarkup() : ''}
            ${!isNew && lang !== 'en' ? `<p class="tutorial-editor__lang-note">${I18nModule.t('mod_editing_lang_note')} ${escapeHtml(lang.toUpperCase())}</p>` : ''}
            <input type="text" id="mod-editor-title" placeholder="${I18nModule.t('tutorial_title_placeholder')}" value="${escapeHtml(existing?.title || '')}">
            <textarea id="mod-editor-intro" rows="3" placeholder="${I18nModule.t('tutorial_intro_placeholder')}">${escapeHtml(existing?.intro || '')}</textarea>
            <div id="mod-editor-steps"></div>
            <button type="button" id="mod-editor-add-step" class="care-back-link" data-i18n="tutorial_add_step">+ Add step</button>
            <div class="tutorial-editor__actions">
                <button type="button" id="mod-editor-save" class="hero-button" data-i18n="tutorial_save">Save</button>
                <button type="button" id="mod-editor-cancel" class="hero-button hero-button--syllabus" data-i18n="tutorial_cancel">Cancel</button>
                ${canDelete ? `<button type="button" id="mod-editor-delete" class="hero-button hero-button--syllabus">${lang === 'en' ? I18nModule.t('tutorial_delete') : I18nModule.t('mod_remove_translation_btn')}</button>` : ''}
            </div>
            <p id="mod-editor-save-status"></p>
        `;

        if (isNew) wireNewComboFields();

        const stepsWrap = el('mod-editor-steps');
        (existing?.steps?.length ? existing.steps : [{}]).forEach(s => stepsWrap.appendChild(stepEditorRow(s)));

        el('mod-editor-add-step').addEventListener('click', () => stepsWrap.appendChild(stepEditorRow()));
        el('mod-editor-cancel').addEventListener('click', closeEditor);
        el('mod-editor-save').addEventListener('click', () => save(isNew));
        el('mod-editor-delete')?.addEventListener('click', del);
    }

    function closeEditor() {
        el('mod-editor').style.display = 'none';
        el('mod-editor').innerHTML = '';
        el('mod-view-wrap').style.display = '';
    }

    // Re-fetches the effective combo list for the language currently being
    // browsed. Used after removing a translation, since the local `combos`
    // array may already hold that language's (now-deleted) override rather
    // than the EN fallback it should show afterwards — cheaper to just ask
    // the server for the right answer than to reconstruct it client-side.
    async function reloadCombos() {
        try {
            const result = await api('GET', `/console-tutorials/${encodeURIComponent(currentModel.code)}/mod?lang=${encodeURIComponent(I18nModule.lang)}`);
            combos = result.success ? result.tutorials : [];
        } catch {
            combos = [];
        }
    }

    async function save(isNew) {
        const statusEl = el('mod-editor-save-status');
        const lang = I18nModule.lang;
        const flashType = isNew ? document.getElementById('mod-editor-flash-type').value.trim() : selectedFlash;
        const version = isNew ? document.getElementById('mod-editor-firmware-version').value.trim() : selectedVersion;
        if (!flashType || !version) {
            statusEl.textContent = I18nModule.t('tutorial_save_error');
            return;
        }

        const title = document.getElementById('mod-editor-title').value.trim();
        const intro = document.getElementById('mod-editor-intro').value.trim();
        const steps = readStepsFromEditor('mod-editor-steps');

        statusEl.textContent = I18nModule.t('tutorial_saving');

        // A brand-new combo (flash type/firmware version pair) is a structural
        // addition, not translatable content, so it's always written to the EN
        // canonical row regardless of which language is currently browsed (the
        // "Add new combo" button itself is hidden outside EN — see
        // renderAdminControls() — this branch just stays correct defensively).
        if (isNew || lang === 'en') {
            const result = await api(
                'PUT',
                `/console-tutorials/${encodeURIComponent(currentModel.code)}/mod/${encodeURIComponent(flashType)}/${encodeURIComponent(version)}`,
                { title, intro, steps }
            );
            if (!result.success) {
                statusEl.textContent = result.error || I18nModule.t('tutorial_save_error');
                return;
            }
            const saved = { ...result.tutorial, has_translation: false };
            const idx = combos.findIndex(c => c.flash_type === saved.flash_type && c.firmware_version === saved.firmware_version);
            if (idx >= 0) combos[idx] = saved; else combos.push(saved);
            selectedFlash = saved.flash_type;
            selectedVersion = saved.firmware_version;
        } else {
            const result = await api(
                'PUT',
                `/console-tutorials/${encodeURIComponent(currentModel.code)}/mod/${encodeURIComponent(flashType)}/${encodeURIComponent(version)}/translations/${encodeURIComponent(lang)}`,
                { title, intro, steps }
            );
            if (!result.success) {
                statusEl.textContent = result.error || I18nModule.t('tutorial_save_error');
                return;
            }
            const idx = combos.findIndex(c => c.flash_type === flashType && c.firmware_version === version);
            if (idx >= 0) {
                combos[idx] = { ...combos[idx], title: result.translation.title, intro: result.translation.intro, steps: result.translation.steps, has_translation: true };
            }
        }

        closeEditor();
        renderView();
        renderAdminControls();
    }

    async function del() {
        const lang = I18nModule.lang;
        if (lang === 'en') {
            if (!confirm(I18nModule.t('tutorial_delete_confirm'))) return;
            await api('DELETE', `/console-tutorials/${encodeURIComponent(currentModel.code)}/mod/${encodeURIComponent(selectedFlash)}/${encodeURIComponent(selectedVersion)}`);
            combos = combos.filter(c => !(c.flash_type === selectedFlash && c.firmware_version === selectedVersion));
            selectedFlash = null;
            selectedVersion = null;
        } else {
            if (!confirm(I18nModule.t('mod_remove_translation_confirm'))) return;
            await api('DELETE', `/console-tutorials/${encodeURIComponent(currentModel.code)}/mod/${encodeURIComponent(selectedFlash)}/${encodeURIComponent(selectedVersion)}/translations/${encodeURIComponent(lang)}`);
            await reloadCombos();
        }
        closeEditor();
        renderView();
        renderAdminControls();
    }

    function renderAdminControls() {
        const wrap = el('mod-admin-controls');
        if (!wrap) return;
        if (!isAdmin()) { wrap.innerHTML = ''; return; }
        const lang = I18nModule.lang;
        const current = findCombo(selectedFlash, selectedVersion);

        // EN: full control — edit the canonical combo, or add a brand-new one.
        if (lang === 'en') {
            wrap.innerHTML = `
                ${current ? `<button type="button" id="mod-edit-btn" class="hero-button hero-button--syllabus">${I18nModule.t('tutorial_edit_btn')}</button>` : ''}
                <button type="button" id="mod-add-btn" class="hero-button hero-button--syllabus">${I18nModule.t('mod_add_combo_btn')}</button>
            `;
            el('mod-edit-btn')?.addEventListener('click', () => openEditor(false));
            el('mod-add-btn').addEventListener('click', () => openEditor(true));
            return;
        }

        // Any other language: translate the currently-browsed combo only — no
        // "add new combo" here, since flash type/firmware version are technical
        // identifiers, not translatable content, and always live on the EN row.
        if (!current) { wrap.innerHTML = ''; return; }
        const label = current.has_translation ? I18nModule.t('mod_edit_translation_btn') : I18nModule.t('mod_add_translation_btn');
        wrap.innerHTML = `
            <button type="button" id="mod-edit-translation-btn" class="hero-button hero-button--syllabus">${label}</button>
            <p class="tutorial-editor__lang-note">${I18nModule.t('mod_switch_to_en_note')}</p>
        `;
        el('mod-edit-translation-btn').addEventListener('click', () => openEditor(false));
    }

    function applyCombos(rows, consoleName, code) {
        combos = Array.isArray(rows) ? rows : [];
        currentConsoleName = consoleName;
        // flashTypesForModel() narrows the per-console-line menu down to the one flash type
        // this specific board actually has (PS3 fat/super-slim only — everything else still
        // gets the unnarrowed line-wide menu). firmwareVersions is left as the generic
        // per-console-line list; narrowing that further would need real per-firmware/flash-type
        // compatibility research this fix wasn't asked to do.
        const base = MOD_OPTIONS[consoleName];
        staticOptions = base ? { flashTypes: flashTypesForModel(consoleName, code), firmwareVersions: base.firmwareVersions } : null;
        selectedFlash = null;
        selectedVersion = null;
    }

    // Selector dropdowns are static elements in console-model.html — wire
    // their change listeners once, here, rather than re-attaching on every
    // renderSelectors() call (which only replaces the <option> children).
    el('mod-flash-select')?.addEventListener('change', (e) => {
        selectedFlash = e.target.value;
        selectedVersion = null; // let renderSelectors() pick the first version for the new flash type
        renderView();
        renderAdminControls();
    });
    el('mod-version-select')?.addEventListener('change', (e) => {
        selectedVersion = e.target.value;
        renderView();
        renderAdminControls();
    });

    return { applyCombos, renderView, renderAdminControls };
}

const disassembly = createTutorialSection({
    idPrefix: 'tutorial',
    titleField: 'title',
    introField: 'intro',
    stepsField: 'steps',
});

const modding = createModTutorialSection();

// ── Boot ─────────────────────────────────────────────────

async function render() {
    const models = await loadModels();
    currentModel = findModel(models);
    applyBackLinks();
    const root = document.getElementById('model-detail-root');
    const notFound = document.getElementById('model-detail-notfound');
    if (!currentModel) {
        if (root) root.style.display = 'none';
        if (notFound) notFound.style.display = 'block';
        return;
    }

    document.title = `${currentModel.code} (${currentModel.console}) — Console Notebook`;
    const desc = `${currentModel.console} model ${currentModel.code}. ${currentModel.note || ''}`;
    const descTag = document.querySelector('meta[name="description"]');
    if (descTag) descTag.setAttribute('content', desc);

    document.getElementById('model-plate-label').textContent = I18nModule.t('care_plate_label');
    document.getElementById('model-plate-code').textContent = currentModel.code;
    document.getElementById('model-plate-console').textContent = currentModel.console;
    document.getElementById('model-mfr').textContent = currentModel.mfr;
    document.getElementById('model-console-name').textContent = currentModel.console;
    renderDateCodes(currentModel);
    document.getElementById('model-note').textContent = currentModel.note || '';
    initModelAdminEditButton();

    let disassemblyRow = null;
    try {
        const result = await api('GET', `/console-tutorials/${encodeURIComponent(currentModel.code)}`);
        disassemblyRow = result.success ? result.tutorial : null;
    } catch {
        disassemblyRow = null;
    }
    disassembly.applyRow(disassemblyRow);
    disassembly.renderView();
    disassembly.renderAdminControls();

    let modTutorials = [];
    try {
        const result = await api('GET', `/console-tutorials/${encodeURIComponent(currentModel.code)}/mod?lang=${encodeURIComponent(I18nModule.lang)}`);
        modTutorials = result.success ? result.tutorials : [];
    } catch {
        modTutorials = [];
    }
    modding.applyCombos(modTutorials, currentModel.console, currentModel.code);
    modding.renderView();
    modding.renderAdminControls();
}

render();
window.addEventListener('cn:language-changed', render);
