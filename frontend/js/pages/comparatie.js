/**
 * Comparatie — ES Module
 * Loads console data from the API (language-aware) and renders the comparison UI.
 * Navigation / hamburger is handled by NavigationModule (main.js).
 */

import { loadConsoles } from '../data/data-loader.js';
import { I18nModule }   from '../modules/i18n.js?v=20260909f';

const selectA = document.getElementById('console-a-select');
const selectB = document.getElementById('console-b-select');
const display = document.getElementById('comparison-display');

if (!selectA || !selectB || !display) throw new Error('Comparatie: required elements not found');

let consolesData = null;

// ── Generation label ──────────────────────────────────────────────────────────
const GEN_YEARS = { 9:'2020–Prezent', 8:'2012–2020', 7:'2005–2013', 6:'1998–2006', 5:'1994–2001', 4:'1987–1996', 3:'1985–1990', 2:'1980–1984', 1:'1972–1980' };

function genLabel(gen) {
    const prefix = I18nModule.t('console_generation_prefix');
    return prefix + ' ' + gen + (GEN_YEARS[gen] ? ' (' + GEN_YEARS[gen] + ')' : '');
}

// ── Spec help-icon tooltip definitions ─────────────────────────────────────
const SPEC_TIPS = {
    spec_label_architecture:    'The processor design family — defines supported instructions, efficiency, and performance generation (e.g. Zen 2, RDNA 2).',
    spec_label_process:         'Manufacturing node in nanometres (nm). Smaller = more transistors in less space = faster and more power-efficient chip.',
    spec_label_cores:           'Number of independent processing threads. More cores allow the system to run more tasks simultaneously.',
    spec_label_clock:           'Operating frequency in GHz (billions of cycles per second). Higher frequency means instructions are processed faster.',
    spec_label_tdp:             'Thermal Design Power in Watts — how much heat the chip produces at maximum load. Also reflects total power draw.',
    spec_label_units:           'Compute Units or Shader Processors inside the GPU. More units = more parallel graphics calculations = better visual performance.',
    spec_label_tflops:          'Trillion Floating-Point Operations Per Second — a measure of raw GPU compute power. Higher = faster 3D rendering.',
    spec_label_capabilities:    'Extra hardware features and technologies supported by this chip.',
    spec_label_type:            'Memory or storage technology standard. e.g. GDDR6 = fast video RAM; NVMe SSD = solid-state drive with fast PCIe interface.',
    spec_label_capacity:        'Total amount in Gigabytes (GB). More memory allows the system to hold larger game worlds and assets without slowdowns.',
    spec_label_bus:             'Width of the memory data channel in bits. A wider bus transfers more data per clock cycle.',
    spec_label_bandwidth:       'Speed at which data moves between the CPU/GPU and memory, in GB/s. Higher bandwidth reduces bottlenecks.',
    spec_label_interface:       'How the storage device connects to the system. PCIe 4.0/5.0 is significantly faster than SATA III.',
    spec_label_speed:           'Sequential read/write throughput in GB/s. Directly affects load times and asset streaming speed.',
    spec_label_resolution:      'Number of pixels displayed (e.g. 4K = 3840×2160). More pixels = sharper, more detailed image.',
    spec_label_refresh:         'How many times per second the screen redraws the image (Hz). 60 Hz is smooth; 120 Hz is very smooth motion.',
    spec_label_hdr:             'High Dynamic Range — a wider range of brightness and colour for more realistic, vivid visuals.',
    spec_label_upscaling:       'Technology that renders at a lower resolution and intelligently scales up to the target resolution, saving GPU power.',
    spec_label_backwards_compat:'Ability to run games designed for older, previous-generation consoles.',
    spec_label_width:           'The left-to-right measurement of the console (in millimetres).',
    spec_label_height:          'The top-to-bottom measurement of the console (in millimetres).',
    spec_label_depth:           'The front-to-back measurement of the console (in millimetres).',
};

const FIXED_TIPS = {
    'Ray Tracing': 'Simulates how light physically bounces off surfaces in real time — produces realistic reflections, shadows, and global illumination.',
    'VRR':         'Variable Refresh Rate — the display dynamically syncs its refresh rate to the GPU\'s output, eliminating screen tearing and stutter.',
};

const HELP_SVG = `<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="8" cy="5.5" r="1"/><rect x="7.25" y="7.5" width="1.5" height="4" rx="0.75"/></svg>`;

