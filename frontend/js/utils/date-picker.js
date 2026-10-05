/**
 * CNote Custom Date Picker
 * Replaces a hidden <input type="hidden"> with a styled calendar dropdown.
 *
 * Usage:
 *   createDatePicker(containerEl, { value, placeholder, maxDate, minDate, onChange })
 *
 * Returns { getValue(), setValue(isoStr), destroy() }
 */

const MONTHS = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
];
const DAYS_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function pad(n) { return String(n).padStart(2, '0'); }

function toISO(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDisplay(isoStr) {
    if (!isoStr) return '';
    const [y, m, d] = isoStr.split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function createDatePicker(container, opts = {}) {
    const {
        value: initVal = '',
        placeholder = 'Select date',
        maxDate = null,
        minDate = null,
        onChange = null,
    } = opts;

    let selectedISO = initVal || '';
    let viewYear, viewMonth;
    let showingYearPicker = false;
    let isOpen = false;

    const today = new Date();
    if (selectedISO) {
        const [y, m] = selectedISO.split('-').map(Number);
        viewYear = y; viewMonth = m - 1;
    } else {
        viewYear = today.getFullYear();
        viewMonth = today.getMonth();
    }

    // ── Build DOM ─────────────────────────────────────────────────────────────

    container.classList.add('cn-datepicker');
    if (selectedISO) container.classList.add('cn-datepicker--has-value');

    container.innerHTML = `
        <button type="button" class="cn-datepicker__trigger" aria-haspopup="true" aria-expanded="false">
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" shape-rendering="crispEdges" data-px="83"><path d="M5 4h14v2H5zm0 16h14v2H5zM3 10h2v10H3zm0-4h2v2H3zm16 0h2v2h-2zm0 4h2v10h-2zM3 8h18v2H3zm12-6h2v2h-2zM7 2h2v2H7z"/></svg>
            <span class="cn-datepicker__trigger-text ${!selectedISO ? 'cn-datepicker__trigger-text--placeholder' : ''}">
                ${selectedISO ? formatDisplay(selectedISO) : placeholder}
            </span>
        </button>
        <button type="button" class="cn-datepicker__clear" aria-label="Clear date" tabindex="-1">✕</button>
        <div class="cn-datepicker__panel" role="dialog" aria-label="Date picker">
            <div class="cn-datepicker__header">
                <button type="button" class="cn-datepicker__nav cn-datepicker__prev" aria-label="Previous month">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="65"><path d="M8 13v-2h2v2H8Zm2-2V9h2v2h-2Zm0 4v-2h2v2h-2Zm2-6V7h2v2h-2Zm0 8v-2h2v2h-2Zm2-10V5h2v2h-2Zm0 12v-2h2v2h-2Z"/></svg>
                </button>
                <button type="button" class="cn-datepicker__month-label"></button>
                <button type="button" class="cn-datepicker__nav cn-datepicker__next" aria-label="Next month">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" shape-rendering="crispEdges" data-px="84"><path d="M16 13v-2h-2v2h2Zm-2-2V9h-2v2h2Zm0 4v-2h-2v2h2Zm-2-6V7h-2v2h2Zm0 8v-2h-2v2h2ZM10 7V5H8v2h2Zm0 12v-2H8v2h2Z"/></svg>
                </button>
            </div>
            <div class="cn-datepicker__body"></div>
            <div class="cn-datepicker__footer">
                <button type="button" class="cn-datepicker__footer-btn cn-datepicker__clear-btn">Clear</button>
                <button type="button" class="cn-datepicker__footer-btn cn-datepicker__footer-btn--today cn-datepicker__today-btn">Today</button>
            </div>
        </div>
    `;

    const trigger     = container.querySelector('.cn-datepicker__trigger');
    const triggerText = container.querySelector('.cn-datepicker__trigger-text');
    const clearBtnTrigger = container.querySelector('.cn-datepicker__clear');
    const panel       = container.querySelector('.cn-datepicker__panel');
    const prevBtn     = container.querySelector('.cn-datepicker__prev');
    const nextBtn     = container.querySelector('.cn-datepicker__next');
    const monthLabel  = container.querySelector('.cn-datepicker__month-label');
    const body        = container.querySelector('.cn-datepicker__body');
    const clearBtn    = container.querySelector('.cn-datepicker__clear-btn');
    const todayBtn    = container.querySelector('.cn-datepicker__today-btn');

    // ── Render ────────────────────────────────────────────────────────────────

    function renderCalendar() {
        monthLabel.textContent = `${MONTHS[viewMonth]} ${viewYear}`;
        showingYearPicker = false;

        const first = new Date(viewYear, viewMonth, 1);
        const startDay = first.getDay();
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const daysInPrev = new Date(viewYear, viewMonth, 0).getDate();

        const todayISO = toISO(today);

        let html = `
            <div class="cn-datepicker__weekdays">
                ${DAYS_SHORT.map(d => `<div class="cn-datepicker__weekday">${d}</div>`).join('')}
            </div>
            <div class="cn-datepicker__days">
        `;

        // Prev-month filler
        for (let i = startDay - 1; i >= 0; i--) {
            const day = daysInPrev - i;
            const iso = `${viewYear}-${pad(viewMonth === 0 ? 12 : viewMonth)}-${pad(day)}`;
            const y = viewMonth === 0 ? viewYear - 1 : viewYear;
            const m = viewMonth === 0 ? 12 : viewMonth;
            const isoFull = `${y}-${pad(m)}-${pad(day)}`;
            html += dayBtn(day, isoFull, true);
        }

        // Current month days
        for (let d = 1; d <= daysInMonth; d++) {
            const iso = `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`;
            html += dayBtn(d, iso, false, iso === todayISO, iso === selectedISO);
        }

        // Next-month filler (fill to complete rows)
        const total = startDay + daysInMonth;
        const remaining = total % 7 === 0 ? 0 : 7 - (total % 7);
        for (let d = 1; d <= remaining; d++) {
            const y = viewMonth === 11 ? viewYear + 1 : viewYear;
            const m = viewMonth === 11 ? 1 : viewMonth + 2;
            const iso = `${y}-${pad(m)}-${pad(d)}`;
            html += dayBtn(d, iso, true);
        }

        html += '</div>';
        body.innerHTML = html;

        body.querySelectorAll('.cn-datepicker__day:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => selectDate(btn.dataset.iso));
        });
    }

    function dayBtn(day, iso, otherMonth, isToday = false, isSelected = false) {
        const disabled = isDisabled(iso);
        const cls = [
            'cn-datepicker__day',
            otherMonth ? 'cn-datepicker__day--other-month' : '',
            isToday    ? 'cn-datepicker__day--today'       : '',
            isSelected ? 'cn-datepicker__day--selected'    : '',
        ].filter(Boolean).join(' ');
        return `<button type="button" class="${cls}" data-iso="${iso}"${disabled ? ' disabled' : ''}>${day}</button>`;
    }

    function isDisabled(iso) {
        if (maxDate && iso > maxDate) return true;
        if (minDate && iso < minDate) return true;
        return false;
    }

    function renderYearPicker() {
        showingYearPicker = true;
        const startYear = Math.max(1900, viewYear - 60);
        const endYear   = today.getFullYear();
        let html = '<div class="cn-datepicker__year-grid">';
        for (let y = endYear; y >= startYear; y--) {
            const sel = y === viewYear ? ' cn-datepicker__year-btn--selected' : '';
            html += `<button type="button" class="cn-datepicker__year-btn${sel}" data-year="${y}">${y}</button>`;
        }
        html += '</div>';
        body.innerHTML = html;
        // Scroll selected year into view
        const sel = body.querySelector('.cn-datepicker__year-btn--selected');
        if (sel) sel.scrollIntoView({ block: 'nearest' });

        body.querySelectorAll('.cn-datepicker__year-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                viewYear = +btn.dataset.year;
                renderCalendar();
            });
        });
    }

    // ── State changes ─────────────────────────────────────────────────────────

    function selectDate(iso) {
        if (isDisabled(iso)) return;
        selectedISO = iso;
        const [y, m] = iso.split('-').map(Number);
        viewYear = y; viewMonth = m - 1;
        updateTrigger();
        renderCalendar();
        close();
        onChange?.(iso);
    }

    function updateTrigger() {
        if (selectedISO) {
            triggerText.textContent = formatDisplay(selectedISO);
            triggerText.classList.remove('cn-datepicker__trigger-text--placeholder');
            container.classList.add('cn-datepicker--has-value');
        } else {
            triggerText.textContent = placeholder;
            triggerText.classList.add('cn-datepicker__trigger-text--placeholder');
            container.classList.remove('cn-datepicker--has-value');
        }
    }

    function open() {
        if (isOpen) return;
        isOpen = true;
        renderCalendar();
        panel.classList.add('cn-datepicker__panel--open');
        trigger.setAttribute('aria-expanded', 'true');
        // Flip up if not enough space below
        const rect = panel.getBoundingClientRect();
        if (rect.bottom > window.innerHeight - 20) {
            panel.style.top = 'auto';
            panel.style.bottom = 'calc(100% + 6px)';
        } else {
            panel.style.top = '';
            panel.style.bottom = '';
        }
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        panel.classList.remove('cn-datepicker__panel--open');
        trigger.setAttribute('aria-expanded', 'false');
        showingYearPicker = false;
    }

    // ── Events ────────────────────────────────────────────────────────────────

    trigger.addEventListener('click', (e) => {
        if (e.target.closest('.cn-datepicker__clear')) return;
        isOpen ? close() : open();
    });

    clearBtnTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedISO = '';
        updateTrigger();
        onChange?.('');
    });

    prevBtn.addEventListener('click', () => {
        if (showingYearPicker) return;
        viewMonth--;
        if (viewMonth < 0) { viewMonth = 11; viewYear--; }
        renderCalendar();
    });

    nextBtn.addEventListener('click', () => {
        if (showingYearPicker) return;
        viewMonth++;
        if (viewMonth > 11) { viewMonth = 0; viewYear++; }
        renderCalendar();
    });

    monthLabel.addEventListener('click', () => {
        showingYearPicker ? renderCalendar() : renderYearPicker();
    });

    clearBtn.addEventListener('click', () => {
        selectedISO = '';
        updateTrigger();
        close();
        onChange?.('');
    });

    todayBtn.addEventListener('click', () => {
        const todayISO = toISO(today);
        if (!isDisabled(todayISO)) selectDate(todayISO);
    });

    // Close on outside click — use composedPath so clicks inside still-rendering
    // panels (where innerHTML just changed) don't falsely trigger a close
    document.addEventListener('click', (e) => {
        if (isOpen && !e.composedPath().includes(container)) close();
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen) close();
    });

    // ── Public API ────────────────────────────────────────────────────────────

    return {
        getValue()  { return selectedISO; },
        setValue(iso) {
            selectedISO = iso || '';
            if (iso) {
                const [y, m] = iso.split('-').map(Number);
                viewYear = y; viewMonth = m - 1;
            }
            updateTrigger();
        },
        destroy() {
            container.innerHTML = '';
            container.classList.remove('cn-datepicker', 'cn-datepicker--has-value');
        }
    };
}
