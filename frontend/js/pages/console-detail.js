/**
 * Console Detail Page - Dynamic content loader
 * Loads console specs from consoles.json and renders them into the page
 */

import { getConsoleById, getConsoleIdFromUrl, resolveImagePath, invalidateCache } from '../data/data-loader.js';
import { MODEL_DIRECTORY_GROUPS } from '../data/console-models.js?v=20260909d';
import { AchievementsModule } from '../modules/achievements.js';
import { AuthModule } from '../modules/auth.js';
import { I18nModule } from '../modules/i18n.js?v=20260909f';
import { API_BASE_URL } from '../config.js';

/** Remove leftover Chrome UI elements from page template */
function cleanupConsolePageChrome() {
    const homeLinkItem = document.querySelector('.nav-links a[href="../index.html"]')?.closest('li');
    if (homeLinkItem) homeLinkItem.remove();

    const githubLink = document.querySelector('.footer-right a[href*="github.com"]');
    if (githubLink) githubLink.remove();
}

/**
 * Image dimensions mapping - prevents layout shift during load
 * Loaded from image-dimensions.json
 */
let IMAGE_DIMENSIONS = {};
let currentConsole = null;

/* ── Spec help-icon tooltip definitions ── */
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

function tipLabel(i18nKey) {
    const label = I18nModule.t(i18nKey);
    const tip = SPEC_TIPS[i18nKey];
    if (!tip) return label;
    return `${label}<button class="spec-help" type="button" aria-label="${tip}">${HELP_SVG}<span class="spec-tooltip">${tip}</span></button>`;
}

function fixedTip(label) {
    const tip = FIXED_TIPS[label];
    if (!tip) return label;
    return `${label}<button class="spec-help" type="button" aria-label="${tip}">${HELP_SVG}<span class="spec-tooltip">${tip}</span></button>`;
}

let _specTooltipsListenerAdded = false;
function initSpecTooltips() {
    document.querySelectorAll('.spec-help').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const wasOpen = btn.classList.contains('is-open');
            document.querySelectorAll('.spec-help.is-open').forEach(b => b.classList.remove('is-open'));
            if (!wasOpen) btn.classList.add('is-open');
        });
    });
    if (!_specTooltipsListenerAdded) {
        _specTooltipsListenerAdded = true;
        document.addEventListener('click', () => {
            document.querySelectorAll('.spec-help.is-open').forEach(b => b.classList.remove('is-open'));
        });
    }
}

/**
 * Load image dimensions from JSON file
 */
/** Load pre-computed image dimensions from JSON (prevents CLS) */
async function loadImageDimensions() {
    if (Object.keys(IMAGE_DIMENSIONS).length > 0) return;
    
    try {
        const path = window.location.pathname.includes('/pages/consoles/') ? '../../../js/data/image-dimensions.json' : '../../js/data/image-dimensions.json';
        const response = await fetch(path);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        IMAGE_DIMENSIONS = await response.json();
    } catch (err) {
        console.warn('Failed to load image-dimensions.json:', err.message);
        IMAGE_DIMENSIONS = {};
    }
}

/**
 * Build spec section definitions based on current language.
 */
function getSpecSections(consola) {
    return [
        {
            group: I18nModule.t('spec_group_primary'),
            cards: [
                {
                    title: I18nModule.t('spec_cpu_title'),
                    render: (c) => formatList([
                        [tipLabel('spec_label_architecture'), c.cpu.architecture],
                        [tipLabel('spec_label_process'), c.cpu.proces_nm],
                        [tipLabel('spec_label_cores'), c.cpu.cores],
                        [tipLabel('spec_label_clock'), c.cpu.frequency],
                        [tipLabel('spec_label_tdp'), c.cpu.tdp]
                    ])
                },
                {
                    title: I18nModule.t('spec_gpu_title'),
                    render: (c) => formatList([
                        [tipLabel('spec_label_architecture'), c.gpu.architecture],
                        [tipLabel('spec_label_units'), c.gpu.units],
                        [tipLabel('spec_label_clock'), c.gpu.frequency],
                        [tipLabel('spec_label_tflops'), c.gpu.tflops],
                        [tipLabel('spec_label_capabilities'), c.gpu.capabilities]
                    ])
                },
                {
                    title: I18nModule.t('spec_memory_title'),
                    render: (c) => formatList([
                        [tipLabel('spec_label_type'), c.memory.type],
                        [tipLabel('spec_label_capacity'), c.memory.capacity],
                        [tipLabel('spec_label_bus'), c.memory.bus],
                        [tipLabel('spec_label_bandwidth'), c.memory.bandwidth]
                    ])
                },
                {
                    title: I18nModule.t('spec_storage_title'),
                    render: (c) => formatList([
                        [tipLabel('spec_label_type'), c.storage.type],
                        [tipLabel('spec_label_interface'), c.storage.interface],
                        [tipLabel('spec_label_speed'), c.storage.speed]
                    ])
                }
            ]
        },
        {
            group: I18nModule.t('spec_group_secondary'),
            cards: [
                {
                    title: I18nModule.t('spec_output_title'),
                    render: (c) => formatList([
                        [tipLabel('spec_label_resolution'), c.output_video.resolution],
                        [tipLabel('spec_label_refresh'), c.output_video.refresh],
                        [tipLabel('spec_label_hdr'), c.output_video.hdr],
                        [tipLabel('spec_label_upscaling'), c.output_video.upscaling]
                    ])
                },
                {
                    title: I18nModule.t('spec_tech_title'),
                    render: (c) => formatList([
                        [fixedTip('Ray Tracing'), formatBool(c.technologies.ray_tracing)],
                        [fixedTip('VRR'), formatBool(c.technologies.vrr)],
                        [tipLabel('spec_label_backwards_compat') || 'Backwards Compat', c.technologies.backwards_compatibility],
                        [I18nModule.t('spec_label_capabilities'), c.technologies.other]
                    ])
                },
                ...(consola.dimensions ? [{
                    title: I18nModule.t('spec_dimensions_title'),
                    render: (c) => formatDimensions(c.dimensions)
                }] : [])
            ]
        }
    ];
}

