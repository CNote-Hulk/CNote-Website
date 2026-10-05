/* ── Custom Confirm Modal ───────────────────────────────── */

let _overlay = null;

function _getOrCreate() {
    if (_overlay) return _overlay;

    _overlay = document.createElement('div');
    _overlay.className = 'confirm-overlay';
    // SAFE: hardcoded only — this is a static SVG + empty structural shell.
    // The `message` parameter is written via .textContent (line below), never innerHTML.
    _overlay.innerHTML = `
        <div class="confirm-box">
            <div class="confirm-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="82"><path d="M2 10h2v2H2zm0 4h2v-2H2zm20-4h-2v2h2zm0 4h-2v-2h2zM4 8h2v2H4zm0 8h2v-2H4zm16-8h-2v2h2zm0 8h-2v-2h2zM6 6h2v2H6zm0 12h2v-2H6zM18 6h-2v2h2zm0 12h-2v-2h2zM8 4h2v2H8zm0 16h2v-2H8zm8-16h-2v2h2zm0 16h-2v-2h2zM10 2h2v2h-2zm0 20h2v-2h-2zm4-20h-2v2h2zm0 20h-2v-2h2zm-3-5h2v-2h-2zm0-4h2V7h-2z"/></svg>
            </div>
            <p class="confirm-msg"></p>
            <div class="confirm-actions">
                <button class="confirm-btn confirm-btn--cancel">Cancel</button>
                <button class="confirm-btn confirm-btn--ok">Delete</button>
            </div>
        </div>`;
    document.body.appendChild(_overlay);
    return _overlay;
}

/**
 * Show a styled confirm dialog. Returns a Promise<boolean>.
 * @param {string} message  – text to display
 * @param {object} [opts]   – { ok: 'Button text', cancel: 'Button text' }
 */
export function confirmModal(message, opts = {}) {
    return new Promise(resolve => {
        const el = _getOrCreate();
        el.querySelector('.confirm-msg').textContent = message;
        el.querySelector('.confirm-btn--ok').textContent = opts.ok || 'Delete';
        el.querySelector('.confirm-btn--cancel').textContent = opts.cancel || 'Cancel';

        el.classList.add('confirm-overlay--active');

        function cleanup(result) {
            el.classList.remove('confirm-overlay--active');
            el.removeEventListener('click', onOverlay);
            btnOk.removeEventListener('click', onOk);
            btnCancel.removeEventListener('click', onCancel);
            document.removeEventListener('keydown', onKey);
            resolve(result);
        }

        const btnOk = el.querySelector('.confirm-btn--ok');
        const btnCancel = el.querySelector('.confirm-btn--cancel');

        function onOk() { cleanup(true); }
        function onCancel() { cleanup(false); }
        function onOverlay(e) { if (e.target === el) cleanup(false); }
        function onKey(e) {
            if (e.key === 'Escape') cleanup(false);
            if (e.key === 'Enter') cleanup(true);
        }

        btnOk.addEventListener('click', onOk);
        btnCancel.addEventListener('click', onCancel);
        el.addEventListener('click', onOverlay);
        document.addEventListener('keydown', onKey);

        btnOk.focus();
    });
}

/* ── Custom Prompt Modal ─────────────────────────────────── */
// (2026-09-01) Andrei: the ban-temp/mute-hours pickers used prompt() — a native browser
// dialog that looks out of place next to the rest of the (already-custom) admin UI. Same
// singleton-overlay pattern as confirmModal above, just with an <input> instead of only two
// buttons.

let _promptOverlay = null;

function _getOrCreatePrompt() {
    if (_promptOverlay) return _promptOverlay;

    _promptOverlay = document.createElement('div');
    _promptOverlay.className = 'confirm-overlay';
    // SAFE: hardcoded shell only. message → .textContent, defaultValue → .value, both below.
    _promptOverlay.innerHTML = `
        <div class="confirm-box">
            <p class="confirm-msg"></p>
            <input class="confirm-input" type="number" min="1">
            <div class="confirm-actions">
                <button class="confirm-btn confirm-btn--cancel">Cancel</button>
                <button class="confirm-btn confirm-btn--ok confirm-btn--ok-neutral">OK</button>
            </div>
        </div>`;
    document.body.appendChild(_promptOverlay);
    return _promptOverlay;
}

