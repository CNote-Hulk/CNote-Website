/**
 * CNote Shop (shop.html) — build a package from CNote's own stock and order it.
 *
 * ?console=<id> opens that console's builder; without it, the list of consoles
 * in stock. Steps: model (one physical unit — each has its own condition and
 * price) → mod (or none) → storage upgrade (when offered) → accessories (with
 * a quantity, up to the stock) → shipping → order. Cables always come with the
 * console. No payment on the site, as with marketplace orders.
 *
 * ?tab=mine — the buyer's orders. Admins (= CNote) also get ?tab=stock (units
 * and extras of a console) and ?tab=orders (every shop order + status).
 * API: backend/routes/shop.js.
 */
import { AuthModule } from '../modules/auth.js?v=20261005';
import { I18nModule } from '../modules/i18n.js?v=20261126j';
import { API_BASE_URL } from '../config.js';
import { getConsoleById, getConsolesSorted, resolveImagePath } from '../data/data-loader.js';
import { confirmModal } from '../utils/confirm-modal.js';
import { MODEL_DIRECTORY_GROUPS } from '../data/console-models.js?v=20260909d';

const t = key => I18nModule.t(key);
const SHIPPING_PRICE = { address: 25, easybox: 20 }; // = backend/utils/shipping.js
const ROMANIAN_COUNTIES = [
    'Alba', 'Arad', 'Argeș', 'Bacău', 'Bihor', 'Bistrița-Năsăud', 'Botoșani', 'Brăila', 'Brașov',
    'București', 'Buzău', 'Caraș-Severin', 'Călărași', 'Cluj', 'Constanța', 'Covasna', 'Dâmbovița',
    'Dolj', 'Galați', 'Giurgiu', 'Gorj', 'Harghita', 'Hunedoara', 'Ialomița', 'Iași', 'Ilfov',
    'Maramureș', 'Mehedinți', 'Mureș', 'Neamț', 'Olt', 'Prahova', 'Satu Mare', 'Sălaj', 'Sibiu',
    'Suceava', 'Teleorman', 'Timiș', 'Tulcea', 'Vaslui', 'Vâlcea', 'Vrancea'
];

async function api(method, path, body) {
    const token = localStorage.getItem('cn_token');
    const opts = { method, credentials: 'include', headers: {} };
    if (token) opts.headers.Authorization = 'Bearer ' + token;
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(API_BASE_URL + '/shop' + path, opts);
    try { return await res.json(); } catch { return { success: false, error: res.statusText }; }
}

function esc(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}
const ron = n => `${Number(n).toFixed(0)} RON`;
// Cosmetic grade of a piece on sale (shop_units.condition): fixed values, translated, each with
// a one-line description. Anything else (an older free-text condition) is shown as written.
const GRADES = ['ca_nou', 'foarte_bun', 'bun'];
const gradeLabel = c => (GRADES.includes(c) ? t('shop_grade_' + c) : c);
const gradeDesc = c => (GRADES.includes(c) ? t('shop_grade_' + c + '_desc') : '');
const user = () => AuthModule.getCurrentUser();
const isAdmin = () => user()?.role === 'admin';

function toast(msg, type) {
    const el = document.createElement('div');
    el.className = 'hub-toast' + (type === 'error' ? ' hub-toast--error' : type === 'success' ? ' hub-toast--success' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('hub-toast--visible'));
    setTimeout(() => {
        el.classList.remove('hub-toast--visible');
        el.addEventListener('transitionend', () => el.remove(), { once: true });
    }, 3500);
}

const params = new URLSearchParams(location.search);
const state = {
    tab: ['build', 'mine', 'stock', 'orders'].includes(params.get('tab')) ? params.get('tab') : 'build',
    consoleId: /^[a-z0-9-]{1,40}$/.test(params.get('console') || '') ? params.get('console') : null,
};

function setUrl() {
    const q = new URLSearchParams();
    if (state.consoleId) q.set('console', state.consoleId);
    if (state.tab !== 'build') q.set('tab', state.tab);
    history.replaceState(null, '', location.pathname + (q.toString() ? `?${q}` : ''));
}

async function consoleName(id) {
    const c = await getConsoleById(id);
    return c?.name || id;
}