function formatBool(val) {
    if (val === true) return I18nModule.t('spec_yes');
    if (val === false) return I18nModule.t('spec_no');
    return val || 'N/A';
}

function isNA(val) {
    return !val || val === 'N/A' || val === 'n/a';
}

function formatList(pairs) {
    const filtered = pairs.filter(([_, val]) => !isNA(val));
    if (filtered.length === 0) return '<p>—</p>';
    return filtered.map(([label, val]) => `<strong>${label}:</strong> ${val}`).join('<br>');
}

function formatDimSingle(d) {
    const w  = I18nModule.t('spec_label_width');
    const h  = I18nModule.t('spec_label_height');
    const dp = I18nModule.t('spec_label_depth');

    function fmt(mm) {
        const cm   = (mm / 10).toFixed(1);
        const inch = (mm / 25.4).toFixed(2);
        return `<span class="dim-cm">${cm} cm</span><span class="dim-sep"> / </span><span class="dim-inch">${inch}"</span>`;
    }

    return `<table class="dim-table">
        <tr><td class="dim-lbl">${w}</td><td class="dim-val">${fmt(d.width_mm)}</td></tr>
        <tr><td class="dim-lbl">${h}</td><td class="dim-val">${fmt(d.height_mm)}</td></tr>
        <tr><td class="dim-lbl">${dp}</td><td class="dim-val">${fmt(d.depth_mm)}</td></tr>
    </table>`;
}

function formatWeight(w) {
    if (w === null || w === undefined) return null;
    if (typeof w === 'number') {
        return `<span class="dim-weight-val">${w}</span><span class="dim-weight-unit"> g</span>`;
    }
    return `<span class="dim-weight-variants">${
        Object.entries(w)
            .map(([k, v]) =>
                `<span class="dim-weight-row"><span class="dim-weight-key">${k.replace(/_/g, ' ')}</span><span class="dim-weight-val">${v}</span><span class="dim-weight-unit"> g</span></span>`)
            .join('')
    }</span>`;
}

function formatDimensions(dim) {
    if (!dim) return '<p>—</p>';
    const weightRow = dim.weight_g !== undefined ? formatWeight(dim.weight_g) : null;
    const wLabel = I18nModule.t('spec_label_weight') || 'Weight';

    if (dim.models && Array.isArray(dim.models)) {
        const modelRows = dim.models.map(m => {
            const label = m.label ? `<em class="dim-model-label">${m.label}</em><br>` : '';
            return label + formatDimSingle(m);
        }).join('<hr class="dim-separator">');
        if (!weightRow) return modelRows;
        return modelRows + `<hr class="dim-separator"><table class="dim-table"><tr><td class="dim-lbl">${wLabel}</td><td class="dim-val">${weightRow}</td></tr></table>`;
    }

    const baseTable = formatDimSingle(dim);
    if (!weightRow) return baseTable;
    const weightRowHtml = `<tr><td class="dim-lbl">${wLabel}</td><td class="dim-val">${weightRow}</td></tr>`;
    return baseTable.replace('</table>', weightRowHtml + '</table>');
}

function getLocalizedField(obj, key) {
    if (!obj) return undefined;
    const langKey = `${key}_${I18nModule.lang}`;
    return obj[langKey] ?? obj[key];
}

function getLocalizedArray(obj, key) {
    if (!obj) return [];
    const langKey = `${key}_${I18nModule.lang}`;
    if (Array.isArray(obj[langKey])) return obj[langKey];
    if (Array.isArray(obj[key])) return obj[key];
    return [];
}

/**
 * Render specs sections into the page
 */
/** Render the specs accordion from section config */
function renderSpecs(consola) {
    const specsContainer = document.querySelector('.specs-section .container');
    if (!specsContainer) return;

    let html = `<h2 class="section-title">${I18nModule.t('console_specs_title')}</h2>
    <p class="specs-hint">${I18nModule.t('specs_hint')}</p>`;

    getSpecSections(consola).forEach(section => {
        html += `
            <div class="specs-group">
                <h3 class="specs-group-title">${section.group}</h3>
                <div class="specs-grid">
                    ${section.cards.map(card => `
                        <div class="spec-card">
                            <h4>${card.title}</h4>
                            <p>${card.render(consola)}</p>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });

    // Verdict section (avantaje / dezavantaje)
    const pros = getLocalizedArray(consola, 'advantages');
    const cons = getLocalizedArray(consola, 'disadvantages');
    if (pros.length || cons.length) {
        html += `
            <div class="specs-group">
                <h3 class="specs-group-title">${I18nModule.t('console_verdict_title')}</h3>
                <div class="specs-grid">
                    ${pros.length ? `
                    <div class="spec-card">
                        <h4 class="pros-title">${I18nModule.t('console_pros_title')}</h4>
                        <ul class="verdict-list pros-list">
                            ${pros.map(p => `<li class="pro-item">✓ ${p}</li>`).join('')}
                        </ul>
                    </div>` : ''}
                    ${cons.length ? `
                    <div class="spec-card">
                        <h4 class="cons-title">${I18nModule.t('console_cons_title')}</h4>
                        <ul class="verdict-list cons-list">
                            ${cons.map(c => `<li class="con-item">✗ ${c}</li>`).join('')}
                        </ul>
                    </div>` : ''}
                </div>
            </div>
        `;
    }

    specsContainer.innerHTML = html;
    initSpecTooltips();
}
/** Render the console history section
 * Inserted between hero and specs sections
 * Normalizes both Pattern A (\n\n) and Pattern B (<br><br>) formats
 */