function tipLabel(label, tipKey) {
    const tip = SPEC_TIPS[tipKey];
    if (!tip) return label;
    return label + `<button class="spec-help" type="button" aria-label="${tip}">${HELP_SVG}<span class="spec-tooltip">${tip}</span></button>`;
}

function fixedTip(label) {
    const tip = FIXED_TIPS[label];
    if (!tip) return label;
    return label + `<button class="spec-help" type="button" aria-label="${tip}">${HELP_SVG}<span class="spec-tooltip">${tip}</span></button>`;
}

let _tooltipsListenerAdded = false;
function resetTooltipStyle(tip) {
    if (!tip) return;
    tip.style.left = '';
    tip.style.transform = '';
    tip.style.removeProperty('--arrow-left');
    tip.style.removeProperty('--arrow-transform');
}

function initSpecTooltips() {
    display.querySelectorAll('.spec-help').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const wasOpen = btn.classList.contains('is-open');
            document.querySelectorAll('.spec-help.is-open').forEach(b => {
                b.classList.remove('is-open');
                resetTooltipStyle(b.querySelector('.spec-tooltip'));
            });
            if (!wasOpen) {
                btn.classList.add('is-open');
                const tip = btn.querySelector('.spec-tooltip');
                if (tip) {
                    resetTooltipStyle(tip);
                    const rect = tip.getBoundingClientRect();
                    const vw = window.innerWidth;
                    const MARGIN = 10;
                    if (rect.left < MARGIN) {
                        const shift = MARGIN - rect.left;
                        tip.style.left = `calc(50% + ${shift}px)`;
                        const btnRect = btn.getBoundingClientRect();
                        const tipRect = tip.getBoundingClientRect();
                        const arrowLeft = btnRect.left + btnRect.width / 2 - tipRect.left;
                        tip.style.setProperty('--arrow-left', `${arrowLeft}px`);
                        tip.style.setProperty('--arrow-transform', 'none');
                    } else if (rect.right > vw - MARGIN) {
                        const shift = rect.right - (vw - MARGIN);
                        tip.style.left = `calc(50% - ${shift}px)`;
                        const btnRect = btn.getBoundingClientRect();
                        const tipRect = tip.getBoundingClientRect();
                        const arrowLeft = btnRect.left + btnRect.width / 2 - tipRect.left;
                        tip.style.setProperty('--arrow-left', `${arrowLeft}px`);
                        tip.style.setProperty('--arrow-transform', 'none');
                    }
                }
            }
        });
    });
    if (!_tooltipsListenerAdded) {
        _tooltipsListenerAdded = true;
        document.addEventListener('click', () => {
            document.querySelectorAll('.spec-help.is-open').forEach(b => {
                b.classList.remove('is-open');
                resetTooltipStyle(b.querySelector('.spec-tooltip'));
            });
        });
    }
}