// ── Tabs ────────────────────────────────────────────────────────────
const tabs = document.getElementById('shop-tabs');
const panels = { build: 'shop-build', mine: 'shop-mine', stock: 'shop-stock', orders: 'shop-orders' };
const renderers = { build: renderBuild, mine: renderMine, stock: renderStock, orders: renderOrders };

function showTab(tab) {
    if ((tab === 'stock' || tab === 'orders') && !isAdmin()) tab = 'build';
    state.tab = tab;
    tabs.querySelectorAll('.shop-tab').forEach(b => {
        const on = b.dataset.tab === tab;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on);
    });
    for (const [k, id] of Object.entries(panels)) document.getElementById(id).hidden = k !== tab;
    setUrl();
    renderers[tab]();
}

tabs.addEventListener('click', e => {
    const b = e.target.closest('.shop-tab');
    if (b) showTab(b.dataset.tab);
});

// ── Build: console list ─────────────────────────────────────────────
async function renderBuild() {
    const el = document.getElementById('shop-build');
    if (!state.consoleId) return renderConsoleList(el);
    el.innerHTML = `<p class="shop-muted">${esc(t('shop_loading'))}</p>`;
    const [res, consola] = await Promise.all([api('GET', `/${state.consoleId}`), getConsoleById(state.consoleId)]);
    if (!res.success) { el.innerHTML = `<p class="shop-muted">${esc(res.error || t('shop_error'))}</p>`; return; }
    renderBuilder(el, consola, res.units, res.extras);
}

async function renderConsoleList(el) {
    el.innerHTML = `<p class="shop-muted">${esc(t('shop_loading'))}</p>`;
    const res = await api('GET', '');
    if (!res.success) { el.innerHTML = `<p class="shop-muted">${esc(t('shop_error'))}</p>`; return; }
    if (!res.consoles.length) {
        el.innerHTML = `<div class="shop-empty"><p>${esc(t('shop_empty'))}</p></div>`;
        return;
    }
    const cards = await Promise.all(res.consoles.map(async c => {
        const consola = await getConsoleById(c.console_id);
        const img = consola?.image ? resolveImagePath(consola.image) : '';
        return `
            <a class="shop-console-card" href="?console=${encodeURIComponent(c.console_id)}">
                ${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ''}
                <span class="shop-console-card__name">${esc(consola?.name || c.console_id)}</span>
                <span class="shop-console-card__meta">${esc(t('shop_units_in_stock').replace('{n}', c.units))} · ${esc(t('shop_from'))} ${ron(c.from_price)}</span>
            </a>`;
    }));
    el.innerHTML = `<div class="shop-console-grid">${cards.join('')}</div>`;
}