/** Render the console history timeline section */
function renderHistory(consola) {
    // Ensure we have a reference point: place before .specs-section
    const specsSection = document.querySelector('.specs-section');
    if (!specsSection) return;

    // Create history section element
    let historySection = document.querySelector('.history-section');
    if (!historySection) {
        historySection = document.createElement('section');
        historySection.className = 'section history-section';
        const inner = document.createElement('div');
        inner.className = 'container';
        historySection.appendChild(inner);
        specsSection.parentNode.insertBefore(historySection, specsSection);
    }

    const container = historySection.querySelector('.container');
    const titleHtml = `<h2 class="section-title">${I18nModule.t('console_history_title')}</h2>`;

    let historyHtml = '';
    const historyText = getLocalizedField(consola, 'history') || '';
    if (historyText && String(historyText).trim()) {
        let text = String(historyText);

        // Normalize: convert <br><br> to \n\n so both patterns split the same way
        text = text.replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '\n\n');
        // Convert remaining <br> to \n
        text = text.replace(/<br\s*\/?>/gi, '\n');

        // Split into semantic blocks by double newline
        const blocks = text.split('\n\n').map(b => b.trim()).filter(Boolean);
        const sections = [];
        let currentSection = null;

        const pushCurrent = () => {
            if (!currentSection) return;
            if (currentSection.heading || currentSection.paragraphs.length) {
                sections.push(currentSection);
            }
            currentSection = null;
        };

        blocks.forEach(block => {
            const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
            const trimmed = block.trim();

            if (lines.length > 1) {
                const firstLine = lines[0];
                const firstLineStrong = firstLine.match(/^<strong>(.*?)<\/strong>$/i);
                const isHeadingLine = firstLineStrong || (firstLine.length < 80 && !firstLine.includes('.') && !firstLine.includes('<') && /^[A-ZĂÂÎȘȚ]/.test(firstLine));

                if (isHeadingLine) {
                    pushCurrent();
                    const heading = (firstLineStrong ? firstLineStrong[1] : firstLine).trim();
                    const content = lines.slice(1).join('\n').trim();
                    currentSection = { heading, paragraphs: [] };
                    if (content) currentSection.paragraphs.push(content);
                    return;
                }
            }

            const strongMatch = trimmed.match(/^<strong>(.*?)<\/strong>$/i);
            if (strongMatch) {
                pushCurrent();
                currentSection = { heading: strongMatch[1].trim(), paragraphs: [] };
                return;
            }

            if (trimmed.length < 80 && !trimmed.includes('.') && !trimmed.includes('<') && /^[A-ZĂÂÎȘȚ]/.test(trimmed)) {
                pushCurrent();
                currentSection = { heading: trimmed, paragraphs: [] };
                return;
            }

            if (!currentSection) {
                currentSection = { heading: '', paragraphs: [] };
            }
            currentSection.paragraphs.push(trimmed);
        });

        pushCurrent();

        const autoTitles = [
            I18nModule.t('history_auto_title_1'),
            I18nModule.t('history_auto_title_2'),
            I18nModule.t('history_auto_title_3'),
            I18nModule.t('history_auto_title_4'),
            I18nModule.t('history_auto_title_5')
        ];
        let autoIndex = 0;

        const rendered = sections.map(section => {
            let heading = section.heading;
            if (!heading) {
                heading = autoTitles[Math.min(autoIndex, autoTitles.length - 1)];
                autoIndex += 1;
            }

            const paragraphs = section.paragraphs.map(paragraph => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`).join('');
            return `<h3 class="history-heading">${heading}</h3>${paragraphs}`;
        }).join('');

        historyHtml = `<div class="history-content">${rendered}</div>`;
    } else {
        historyHtml = '<div class="history-content"></div>';
    }

    // "Fun facts" — deep-links into the Modding Guide's hardware-model directory
    // (console-modding.html), pre-filtered to just this console's own model codes via the
    // ?groups= param model-directory.js reads (see console-models.js's MODEL_DIRECTORY_GROUPS
    // for the id → group-name mapping). Hidden entirely for a console with no entry there —
    // everything outside Xbox/PlayStation/Nintendo, the only 3 manufacturers with any
    // hardware-model directory content at all today.
    const groups = MODEL_DIRECTORY_GROUPS[consola.id];
    const funFactsHtml = groups
        ? `<a class="hero-button hero-button--syllabus history-fun-facts-btn" href="../console-modding.html?groups=${encodeURIComponent(groups.join(','))}#identify">${I18nModule.t('console_fun_facts_btn')}</a>`
        : '';

    container.innerHTML = titleHtml + historyHtml + funFactsHtml;
}

/**
 * Render the hero section with console data
 */
/** Render the hero section: image, title, tagline, action buttons */
function renderHero(consola) {
    const titleText = getLocalizedField(consola, 'name') || I18nModule.t('hero_title');

    // Update title
    const h1 = document.querySelector('.console-hero-text h1');
    if (h1) {
        h1.textContent = titleText;

        // Add favorite heart button next to title
        const heartBtn = document.createElement('button');
        heartBtn.className = 'favorite-heart-btn';
        heartBtn.id = 'favorite-heart-btn';
        heartBtn.type = 'button';
        const favLabel = I18nModule.t('console_favorite_add');
        heartBtn.title = favLabel;
        heartBtn.innerHTML = '♡';
        heartBtn.setAttribute('aria-label', favLabel);
        h1.appendChild(heartBtn);
    }

    // Update meta info
    const metaContainer = document.querySelector('.console-hero-text .console-meta');
    if (metaContainer) {
        const manufacturer = getLocalizedField(consola, 'manufacturer') || '';
        const year = consola.release || '';
        const genLabel = I18nModule.t('console_generation_prefix');
        const generation = getLocalizedField(consola, 'generation') || '';

        metaContainer.innerHTML = `
            <span>${manufacturer}</span>
            <span>${year}</span>
            <span>${genLabel} ${generation}</span>
        `;
    }

    // Models / hardware revisions
    let modelsEl = document.querySelector('.console-hero-text .console-models');
    if (!modelsEl && metaContainer) {
        modelsEl = document.createElement('div');
        modelsEl.className = 'console-models';
        metaContainer.after(modelsEl);
    }
    if (modelsEl) {
        if (consola.models && consola.models.length > 0) {
            modelsEl.innerHTML = consola.models
                .map(m => `<span class="console-model-item">${m.name}<em> ${m.year}</em></span>`)
                .join('');
            modelsEl.style.display = '';
        } else {
            modelsEl.style.display = 'none';
        }
    }

    // Update image
    const img = document.querySelector('.console-hero-image img');
    if (img) {
        img.src = resolveImagePath(consola.image);
        img.alt = consola.name;
        
        // Set width and height to prevent layout shift
        const imageName = consola.image.split('/').pop();
        const dimensions = IMAGE_DIMENSIONS[imageName];
        if (dimensions) {
            img.width = dimensions.width;
            img.height = dimensions.height;
        }
    }

    // Update page title
    document.title = `${consola.name} — Console Notebook`;
}

/* ── Structured data (schema.org JSON-LD) ────────────────────────────────
 * Injected client-side from the same consola object the rest of the page
 * renders from, so it can't drift out of sync with visible content. Only
 * real fields go in: no fabricated price/offers, and aggregateRating is
 * added only once the /ratings endpoint returns an actual count > 0. */
let structuredDataGraph = null;

function addSpecProperty(props, name, value) {
    if (value === undefined || value === null) return;
    const v = String(value).trim();
    if (!v || v === 'N/A') return;
    props.push({ '@type': 'PropertyValue', name, value: v });
}

function buildStructuredData(consola, consoleId) {
    const url = `https://consolenotebook.com/html/pages/consoles/${consoleId}.html`;
    const props = [];
    addSpecProperty(props, 'CPU Architecture', consola.cpu?.architecture);
    addSpecProperty(props, 'CPU Cores/Threads', consola.cpu?.cores);
    addSpecProperty(props, 'CPU Clock Speed', consola.cpu?.frequency);
    addSpecProperty(props, 'GPU Architecture', consola.gpu?.architecture);
    addSpecProperty(props, 'GPU TFLOPS', consola.gpu?.tflops);
    addSpecProperty(props, 'Memory', consola.memory?.capacity ? `${consola.memory.capacity} ${consola.memory.type || ''}`.trim() : null);
    addSpecProperty(props, 'Storage', consola.storage?.type);
    addSpecProperty(props, 'Storage Speed', consola.storage?.speed);
    addSpecProperty(props, 'Output Resolution', consola.output_video?.resolution);
    addSpecProperty(props, 'Generation', consola.generation);

    const product = {
        '@type': 'Product',
        '@id': `${url}#product`,
        name: consola.name,
        description: `${consola.name} by ${consola.manufacturer} (${consola.release}) — full specs, hardware, and history on Console Notebook.`,
        // Same absolute-URL gotcha as resolveImagePath() above — an admin-uploaded image is
        // already a full R2 URL, prefixing it with the site origin would double it up.
        image: /^https?:\/\//i.test(consola.image || '') ? consola.image : `https://consolenotebook.com/${consola.image}`,
        brand: { '@type': 'Brand', name: consola.manufacturer },
        releaseDate: String(consola.release),
        url,
        additionalProperty: props
    };

    const breadcrumb = {
        '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Console Notebook', item: 'https://consolenotebook.com/html/pages/index.html' },
            { '@type': 'ListItem', position: 2, name: 'Encyclopedia', item: 'https://consolenotebook.com/html/pages/evolutie.html' },
            { '@type': 'ListItem', position: 3, name: consola.name, item: url }
        ]
    };

    return { product, breadcrumb };
}

function writeStructuredDataScript() {
    if (!structuredDataGraph) return;
    let script = document.getElementById('cn-jsonld');
    if (!script) {
        script = document.createElement('script');
        script.type = 'application/ld+json';
        script.id = 'cn-jsonld';
        document.head.appendChild(script);
    }
    script.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [structuredDataGraph.product, structuredDataGraph.breadcrumb]
    });
}

