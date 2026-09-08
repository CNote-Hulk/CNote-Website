/**
 * Single article detail page — dynamic via ?slug=..., like console-model.html.
 * Admin sees Edit/Delete buttons (reusing the same modal markup as articles.js).
 */
import { AuthModule } from '../modules/auth.js';
import { I18nModule } from '../modules/i18n.js?v=20260909';
import { API_BASE_URL } from '../config.js';
import { confirmModal } from '../utils/confirm-modal.js';

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

function formatDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const slug = new URLSearchParams(location.search).get('slug');
let article = null;

const loadingEl = document.getElementById('article-loading');
const notfoundEl = document.getElementById('article-notfound');
const viewEl = document.getElementById('article-view');

async function loadArticle() {
    if (!slug) { loadingEl.hidden = true; notfoundEl.hidden = false; return; }
    try {
        const res = await api('GET', `/articles/${encodeURIComponent(slug)}`);
        if (!res.success) { loadingEl.hidden = true; notfoundEl.hidden = false; return; }
        article = res.article;
        renderArticle();
    } catch (err) {
        console.error('Article load error:', err);
        loadingEl.hidden = true;
        notfoundEl.hidden = false;
    }
}

function renderArticle() {
    loadingEl.hidden = true;
    viewEl.hidden = false;

    document.getElementById('article-doc-title').textContent = `${article.title} — Console Notebook`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', article.excerpt || article.title);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', `${article.title} — Console Notebook`);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', article.excerpt || article.title);
    if (article.cover_image_url) document.querySelector('meta[property="og:image"]')?.setAttribute('content', article.cover_image_url);

    const cover = document.getElementById('article-cover');
    if (article.cover_image_url) {
        cover.src = article.cover_image_url;
        cover.alt = article.title;
        cover.hidden = false;
    }

    document.getElementById('article-title').textContent = article.title;
    document.getElementById('article-author').textContent = article.author_name;
    document.getElementById('article-date').textContent = formatDate(article.created_at);
    document.getElementById('article-views').textContent = `${article.views} ${I18nModule.t('articles_views_label') || 'views'}`;
    document.getElementById('article-content').innerHTML = article.content_html;

    if (isAdmin()) {
        document.getElementById('article-admin-actions').hidden = false;
        if (!article.published) {
            const badge = document.createElement('span');
            badge.className = 'article-view__draft-badge';
            badge.textContent = I18nModule.t('articles_draft_badge') || 'Draft';
            document.getElementById('article-title').after(badge);
        }
    }
}

loadArticle();

// ── Admin: edit/delete ──────────────────────────────────────────────
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
    titleInput.value = article.title;
    excerptInput.value = article.excerpt || '';
    contentInput.value = article.content_html;
    publishedInput.checked = article.published;
    coverImageKey = null;
    if (article.cover_image_url) {
        coverPreview.src = article.cover_image_url;
        coverPreview.hidden = false;
    } else {
        coverPreview.hidden = true;
    }
    coverStatus.textContent = '';
    overlay.hidden = false;
}
function closeModal() { overlay.hidden = true; }

document.getElementById('article-edit-btn').addEventListener('click', openModal);
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
        const body = {
            title: titleInput.value.trim(),
            excerpt: excerptInput.value.trim(),
            content_html: contentInput.value,
            published: publishedInput.checked,
        };
        if (coverImageKey) body.cover_image_key = coverImageKey;
        const res = await api('PUT', `/articles/${article.id}`, body);
        if (res.success) {
            article = res.article;
            if (article.slug !== slug) {
                window.location.href = `article.html?slug=${encodeURIComponent(article.slug)}`;
                return;
            }
            renderArticle();
            closeModal();
            showToast(I18nModule.t('articles_saved') || 'Article saved.', 'success');
        } else {
            showToast(res.error || I18nModule.t('articles_save_error') || 'Could not save article.', 'error');
        }
    } catch (err) {
        console.error('Article save failed:', err);
        showToast(I18nModule.t('articles_save_error') || 'Could not save article.', 'error');
    } finally {
        btn.disabled = false;
    }
});

document.getElementById('article-delete-btn').addEventListener('click', async () => {
    const ok = await confirmModal(I18nModule.t('articles_delete_confirm') || 'Delete this article? This cannot be undone.', { ok: I18nModule.t('articles_delete') || 'Delete' });
    if (!ok) return;
    try {
        const res = await api('DELETE', `/articles/${article.id}`);
        if (res.success) {
            window.location.href = 'articles.html';
        } else {
            showToast(res.error || I18nModule.t('articles_save_error') || 'Could not delete article.', 'error');
        }
    } catch (err) {
        console.error('Article delete failed:', err);
        showToast(I18nModule.t('articles_save_error') || 'Could not delete article.', 'error');
    }
});
