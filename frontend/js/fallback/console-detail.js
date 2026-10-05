/**
 * Console Detail Fallback Script
 * Works without ES modules (file:// protocol)
 * Tries to fetch consoles.json and render the page dynamically
 */
(function () {
    'use strict';

    /** Remove leftover Chrome UI elements from template */
    function cleanupConsolePageChrome() {
        var homeLink = document.querySelector('.nav-links a[href="../index.html"]');
        if (homeLink && homeLink.parentElement) {
            homeLink.parentElement.remove();
        }

        var githubLink = document.querySelector('.footer-right a[href*="github.com"]');
        if (githubLink && githubLink.parentElement) {
            githubLink.parentElement.removeChild(githubLink);
        }
    }

    // Image dimensions mapping - prevents layout shift during load
    var IMAGE_DIMENSIONS = {};

    /**
     * Load image dimensions from JSON
     */
    /** Load pre-computed image dimensions from JSON (for CLS prevention) */
    function loadImageDimensions() {
        if (window.IMAGE_DIMENSIONS_DATA) {
            IMAGE_DIMENSIONS = window.IMAGE_DIMENSIONS_DATA;
            return Promise.resolve(IMAGE_DIMENSIONS);
        }
        var path = '../../../js/data/image-dimensions.json';
        var loadFn = (window.location.protocol === 'file:')
            ? loadJsonWithXhr(path)
            : fetch(path).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            });
        return loadFn
            .then(function (data) {
                IMAGE_DIMENSIONS = data;
                return data;
            })
            .catch(function (err) {
                console.warn('Failed to load image dimensions:', err.message);
                return {};
            });
    }

    /** Load JSON via XHR (file:// protocol friendly, no fetch) */
    function loadJsonWithXhr(path) {
        return new Promise(function (resolve, reject) {
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', path, true);
                xhr.overrideMimeType('application/json');
                xhr.onload = function () {
                    if (xhr.status === 200 || xhr.status === 0) {
                        try {
                            resolve(JSON.parse(xhr.responseText));
                        } catch (e) {
                            reject(e);
                        }
                    } else {
                        reject(new Error('HTTP ' + xhr.status));
                    }
                };
                xhr.onerror = function () { reject(new Error('XHR error')); };
                xhr.send();
            } catch (err) {
                reject(err);
            }
        });
    }


    // Hamburger menu
    var hamburger = document.querySelector('.hamburger');
    var navLinks = document.querySelector('.nav-links');
    if (hamburger && navLinks) {
        hamburger.addEventListener('click', function () {
            var expanded = hamburger.getAttribute('aria-expanded') === 'true';
            hamburger.setAttribute('aria-expanded', String(!expanded));
            hamburger.classList.toggle('active');
            navLinks.classList.toggle('active');
        });
    }

    // Determine console ID from filename
    /** Extract console ID from URL query param or filename */
    function getConsoleId() {
        var params = new URLSearchParams(window.location.search);
        var idParam = params.get('id');
        if (idParam) return idParam;

        var path = window.location.pathname;
        var parts = path.replace(/\\/g, '/').split('/');
        var filename = parts[parts.length - 1];
        if (filename && filename.indexOf('.html') !== -1) {
            return filename.replace('.html', '');
        }
        return null;
    }

    /** Track console page visit for achievement system */
    function trackConsoleVisit(consoleId) {
        try {
            var visited = JSON.parse(localStorage.getItem('cn_visited_consoles')) || [];
            if (!visited.includes(consoleId)) {
                visited.push(consoleId);
                localStorage.setItem('cn_visited_consoles', JSON.stringify(visited));
            }
            window.dispatchEvent(new CustomEvent('cn:console-visited', {
                detail: { consoleId: consoleId }
            }));
        } catch (_) {
            // noop
        }
    }

    // Format a boolean value
    function formatBool(val) {
        if (val === true) return 'Yes';
        if (val === false) return 'No';
        return val || 'N/A';
    }

    // Check if value is meaningful
    function isNA(val) {
        return !val || val === 'N/A' || val === 'n/a';
    }

    // Format label-value pairs into HTML
    function formatList(pairs) {
        var filtered = pairs.filter(function (p) { return !isNA(p[1]); });
        if (filtered.length === 0) return '<p>\u2014</p>';
        return filtered.map(function (p) {
            return '<strong>' + p[0] + ':</strong> ' + p[1];
        }).join('<br>');
    }

    /* ── Spec tooltips ── */
    var SPEC_TIPS = {
        'Architecture':     'The processor design family — defines supported instructions, efficiency, and performance generation (e.g. Zen 2, RDNA 2).',
        'Process':          'Manufacturing node in nanometres (nm). Smaller = more transistors in less space = faster and more power-efficient chip.',
        'Cores':            'Number of independent processing threads. More cores allow the system to run more tasks simultaneously.',
        'Clock Speed':      'Operating frequency in GHz (billions of cycles per second). Higher frequency means instructions are processed faster.',
        'TDP':              'Thermal Design Power in Watts — how much heat the chip produces at maximum load. Also reflects total power draw.',
        'Units':            'Compute Units or Shader Processors inside the GPU. More units = more parallel graphics calculations = better visual performance.',
        'TFLOPS':           'Trillion Floating-Point Operations Per Second — a measure of raw GPU compute power. Higher = faster 3D rendering.',
        'Type':             'Memory or storage technology standard. e.g. GDDR6 = fast video RAM; NVMe SSD = solid-state drive with fast PCIe interface.',
        'Capacity':         'Total amount in Gigabytes (GB). More memory allows the system to hold larger game worlds and assets without slowdowns.',
        'Bus':              'Width of the memory data channel in bits. A wider bus transfers more data per clock cycle.',
        'Bandwidth':        'Speed at which data moves between the CPU/GPU and memory, in GB/s. Higher bandwidth reduces bottlenecks.',
        'Interface':        'How the storage device connects to the system. PCIe 4.0/5.0 is significantly faster than SATA III.',
        'Speed':            'Sequential read/write throughput in GB/s. Directly affects load times and asset streaming speed.',
        'Resolution':       'Number of pixels displayed (e.g. 4K = 3840\u00d72160). More pixels = sharper, more detailed image.',
        'Refresh':          'How many times per second the screen redraws the image (Hz). 60\u00a0Hz is smooth; 120\u00a0Hz is very smooth motion.',
        'HDR':              'High Dynamic Range \u2014 a wider range of brightness and colour for more realistic, vivid visuals.',
        'Upscaling':        'Technology that renders at a lower resolution and intelligently scales up to the target resolution, saving GPU power.',
        'Backwards Compat': 'Ability to run games designed for older, previous-generation consoles.',
        'Ray Tracing':      'Simulates how light physically bounces off surfaces in real time \u2014 produces realistic reflections, shadows, and global illumination.',
        'VRR':              "Variable Refresh Rate \u2014 the display dynamically syncs its refresh rate to the GPU's output, eliminating screen tearing and stutter.",
    };

    var HELP_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="currentColor" shape-rendering="crispEdges"><path d="M18 22H6V20H18V22ZM6 20H4V18H6V20ZM20 20H18V18H20V20ZM4 18H2V6H4V18ZM22 18H20V6H22V18ZM13 17H11V11H13V17ZM13 9H11V7H13V9ZM6 6H4V4H6V6ZM20 6H18V4H20V6ZM18 4H6V2H18V4Z"/></svg>';

    function tip(label) {
        var text = SPEC_TIPS[label];
        if (!text) return label;
        return label + '<button class="spec-help" type="button" aria-label="' + text + '">' + HELP_SVG + '<span class="spec-tooltip">' + text + '</span></button>';
    }

    var _specTooltipsListenerAdded = false;
    function initSpecTooltips() {
        document.querySelectorAll('.spec-help').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var wasOpen = btn.classList.contains('is-open');
                document.querySelectorAll('.spec-help.is-open').forEach(function (b) { b.classList.remove('is-open'); });
                if (!wasOpen) btn.classList.add('is-open');
            });
        });
        if (!_specTooltipsListenerAdded) {
            _specTooltipsListenerAdded = true;
            document.addEventListener('click', function () {
                document.querySelectorAll('.spec-help.is-open').forEach(function (b) { b.classList.remove('is-open'); });
            });
        }
    }

    // Spec sections definition
    var SPEC_SECTIONS = [
        {
            group: 'Primary',
            cards: [
                {
                    title: 'Processing (CPU)',
                    keys: function (c) {
                        return [
                            [tip('Architecture'), c.cpu.architecture],
                            [tip('Process'), c.cpu.proces_nm],
                            [tip('Cores'), c.cpu.cores],
                            [tip('Clock Speed'), c.cpu.frequency],
                            [tip('TDP'), c.cpu.tdp]
                        ];
                    }
                },
                {
                    title: 'Graphics (GPU)',
                    keys: function (c) {
                        return [
                            [tip('Architecture'), c.gpu.architecture],
                            [tip('Units'), c.gpu.units],
                            [tip('Clock Speed'), c.gpu.frequency],
                            [tip('TFLOPS'), c.gpu.tflops],
                            ['Capabilities', c.gpu.capabilities]
                        ];
                    }
                },
                {
                    title: 'Memory',
                    keys: function (c) {
                        return [
                            [tip('Type'), c.memory.type],
                            [tip('Capacity'), c.memory.capacity],
                            [tip('Bus'), c.memory.bus],
                            [tip('Bandwidth'), c.memory.bandwidth]
                        ];
                    }
                },
                {
                    title: 'Storage',
                    keys: function (c) {
                        return [
                            [tip('Type'), c.storage.type],
                            [tip('Interface'), c.storage.interface],
                            [tip('Speed'), c.storage.speed]
                        ];
                    }
                }
            ]
        },
        {
            group: 'Secondary',
            cards: [
                {
                    title: 'Video Output',
                    keys: function (c) {
                        return [
                            [tip('Resolution'), c.output_video.resolution],
                            [tip('Refresh'), c.output_video.refresh],
                            [tip('HDR'), c.output_video.hdr],
                            ['Upscaling', c.output_video.upscaling]
                        ];
                    }
                },
                {
                    title: 'Technologies',
                    keys: function (c) {
                        return [
                            [tip('Ray Tracing'), formatBool(c.technologies.ray_tracing)],
                            [tip('VRR'), formatBool(c.technologies.vrr)],
                            [tip('Backwards Compat'), c.technologies.backwards_compatibility],
                            ['Other', c.technologies.other]
                        ];
                    }
                }
            ]
        }
    ];

    /** Render the console history timeline section */
    function renderHistory(consola) {
        var specsSection = document.querySelector('.specs-section');
        if (!specsSection) return;

        var historySection = document.querySelector('.history-section');
        if (!historySection) {
            historySection = document.createElement('section');
            historySection.className = 'section history-section';
            var inner = document.createElement('div');
            inner.className = 'container';
            historySection.appendChild(inner);
            specsSection.parentNode.insertBefore(historySection, specsSection);
        }

        var container = historySection.querySelector('.container');
        var titleHtml = '<h2 class="section-title">History</h2>';
        var historyHtml = '';

        if (consola.history && String(consola.history).trim()) {
            var text = String(consola.history);
            text = text.replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '\n\n');
            text = text.replace(/<br\s*\/?>/gi, '\n');

            var blocks = text.split('\n\n').map(function (b) { return b.trim(); }).filter(Boolean);
            var sections = [];
            var currentSection = null;

            function pushCurrent() {
                if (!currentSection) return;
                if (currentSection.heading || currentSection.paragraphs.length) {
                    sections.push(currentSection);
                }
                currentSection = null;
            }

            blocks.forEach(function (block) {
                var lines = block.split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
                var trimmed = block.trim();

                if (lines.length > 1) {
                    var firstLine = lines[0];
                    var firstLineStrong = firstLine.match(/^<strong>(.*?)<\/strong>$/i);
                    var isHeadingLine = firstLineStrong || (firstLine.length < 80 && firstLine.indexOf('.') === -1 && firstLine.indexOf('<') === -1 && /^[A-Z\u0102\u00C2\u00CE\u0218\u021A]/.test(firstLine));

                    if (isHeadingLine) {
                        pushCurrent();
                        var heading = (firstLineStrong ? firstLineStrong[1] : firstLine).trim();
                        var content = lines.slice(1).join('\n').trim();
                        currentSection = { heading: heading, paragraphs: [] };
                        if (content) currentSection.paragraphs.push(content);
                        return;
                    }
                }

                var strongMatch = trimmed.match(/^<strong>(.*?)<\/strong>$/i);
                if (strongMatch) {
                    pushCurrent();
                    currentSection = { heading: strongMatch[1].trim(), paragraphs: [] };
                    return;
                }

                if (trimmed.length < 80 && trimmed.indexOf('.') === -1 && trimmed.indexOf('<') === -1 && /^[A-Z\u0102\u00C2\u00CE\u0218\u021A]/.test(trimmed)) {
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

            var autoTitles = ['Context', 'Details', 'Evolution', 'Impact', 'Legacy'];
            var autoIndex = 0;

            var rendered = sections.map(function (section) {
                var heading = section.heading;
                if (!heading) {
                    heading = autoTitles[Math.min(autoIndex, autoTitles.length - 1)];
                    autoIndex += 1;
                }

                var paragraphs = section.paragraphs.map(function (paragraph) {
                    return '<p>' + paragraph.replace(/\n/g, '<br>') + '</p>';
                }).join('');

                return '<h3 class="history-heading">' + heading + '</h3>' + paragraphs;
            }).join('');

            historyHtml = '<div class="history-content">' + rendered + '</div>';
        } else {
            historyHtml = '<div class="history-content"></div>';
        }

        // SAFE: data from internal catalog JSON (consoles-en.json) or backend /api/consoles.
        // titleHtml and historyHtml are built from authored console metadata, not user input.
        container.innerHTML = titleHtml + historyHtml;
    }

    /** Render the hero section: image, title, tagline */
    function renderHero(consola) {

        var h1 = document.querySelector('.console-hero-text h1');
        if (h1) h1.textContent = consola.name;

        var meta = document.querySelector('.console-hero-text .console-meta');
        if (meta) {
            // SAFE: manufacturer, release, generation are authored catalog fields, not user input.
            meta.innerHTML =
                '<span>' + consola.manufacturer + '</span>' +
                '<span>' + consola.release + '</span>' +
                '<span>Generation ' + consola.generation + '</span>';
        }

        // Models / hardware revisions
        var modelsEl = document.querySelector('.console-hero-text .console-models');
        if (!modelsEl && meta) {
            modelsEl = document.createElement('div');
            modelsEl.className = 'console-models';
            meta.parentNode.insertBefore(modelsEl, meta.nextSibling);
        }
        if (modelsEl) {
            if (consola.models && consola.models.length > 0) {
                // SAFE: m.name and m.year are authored catalog fields, not user input.
                modelsEl.innerHTML = consola.models.map(function (m) {
                    return '<span class="console-model-item">' + m.name + '<em> ' + m.year + '</em></span>';
                }).join('');
                modelsEl.style.display = '';
            } else {
                modelsEl.style.display = 'none';
            }
        }

        var img = document.querySelector('.console-hero-image img');
        if (img) {
            img.src = '../../../' + consola.image;
            img.alt = consola.name;
            
            // Set width and height to prevent layout shift
            var imageName = consola.image.split('/').pop();
            var dimensions = IMAGE_DIMENSIONS[imageName];
            if (dimensions) {
                img.width = dimensions.width;
                img.height = dimensions.height;
            }
        }

        document.title = consola.name + ' \u2014 Console Notebook';
    }

    /** Render the specs accordion from SPEC_SECTIONS config */
    function renderSpecs(consola) {
        var container = document.querySelector('.specs-section .container');
        if (!container) return;

        var html = '<h2 class="section-title">Key Specifications</h2>' +
            '<p class="specs-hint">Tap or hover the <strong>\u24d8</strong> icons next to any label for a plain-language explanation of that term.</p>';

        SPEC_SECTIONS.forEach(function (section) {
            html += '<div class="specs-group">';
            html += '<h3 class="specs-group-title">' + section.group + '</h3>';
            html += '<div class="specs-grid">';

            section.cards.forEach(function (card) {
                html += '<div class="spec-card">';
                html += '<h4>' + card.title + '</h4>';
                html += '<p>' + formatList(card.keys(consola)) + '</p>';
                html += '</div>';
            });

            html += '</div></div>';
        });

        // Verdict
        var hasAvantaje = consola.advantages && consola.advantages.length > 0;
        var hasDezavantaje = consola.disadvantages && consola.disadvantages.length > 0;

        if (hasAvantaje || hasDezavantaje) {
            html += '<div class="specs-group">';
            html += '<h3 class="specs-group-title">Verdict</h3>';
            html += '<div class="specs-grid">';

            if (hasAvantaje) {
                html += '<div class="spec-card"><h4 class="pros-title">Advantages</h4>';
                html += '<ul class="verdict-list pros-list">';
                consola.advantages.forEach(function (p) {
                    html += '<li class="pro-item">\u2713 ' + p + '</li>';
                });
                html += '</ul></div>';
            }

            if (hasDezavantaje) {
                html += '<div class="spec-card"><h4 class="cons-title">Disadvantages</h4>';
                html += '<ul class="verdict-list cons-list">';
                consola.disadvantages.forEach(function (c) {
                    html += '<li class="con-item">\u2717 ' + c + '</li>';
                });
                html += '</ul></div>';
            }

            html += '</div></div>';
        }

        // SAFE: `html` is built entirely from internal catalog JSON fields
        // (spec labels, values, advantages, disadvantages) — not user input.
        container.innerHTML = html;
        initSpecTooltips();
    }

    function showError(msg) {
        var container = document.querySelector('.specs-section .container');
        if (container) {
            // SAFE: `msg` is a hardcoded internal error string set only by this file's
            // own error handling branches (e.g. 'Could not load data. Please open...').
            // It is never sourced from user input or API response bodies.
            container.innerHTML =
                '<h2 class="section-title">Eroare</h2>' +
                '<p class="console-loading">' + msg + '</p>';
        }
    }

    // Main init
    function init() {
        cleanupConsolePageChrome();

        var consoleId = getConsoleId();
        if (!consoleId) {
            showError('Nu s-a putut determina consola din URL.');
            return;
        }

        // Load image dimensions and console data
        Promise.all([
            loadImageDimensions(),
            (function () {
                // Nu mai încercăm consoles.json, doar consoles-en.json sau API
                if (window.location.protocol === 'file:') {
                    return loadJsonWithXhr('../../../js/data/consoles-en.json').catch(function() { return window.CONSOLES_DATA || null; });
                }
                return fetch('/api/consoles?lang=en').then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                }).catch(function() {
                    return fetch('../../../js/data/consoles-en.json').then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).catch(function() { return window.CONSOLES_DATA || null; });
                });
            })()
        ])
            .then(function (results) {
                var data = results[1];
                var consola = null;
                for (var i = 0; i < data.length; i++) {
                    if (data[i].id === consoleId) {
                        consola = data[i];
                        break;
                    }
                }
                if (!consola) {
                    showError('Console "' + consoleId + '" was not found in the database.');
                    return;
                }
                renderHero(consola);
                renderHistory(consola);
                renderSpecs(consola);
                trackConsoleVisit(consoleId);
            })
            .catch(function (err) {
                console.warn('Fallback: fetch failed', err);
                showError('Could not load data. Please open the page through an HTTP server.');
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