function injectStructuredData(consola, consoleId) {
    structuredDataGraph = buildStructuredData(consola, consoleId);
    writeStructuredDataScript();
}

function updateStructuredDataRating(average, count) {
    if (!structuredDataGraph || !count || count <= 0) return;
    structuredDataGraph.product.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: average,
        ratingCount: count,
        bestRating: 5,
        worstRating: 1
    };
    writeStructuredDataScript();
}

/**
 * Render the community rating widget after specs
 */
/** Render the star rating widget with user interaction */
function renderRatingWidget(consoleId) {
    const specsSection = document.querySelector('.specs-section');
    if (!specsSection) return;

    // Create rating section
    const section = document.createElement('section');
    section.className = 'section rating-section';
    section.id = 'rating';
    section.innerHTML = `
        <div class="container">
            <h2 class="section-title">${I18nModule.t('console_rating_title')}</h2>
            <div class="rating-widget" id="rating-widget">
                <div class="rating-summary" id="rating-summary">
                    <div class="rating-stars-display" id="rating-stars-display"></div>
                    <div class="rating-avg" id="rating-avg">— / 5</div>
                    <div class="rating-count" id="rating-count">${I18nModule.t('console_rating_loading')}</div>
                </div>
                <div class="rating-user" id="rating-user"></div>
            </div>
        </div>
    `;
    specsSection.parentNode.insertBefore(section, specsSection.nextSibling);

    loadRating(consoleId);
}

