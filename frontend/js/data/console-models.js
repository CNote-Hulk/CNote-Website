// Console Notebook — hardware model/revision reference data.
// Shared by console-care.js (directory) and console-model.js (per-model detail page).
//
// MODELS used to be a static array here (209 entries, compiled from web
// research across PSDevWiki/ConsoleMods/Wikipedia/xboxdevwiki/Free60/Xbox One
// Research Wiki/3dbrew/Nintendo Life). Moved to Postgres (2026-09-06, Phase 3
// of the site-wide admin-editing task — see backend/routes/console-models.js)
// so admins can add a new model and edit an existing one's
// manufacturer/console/code/note directly from the site instead of editing
// this file and redeploying. All 209 original entries were migrated as-is
// (same order, same wording) — nothing was lost, just relocated.

// Static "what's pickable" option lists for the Modding Guide flash-type /
// firmware-version selector on console-model.html, keyed by the `console`
// field a model (loaded via loadModels() below) carries. This is NOT
// compatibility data (no claim that a given combination works) — it's just
// the menu of options a visitor can choose from before a real write-up
// exists for most of them, so the selector is visible and useful from the
// very first visit to a model page, not only once an admin has written
// something. Firmware bracket labels match the ones the site owner specified
// directly (not third-party research). A model whose `console` isn't listed
// here falls back to the old behaviour: the selector stays hidden until at
// least one real (flash_type, firmware_version) write-up exists for it.
export const MOD_OPTIONS = {
    'PS3': { flashTypes: ['NAND', 'NOR'], firmwareVersions: ['3.55', '3.56–4.80', '4.81–4.89', '4.90', '4.91', '4.92', '4.93'] },
    'PS3 Slim': { flashTypes: ['NOR'], firmwareVersions: ['3.55', '3.56–4.80', '4.81–4.89', '4.90', '4.91', '4.92', '4.93'] },
    'PS3 Super Slim': { flashTypes: ['NOR'], firmwareVersions: ['3.55', '3.56–4.80', '4.81–4.89', '4.90', '4.91', '4.92', '4.93'] },
};

// A PS3 board only ever has ONE flash chip — the 'PS3'/'PS3 Super Slim' entries above list
// every type that line EVER shipped with, not a per-board choice, so the generic menu let a
// visitor "pick" NAND on a board that was always NOR (or vice versa). Real hardware split, per
// PS3 Developer Wiki (Hardware flashing / SKU Models — psdevwiki.com, fetched via search since
// the wiki itself blocks automated fetches, same as the console-mod-tutorial research notes
// elsewhere in this repo): 'PS3' (Fat) — CECHA/B/C/E/G shipped 2x interleaved NAND chips (the
// "Starship2" controller generation), CECHH/J/K/L/M/P/Q switched to a single NOR chip;
// 'PS3 Slim' (CECH-2000–3000 series) is uniformly NOR; 'PS3 Super Slim' is uniformly NOR EXCEPT
// the 12GB, no-internal-HDD variants (CECH-4000A/4001A — the DB's own note text for both says
// "12GB flash", corroborating this) which use eMMC instead. Added 2026-09-08.
const PS3_FAT_NAND_CODES = ['CECHA', 'CECHB', 'CECHC', 'CECHE', 'CECHG'];
const PS3_SUPER_SLIM_EMMC_CODES = ['CECH-4000A', 'CECH-4001A'];

/**
 * Narrows MOD_OPTIONS[consoleName].flashTypes down to the one real type a specific PS3 board
 * code actually has, where that's known. Any other console (or an unrecognized PS3 code, e.g.
 * a newly admin-added one) falls back to the unnarrowed per-line menu — same graceful-degrade
 * default as before this function existed.
 */
export function flashTypesForModel(consoleName, code) {
    const fallback = MOD_OPTIONS[consoleName]?.flashTypes || [];
    if (consoleName === 'PS3') {
        return PS3_FAT_NAND_CODES.includes(code) ? ['NAND'] : fallback.includes('NOR') ? ['NOR'] : fallback;
    }
    if (consoleName === 'PS3 Super Slim') {
        return PS3_SUPER_SLIM_EMMC_CODES.includes(code) ? ['eMMC'] : fallback;
    }
    return fallback;
}

// Same bare-relative-path fetch convention as the sibling data-loader.js in
// this same directory (no API_BASE_URL import — that module doesn't use it
// either, since neither has ever needed the frontend-hosted-separately
// override that config.js exists for).
let _cache = null;
let _loading = null;

/**
 * Load all hardware models from the API. Cached after the first successful
 * call — call invalidateModelsCache() after an admin add/edit to force a
 * fresh fetch (mirrors data-loader.js's loadConsoles()/invalidateCache()).
 */
export async function loadModels() {
    if (_cache) return _cache;
    if (_loading) return _loading;

    _loading = (async () => {
        try {
            const res = await fetch('/api/console-models');
            if (res.ok) {
                const data = await res.json();
                if (data.success && Array.isArray(data.models)) {
                    _cache = data.models;
                    return _cache;
                }
            }
        } catch { /* fall through */ }
        console.warn('Could not load console models from the API.');
        _cache = [];
        return _cache;
    })();

    const result = await _loading;
    _loading = null;
    return result;
}

export function invalidateModelsCache() {
    _cache = null;
    _loading = null;
}
