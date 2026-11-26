/**
 * "From the CNote shelf" block on a console page (2026-11-26): what CNote has
 * in stock for this console — consoles per model, accessories — and a button
 * to build the package on shop.html. Hidden when nothing is in stock, except
 * for an admin, who gets a link to add stock. Styles: shop.css (.console-shop*),
 * loaded on demand since the console pages don't link it.
 * API: GET /api/shop/:consoleId (backend/routes/shop.js).
 */
import { AuthModule } from './auth.js?v=20261005';
import { I18nModule } from './i18n.js?v=20261126c';
import { API_BASE_URL } from '../config.js';

const t = key => I18nModule.t(key);

function esc(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

function ensureStylesheet() {
    if (document.querySelector('link[data-shop-css]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/pages/shop.css?v=20261126c';
    link.dataset.shopCss = '';
    document.head.appendChild(link);
}

let cache = { id: null, data: null };

async function render(consoleId) {
    let data;
    try {
        if (cache.id !== consoleId) {
            const r = await fetch(`${API_BASE_URL}/shop/${encodeURIComponent(consoleId)}`);
            const j = await r.json();
            cache = { id: consoleId, data: j.success ? j : { units: [], extras: [] } };
        }
        data = cache.data;
    } catch (err) {
        console.warn('Shop stock failed to load:', err);
        return;
    }
    const admin = AuthModule.getCurrentUser()?.role === 'admin';
    let box = document.querySelector('.console-shop');
    if (!data.units.length && !admin) { box?.remove(); return; }

    ensureStylesheet();
    if (!box) {
        box = document.createElement('section');
        box.className = 'section console-shop';
        box.id = 'shop';
        const hero = document.querySelector('.console-hero');
        if (hero) hero.after(box);
        else document.querySelector('main')?.prepend(box);
    }

    const shopUrl = `/html/pages/shop.html?console=${encodeURIComponent(consoleId)}`;
    if (!data.units.length) {
        box.innerHTML = `<div class="container"><div class="console-shop__card console-shop__card--admin">
            <span>${esc(t('console_shop_empty_admin'))}</span>
            <a class="hero-button hero-button--syllabus" href="${shopUrl}&tab=stock">${esc(t('shop_manage_stock'))}</a>
        </div></div>`;
        return;
    }

    const models = new Map();
    for (const u of data.units) models.set(u.model_code || '—', (models.get(u.model_code || '—') || 0) + 1);
    const minPrice = Math.min(...data.units.map(u => u.price));
    const acc = data.extras.filter(e => e.kind === 'accessory');
    const options = data.extras.filter(e => e.kind !== 'accessory');

    box.innerHTML = `
        <div class="container">
            <div class="console-shop__card">
                <div class="console-shop__info">
                    <p class="console-shop__kicker">${esc(t('console_shop_kicker'))}</p>
                    <h2 class="console-shop__title">${esc(t('shop_units_in_stock').replace('{n}', data.units.length))}
                        <span class="console-shop__from">${esc(t('shop_from'))} ${minPrice.toFixed(0)} RON</span></h2>
                    <div class="console-shop__chips">
                        ${[...models.entries()].map(([m, n]) => `<span class="console-shop__chip">${esc(m)} <b>×${n}</b></span>`).join('')}
                        ${acc.map(a => `<span class="console-shop__chip console-shop__chip--acc">${esc(a.name)}${a.stock !== null ? ` <b>×${a.stock}</b>` : ''}</span>`).join('')}
                    </div>
                    ${options.length ? `<p class="console-shop__note">${esc(t('console_shop_options'))}: ${options.map(o => esc(o.name)).join(' · ')}</p>` : ''}
                </div>
                <div class="console-shop__actions">
                    <a class="hero-button" href="${shopUrl}">${esc(t('console_shop_buy'))}</a>
                    ${admin ? `<a class="console-shop__manage" href="${shopUrl}&tab=stock">${esc(t('shop_manage_stock'))}</a>` : ''}
                </div>
            </div>
        </div>`;
}

export const ConsoleShopModule = { render };