/** Generate star HTML for a given rating value */
function renderStars(rating, max = 5) {
    let html = '';
    for (let i = 1; i <= max; i++) {
        if (i <= Math.floor(rating)) {
            html += '<span class="star star--filled">★</span>';
        } else if (i - rating < 1 && i - rating > 0) {
            html += '<span class="star star--half">★</span>';
        } else {
            html += '<span class="star star--empty">★</span>';
        }
    }
    return html;
}

/** Render clickable/hoverable rating stars for user input */
function renderInteractiveStars(currentRating, consoleId) {
    const user = AuthModule.getCurrentUser();
    const container = document.getElementById('rating-user');
    if (!container) return;

    if (!user) {
        const loginText = I18nModule.t('console_rating_login');
        const loginLink = I18nModule.t('console_rating_login_link');
        container.innerHTML = `<p class="rating-login-msg">${loginText} <a href="../login.html">${loginLink}</a></p>`;
        return;
    }

    const selected = currentRating || 0;
    container.innerHTML = `
        <p class="rating-your-label">${selected ? I18nModule.t('console_rating_your_label') : I18nModule.t('console_rating_rate_label')}</p>
        <div class="rating-interactive" id="rating-interactive">
            ${[1,2,3,4,5].map(i => `<button class="star-btn${i <= selected ? ' active' : ''}" data-value="${i}" title="${i} ${I18nModule.t('console_rating_star_label')}">★</button>`).join('')}
        </div>
    `;

    const buttons = container.querySelectorAll('.star-btn');

    // Hover effects
    buttons.forEach(btn => {
        btn.addEventListener('mouseenter', () => {
            const val = parseInt(btn.dataset.value);
            buttons.forEach(b => {
                b.classList.toggle('hover', parseInt(b.dataset.value) <= val);
            });
        });
        btn.addEventListener('mouseleave', () => {
            buttons.forEach(b => b.classList.remove('hover'));
        });
        btn.addEventListener('click', () => submitRating(consoleId, parseInt(btn.dataset.value)));
    });
}

/** Fetch current rating data from API */
async function loadRating(consoleId) {
    try {
        const token = localStorage.getItem('cn_token');
        const headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const res = await fetch(`${API_BASE_URL}/ratings/${encodeURIComponent(consoleId)}`, {
            headers,
            credentials: 'include'
        });
        const data = await res.json();
        if (data.success) {
            updateRatingDisplay(data.average, data.count);
            renderInteractiveStars(data.userRating, consoleId);
        }
    } catch {
        const countEl = document.getElementById('rating-count');
        if (countEl) countEl.textContent = I18nModule.t('console_rating_error');
    }
}

/** Submit user's rating to API and refresh display */
async function submitRating(consoleId, rating) {
    try {
        const token = localStorage.getItem('cn_token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const res = await fetch(`${API_BASE_URL}/ratings/${encodeURIComponent(consoleId)}`, {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify({ rating })
        });
        const data = await res.json();
        if (data.success) {
            updateRatingDisplay(data.average, data.count);
            renderInteractiveStars(data.userRating, consoleId);
            window.dispatchEvent(new CustomEvent('cn:rating-submitted'));
        }
    } catch { /* silent */ }
}

function updateRatingDisplay(average, count) {
    const starsEl = document.getElementById('rating-stars-display');
    const avgEl = document.getElementById('rating-avg');
    const countEl = document.getElementById('rating-count');

    if (starsEl) starsEl.innerHTML = renderStars(average);
    if (avgEl) avgEl.textContent = `${average} / 5`;
    if (countEl) countEl.textContent = count === 1
        ? I18nModule.t('console_rating_count_one')
        : I18nModule.t('console_rating_count_many').replace('{count}', count);

    updateStructuredDataRating(average, count);
}

/**
 * Initialize the favorite heart button
 */
/** Initialize the favorite (heart) toggle button for a console */
async function initFavoriteButton(consoleId) {
    const btn = document.getElementById('favorite-heart-btn');
    if (!btn) return;

    const user = AuthModule.getCurrentUser();
    if (!user) {
        btn.title = I18nModule.t('console_favorite_login');
        btn.addEventListener('click', () => {
            window.location.href = '../login.html';
        });
        return;
    }

    // Check current favorite status
    try {
        const token = localStorage.getItem('cn_token');
        const headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const res = await fetch(`${API_BASE_URL}/favorites/${encodeURIComponent(consoleId)}`, {
            headers,
            credentials: 'include'
        });
        const data = await res.json();
        if (data.success && data.isFavorite) {
            btn.classList.add('active');
            btn.innerHTML = '♥';
            btn.title = I18nModule.t('console_favorite_remove');
        }
    } catch { /* ignore */ }

    btn.addEventListener('click', async () => {
        try {
            const token = localStorage.getItem('cn_token');
            const headers = {};
            if (token) headers['Authorization'] = 'Bearer ' + token;

            const res = await fetch(`${API_BASE_URL}/favorites/${encodeURIComponent(consoleId)}`, {
                method: 'POST',
                headers,
                credentials: 'include'
            });
            const data = await res.json();
            if (data.success) {
                btn.classList.toggle('active', data.isFavorite);
                btn.innerHTML = data.isFavorite ? '♥' : '♡';
                btn.title = data.isFavorite ? I18nModule.t('console_favorite_remove') : I18nModule.t('console_favorite_add');
                window.dispatchEvent(new CustomEvent('cn:favorite-changed', { detail: { isFavorite: data.isFavorite } }));
            }
        } catch { /* ignore */ }
    });
}

/* ═══════════════════════════════════════════════════
   ADMIN EDIT MODAL (2026-09-06) — full-content editor for
   name/manufacturer/generation/release/image/models/specs/advantages/
   disadvantages/history, PUT to /api/consoles/:id (EN only for now,
   translations reviewed/added separately later). Console encyclopedia data
   is the live DB source of truth now — see CLAUDE.md.
   ═══════════════════════════════════════════════════ */

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}