// ── Build: the package builder ──────────────────────────────────────
function renderBuilder(panel, consola, units, extras) {
    // A fresh root per render: its listeners go away with it.
    const el = document.createElement('div');
    panel.replaceChildren(el);
    const name = consola?.name || state.consoleId;
    document.getElementById('shop-title').textContent = name;
    document.title = `${name} — CNote Shop`;

    if (!units.length) {
        el.innerHTML = `
            <div class="shop-empty">
                <p>${esc(t('shop_none_for_console'))}</p>
                <a class="hub-btn hub-btn--secondary" href="shop.html">${esc(t('shop_see_all'))}</a>
                ${isAdmin() ? `<button type="button" class="hub-btn hub-btn--primary" data-goto-stock>${esc(t('shop_manage_stock'))}</button>` : ''}
            </div>`;
        el.querySelector('[data-goto-stock]')?.addEventListener('click', () => showTab('stock'));
        return;
    }

    // Units grouped by model code, cheapest first inside a model.
    const byModel = new Map();
    for (const u of units) {
        const k = u.model_code || '—';
        if (!byModel.has(k)) byModel.set(k, []);
        byModel.get(k).push(u);
    }
    const mods = extras.filter(e => e.kind === 'mod');
    const storage = extras.filter(e => e.kind === 'storage');
    const accessories = extras.filter(e => e.kind === 'accessory');

    const pick = { model: byModel.size === 1 ? [...byModel.keys()][0] : null, unitId: null, mod: null, storage: null, acc: {}, method: 'address' };
    if (pick.model && byModel.get(pick.model).length === 1) pick.unitId = byModel.get(pick.model)[0].id;

    const unit = () => units.find(u => u.id === pick.unitId) || null;
    const fits = e => !e.models.length || (unit() && e.models.includes(unit().model_code));

    el.innerHTML = `
        <div class="shop-builder">
            <div class="shop-steps">
                <section class="shop-step">
                    <h2 class="shop-step__title"><span>1</span>${esc(t('shop_step_model'))}</h2>
                    <div class="shop-options" id="shop-models"></div>
                    <div class="shop-options shop-options--units" id="shop-units"></div>
                </section>
                ${mods.length ? `
                <section class="shop-step">
                    <h2 class="shop-step__title"><span>2</span>${esc(t('shop_step_mod'))}</h2>
                    <div class="shop-options" id="shop-mods"></div>
                </section>` : ''}
                ${storage.length ? `
                <section class="shop-step">
                    <h2 class="shop-step__title"><span>${mods.length ? 3 : 2}</span>${esc(t('shop_step_storage'))}</h2>
                    <div class="shop-options" id="shop-storage"></div>
                </section>` : ''}
                ${accessories.length ? `
                <section class="shop-step">
                    <h2 class="shop-step__title"><span>${1 + (mods.length ? 1 : 0) + (storage.length ? 1 : 0) + 1}</span>${esc(t('shop_step_accessories'))}</h2>
                    <div class="shop-accessories" id="shop-accessories"></div>
                </section>` : ''}
                <p class="shop-included">✓ ${esc(t('shop_cables_included'))}</p>
            </div>

            <aside class="shop-summary">
                <h2 class="shop-summary__title">${esc(t('shop_your_package'))}</h2>
                <div class="order-summary" id="shop-lines"></div>
                <form id="shop-checkout" class="shop-checkout" hidden>
                    <div class="hub-form-row">
                        <div class="hub-form-group">
                            <label class="hub-form-label">${esc(t('order_field_last_name'))}</label>
                            <input class="hub-form-input" name="recipient_last_name" maxlength="100" required>
                        </div>
                        <div class="hub-form-group">
                            <label class="hub-form-label">${esc(t('order_field_first_name'))}</label>
                            <input class="hub-form-input" name="recipient_first_name" maxlength="100" required>
                        </div>
                    </div>
                    <div class="hub-form-row">
                        <div class="hub-form-group">
                            <label class="hub-form-label">${esc(t('order_field_phone'))}</label>
                            <input class="hub-form-input" name="recipient_phone" type="tel" maxlength="30" required>
                        </div>
                        <div class="hub-form-group">
                            <label class="hub-form-label">${esc(t('order_field_email'))}</label>
                            <input class="hub-form-input" name="recipient_email" type="email" maxlength="150">
                        </div>
                    </div>
                    <div class="hub-form-group">
                        <label class="hub-form-label">${esc(t('order_field_method'))}</label>
                        <div class="order-method-toggle">
                            <button type="button" class="order-method-btn order-method-btn--active" data-method="address">${esc(t('order_method_address'))} (+${SHIPPING_PRICE.address} RON)</button>
                            <button type="button" class="order-method-btn" data-method="easybox">${esc(t('order_method_easybox'))} (+${SHIPPING_PRICE.easybox} RON)</button>
                        </div>
                    </div>
                    <div data-for="address">
                        <div class="hub-form-row">
                            <div class="hub-form-group">
                                <label class="hub-form-label">${esc(t('order_field_county'))}</label>
                                <select class="hub-form-input" name="county">
                                    <option value="">${esc(t('order_field_county_placeholder'))}</option>
                                    ${ROMANIAN_COUNTIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
                                </select>
                            </div>
                            <div class="hub-form-group">
                                <label class="hub-form-label">${esc(t('order_field_city'))}</label>
                                <input class="hub-form-input" name="city" maxlength="100">
                            </div>
                        </div>
                        <div class="hub-form-group">
                            <label class="hub-form-label">${esc(t('order_field_address'))}</label>
                            <textarea class="hub-form-textarea" name="address" rows="2" maxlength="300"></textarea>
                        </div>
                        <div class="hub-form-group">
                            <label class="hub-form-label">${esc(t('order_field_address2'))}</label>
                            <input class="hub-form-input" name="address_line2" maxlength="150" placeholder="${esc(t('order_field_address2_placeholder'))}">
                        </div>
                    </div>
                    <div data-for="easybox" hidden>
                        <div class="hub-form-group">
                            <label class="hub-form-label">${esc(t('order_field_easybox'))}</label>
                            <input class="hub-form-input" name="easybox_name" maxlength="200" placeholder="${esc(t('order_field_easybox_placeholder'))}">
                        </div>
                    </div>
                    <div class="hub-form-group">
                        <label class="hub-form-label">${esc(t('order_field_notes'))}</label>
                        <textarea class="hub-form-textarea" name="notes" rows="2" maxlength="500"></textarea>
                    </div>
                    <p class="order-payment-note">${esc(t('shop_payment_note'))}</p>
                    <button type="submit" class="hub-btn hub-btn--primary shop-order-btn">${esc(t('order_place_button'))}</button>
                </form>
                <button type="button" class="hub-btn hub-btn--primary shop-order-btn" id="shop-continue">${esc(t('shop_continue'))}</button>
            </aside>
        </div>`;

    const radio = (group, value, checked, label, price, sub, disabled) => `
        <label class="shop-option${checked ? ' is-checked' : ''}${disabled ? ' is-disabled' : ''}">
            <input type="radio" name="${group}" value="${esc(value)}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}>
            <span class="shop-option__main">
                <span class="shop-option__label">${esc(label)}</span>
                ${sub ? `<span class="shop-option__sub">${esc(sub)}</span>` : ''}
            </span>
            ${price !== null ? `<span class="shop-option__price">${price}</span>` : ''}
        </label>`;

    function drawModels() {
        document.getElementById('shop-models').innerHTML = [...byModel.entries()].map(([model, list]) =>
            radio('model', model, pick.model === model, model,
                `${esc(t('shop_from'))} ${ron(Math.min(...list.map(u => u.price)))}`,
                t('shop_units_in_stock').replace('{n}', list.length))).join('');
        const unitsEl = document.getElementById('shop-units');
        const list = pick.model ? byModel.get(pick.model) : [];
        // Shown even for a single piece: its grade and description are what the buyer judges by.
        unitsEl.hidden = !list.length;
        unitsEl.innerHTML = !list.length ? '' :
            `<p class="shop-step__hint">${esc(t('shop_pick_unit'))}</p>` +
            list.map(u => radio('unit', u.id, pick.unitId === u.id, gradeLabel(u.condition) || `#${u.id}`, ron(u.price), [gradeDesc(u.condition), u.notes].filter(Boolean).join(' · '))).join('');
    }
    function drawMods() {
        const box = document.getElementById('shop-mods');
        if (!box) return;
        if (pick.mod && !fits(mods.find(m => m.id === pick.mod))) pick.mod = null;
        box.innerHTML = radio('mod', '', !pick.mod, t('shop_unmodded'), '+0 RON', '') +
            mods.map(m => radio('mod', m.id, pick.mod === m.id, m.name, `+${ron(m.price)}`,
                fits(m) ? m.description : t('shop_not_for_model'), !fits(m))).join('');
    }
    function drawStorage() {
        const box = document.getElementById('shop-storage');
        if (!box) return;
        if (pick.storage && !fits(storage.find(s => s.id === pick.storage))) pick.storage = null;
        box.innerHTML = radio('storage', '', !pick.storage, t('shop_storage_standard'), '+0 RON', '') +
            storage.map(s => radio('storage', s.id, pick.storage === s.id, s.name, `+${ron(s.price)}`,
                fits(s) ? s.description : t('shop_not_for_model'), !fits(s))).join('');
    }
    function drawAccessories() {
        const box = document.getElementById('shop-accessories');
        if (!box) return;
        box.innerHTML = accessories.map(a => {
            const max = a.stock === null ? 10 : a.stock;
            const q = pick.acc[a.id] || 0;
            return `
                <div class="shop-acc${q ? ' is-checked' : ''}">
                    <span class="shop-option__main">
                        <span class="shop-option__label">${esc(a.name)}</span>
                        <span class="shop-option__sub">${esc(a.description || '')}${a.stock !== null ? ` · ${esc(t('shop_left').replace('{n}', a.stock))}` : ''}</span>
                    </span>
                    <span class="shop-option__price">${ron(a.price)}</span>
                    <span class="shop-qty">
                        <button type="button" data-acc="${a.id}" data-d="-1" ${q <= 0 ? 'disabled' : ''} aria-label="−">−</button>
                        <span>${q}</span>
                        <button type="button" data-acc="${a.id}" data-d="1" ${q >= max ? 'disabled' : ''} aria-label="+">+</button>
                    </span>
                </div>`;
        }).join('');
    }
    function drawSummary() {
        const u = unit();
        const lines = [];
        if (u) lines.push([`${name} ${u.model_code}${u.condition ? ` · ${gradeLabel(u.condition)}` : ''}`, u.price]);
        const mod = mods.find(m => m.id === pick.mod);
        if (mod) lines.push([mod.name, mod.price]);
        const st = storage.find(s => s.id === pick.storage);
        if (st) lines.push([st.name, st.price]);
        for (const a of accessories) if (pick.acc[a.id]) lines.push([`${pick.acc[a.id]} × ${a.name}`, a.price * pick.acc[a.id]]);
        const sub = lines.reduce((n, l) => n + l[1], 0);
        const ship = SHIPPING_PRICE[pick.method];
        document.getElementById('shop-lines').innerHTML = u ? `
            ${lines.map(([l, p]) => `<div class="order-summary__row"><span>${esc(l)}</span><span>${ron(p)}</span></div>`).join('')}
            <div class="order-summary__row"><span>${esc(t('shop_cables'))}</span><span>${esc(t('shop_included'))}</span></div>
            <div class="order-summary__row"><span>${esc(t('order_summary_shipping'))}</span><span>${ron(ship)}</span></div>
            <div class="order-summary__row order-summary__row--total"><span>${esc(t('order_summary_total'))}</span><span>${ron(sub + ship)}</span></div>`
            : `<p class="shop-muted">${esc(t('shop_pick_model_first'))}</p>`;
        document.getElementById('shop-continue').disabled = !u;
    }
    const redraw = () => { drawModels(); drawMods(); drawStorage(); drawAccessories(); drawSummary(); };

    el.addEventListener('change', e => {
        const r = e.target;
        if (r.name === 'model') {
            pick.model = r.value;
            const list = byModel.get(pick.model);
            pick.unitId = list.length === 1 ? list[0].id : null;
        } else if (r.name === 'unit') pick.unitId = parseInt(r.value);
        else if (r.name === 'mod') pick.mod = r.value ? parseInt(r.value) : null;
        else if (r.name === 'storage') pick.storage = r.value ? parseInt(r.value) : null;
        else return;
        redraw();
    });
    el.addEventListener('click', e => {
        const b = e.target.closest('[data-acc]');
        if (!b) return;
        const id = parseInt(b.dataset.acc);
        pick.acc[id] = Math.max(0, (pick.acc[id] || 0) + parseInt(b.dataset.d));
        drawAccessories(); drawSummary();
    });

    const form = document.getElementById('shop-checkout');
    document.getElementById('shop-continue').addEventListener('click', e => {
        if (!user()) {
            location.href = 'login.html';
            return;
        }
        form.hidden = false;
        e.target.hidden = true;
        form.querySelector('input').focus();
    });
    form.querySelectorAll('.order-method-btn').forEach(btn => btn.addEventListener('click', () => {
        pick.method = btn.dataset.method;
        form.querySelectorAll('.order-method-btn').forEach(b => b.classList.toggle('order-method-btn--active', b === btn));
        form.querySelectorAll('[data-for]').forEach(d => { d.hidden = d.dataset.for !== pick.method; });
        drawSummary();
    }));
    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!unit()) return;
        const f = form, btn = f.querySelector('[type="submit"]');
        btn.disabled = true; btn.textContent = t('order_placing');
        const addr = pick.method === 'address';
        const res = await api('POST', '/orders', {
            unit_id: pick.unitId,
            mod_id: pick.mod,
            storage_id: pick.storage,
            accessories: Object.entries(pick.acc).filter(([, q]) => q > 0).map(([id, qty]) => ({ id: parseInt(id), qty })),
            delivery_method: pick.method,
            recipient_first_name: f.recipient_first_name.value.trim(),
            recipient_last_name: f.recipient_last_name.value.trim(),
            recipient_phone: f.recipient_phone.value.trim(),
            recipient_email: f.recipient_email.value.trim(),
            county: addr ? f.county.value : '',
            city: addr ? f.city.value.trim() : '',
            address: addr ? f.address.value.trim() : '',
            address_line2: addr ? f.address_line2.value.trim() : '',
            easybox_name: addr ? '' : f.easybox_name.value.trim(),
            notes: f.notes.value.trim(),
        });
        if (res.success) {
            toast(t('shop_order_placed'), 'success');
            showTab('mine');
        } else {
            btn.disabled = false; btn.textContent = t('order_place_button');
            toast(res.error || t('shop_error'), 'error');
            if (/no longer available|left|not available|does not fit/i.test(res.error || '')) renderBuild();
        }
    });

    redraw();
}

