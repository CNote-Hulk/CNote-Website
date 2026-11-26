/* ─────────────────────────────────────────
   FILE: igdb.js
   DESCRIPTION: Minimal IGDB client for runtime use (2026-11-26): an app access
   token from Twitch, cached until shortly before it expires, and one POST helper.
   Needs IGDB_CLIENT_ID / IGDB_CLIENT_SECRET in the environment; `configured()`
   says whether they are there, so a route can answer 503 instead of failing.
   (The offline cover scripts in scripts/ keep their own copies on purpose: they
   run once from a laptop, this runs in the server.)
   ───────────────────────────────────────── */
let token = null;
let expiresAt = 0;

const configured = () => !!(process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET);

async function getToken() {
    if (token && Date.now() < expiresAt) return token;
    const r = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(process.env.IGDB_CLIENT_ID)}`
        + `&client_secret=${encodeURIComponent(process.env.IGDB_CLIENT_SECRET)}&grant_type=client_credentials`, { method: 'POST' });
    if (!r.ok) throw new Error(`IGDB token ${r.status}`);
    const j = await r.json();
    token = j.access_token;
    expiresAt = Date.now() + Math.max(60, (j.expires_in || 3600) - 300) * 1000;
    return token;
}

async function igdb(endpoint, body) {
    const t = await getToken();
    const r = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
        method: 'POST',
        headers: { 'Client-ID': process.env.IGDB_CLIENT_ID, Authorization: `Bearer ${t}`, 'Content-Type': 'text/plain' },
        body,
    });
    if (r.status === 401) { token = null; }
    if (!r.ok) throw new Error(`IGDB ${endpoint} ${r.status}`);
    return r.json();
}

/** An IGDB image URL; ids are validated by the caller (letters/digits only). */
const imageUrl = (imageId, size = 't_1080p') => `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg`;
const IMAGE_ID = /^[a-z0-9]{2,40}$/;

module.exports = { configured, igdb, imageUrl, IMAGE_ID };
