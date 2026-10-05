const CONSENT_KEY = 'cn_cookie_consent';

function loadGA() {
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=G-Q07J9XCMJP';
  document.head.appendChild(script);
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', 'G-Q07J9XCMJP');
}

function loadYouTubeEmbeds() {
  document.querySelectorAll('.yt-placeholder').forEach(placeholder => {
    const videoId = placeholder.dataset.videoId;
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed/${videoId}?rel=0`;
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.classList.add('yt-iframe');
    iframe.dataset.videoId = videoId;
    iframe.addEventListener('error', () => showYtFallback(iframe, videoId));
    placeholder.replaceWith(iframe);
  });
}

function showYtFallback(placeholder, videoId) {
  const fallback = document.createElement('div');
  fallback.className = 'yt-fallback';
  // SAFE: SVG and static text are hardcoded literals.
  // videoId comes from placeholder.dataset.videoId (authored HTML attribute, not user input).
  // It is validated to be a YouTube-safe alphanumeric ID before interpolation, and is
  // only placed inside an href value — not as raw HTML — so tag-injection is not possible.
  // Extra guard: strip anything that isn't a standard YouTube video ID character (A-Z a-z 0-9 - _).
  const safeVideoId = String(videoId).replace(/[^A-Za-z0-9_-]/g, '');
  fallback.innerHTML = `
    <svg width="48" height="48" viewBox="0 0 24 24" opacity="0.4" fill="currentColor" shape-rendering="crispEdges"><path d="M4 2h16v2H4zm0 18h16v2H4zM20 4h2v16h-2zM2 4h2v16H2zm9 2h2v8h-2zm0 10h2v2h-2z"/></svg>
    <p>Videoclipul nu poate fi afișat direct.</p>
    <a href="https://www.youtube.com/watch?v=${safeVideoId}" target="_blank" rel="noopener noreferrer" class="yt-fallback__link">Vizionează pe YouTube →</a>
  `;
  placeholder.replaceWith(fallback);
}

function getStoredConsent() {
  try {
    return JSON.parse(localStorage.getItem(CONSENT_KEY));
  } catch (e) {
    return null;
  }
}

function hideModal() {
  const overlay = document.getElementById('cookie-overlay');
  if (overlay) overlay.remove();
}

function acceptAll() {
  localStorage.setItem(CONSENT_KEY, JSON.stringify({ necessary: true, analytics: true }));
  hideModal();
  loadGA();
  loadYouTubeEmbeds();
}

function decline() {
  localStorage.setItem(CONSENT_KEY, JSON.stringify({ necessary: true, analytics: false }));
  hideModal();
}

function initConsent() {
  const consent = getStoredConsent();
  if (consent && consent.analytics) { loadGA(); loadYouTubeEmbeds(); return; }
  if (consent && consent.necessary) return;

  const overlay = document.createElement('div');
  overlay.id = 'cookie-overlay';

  const modal = document.createElement('div');
  modal.id = 'cookie-modal';
  // SAFE: hardcoded only — no user data or external input flows into this string.
  modal.innerHTML = `
    <span class="cookie-modal-icon">🍪</span>
    <p class="cookie-modal-title">Preferințe cookies</p>
    <p class="cookie-modal-body">Folosim cookies pentru analytics (Google Analytics) și videoclipuri (YouTube). Cookies esențiale sunt întotdeauna active.</p>
    <div class="cookie-modal-actions">
      <button class="cookie-btn-accept" type="button">Accept All</button>
      <button class="cookie-btn-essential" type="button">Decline</button>
    </div>
  `;

  modal.querySelector('.cookie-btn-accept').addEventListener('click', acceptAll);
  modal.querySelector('.cookie-btn-essential').addEventListener('click', decline);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

document.addEventListener('DOMContentLoaded', initConsent);