/**
 * Show a styled numeric prompt. Returns a Promise<string|null> (null if canceled) —
 * same contract as native prompt(), so callers keep doing their own parseInt/validation.
 * @param {string} message
 * @param {object} [opts] – { defaultValue, ok, cancel, min, max }
 */
export function promptModal(message, opts = {}) {
    return new Promise(resolve => {
        const el = _getOrCreatePrompt();
        el.querySelector('.confirm-msg').textContent = message;
        el.querySelector('.confirm-btn--ok').textContent = opts.ok || 'OK';
        el.querySelector('.confirm-btn--cancel').textContent = opts.cancel || 'Cancel';
        const input = el.querySelector('.confirm-input');
        input.value = opts.defaultValue ?? '';
        input.min = opts.min ?? 1;
        if (opts.max !== undefined) input.max = opts.max; else input.removeAttribute('max');

        el.classList.add('confirm-overlay--active');

        function cleanup(result) {
            el.classList.remove('confirm-overlay--active');
            el.removeEventListener('click', onOverlay);
            btnOk.removeEventListener('click', onOk);
            btnCancel.removeEventListener('click', onCancel);
            input.removeEventListener('keydown', onInputKey);
            document.removeEventListener('keydown', onKey);
            resolve(result);
        }

        const btnOk = el.querySelector('.confirm-btn--ok');
        const btnCancel = el.querySelector('.confirm-btn--cancel');

        function onOk() { cleanup(input.value); }
        function onCancel() { cleanup(null); }
        function onOverlay(e) { if (e.target === el) cleanup(null); }
        function onKey(e) { if (e.key === 'Escape') cleanup(null); }
        function onInputKey(e) { if (e.key === 'Enter') cleanup(input.value); }

        btnOk.addEventListener('click', onOk);
        btnCancel.addEventListener('click', onCancel);
        el.addEventListener('click', onOverlay);
        input.addEventListener('keydown', onInputKey);
        document.addEventListener('keydown', onKey);

        input.focus();
        input.select();
    });
}

/* ── Custom Alert Modal ──────────────────────────────────── */
// Same rationale as promptModal above — replaces alert() (e.g. chat.js's "you can't post,
// you're restricted until <date>" message) with the same visual language as confirmModal.

let _alertOverlay = null;

function _getOrCreateAlert() {
    if (_alertOverlay) return _alertOverlay;

    _alertOverlay = document.createElement('div');
    _alertOverlay.className = 'confirm-overlay';
    // SAFE: hardcoded shell only. message → .textContent below.
    _alertOverlay.innerHTML = `
        <div class="confirm-box">
            <p class="confirm-msg"></p>
            <div class="confirm-actions confirm-actions--single">
                <button class="confirm-btn confirm-btn--ok confirm-btn--ok-neutral">OK</button>
            </div>
        </div>`;
    document.body.appendChild(_alertOverlay);
    return _alertOverlay;
}

/** Show a styled alert. Returns a Promise<void>, resolved once dismissed. */
export function alertModal(message, opts = {}) {
    return new Promise(resolve => {
        const el = _getOrCreateAlert();
        el.querySelector('.confirm-msg').textContent = message;
        el.querySelector('.confirm-btn--ok').textContent = opts.ok || 'OK';

        el.classList.add('confirm-overlay--active');

        function cleanup() {
            el.classList.remove('confirm-overlay--active');
            el.removeEventListener('click', onOverlay);
            btnOk.removeEventListener('click', onOk);
            document.removeEventListener('keydown', onKey);
            resolve();
        }

        const btnOk = el.querySelector('.confirm-btn--ok');
        function onOk() { cleanup(); }
        function onOverlay(e) { if (e.target === el) cleanup(); }
        function onKey(e) { if (e.key === 'Escape' || e.key === 'Enter') cleanup(); }

        btnOk.addEventListener('click', onOk);
        el.addEventListener('click', onOverlay);
        document.addEventListener('keydown', onKey);

        btnOk.focus();
    });
}
