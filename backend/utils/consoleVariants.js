/* ─────────────────────────────────────────
   FILE: consoleVariants.js
   DESCRIPTION: The hardware lines of each console (2026-11-26): PS2 / PS2 Slim,
   PS4 / PS4 Slim / PS4 Pro, Xbox 360 / S / E... A collection says which one you
   own (user_owned_variants), on top of the console page (user_owned_consoles).

   Source: MODEL_DIRECTORY_GROUPS in frontend/js/data/console-models.js - the same
   console page -> console_models group mapping the Modding/Care directory and the
   app use - read from that file rather than copied, so there is one list.
   A variant key is "<console id>|<group>"; a console with no groups has only
   "<console id>" (its single, implicit line).
   ───────────────────────────────────────── */
const fs = require('fs');
const path = require('path');

let GROUPS = {};
try {
    const src = fs.readFileSync(path.join(__dirname, '../../frontend/js/data/console-models.js'), 'utf8');
    const m = src.match(/export const MODEL_DIRECTORY_GROUPS = (\{[\s\S]*?\});/);
    // eslint-disable-next-line no-new-func
    if (m) GROUPS = new Function(`return ${m[1]};`)();
} catch (err) {
    console.error('consoleVariants: could not read MODEL_DIRECTORY_GROUPS:', err.message);
}

const groupsOf = consoleId => GROUPS[consoleId] || [];

/** The key of a console's base line (the first group; the console itself if it has none). */
function baseVariant(consoleId) {
    const g = groupsOf(consoleId);
    return g.length ? `${consoleId}|${g[0]}` : consoleId;
}

/** Parses "<console>|<group>" / "<console>"; null when the console/group pair does not exist. */
function parseVariant(key) {
    const s = String(key || '').trim();
    const [consoleId, group] = s.split('|');
    if (!/^[a-z0-9-]{1,40}$/.test(consoleId || '')) return null;
    const g = groupsOf(consoleId);
    if (group === undefined) return g.length ? null : { consoleId, key: consoleId };
    return g.includes(group) ? { consoleId, group, key: `${consoleId}|${group}` } : null;
}

/** The variant key a console_models group name belongs to on a console page, if any. */
function variantOfGroup(consoleId, group) {
    return groupsOf(consoleId).includes(group) ? `${consoleId}|${group}` : null;
}

module.exports = { GROUPS, groupsOf, baseVariant, parseVariant, variantOfGroup };