function isAdmin() {
    return AuthModule.getCurrentUser()?.role === 'admin';
}

async function apiConsole(method, path, body) {
    const token = localStorage.getItem('cn_token');
    const opts = { method, credentials: 'include', headers: {} };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(API_BASE_URL + path, opts);
    return res.json();
}

function consoleEditArrayRow(value) {
    const row = document.createElement('div');
    row.className = 'console-edit__array-row';
    row.innerHTML = `
        <input type="text" class="console-edit__array-input" value="${escapeHtml(value || '')}">
        <button type="button" class="console-edit__array-remove">${I18nModule.t('console_edit_remove_item')}</button>
    `;
    row.querySelector('.console-edit__array-remove').addEventListener('click', () => row.remove());
    return row;
}

function readConsoleEditArray(wrapId) {
    return Array.from(document.querySelectorAll(`#${wrapId} .console-edit__array-input`))
        .map(el => el.value.trim())
        .filter(Boolean);
}

function consoleEditModelRow(model) {
    const row = document.createElement('div');
    row.className = 'console-edit__model-row';
    row.innerHTML = `
        <input type="text" class="console-edit__model-name" placeholder="${I18nModule.t('console_edit_model_name_placeholder')}" value="${escapeHtml(model?.name || '')}">
        <input type="text" class="console-edit__model-year" placeholder="${I18nModule.t('console_edit_model_year_placeholder')}" value="${escapeHtml(model?.year || '')}">
        <button type="button" class="console-edit__array-remove">${I18nModule.t('console_edit_remove_item')}</button>
    `;
    row.querySelector('.console-edit__array-remove').addEventListener('click', () => row.remove());
    return row;
}

function readConsoleEditModels() {
    return Array.from(document.querySelectorAll('#console-edit-models .console-edit__model-row')).map(row => ({
        name: row.querySelector('.console-edit__model-name').value.trim(),
        year: row.querySelector('.console-edit__model-year').value.trim(),
    })).filter(m => m.name);
}

// One <label>+<input> pair for a spec field, reusing the same i18n keys
// already used to DISPLAY that spec (spec_label_*) so this form needed
// almost no new translation strings.
function consoleEditSpecField(id, labelKey, value) {
    return `
        <label class="console-edit__label" for="${id}">${I18nModule.t(labelKey)}</label>
        <input type="text" id="${id}" class="console-edit__input" value="${escapeHtml(value)}">
    `;
}

