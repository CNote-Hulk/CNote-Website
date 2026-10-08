/**
 * Full-screen pinch-zoom / pan / drag-to-dismiss image viewer.
 *
 * One copy. The logic existed twice already - community.js's DM viewer and a trimmed copy inside
 * console-model.js for tutorial step photos - and My Space needed it on the console pages, which
 * would have made three. This is that trimmed version, lifted out: no reply/forward chrome, because
 * a photo of your own console has none.
 *
 * A plain fixed overlay rather than a <dialog>: edge-to-edge with no user-agent chrome to fight.
 *
 * Built with createElement rather than innerHTML — the URL and alt text can come from other users'
 * uploads, and a viewer is a poor place to discover an escaping mistake.
 */
import { I18nModule } from './i18n.js?v=20261005b';

export function openImageViewer(url, alt) {
    document.querySelector('.cn-img-viewer')?.remove();

    const viewer = document.createElement('div');
    viewer.className = 'cn-img-viewer';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cn-img-viewer__close';
    closeBtn.textContent = '✕';
    const label = I18nModule && typeof I18nModule.t === 'function' ? I18nModule.t('dm_close_viewer') : null;
    closeBtn.setAttribute('aria-label', label && label !== 'dm_close_viewer' ? label : 'Close');

    const stage = document.createElement('div');
    stage.className = 'cn-img-viewer__stage';

    const img = document.createElement('img');
    img.className = 'cn-img-viewer__img';
    img.src = url;
    img.alt = alt || '';
    img.draggable = false;

    stage.appendChild(img);
    viewer.appendChild(closeBtn);
    viewer.appendChild(stage);
    document.body.appendChild(viewer);

    const close = () => { document.removeEventListener('keydown', onKey); viewer.remove(); };
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    closeBtn.addEventListener('click', close);
    viewer.addEventListener('click', e => { if (e.target === viewer) close(); });

    let scale = 1, tx = 0, ty = 0, dragging = false, lastX = 0, lastY = 0, dismissDrag = 0;

    function applyTransform() { img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; }
    function clampPan() {
        const maxX = Math.max(0, (img.clientWidth * scale - stage.clientWidth) / 2);
        const maxY = Math.max(0, (img.clientHeight * scale - stage.clientHeight) / 2);
        tx = Math.min(maxX, Math.max(-maxX, tx));
        ty = Math.min(maxY, Math.max(-maxY, ty));
    }

    stage.addEventListener('wheel', e => {
        e.preventDefault();
        scale = Math.min(4, Math.max(1, scale - e.deltaY * 0.0015));
        if (scale === 1) { tx = 0; ty = 0; }
        clampPan();
        applyTransform();
    }, { passive: false });

    stage.addEventListener('dblclick', () => {
        scale = scale > 1 ? 1 : 2;
        tx = 0; ty = 0;
        applyTransform();
    });

    stage.addEventListener('pointerdown', e => {
        dragging = true; dismissDrag = 0;
        lastX = e.clientX; lastY = e.clientY;
        stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', e => {
        if (!dragging) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        if (scale > 1) {
            tx += dx; ty += dy;
            clampPan();
            applyTransform();
        } else if (dy > 0 || dismissDrag > 0) {
            // Only while unzoomed: dragging a zoomed-in photo is panning, not dismissing.
            dismissDrag += dy;
            viewer.style.opacity = String(Math.max(0.4, 1 - dismissDrag / 300));
            img.style.transform = `translateY(${dismissDrag}px)`;
        }
    });
    stage.addEventListener('pointerup', () => {
        dragging = false;
        if (scale === 1 && dismissDrag > 120) { close(); return; }
        if (scale === 1) { dismissDrag = 0; viewer.style.opacity = '1'; applyTransform(); }
    });

    return close;
}