// ── Spec sections (field labels are universal technical terms) ─────────────────
function buildSpecSections() {
    return [
        { key: 'cpu',        labelKey: 'spec_cpu_title',     fields: [
            { key: 'architecture', label: 'Architecture',    tipKey: 'spec_label_architecture' },
            { key: 'proces_nm',    label: 'Process (nm)',    tipKey: 'spec_label_process' },
            { key: 'cores',        label: 'Cores/Threads',  tipKey: 'spec_label_cores' },
            { key: 'frequency',    label: 'Clock Speed',    tipKey: 'spec_label_clock' },
            { key: 'tdp',          label: 'TDP',            tipKey: 'spec_label_tdp' }
        ]},
        { key: 'gpu',        labelKey: 'spec_gpu_title',     fields: [
            { key: 'architecture', label: 'Architecture',   tipKey: 'spec_label_architecture' },
            { key: 'units',        label: 'Units/CUs',      tipKey: 'spec_label_units' },
            { key: 'frequency',    label: 'Clock Speed',    tipKey: 'spec_label_clock' },
            { key: 'tflops',       label: 'TFLOPS',         tipKey: 'spec_label_tflops' },
            { key: 'capabilities', label: 'Capabilities',  tipKey: 'spec_label_capabilities' }
        ]},
        { key: 'memory',     labelKey: 'spec_memory_title',  fields: [
            { key: 'type',      label: 'Type',      tipKey: 'spec_label_type' },
            { key: 'capacity',  label: 'Capacity',  tipKey: 'spec_label_capacity' },
            { key: 'bus',       label: 'Bus',       tipKey: 'spec_label_bus' },
            { key: 'bandwidth', label: 'Bandwidth', tipKey: 'spec_label_bandwidth' }
        ]},
        { key: 'storage',    labelKey: 'spec_storage_title', fields: [
            { key: 'type',      label: 'Type',      tipKey: 'spec_label_type' },
            { key: 'interface', label: 'Interface', tipKey: 'spec_label_interface' },
            { key: 'speed',     label: 'Speed',     tipKey: 'spec_label_speed' }
        ]},
        { key: 'output_video', labelKey: 'spec_output_title', fields: [
            { key: 'resolution', label: 'Resolution', tipKey: 'spec_label_resolution' },
            { key: 'refresh',    label: 'Refresh',    tipKey: 'spec_label_refresh' },
            { key: 'hdr',        label: 'HDR',        tipKey: 'spec_label_hdr' },
            { key: 'upscaling',  label: 'Upscaling',  tipKey: 'spec_label_upscaling' }
        ]},
        { key: 'technologies', labelKey: 'spec_tech_title', fields: [
            { key: 'ray_tracing',           label: 'Ray Tracing',       tipKey: null },
            { key: 'vrr',                   label: 'VRR',               tipKey: null },
            { key: 'backwards_compatibility', label: 'Backwards Compat', tipKey: 'spec_label_backwards_compat' },
            { key: 'other',                 label: 'Other',             tipKey: null }
        ]},
        { key: 'dimensions', labelKey: 'spec_dimensions_title', fields: [
            { key: 'width_mm',  label: 'Width (mm)',  tipKey: 'spec_label_width' },
            { key: 'height_mm', label: 'Height (mm)', tipKey: 'spec_label_height' },
            { key: 'depth_mm',  label: 'Depth (mm)',  tipKey: 'spec_label_depth' },
            { key: 'weight_g',  label: 'Weight (g)',  tipKey: 'spec_label_weight' }
        ]}
    ];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatValue(val) {
    if (val === true)  return '<span class="flag yes"></span>';
    if (val === false) return '<span class="flag no"></span>';
    if (val !== null && typeof val === 'object') {
        return Object.entries(val)
            .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v} g`)
            .join('<br>');
    }
    return val !== null && val !== undefined && String(val).trim().length && val !== 'N/A' ? val : 'N/A';
}

function getVal(obj, sectionKey, fieldKey) {
    if (!obj || !obj[sectionKey]) return null;
    const sec = obj[sectionKey];
    // weight_g lives on dimensions itself, not inside each model
    if (sectionKey === 'dimensions' && fieldKey === 'weight_g') {
        return sec.weight_g !== undefined ? sec.weight_g : null;
    }
    // For other dimension fields on multi-model consoles, show first model's value
    if (sectionKey === 'dimensions' && sec.models) {
        const first = sec.models[0];
        return first && first[fieldKey] !== undefined ? first[fieldKey] : null;
    }
    return sec[fieldKey] !== undefined ? sec[fieldKey] : null;
}

function resolveImg(imgPath) {
    return '../../' + imgPath;
}

// ── Populate select dropdowns ─────────────────────────────────────────────────
function populateSelects() {
    const gens = {};
    consolesData.forEach(c => {
        const g = c.generation;
        if (!gens[g]) gens[g] = [];
        gens[g].push(c);
    });

    [selectA, selectB].forEach(sel => {
        sel.innerHTML = '';
        Object.keys(gens).sort((a, b) => b - a).forEach(gen => {
            const og = document.createElement('optgroup');
            og.label = genLabel(gen);
            gens[gen].sort((a, b) => b.release - a.release).forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.name + ' (' + c.release + ')';
                og.appendChild(opt);
            });
            sel.appendChild(og);
        });
    });
}

// ── Render comparison ─────────────────────────────────────────────────────────
function update() {
    const a = consolesData.find(c => c.id === selectA.value);
    const b = consolesData.find(c => c.id === selectB.value);
    if (!a || !b) return;

    const specSections = buildSpecSections();

    const specsHtml = specSections.map(section => {
        const rows = section.fields.map(field => {
            const vA = getVal(a, section.key, field.key);
            const vB = getVal(b, section.key, field.key);
            if (vA === null && vB === null) return '';
            const labelHtml = field.tipKey
                ? tipLabel(field.label, field.tipKey)
                : fixedTip(field.label);
            return '<div class="spec-row">' +
                '<div class="spec-value spec-left">'  + formatValue(vA) + '</div>' +
                '<div class="spec-label">'            + labelHtml       + '</div>' +
                '<div class="spec-value spec-right">' + formatValue(vB) + '</div>' +
                '</div>';
        }).filter(r => r.length > 0).join('');
        return rows
            ? '<div class="spec-section"><div class="spec-section-header">' + I18nModule.t(section.labelKey) + '</div>' + rows + '</div>'
            : '';
    }).filter(s => s.length > 0).join('');

    const prosTitle  = I18nModule.t('console_pros_title');
    const consTitle  = I18nModule.t('console_cons_title');

    const prosA = (a.advantages    || []).map(p => '<li class="pro-item"> ' + p + '</li>').join('');
    const consA = (a.disadvantages || []).map(c => '<li class="con-item"> ' + c + '</li>').join('');
    const prosB = (b.advantages    || []).map(p => '<li class="pro-item"> ' + p + '</li>').join('');
    const consB = (b.disadvantages || []).map(c => '<li class="con-item"> ' + c + '</li>').join('');

    const specsSection = specsHtml
        ? '<div class="specs-comparison"><h3 class="specs-title">' + I18nModule.t('console_specs_title') + '</h3><div class="spec-sheet">' + specsHtml + '</div></div>'
        : '';

    const verdictSection = (prosA || consA || prosB || consB)
        ? '<div class="verdict-section"><h3 class="verdict-title">' + I18nModule.t('console_verdict_title') + '</h3><div class="verdict-grid">' +
            '<div class="verdict-card"><h4 class="verdict-console-name">' + a.name + '</h4><div class="verdict-lists">' +
                (prosA ? '<div class="pros-list"><h5 class="list-title pros-title">' + prosTitle + '</h5><ul>' + prosA + '</ul></div>' : '') +
                (consA ? '<div class="cons-list"><h5 class="list-title cons-title">' + consTitle + '</h5><ul>' + consA + '</ul></div>' : '') +
            '</div></div>' +
            '<div class="verdict-card"><h4 class="verdict-console-name">' + b.name + '</h4><div class="verdict-lists">' +
                (prosB ? '<div class="pros-list"><h5 class="list-title pros-title">' + prosTitle + '</h5><ul>' + prosB + '</ul></div>' : '') +
                (consB ? '<div class="cons-list"><h5 class="list-title cons-title">' + consTitle + '</h5><ul>' + consB + '</ul></div>' : '') +
            '</div></div></div></div>'
        : '';

    display.innerHTML =
        '<div class="comparison-grid">' +
        '<div class="console-card" data-console-id="' + a.id + '"><div class="console-card-image"><img src="' + resolveImg(a.image) + '" alt="' + a.name + '"></div>' +
        '<div class="console-card-info"><h3>' + a.name + '</h3><div class="console-meta-tags"><span class="meta-tag">' + a.manufacturer + '</span><span class="meta-tag">' + a.release + '</span><span class="meta-tag">Gen ' + a.generation + '</span></div></div></div>' +
        '<div class="comparison-vs"><span class="vs-badge">VS</span></div>' +
        '<div class="console-card" data-console-id="' + b.id + '"><div class="console-card-image"><img src="' + resolveImg(b.image) + '" alt="' + b.name + '"></div>' +
        '<div class="console-card-info"><h3>' + b.name + '</h3><div class="console-meta-tags"><span class="meta-tag">' + b.manufacturer + '</span><span class="meta-tag">' + b.release + '</span><span class="meta-tag">Gen ' + b.generation + '</span></div></div></div>' +
        '</div>' + specsSection + verdictSection;

    display.querySelectorAll('img').forEach(img => {
        img.addEventListener('error', () => img.classList.add('image-hidden'));
    });

    initSpecTooltips();

    document.querySelectorAll('.console-card[data-console-id]').forEach(card => {
        card.style.cursor = 'pointer';
        card.addEventListener('click', function () {
            window.location.href = './consoles/' + this.getAttribute('data-console-id') + '.html';
        });
    });
}

// ── URL-driven state (?a=<id>&b=<id>) + dynamic SEO meta ──────────────────────
// Query string (not #hash) so each pair can be linked/canonicalized/indexed as
// its own URL — Google does not crawl/index fragment identifiers separately.
const BASE_URL = 'https://consolenotebook.com/html/pages/comparatie.html';
const DEFAULT_META = {
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content || '',
};

function findConsole(id) {
    return consolesData ? consolesData.find(c => c.id === id) : null;
}

// Canonical pair order = order the two consoles appear in the source data
// (roughly release order). This keeps "A vs B" and "B vs A" URLs pointing at
// one authoritative canonical, instead of splitting SEO signal across both.
function canonicalOrder(idA, idB) {
    const iA = consolesData.findIndex(c => c.id === idA);
    const iB = consolesData.findIndex(c => c.id === idB);
    return iA <= iB ? [idA, idB] : [idB, idA];
}

function setMeta(selector, attr, value) {
    const el = document.querySelector(selector);
    if (el) el.setAttribute(attr, value);
}

function updateMetaTags(idA, idB) {
    const a = findConsole(idA);
    const b = findConsole(idB);
    if (!a || !b) return;

    const title = `${a.name} vs ${b.name} — Console Notebook`;
    const description = `Compare ${a.name} vs ${b.name}: CPU, GPU, RAM, storage, specs and verdict on Console Notebook.`;
    const [canonA, canonB] = canonicalOrder(idA, idB);
    const canonicalUrl = `${BASE_URL}?a=${canonA}&b=${canonB}`;
    const ogImage = 'https://consolenotebook.com/' + a.image;

    document.title = title;
    setMeta('meta[name="description"]', 'content', description);
    setMeta('link[rel="canonical"]', 'href', canonicalUrl);
    setMeta('meta[property="og:title"]', 'content', title);
    setMeta('meta[property="og:description"]', 'content', description);
    setMeta('meta[property="og:url"]', 'content', canonicalUrl);
    setMeta('meta[property="og:image"]', 'content', ogImage);
}

function resetMetaTags() {
    document.title = DEFAULT_META.title;
    setMeta('meta[name="description"]', 'content', DEFAULT_META.description);
    setMeta('link[rel="canonical"]', 'href', BASE_URL);
    setMeta('meta[property="og:title"]', 'content', DEFAULT_META.title);
    setMeta('meta[property="og:description"]', 'content', DEFAULT_META.description);
    setMeta('meta[property="og:url"]', 'content', BASE_URL);
}

function syncUrl(idA, idB, replace) {
    const url = `${location.pathname}?a=${idA}&b=${idB}`;
    if (replace) history.replaceState({ a: idA, b: idB }, '', url);
    else history.pushState({ a: idA, b: idB }, '', url);
}

function onSelectionChange() {
    update();
    syncUrl(selectA.value, selectB.value, false);
    updateMetaTags(selectA.value, selectB.value);
}

window.addEventListener('popstate', () => {
    const params = new URLSearchParams(location.search);
    const idA = params.get('a');
    const idB = params.get('b');
    if (idA && idB && findConsole(idA) && findConsole(idB)) {
        selectA.value = idA;
        selectB.value = idB;
        update();
        updateMetaTags(idA, idB);
    } else {
        selectA.value = 'playstation-5';
        selectB.value = 'xbox-series-x';
        update();
        resetMetaTags();
    }
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
    const data = await loadConsoles();
    if (!data || data.length === 0) {
        display.innerHTML = '<p class="comparison-error">' + I18nModule.t('compare_hero_subtitle') + '</p>';
        return;
    }
    consolesData = data;
    populateSelects();

    const params = new URLSearchParams(location.search);
    const urlA = params.get('a');
    const urlB = params.get('b');
    const urlDriven = urlA && urlB && findConsole(urlA) && findConsole(urlB);

    selectA.value = urlDriven ? urlA : 'playstation-5';
    selectB.value = urlDriven ? urlB : 'xbox-series-x';
    selectA.addEventListener('change', onSelectionChange);
    selectB.addEventListener('change', onSelectionChange);
    update();
    if (urlDriven) updateMetaTags(selectA.value, selectB.value);
}

init();

// Language change: data-loader cache is already cleared by data-loader's own listener.
// We just reload and re-render.
window.addEventListener('cn:language-changed', async () => {
    const prevA = selectA.value;
    const prevB = selectB.value;
    const data = await loadConsoles();
    if (!data || data.length === 0) return;
    consolesData = data;
    populateSelects();
    selectA.value = prevA;
    selectB.value = prevB;
    update();
});