function openConsoleEditor() {
    if (!currentConsole) return;
    const c = currentConsole;

    const overlay = document.createElement('div');
    overlay.className = 'console-edit-overlay';
    overlay.innerHTML = `
        <div class="console-edit-modal">
            <button type="button" class="console-edit-modal__close" aria-label="${I18nModule.t('tutorial_cancel')}">&times;</button>
            <h2>${I18nModule.t('console_edit_modal_title')}</h2>

            <label class="console-edit__label" for="console-edit-name">${I18nModule.t('console_edit_name_label')}</label>
            <input type="text" id="console-edit-name" class="console-edit__input" value="${escapeHtml(c.name)}">

            <label class="console-edit__label" for="console-edit-manufacturer">${I18nModule.t('console_edit_manufacturer_label')}</label>
            <input type="text" id="console-edit-manufacturer" class="console-edit__input" value="${escapeHtml(c.manufacturer)}">

            <div class="console-edit__row2">
                <div>
                    <label class="console-edit__label" for="console-edit-generation">${I18nModule.t('console_generation_prefix')}</label>
                    <input type="number" id="console-edit-generation" class="console-edit__input" value="${escapeHtml(c.generation)}">
                </div>
                <div>
                    <label class="console-edit__label" for="console-edit-release">${I18nModule.t('console_edit_release_label')}</label>
                    <input type="number" id="console-edit-release" class="console-edit__input" value="${escapeHtml(c.release)}">
                </div>
            </div>

            <label class="console-edit__label">${I18nModule.t('console_edit_image_label')}</label>
            <div class="console-edit__upload">
                <img class="console-edit__upload-preview" src="${escapeHtml(resolveImagePath(c.image))}" alt="">
                <input type="hidden" id="console-edit-image-url" value="${escapeHtml(c.image || '')}">
                <label class="hero-button hero-button--syllabus">
                    <span>${I18nModule.t('tutorial_upload_photo')}</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none;">
                </label>
                <span class="console-edit__upload-status"></span>
            </div>

            <label class="console-edit__label">${I18nModule.t('console_edit_models_label')}</label>
            <div id="console-edit-models"></div>
            <button type="button" id="console-edit-add-model" class="console-edit__add-btn">${I18nModule.t('console_edit_add_item')}</button>

            <div class="console-edit__specs-grid">
                <fieldset>
                    <legend>${I18nModule.t('spec_cpu_title')}</legend>
                    ${consoleEditSpecField('console-edit-cpu-architecture', 'spec_label_architecture', c.cpu?.architecture)}
                    ${consoleEditSpecField('console-edit-cpu-process', 'spec_label_process', c.cpu?.proces_nm)}
                    ${consoleEditSpecField('console-edit-cpu-cores', 'spec_label_cores', c.cpu?.cores)}
                    ${consoleEditSpecField('console-edit-cpu-frequency', 'spec_label_clock', c.cpu?.frequency)}
                    ${consoleEditSpecField('console-edit-cpu-tdp', 'spec_label_tdp', c.cpu?.tdp)}
                </fieldset>
                <fieldset>
                    <legend>${I18nModule.t('spec_gpu_title')}</legend>
                    ${consoleEditSpecField('console-edit-gpu-architecture', 'spec_label_architecture', c.gpu?.architecture)}
                    ${consoleEditSpecField('console-edit-gpu-units', 'spec_label_units', c.gpu?.units)}
                    ${consoleEditSpecField('console-edit-gpu-frequency', 'spec_label_clock', c.gpu?.frequency)}
                    ${consoleEditSpecField('console-edit-gpu-tflops', 'spec_label_tflops', c.gpu?.tflops)}
                    ${consoleEditSpecField('console-edit-gpu-capabilities', 'spec_label_capabilities', c.gpu?.capabilities)}
                </fieldset>
                <fieldset>
                    <legend>${I18nModule.t('spec_memory_title')}</legend>
                    ${consoleEditSpecField('console-edit-memory-type', 'spec_label_type', c.memory?.type)}
                    ${consoleEditSpecField('console-edit-memory-capacity', 'spec_label_capacity', c.memory?.capacity)}
                    ${consoleEditSpecField('console-edit-memory-bus', 'spec_label_bus', c.memory?.bus)}
                    ${consoleEditSpecField('console-edit-memory-bandwidth', 'spec_label_bandwidth', c.memory?.bandwidth)}
                </fieldset>
                <fieldset>
                    <legend>${I18nModule.t('spec_storage_title')}</legend>
                    ${consoleEditSpecField('console-edit-storage-type', 'spec_label_type', c.storage?.type)}
                    ${consoleEditSpecField('console-edit-storage-interface', 'spec_label_interface', c.storage?.interface)}
                    ${consoleEditSpecField('console-edit-storage-speed', 'spec_label_speed', c.storage?.speed)}
                </fieldset>
                <fieldset>
                    <legend>${I18nModule.t('spec_output_title')}</legend>
                    ${consoleEditSpecField('console-edit-video-resolution', 'spec_label_resolution', c.output_video?.resolution)}
                    ${consoleEditSpecField('console-edit-video-refresh', 'spec_label_refresh', c.output_video?.refresh)}
                    ${consoleEditSpecField('console-edit-video-hdr', 'spec_label_hdr', c.output_video?.hdr)}
                    ${consoleEditSpecField('console-edit-video-upscaling', 'spec_label_upscaling', c.output_video?.upscaling)}
                </fieldset>
                <fieldset>
                    <legend>${I18nModule.t('spec_tech_title')}</legend>
                    <label class="console-edit__checkbox"><input type="checkbox" id="console-edit-tech-rt" ${c.technologies?.ray_tracing ? 'checked' : ''}> Ray Tracing</label>
                    <label class="console-edit__checkbox"><input type="checkbox" id="console-edit-tech-vrr" ${c.technologies?.vrr ? 'checked' : ''}> VRR</label>
                    ${consoleEditSpecField('console-edit-tech-backcompat', 'spec_label_backwards_compat', c.technologies?.backwards_compatibility)}
                    ${consoleEditSpecField('console-edit-tech-other', 'spec_label_capabilities', c.technologies?.other)}
                </fieldset>
            </div>

            <label class="console-edit__label">${I18nModule.t('console_pros_title')}</label>
            <div id="console-edit-advantages"></div>
            <button type="button" id="console-edit-add-advantage" class="console-edit__add-btn">${I18nModule.t('console_edit_add_item')}</button>

            <label class="console-edit__label">${I18nModule.t('console_cons_title')}</label>
            <div id="console-edit-disadvantages"></div>
            <button type="button" id="console-edit-add-disadvantage" class="console-edit__add-btn">${I18nModule.t('console_edit_add_item')}</button>

            <label class="console-edit__label" for="console-edit-history">${I18nModule.t('console_history_title')}</label>
            <textarea id="console-edit-history" class="console-edit__textarea" rows="10">${escapeHtml(c.history || '')}</textarea>

            <div class="console-edit__actions">
                <button type="button" id="console-edit-save" class="hero-button">${I18nModule.t('tutorial_save')}</button>
                <button type="button" id="console-edit-cancel" class="hero-button hero-button--syllabus">${I18nModule.t('tutorial_cancel')}</button>
            </div>
            <p id="console-edit-status"></p>
        </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const modelsWrap = overlay.querySelector('#console-edit-models');
    (Array.isArray(c.models) ? c.models : []).forEach(m => modelsWrap.appendChild(consoleEditModelRow(m)));
    overlay.querySelector('#console-edit-add-model').addEventListener('click', () => modelsWrap.appendChild(consoleEditModelRow()));

    const advWrap = overlay.querySelector('#console-edit-advantages');
    getLocalizedArray(c, 'advantages').forEach(a => advWrap.appendChild(consoleEditArrayRow(a)));
    overlay.querySelector('#console-edit-add-advantage').addEventListener('click', () => advWrap.appendChild(consoleEditArrayRow()));

    const consWrap = overlay.querySelector('#console-edit-disadvantages');
    getLocalizedArray(c, 'disadvantages').forEach(d => consWrap.appendChild(consoleEditArrayRow(d)));
    overlay.querySelector('#console-edit-add-disadvantage').addEventListener('click', () => consWrap.appendChild(consoleEditArrayRow()));

    // Image upload — same presign-then-PUT flow used everywhere else on the
    // site (kind: 'console', admin-gated server-side too, see uploads.js).
    const fileInput = overlay.querySelector('input[type="file"]');
    const preview = overlay.querySelector('.console-edit__upload-preview');
    const urlField = overlay.querySelector('#console-edit-image-url');
    const uploadStatus = overlay.querySelector('.console-edit__upload-status');
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        uploadStatus.textContent = I18nModule.t('tutorial_uploading');
        try {
            const presign = await apiConsole('POST', '/uploads/presign', { kind: 'console', contentType: file.type, fileSize: file.size });
            if (!presign.success) throw new Error(presign.error || 'Presign failed');
            const putRes = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
            if (!putRes.ok) throw new Error('Upload failed');
            urlField.value = presign.publicUrl;
            preview.src = presign.publicUrl;
            uploadStatus.textContent = '';
        } catch (err) {
            uploadStatus.textContent = err.message || I18nModule.t('tutorial_upload_error');
        }
    });

    function closeEditor() {
        overlay.remove();
        document.body.style.overflow = '';
    }
    overlay.querySelector('.console-edit-modal__close').addEventListener('click', closeEditor);
    overlay.querySelector('#console-edit-cancel').addEventListener('click', closeEditor);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeEditor(); });

    overlay.querySelector('#console-edit-save').addEventListener('click', async () => {
        const statusEl = overlay.querySelector('#console-edit-status');
        const val = id => overlay.querySelector('#' + id).value.trim();

        const payload = {
            name: val('console-edit-name'),
            manufacturer: val('console-edit-manufacturer'),
            generation: Number(val('console-edit-generation')) || 0,
            release: Number(val('console-edit-release')) || 0,
            image: urlField.value.trim(),
            models: readConsoleEditModels(),
            cpu: {
                architecture: val('console-edit-cpu-architecture'),
                proces_nm: val('console-edit-cpu-process'),
                cores: val('console-edit-cpu-cores'),
                frequency: val('console-edit-cpu-frequency'),
                tdp: val('console-edit-cpu-tdp'),
            },
            gpu: {
                architecture: val('console-edit-gpu-architecture'),
                units: val('console-edit-gpu-units'),
                frequency: val('console-edit-gpu-frequency'),
                tflops: val('console-edit-gpu-tflops'),
                capabilities: val('console-edit-gpu-capabilities'),
            },
            memory: {
                type: val('console-edit-memory-type'),
                capacity: val('console-edit-memory-capacity'),
                bus: val('console-edit-memory-bus'),
                bandwidth: val('console-edit-memory-bandwidth'),
            },
            storage: {
                type: val('console-edit-storage-type'),
                interface: val('console-edit-storage-interface'),
                speed: val('console-edit-storage-speed'),
            },
            output_video: {
                resolution: val('console-edit-video-resolution'),
                refresh: val('console-edit-video-refresh'),
                hdr: val('console-edit-video-hdr'),
                upscaling: val('console-edit-video-upscaling'),
            },
            technologies: {
                ray_tracing: overlay.querySelector('#console-edit-tech-rt').checked,
                vrr: overlay.querySelector('#console-edit-tech-vrr').checked,
                backwards_compatibility: val('console-edit-tech-backcompat'),
                other: val('console-edit-tech-other'),
            },
            advantages: readConsoleEditArray('console-edit-advantages'),
            disadvantages: readConsoleEditArray('console-edit-disadvantages'),
            history: overlay.querySelector('#console-edit-history').value,
        };

        if (!payload.name || !payload.manufacturer) {
            statusEl.textContent = I18nModule.t('tutorial_save_error');
            return;
        }

        statusEl.textContent = I18nModule.t('tutorial_saving');
        const consoleId = getConsoleIdFromUrl();
        const result = await apiConsole('PUT', `/consoles/${encodeURIComponent(consoleId)}`, payload);
        if (!result.success) {
            statusEl.textContent = result.error || I18nModule.t('tutorial_save_error');
            return;
        }

        currentConsole = result.console;
        invalidateCache();
        renderHero(currentConsole);
        renderHistory(currentConsole);
        renderSpecs(currentConsole);
        injectStructuredData(currentConsole, consoleId);
        closeEditor();
    });
}

const EDIT_PENCIL_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

function initAdminEditButton() {
    if (!isAdmin()) return;
    // Anchored after the meta row (manufacturer/year/generation), not the
    // title itself — keeps the <h1> (and its favorite-heart button) clean and
    // reads as a page-level admin action rather than crowding the heading.
    const anchor = document.querySelector('.console-hero-text .console-meta');
    if (!anchor || document.getElementById('console-edit-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'console-edit-btn';
    btn.className = 'console-edit-trigger';
    btn.innerHTML = `${EDIT_PENCIL_SVG}<span>${I18nModule.t('console_edit_btn')}</span>`;
    btn.addEventListener('click', openConsoleEditor);
    anchor.after(btn);
}

/**
 * Initialize the console detail page
 */
/** Main entry point: load console data and render all sections */
async function init() {
    cleanupConsolePageChrome();

    await loadImageDimensions();
    
    const consoleId = getConsoleIdFromUrl();
    if (!consoleId) {
        console.warn('No console ID found in URL');
        return;
    }

    const consola = await getConsoleById(consoleId);
    if (!consola) {
        console.warn(`Console "${consoleId}" not found in database`);
        return;
    }

    currentConsole = consola;

    renderHero(currentConsole);
    renderHistory(currentConsole);
    renderSpecs(currentConsole);
    renderRatingWidget(consoleId);
    initFavoriteButton(consoleId);
    initAdminEditButton();
    injectStructuredData(currentConsole, consoleId);

    // Mark console as visited on server
    try {
        await fetch('/api/consoles/visit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ console_id: consoleId })
        });
    } catch (err) {
        console.warn('Failed to mark console as visited:', err);
    }

    // Scroll to hash target if present (e.g. #rating)
    if (window.location.hash) {
        setTimeout(function () {
            var target = document.querySelector(window.location.hash);
            if (target) target.scrollIntoView({ behavior: 'smooth' });
        }, 300);
    }

    window.addEventListener('cn:language-changed', async () => {
        if (!consoleId) return;
        const refreshed = await getConsoleById(consoleId);
        if (refreshed) currentConsole = refreshed;
        renderHero(currentConsole);
        renderHistory(currentConsole);
        renderSpecs(currentConsole);
        initAdminEditButton();
        injectStructuredData(currentConsole, consoleId);
        loadRating(consoleId);
    });

    AchievementsModule.trackConsoleVisit(consoleId);
    window.dispatchEvent(new CustomEvent('cn:console-visited', {
        detail: { consoleId }
    }));
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

export { init };
