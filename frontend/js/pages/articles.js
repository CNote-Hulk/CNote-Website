/**
 * Articles list page — public grid of admin-written articles, with an
 * admin-only "Write article" modal that creates a new one.
 */
import { AuthModule } from '../modules/auth.js';
import { I18nModule } from '../modules/i18n.js?v=20260909e';
import { API_BASE_URL } from '../config.js';

const PAGE_SIZE = 12;

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
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

function isAdmin() {
    return AuthModule.getCurrentUser()?.role === 'admin';
}

function showToast(msg, type) {
    const el = document.createElement('div');
    el.className = 'hub-toast' + (type === 'error' ? ' hub-toast--error' : type === 'success' ? ' hub-toast--success' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('hub-toast--visible'));
    setTimeout(() => {
        el.classList.remove('hub-toast--visible');
        el.addEventListener('transitionend', () => el.remove(), { once: true });
    }, 3000);
}

const gridEl = document.getElementById('articles-grid');
const loadingEl = document.getElementById('articles-loading');
const emptyEl = document.getElementById('articles-empty');
const loadMoreBtn = document.getElementById('articles-load-more');
const writeBtn = document.getElementById('articles-write-btn');

let offset = 0;

function formatDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderCard(a) {
    const card = document.createElement('a');
    card.className = 'article-card';
    card.href = `article.html?slug=${encodeURIComponent(a.slug)}`;
    card.innerHTML = `
        ${a.cover_image_url ? `<img class="article-card__cover" src="${escapeHtml(a.cover_image_url)}" alt="" loading="lazy">` : '<div class="article-card__cover article-card__cover--placeholder">📰</div>'}
        <div class="article-card__body">
            <h3 class="article-card__title">${escapeHtml(a.title)}</h3>
            ${a.excerpt ? `<p class="article-card__excerpt">${escapeHtml(a.excerpt)}</p>` : ''}
            <div class="article-card__meta">
                <span>${escapeHtml(a.author_name)}</span>
                <span>${formatDate(a.created_at)}</span>
            </div>
        </div>`;
    return card;
}

async function loadPage() {
    loadingEl.hidden = false;
    loadMoreBtn.hidden = true;
    try {
        const res = await api('GET', `/articles?limit=${PAGE_SIZE}&offset=${offset}`);
        if (!res.success) throw new Error(res.error || 'failed');

        if (offset === 0 && res.articles.length === 0) {
            emptyEl.hidden = false;
            loadingEl.hidden = true;
            return;
        }

        res.articles.forEach(a => gridEl.appendChild(renderCard(a)));
        offset += res.articles.length;
        loadMoreBtn.hidden = res.articles.length < PAGE_SIZE;
    } catch (err) {
        console.error('Articles load error:', err);
        emptyEl.hidden = false;
        emptyEl.querySelector('p').textContent = I18nModule.t('articles_error') || 'Could not load articles.';
    } finally {
        loadingEl.hidden = true;
    }
}

loadMoreBtn.addEventListener('click', loadPage);
loadPage();

// ── Admin: write article modal ──────────────────────────────────────
if (isAdmin()) writeBtn.hidden = false;

const overlay = document.getElementById('article-modal-overlay');
const form = document.getElementById('article-form');
const titleInput = document.getElementById('article-title-input');
const excerptInput = document.getElementById('article-excerpt-input');
const contentInput = document.getElementById('article-content-input');
const publishedInput = document.getElementById('article-published-input');
const coverInput = document.getElementById('article-cover-input');
const coverPreview = document.getElementById('article-cover-preview');
const coverStatus = document.getElementById('article-cover-status');
let coverImageKey = null;

function openModal() {
    form.reset();
    coverImageKey = null;
    coverPreview.hidden = true;
    coverStatus.textContent = '';
    overlay.hidden = false;
}
function closeModal() { overlay.hidden = true; }

writeBtn.addEventListener('click', openModal);
document.getElementById('article-modal-close').addEventListener('click', closeModal);
document.getElementById('article-form-cancel').addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

coverInput.addEventListener('change', async () => {
    const file = coverInput.files[0];
    if (!file) return;
    coverPreview.src = URL.createObjectURL(file);
    coverPreview.hidden = false;
    coverStatus.textContent = I18nModule.t('articles_uploading') || 'Uploading…';
    try {
        const presign = await api('POST', '/uploads/presign', { kind: 'article', contentType: file.type, fileSize: file.size });
        if (!presign.success) throw new Error(presign.error || 'Presign failed');
        const putRes = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        if (!putRes.ok) throw new Error('Upload failed');
        coverImageKey = presign.key;
        coverStatus.textContent = '';
    } catch (err) {
        console.error('Cover upload failed:', err);
        coverImageKey = null;
        coverStatus.textContent = I18nModule.t('articles_upload_error') || 'Upload failed — try again.';
    }
});

form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('article-form-submit');
    btn.disabled = true;
    try {
        const res = await api('POST', '/articles', {
            title: titleInput.value.trim(),
            excerpt: excerptInput.value.trim(),
            content_html: contentInput.value,
            cover_image_key: coverImageKey,
            published: publishedInput.checked,
        });
        if (res.success) {
            window.location.href = `article.html?slug=${encodeURIComponent(res.article.slug)}`;
        } else {
            showToast(res.error || I18nModule.t('articles_save_error') || 'Could not create article.', 'error');
            btn.disabled = false;
        }
    } catch (err) {
        console.error('Article create failed:', err);
        showToast(I18nModule.t('articles_save_error') || 'Could not create article.', 'error');
        btn.disabled = false;
    }
});
