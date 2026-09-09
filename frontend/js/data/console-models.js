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
// Every retail (CEX) PS3 system-software version ever released, per PS3
// Developer Wiki — replaces the earlier rough brackets ('3.55', '3.56–4.80',
// etc.) with the real, complete list (2026-09-09): a visitor picking a
// firmware version for the modding-guide selector knows their console's
// EXACT current version from the XMB, never "a bracket", so the granular
// list is strictly more useful, not just more complete. "-1"/"-2"/"-patch"
// suffixes are kept exactly as the source lists them (a patch release can
// behave differently for an exploit than the version it patched).
const PS3_ALL_FIRMWARE_VERSIONS = [
    '1.00', '1.02', '1.10', '1.11', '1.30', '1.31', '1.32', '1.50', '1.51', '1.54', '1.55',
    '1.60', '1.70', '1.80', '1.81', '1.82', '1.90', '1.91', '1.92', '1.93', '1.94', '1.97',
    '2.00', '2.01', '2.10', '2.16', '2.17', '2.20', '2.30', '2.35', '2.36', '2.40', '2.41',
    '2.42', '2.43', '2.45', '2.50', '2.52', '2.53', '2.60', '2.70', '2.75', '2.76', '2.80',
    '3.00', '3.01', '3.10', '3.15', '3.16', '3.20', '3.21', '3.30', '3.40',
    '3.41-1', '3.41-patch', '3.41-2', '3.42', '3.42-patch', '3.50', '3.55', '3.55-patch',
    '3.56-1', '3.56-2', '3.60', '3.61', '3.65', '3.66', '3.70', '3.71', '3.72', '3.72-patch',
    '3.73', '3.73-patch', '3.74',
    '4.00', '4.01', '4.10', '4.11', '4.15', '4.20', '4.21', '4.21-patch', '4.22', '4.25',
    '4.25-patch', '4.30', '4.30-patch', '4.31', '4.31-patch', '4.40', '4.40-patch', '4.41',
    '4.41-patch', '4.45', '4.45-patch', '4.46', '4.50', '4.50-patch', '4.53', '4.53-patch',
    '4.55', '4.55-patch', '4.60', '4.60-patch', '4.65', '4.65-patch', '4.66', '4.66-patch',
    '4.70', '4.70-patch', '4.70 SPECIAL', '4.75', '4.75-patch', '4.76', '4.76-patch', '4.78',
    '4.78-patch', '4.80', '4.80-patch', '4.81', '4.81-patch', '4.82', '4.82-patch', '4.83',
    '4.83-patch', '4.84', '4.84-patch', '4.85', '4.85-patch', '4.86', '4.86-patch', '4.87',
    '4.88', '4.89', '4.90', '4.91', '4.92', '4.93',
];

export const MOD_OPTIONS = {
    'PS3': { flashTypes: ['NAND', 'NOR'], firmwareVersions: PS3_ALL_FIRMWARE_VERSIONS },
    'PS3 Slim': { flashTypes: ['NOR'], firmwareVersions: PS3_ALL_FIRMWARE_VERSIONS },
    'PS3 Super Slim': { flashTypes: ['NOR'], firmwareVersions: PS3_ALL_FIRMWARE_VERSIONS },
    // Xbox 360 S's "1439" is one model code covering TWO real motherboards
    // (Trinity/Corona — see the date-code split on that model's own page),
    // unlike PS3 where flashTypesForModel() can always narrow to one real
    // value from the code alone. There's no way to tell which one a given
    // unit has without checking ITS OWN manufacture date, so this genuinely
    // stays a 2-option picker rather than collapsing to static text — the
    // renderSelectors() single-option-becomes-text logic only fires when
    // there's truly one answer, and here there isn't. Dashboard/kernel
    // version bracket is a real, verifiable Xbox 360 milestone (2.0.14699
    // is the last dashboard RGH1 could use), not narrowed further since no
    // personally-tested Xbox write-up exists yet to know if it even matters
    // for S consoles specifically (which never support RGH1 in the first
    // place — only RGH1.2/2/3/S-RGH, all installed the same way).
    'Xbox 360 S': { flashTypes: ['Trinity', 'Corona'], firmwareVersions: ['2.0.14699 or lower', 'Above 2.0.14699'] },
    // Real per-board recommended-method chart from ConsoleMods Wiki
    // (consolemods.org/wiki/Xbox_360:RGH, fetched 2026-09-09 — blocked by a
    // Cloudflare challenge on the first attempt, passed on retry). The
    // firmwareVersions buckets reuse the same 2.0.14699 threshold as
    // 'Xbox 360 S' above since it's the same real dashboard/kernel milestone
    // (RGH1/JTAG's ceiling) — narrowed per board in flashTypesForModel().
    'Xbox 360': { flashTypes: ['JTAG', 'EXT_CLK', 'RGH1.2', 'RGH3'], firmwareVersions: ['2.0.14699 or lower', 'Above 2.0.14699'] },
    // Original Xbox: TSOP Flash works in-circuit on every board EXCEPT v1.6
    // (different flash chip, can't be reflashed the same way — needs a full
    // modchip or the more advanced "hotswap" softmod instead). Softmod (a
    // save-game exploit, e.g. 007: Agent Under Fire) and Modchip both work on
    // every revision including v1.6. Source: ConsoleMods Wiki TSOP Flashing
    // page + community consensus (quade.co TSOP guide), fetched 2026-09-09.
    'Xbox (original)': { flashTypes: ['Softmod', 'Modchip', 'TSOP Flash'], firmwareVersions: ['Any'] },
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

// Xbox 360 "fat" boards, per the ConsoleMods Wiki recommended-method chart:
// Xenon/Zephyr/Elpis share a Waternoose CPU that's unstable under RGH1.2's
// PLL-bypass glitching, so EXT_CLK is their only modern method (JTAG still
// works on old dashboards, same as every other fat board here). Tonasket is
// the one board that's NEVER JTAG-exploitable, patched from the factory
// regardless of dashboard — everything else (Falcon/Opus/Jasper) gets
// JTAG-or-RGH1.2-or-RGH3, though Jasper's JTAG viability specifically can't
// be trusted from dashboard version alone (see its date_codes/note — some
// units shipped with an already-patched CB even under 2.0.14699).
const XBOX360_EXT_CLK_ONLY_BOARDS = ['Xenon', 'Zephyr', 'Elpis'];
const XBOX360_NEVER_JTAG_BOARDS = ['Tonasket'];
// v1.6 is the one original-Xbox board without an in-circuit-flashable TSOP
// (different flash chip) — modchip and softmod both still work on it.
const XBOX_NO_TSOP_CODES = ['v1.6'];

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
    if (consoleName === 'Xbox 360') {
        if (XBOX360_NEVER_JTAG_BOARDS.includes(code)) return ['RGH1.2', 'RGH3'];
        if (XBOX360_EXT_CLK_ONLY_BOARDS.includes(code)) return ['JTAG', 'EXT_CLK'];
        return ['JTAG', 'RGH1.2', 'RGH3']; // Falcon, Opus, Jasper
    }
    if (consoleName === 'Xbox (original)') {
        return XBOX_NO_TSOP_CODES.includes(code) ? ['Softmod', 'Modchip'] : fallback;
    }
    return fallback;
}