// ── Orders (buyer and admin) ────────────────────────────────────────
const STATUS_KEYS = { new: 'shop_status_new', confirmed: 'shop_status_confirmed', shipped: 'shop_status_shipped', cancelled: 'shop_status_cancelled' };

async function orderCard(o, admin) {
    const name = await consoleName(o.console_id);
    const items = (o.items || []).map(i => `<li>${i.qty > 1 ? `${i.qty} × ` : ''}${esc(i.name)} <span>${ron(i.price * i.qty)}</span></li>`).join('');
    const shipTo = o.delivery_method === 'easybox'
        ? `${esc(t('order_method_easybox'))}: ${esc(o.easybox_name)}`
        : `${esc(o.address)}${o.address_line2 ? `, ${esc(o.address_line2)}` : ''}, ${esc(o.city)}, ${esc(o.county)}`;
    const date = new Date(o.created_at).toLocaleString();
    return `
        <article class="shop-order shop-order--${esc(o.status)}" data-id="${o.id}">
            <header class="shop-order__head">
                <span class="shop-order__id">#${o.id}</span>
                <span class="shop-order__status">${esc(t(STATUS_KEYS[o.status] || 'shop_status_new'))}</span>
                <span class="shop-order__date">${esc(date)}</span>
            </header>
            <ul class="shop-order__items">
                <li><strong>${esc(name)} ${esc(o.model_code)}</strong> <span>${ron(o.unit_price)}</span></li>
                ${items}
                <li>${esc(t('shop_cables'))} <span>${esc(t('shop_included'))}</span></li>
                <li>${esc(t('order_summary_shipping'))} <span>${ron(o.shipping_price)}</span></li>
                <li class="shop-order__total">${esc(t('order_summary_total'))} <span>${ron(o.total_price)}</span></li>
            </ul>
            ${admin ? `
            <div class="shop-order__ship">
                <div><strong>${esc(o.recipient_name)}</strong> · ${esc(o.recipient_phone)}${o.recipient_email ? ` · ${esc(o.recipient_email)}` : ''} · @${esc(o.buyer_name)}</div>
                <div>${shipTo}</div>
                ${o.notes ? `<div class="shop-muted">${esc(o.notes)}</div>` : ''}
            </div>
            ${o.status !== 'cancelled' && o.status !== 'shipped' ? `
            <div class="shop-order__actions">
                ${o.status === 'new' ? `<button type="button" class="hub-btn hub-btn--secondary" data-status="confirmed">${esc(t('shop_action_confirm'))}</button>` : ''}
                <button type="button" class="hub-btn hub-btn--primary" data-status="shipped">${esc(t('shop_action_ship'))}</button>
                <button type="button" class="hub-btn hub-btn--secondary" data-status="cancelled">${esc(t('shop_action_cancel'))}</button>
            </div>` : ''}` : `<div class="shop-order__ship">${shipTo}</div>`}
        </article>`;
}

