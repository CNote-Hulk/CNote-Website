/**
 * My Space — read-only, on the website.
 *
 * The app is the only editor, deliberately: My Space is a record of physical things you own, kept
 * while you are holding them. Here it is a page you look at, so nothing on it is clickable into an
 * edit state and no write endpoint is ever called.
 *
 * Whose space: `?u=<username>` shows that person's (the public profile links here), and without it
 * your own. The API takes a user id, so a username is resolved through the public profile first.
 *
 * Everything user-supplied — titles, names, photo URLs — is written with textContent and element
 * properties rather than innerHTML. This renders other people's content, which is exactly where a
 * single interpolated string becomes someone else's script.
 */
import { API_BASE_URL } from '../config.js';
import { I18nModule } from './i18n.js?v=20261005b';

const t = (key, fallback) => {
    const value = I18nModule && typeof I18nModule.t === 'function' ? I18nModule.t(key) : null;
    return value && value !== key ? value : fallback;
};

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function authHeaders() {
    const token = localStorage.getItem('cn_token');
    return token ? { Authorization: 'Bearer ' + token } : {};
}

async function getJson(url) {
    try {
        const res = await fetch(url, { headers: authHeaders(), credentials: 'include' });
        if (!res.ok) return null;
        return await res.json();
    } catch (err) {
        console.warn('My Space fetch failed:', url, err);
        return null;
    }
}

/** The person whose space this is: ?u=<username>, else whoever is signed in. */
async function resolveViewer() {
    const username = new URLSearchParams(window.location.search).get('u');
    if (!username) {
        return localStorage.getItem('cn_token') ? { userId: null, name: null, own: true } : null;
    }
    const profile = await getJson(`${API_BASE_URL}/users/${encodeURIComponent(username)}`);
    const user = profile && profile.user;
    if (!user) return null;
    return { userId: user.id, name: user.nickname || user.username, own: false };
}

function section(titleText) {
    const wrap = el('section', 'myspace-section');
    const container = el('div', 'container');
    container.appendChild(el('h2', 'myspace-title', titleText));
    wrap.appendChild(container);
    return { wrap, container };
}

function badges(space) {
    const row = el('div', 'myspace-badges');
    if (space.owned) row.appendChild(el('span', 'myspace-badge', t('myspace_owned', 'Owns it')));
    if (space.favourite) row.appendChild(el('span', 'myspace-badge', t('myspace_favourite', 'Favourite')));
    return row.childElementCount ? row : null;
}

function pills(codes) {
    if (!codes || !codes.length) return null;
    const block = el('div', 'myspace-block');
    block.appendChild(el('h3', 'myspace-subtitle', t('myspace_models', 'Hardware revisions')));
    const row = el('div', 'myspace-pills');
    codes.forEach(code => row.appendChild(el('span', 'myspace-pill', code)));
    block.appendChild(row);
    return block;
}

function photos(list) {
    if (!list || !list.length) return null;
    const block = el('div', 'myspace-block');
    block.appendChild(el('h3', 'myspace-subtitle', t('myspace_photos', 'Photos')));
    const grid = el('div', 'myspace-photos');
    list.forEach(photo => {
        if (!photo || !photo.url) return;
        const img = el('img', 'myspace-photo');
        img.src = photo.url;
        img.loading = 'lazy';
        img.alt = '';
        grid.appendChild(img);
    });
    block.appendChild(grid);
    return block;
}

function games(list) {
    if (!list || !list.length) return null;
    const block = el('div', 'myspace-block');
    const head = el('div', 'myspace-block-head');
    head.appendChild(el('h3', 'myspace-subtitle', t('myspace_games', 'Games collection')));
    head.appendChild(el('span', 'myspace-count',
        t('myspace_games_count', '{n} games').replace('{n}', String(list.length))));
    block.appendChild(head);

    const shelf = el('div', 'myspace-shelf');
    list.slice().sort((a, b) => String(a.title).localeCompare(String(b.title))).forEach(game => {
        const card = el('article', 'myspace-game');
        if (game.coverUrl) {
            const img = el('img', 'myspace-cover');
            img.src = game.coverUrl;
            img.loading = 'lazy';
            img.alt = game.title || '';
            card.appendChild(img);
        } else {
            // No scan for this release. A plain plate with the title on it, rather than a blank
            // frame or a stand-in cover that would be a picture of nothing.
            const plate = el('div', 'myspace-cover myspace-cover-blank');
            plate.appendChild(el('span', null, game.title || ''));
            card.appendChild(plate);
        }
        card.appendChild(el('p', 'myspace-game-title', game.title || ''));
        if (game.releaseYear) card.appendChild(el('p', 'myspace-game-year', String(game.releaseYear)));
        shelf.appendChild(card);
    });
    block.appendChild(shelf);
    return block;
}

export const MySpaceModule = {
    async render(consoleId) {
        document.querySelectorAll('.myspace-section').forEach(node => node.remove());

        const anchor = document.querySelector('.specs-section');
        if (!anchor || !consoleId) return;

        const viewer = await resolveViewer();
        if (!viewer) {
            // Signed out and no ?u= — there is no space to show, so say which it is rather than
            // rendering an empty one that looks like the data failed to load.
            const { wrap, container } = section(t('myspace_title', 'MY SPACE'));
            container.appendChild(el('p', 'myspace-note',
                t('myspace_sign_in', 'Sign in to see your own space for this console.')));
            anchor.insertAdjacentElement('afterend', wrap);
            return;
        }

        const query = viewer.userId ? `?userId=${encodeURIComponent(viewer.userId)}` : '';
        const [spaceRes, gamesRes] = await Promise.all([
            getJson(`${API_BASE_URL}/my-space/${encodeURIComponent(consoleId)}${query}`),
            getJson(`${API_BASE_URL}/games/${encodeURIComponent(consoleId)}/mine${query}`),
        ]);

        const space = spaceRes && spaceRes.success ? spaceRes : { modelCodes: [], photos: [] };
        const shelf = gamesRes && gamesRes.success ? gamesRes.games : [];

        const heading = viewer.own
            ? t('myspace_title', 'MY SPACE')
            : t('myspace_title_other', "{name}'s space").replace('{name}', viewer.name || '');
        const { wrap, container } = section(heading);

        const parts = [badges(space), pills(space.modelCodes), photos(space.photos), games(shelf)]
            .filter(Boolean);

        if (!parts.length) {
            container.appendChild(el('p', 'myspace-note', t('myspace_empty', 'Nothing here yet.')));
        } else {
            parts.forEach(part => container.appendChild(part));
            if (viewer.own) {
                container.appendChild(el('p', 'myspace-note',
                    t('myspace_app_only', 'My Space is edited in the Console Notebook app.')));
            }
        }
        anchor.insertAdjacentElement('afterend', wrap);
    },
};