// Maps an Evolution console page's id (consoles_translations.id — e.g. "playstation-3") to the
// exact set of console_models.console group names that belong to it (e.g. "PS3"/"PS3 Slim"/
// "PS3 Super Slim") — powers the "Fun facts" button on console-detail.js's history section,
// which deep-links into console-modding.html pre-filtered to just this console's hardware
// models. The two naming schemes were curated independently (this file's own MODELS migration
// vs. each console's own `models: [{name, year}]` field) and don't always match textually
// (e.g. Evolution's "PS3 Fat" vs. the directory's plain "PS3"), so this is an explicit table,
// not a derived transform — verified 2026-09-08 against every console_models.console value
// that actually exists (see GET /api/console-models). A console with no entry here (everything
// outside Xbox/PlayStation/Nintendo — the only 3 manufacturers with any hardware-model
// directory content at all) simply doesn't get the button; initConsoleFunFactsButton() below
// checks for that.
export const MODEL_DIRECTORY_GROUPS = {
    // PlayStation
    'playstation-1': ['PS1', 'PSone'],
    'playstation-2': ['PS2', 'PS2 Slim'],
    'playstation-3': ['PS3', 'PS3 Slim', 'PS3 Super Slim'],
    'playstation-4': ['PS4', 'PS4 Slim', 'PS4 Pro'],
    'playstation-5': ['PS5', 'PS5 Slim', 'PS5 Pro'],
    'psp': ['PSP'],
    'ps-vita': ['PS Vita', 'PS Vita Slim'],
    // Xbox
    'xbox': ['Xbox (original)'],
    'xbox-360': ['Xbox 360', 'Xbox 360 S', 'Xbox 360 E'],
    'xbox-one': ['Xbox One', 'Xbox One S', 'Xbox One X'],
    'xbox-series-x': ['Xbox Series X'],
    'xbox-series-s': ['Xbox Series S'],
    // Nintendo
    'famicom': ['Famicom'],
    'nes': ['NES'],
    'snes': ['Super Famicom', 'SNES'],
    'nintendo-64': ['Nintendo 64'],
    'nintendo-gamecube': ['GameCube'],
    'nintendo-wii': ['Wii', 'Wii Mini'],
    'nintendo-wii-u': ['Wii U'],
    'nintendo-switch': ['Switch', 'Switch Lite', 'Switch OLED'],
    'nintendo-switch-2': ['Switch 2'],
    'game-boy': ['Game Boy', 'Game Boy Pocket', 'Game Boy Light'],
    'game-boy-color': ['Game Boy Color'],
    'game-boy-advance': ['Game Boy Advance', 'Game Boy Advance SP', 'Game Boy Micro'],
    'nintendo-ds': ['Nintendo DS', 'Nintendo DS Lite', 'Nintendo DSi', 'Nintendo DSi XL'],
    'nintendo-3ds': ['Nintendo 3DS', 'Nintendo 3DS XL', 'Nintendo 2DS', 'New Nintendo 3DS', 'New Nintendo 3DS XL', 'New Nintendo 2DS XL'],
};

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