async function renderMine() {
    const el = document.getElementById('shop-mine');
    if (!user()) {
        el.innerHTML = `<div class="shop-empty"><p>${esc(t('shop_login_to_see'))}</p><a class="hub-btn hub-btn--primary" href="login.html">${esc(t('shop_login'))}</a></div>`;
        return;
    }
    el.innerHTML = `<p class="shop-muted">${esc(t('shop_loading'))}</p>`;
    const res = await api('GET', '/orders/mine');
    if (!res.success) { el.innerHTML = `<p class="shop-muted">${esc(t('shop_error'))}</p>`; return; }
    el.innerHTML = res.orders.length
        ? `<p class="order-payment-note">${esc(t('shop_payment_note'))}</p>` + (await Promise.all(res.orders.map(o => orderCard(o, false)))).join('')
        : `<div class="shop-empty"><p>${esc(t('shop_no_orders'))}</p></div>`;
}

async function renderOrders() {
    const el = document.getElementById('shop-orders');
    el.innerHTML = `<p class="shop-muted">${esc(t('shop_loading'))}</p>`;
    const res = await api('GET', '/orders');
    if (!res.success) { el.innerHTML = `<p class="shop-muted">${esc(res.error || t('shop_error'))}</p>`; return; }
    el.innerHTML = res.orders.length
        ? (await Promise.all(res.orders.map(o => orderCard(o, true)))).join('')
        : `<div class="shop-empty"><p>${esc(t('shop_no_orders'))}</p></div>`;
}

