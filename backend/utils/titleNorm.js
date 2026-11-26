/* ─────────────────────────────────────────
   FILE: titleNorm.js
   DESCRIPTION: Normalized game title, for matching the same game across sources
   (IGDB names vs TheGamesDB titles): lower case, no accents/punctuation, "&" as
   "and", no articles, roman numerals as digits. Same rules as the catalogue
   scripts (scripts/seed-releases-tgdb.js's norm).
   ───────────────────────────────────────── */
const ROMAN = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
const unescape = s => String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const titleNorm = s => unescape(s).toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ').map(w => ROMAN[w] || w).join(' ');
module.exports = { titleNorm };
