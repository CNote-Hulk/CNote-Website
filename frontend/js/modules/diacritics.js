/**
 * Diacritics Module
 * Normalizes common Romanian words without diacritics in static and dynamic DOM content.
 */

const REPLACEMENTS = [
    [/\bAcasa\b/g, 'Acasă'],
    [/\bacasa\b/g, 'acasă'],
    [/\bInvata\b/g, 'Învață'],
    [/\binvata\b/g, 'învață'],
    [/\bComparatie\b/g, 'Comparație'],
    [/\bcomparatie\b/g, 'comparație'],
    [/\bSpecificatii\b/g, 'Specificații'],
    [/\bspecificatii\b/g, 'specificații'],
    [/\bInapoi\b/g, 'Înapoi'],
    [/\binapoi\b/g, 'înapoi'],
    [/\bIncarca\b/g, 'Încarcă'],
    [/\bincarca\b/g, 'încarcă'],
    [/\bInformatica\b/g, 'Informatică'],
    [/\binformatica\b/g, 'informatică'],
    [/\bFolositi\b/g, 'Folosiți'],
    [/\bfolositi\b/g, 'folosiți'],
    [/\bLEGATURA\b/g, 'LEGĂTURA'],
    [/\bLegatura\b/g, 'Legătura'],
    [/\bFIZICA-INFORMATICA\b/g, 'FIZICĂ-INFORMATICĂ'],
    [/\bSi\b/g, 'Și'],
    [/\bsi\b/g, 'și']
];

const ATTRIBUTE_NAMES = ['placeholder', 'title', 'aria-label', 'content'];

// These replacements are Romanian-only ("si" -> "și"). They used to run on every page in every language, which
// rewrote ordinary words in Italian ("si"), Spanish and French ("si") into Romanian ones - lesson 22 showed ~24
// wrong "și" in Italian (found 2026-10-28). Mirrors I18nModule.getStoredLang(): no stored language means English.
function isRomanian() {
    try { return localStorage.getItem('cnote_lang') === 'ro'; } catch { return false; }
}

function normalizeText(text) {
    if (!isRomanian()) return text;
    let normalized = text;

    REPLACEMENTS.forEach(([pattern, replacement]) => {
        normalized = normalized.replace(pattern, replacement);
    });

    return normalized;
}

function normalizeElementAttributes(element) {
    ATTRIBUTE_NAMES.forEach((attribute) => {
        const value = element.getAttribute(attribute);
        if (!value) return;

        const normalized = normalizeText(value);
        if (normalized !== value) {
            element.setAttribute(attribute, normalized);
        }
    });
}

function normalizeNode(node) {
    if (!node) return;

    if (node.nodeType === Node.TEXT_NODE) {
        const parentTag = node.parentElement?.tagName;
        if (parentTag === 'SCRIPT' || parentTag === 'STYLE' || parentTag === 'NOSCRIPT') return;

        const original = node.nodeValue;
        const normalized = normalizeText(original || '');
        if (normalized !== original) {
            node.nodeValue = normalized;
        }
        return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    normalizeElementAttributes(node);

    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
        normalizeNode(current);
        current = walker.nextNode();
    }

    const elements = node.querySelectorAll('*');
    elements.forEach(normalizeElementAttributes);
}

export const DiacriticsModule = {
    init() {
        if (window.__DIACRITICS_NORMALIZED__) return;
        window.__DIACRITICS_NORMALIZED__ = true;

        normalizeNode(document.body);

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((addedNode) => {
                    normalizeNode(addedNode);
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
};