document.getElementById('shop-orders').addEventListener('click', async e => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    if (b.dataset.status === 'cancelled' && !await confirmModal(t('shop_cancel_confirm'), { ok: t('shop_action_cancel') })) return;
    b.disabled = true;
    const res = await api('PATCH', `/orders/${id}`, { status: b.dataset.status });
    if (!res.success) toast(res.error || t('shop_error'), 'error');
    renderOrders();
});

// ── Admin: stock ────────────────────────────────────────────────────
async function renderStock() {
    const el = document.getElementById('shop-stock');
    const consoles = await getConsolesSorted();
    const sorted = [...consoles].sort((a, b) => a.name.localeCompare(b.name));
    if (!state.consoleId && sorted.length) state.consoleId = sorted[0].id;
    setUrl();
    el.innerHTML = `
        <div class="hub-form-group shop-stock__console">
            <label class="hub-form-label" for="shop-stock-console">${esc(t('shop_stock_console'))}</label>
            <select class="hub-form-input" id="shop-stock-console">
                ${sorted.map(c => `<option value="${esc(c.id)}"${c.id === state.consoleId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
        </div>
        <div id="shop-stock-body"><p class="shop-muted">${esc(t('shop_loading'))}</p></div>`;
    el.querySelector('#shop-stock-console').addEventListener('change', e => {
        state.consoleId = e.target.value;
        setUrl();
        drawStock();
    });
    drawStock();
}

let modelCodes = null;
async function codesFor(consoleId) {
    if (!modelCodes) {
        try {
            const r = await fetch(API_BASE_URL + '/console-models');
            const j = await r.json();
            modelCodes = Array.isArray(j) ? j : (j.models || []);
        } catch { modelCodes = []; }
    }
    // Same console → model-group mapping as the console pages' Modding Guide link.
    const groups = new Set(MODEL_DIRECTORY_GROUPS[consoleId] || []);
    return modelCodes.filter(m => groups.has(m.console)).map(m => m.code);
}

async function drawStock() {
    const body = document.getElementById('shop-stock-body');
    const id = state.consoleId;
    const [res, codes] = await Promise.all([api('GET', `/${id}?all=1`), codesFor(id)]);
    if (!res.success) { body.innerHTML = `<p class="shop-muted">${esc(t('shop_error'))}</p>`; return; }
    const statusOpts = s => ['available', 'reserved', 'sold', 'hidden']
        .map(v => `<option value="${v}"${v === s ? ' selected' : ''}>${esc(t('shop_unit_' + v))}</option>`).join('');
    const kindOpts = k => ['mod', 'storage', 'accessory']
        .map(v => `<option value="${v}"${v === k ? ' selected' : ''}>${esc(t('shop_kind_' + v))}</option>`).join('');
    const unitRow = u => `
        <form class="shop-row" data-unit="${u.id || ''}">
            <input class="hub-form-input" name="model_code" list="shop-codes" placeholder="${esc(t('shop_f_model'))}" value="${esc(u.model_code || '')}" maxlength="40">
            <select class="hub-form-input" name="condition" title="${esc(t('shop_f_condition'))}">
                ${GRADES.map(g => `<option value="${g}"${g === u.condition ? ' selected' : ''}>${esc(gradeLabel(g))}</option>`).join('')}
                ${u.condition && !GRADES.includes(u.condition) ? `<option value="${esc(u.condition)}" selected>${esc(u.condition)}</option>` : ''}
            </select>
            <input class="hub-form-input" name="notes" placeholder="${esc(t('shop_f_notes'))}" value="${esc(u.notes || '')}" maxlength="500">
            <input class="hub-form-input shop-row__num" name="price" type="number" min="0" step="1" placeholder="RON" value="${u.price ?? ''}" required>
            <select class="hub-form-input" name="status">${statusOpts(u.status || 'available')}</select>
            <button type="submit" class="hub-btn hub-btn--primary">${esc(u.id ? t('shop_save') : t('shop_add'))}</button>
            ${u.id ? `<button type="button" class="hub-btn hub-btn--secondary" data-del>✕</button>` : ''}
        </form>`;
    const extraRow = x => `
        <form class="shop-row shop-row--extra" data-extra="${x.id || ''}">
            <select class="hub-form-input" name="kind">${kindOpts(x.kind || 'mod')}</select>
            <input class="hub-form-input" name="name" placeholder="${esc(t('shop_f_name'))}" value="${esc(x.name || '')}" maxlength="120" required>
            <input class="hub-form-input" name="description" placeholder="${esc(t('shop_f_description'))}" value="${esc(x.description || '')}" maxlength="500">
            <input class="hub-form-input shop-row__num" name="price" type="number" min="0" step="1" placeholder="RON" value="${x.price ?? ''}" required>
            <input class="hub-form-input shop-row__num" name="stock" type="number" min="0" step="1" placeholder="${esc(t('shop_f_stock'))}" value="${x.stock ?? ''}" title="${esc(t('shop_f_stock_hint'))}">
            <input class="hub-form-input" name="models" placeholder="${esc(t('shop_f_models'))}" value="${esc((x.models || []).join(', '))}" title="${esc(t('shop_f_models_hint'))}">
            <label class="shop-row__check"><input type="checkbox" name="active"${x.active !== false ? ' checked' : ''}> ${esc(t('shop_f_active'))}</label>
            <button type="submit" class="hub-btn hub-btn--primary">${esc(x.id ? t('shop_save') : t('shop_add'))}</button>
            ${x.id ? `<button type="button" class="hub-btn hub-btn--secondary" data-del>✕</button>` : ''}
        </form>`;
    body.innerHTML = `
        <datalist id="shop-codes">${codes.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
        <h2 class="shop-step__title">${esc(t('shop_stock_units'))}</h2>
        <p class="shop-step__hint">${esc(t('shop_stock_units_hint'))}</p>
        <div class="shop-rows">${res.units.map(unitRow).join('')}${unitRow({})}</div>
        <h2 class="shop-step__title">${esc(t('shop_stock_extras'))}</h2>
        <p class="shop-step__hint">${esc(t('shop_stock_extras_hint'))}</p>
        <div class="shop-rows">${res.extras.map(extraRow).join('')}${extraRow({})}</div>
        <p><a href="?console=${encodeURIComponent(id)}">${esc(t('shop_preview'))} →</a></p>`;
}

document.getElementById('shop-stock').addEventListener('submit', async e => {
    const f = e.target.closest('form.shop-row');
    if (!f) return;
    e.preventDefault();
    const isUnit = f.dataset.unit !== undefined;
    const id = isUnit ? f.dataset.unit : f.dataset.extra;
    const v = n => f.elements[n]?.value ?? '';
    const body = isUnit
        ? { console_id: state.consoleId, model_code: v('model_code'), condition: v('condition'), notes: v('notes'), price: v('price'), status: v('status') }
        : { console_id: state.consoleId, kind: v('kind'), name: v('name'), description: v('description'), price: v('price'), stock: v('stock') === '' ? null : v('stock'), models: v('models'), active: f.elements.active.checked };
    const path = isUnit ? '/units' : '/extras';
    const res = await api(id ? 'PUT' : 'POST', id ? `${path}/${id}` : path, body);
    if (res.success) { toast(t('shop_saved'), 'success'); drawStock(); }
    else toast(res.error || t('shop_error'), 'error');
});

document.getElementById('shop-stock').addEventListener('click', async e => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    const f = b.closest('form.shop-row');
    if (!await confirmModal(t('shop_delete_confirm'), { ok: t('shop_delete') })) return;
    const res = await api('DELETE', f.dataset.unit !== undefined ? `/units/${f.dataset.unit}` : `/extras/${f.dataset.extra}`);
    if (res.success) drawStock();
    else toast(res.error || t('shop_error'), 'error');
});

// ── Start ───────────────────────────────────────────────────────────
if (isAdmin()) tabs.querySelectorAll('[data-admin]').forEach(b => { b.hidden = false; });
window.addEventListener('cn:language-changed', () => renderers[state.tab]());
showTab(state.tab);
