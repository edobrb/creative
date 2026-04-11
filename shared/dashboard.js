/**
 * dashboard.js — Shared UI primitives for the control dashboard.
 *
 * Provides: panel shell, collapsible sections, stat grids,
 * slider rows, segmented controls, action bars, and the toggle button.
 */

// ─── Panel shell ─────────────────────────────────────────────

/**
 * Create the root dashboard panel.
 * @param {HTMLElement} container  Parent element to append to.
 * @param {string}      title     Dashboard heading text.
 * @returns {{ panel: HTMLDivElement, toggle: () => void, isVisible: () => boolean }}
 */
export function createDashboard(container, title) {
    const panel = document.createElement('div');
    panel.className = 'dashboard';

    const header = document.createElement('div');
    header.className = 'dash-header';

    const homeBtn = document.createElement('a');
    homeBtn.href = '/';
    homeBtn.className = 'dash-home-btn';
    homeBtn.title = 'Home';
    homeBtn.textContent = '⌂';

    const h1 = document.createElement('h1');
    h1.className = 'dash-title';
    h1.textContent = title;

    header.appendChild(homeBtn);
    header.appendChild(h1);
    panel.appendChild(header);

    panel.addEventListener('wheel', (e) => e.stopPropagation());
    panel.addEventListener('mousedown', (e) => e.stopPropagation());

    container.appendChild(panel);

    let visible = true;
    let floatBtn = null;

    const api = {
        panel,
        setFloatBtn(btn) { floatBtn = btn; },
        toggle() {
            visible = !visible;
            panel.classList.toggle('hidden', !visible);
            if (floatBtn) floatBtn.classList.toggle('panel-open', visible);
        },
        isVisible() { return visible; },
    };

    return api;
}

// ─── Float toggle button ─────────────────────────────────────

/**
 * Create the always-visible ☰ button.
 * @param {HTMLElement} parent   Where to append (usually document.body or container).
 * @param {Function}    onClick  Called on click.
 * @returns {HTMLButtonElement}
 */
export function createFloatToggle(parent, onClick) {
    const btn = document.createElement('button');
    btn.className = 'float-toggle-btn panel-open';
    btn.textContent = '☰';
    btn.title = 'Toggle settings';
    btn.addEventListener('click', onClick);
    btn.addEventListener('touchstart', (e) => e.stopPropagation());
    parent.appendChild(btn);
    return btn;
}

// ─── Collapsible section ─────────────────────────────────────

/**
 * @param {string}      title     Section header text.
 * @param {HTMLElement}  contentEl Inner content.
 * @param {boolean}      [open]   Start expanded (default false).
 * @returns {HTMLDivElement}
 */
export function createSection(title, contentEl, open = false) {
    const wrap = document.createElement('div');
    wrap.className = 'dash-section';

    const header = document.createElement('div');
    header.className = 'dash-section-header';

    const chevron = document.createElement('span');
    chevron.className = 'dash-chevron';
    chevron.textContent = open ? '▼' : '▶';

    const lbl = document.createElement('span');
    lbl.textContent = title;

    header.appendChild(lbl);
    header.appendChild(chevron);

    const body = document.createElement('div');
    body.className = 'dash-section-body' + (open ? '' : ' collapsed');
    body.appendChild(contentEl);

    header.addEventListener('click', () => {
        const isOpen = !body.classList.contains('collapsed');
        body.classList.toggle('collapsed', isOpen);
        chevron.textContent = isOpen ? '▶' : '▼';
    });

    wrap.appendChild(header);
    wrap.appendChild(body);
    return wrap;
}

// ─── Stats grid ──────────────────────────────────────────────

/**
 * Build a label–value stats grid.
 * @param {Array<{key:string, label:string, editable?:boolean}>} defs
 * @returns {{ el: HTMLDivElement, fields: Record<string, HTMLElement> }}
 */
export function createStatsGrid(defs) {
    const grid = document.createElement('div');
    grid.className = 'dash-stats';
    const fields = {};

    for (const { key, label, editable } of defs) {
        const lbl = document.createElement('span');
        lbl.className = 'stat-label';
        lbl.textContent = label;
        grid.appendChild(lbl);

        if (editable) {
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'stat-value stat-input';
            inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') inp.blur();
                e.stopPropagation();
            });
            grid.appendChild(inp);
            fields[key] = inp;
        } else {
            const val = document.createElement('span');
            val.className = 'stat-value';
            grid.appendChild(val);
            fields[key] = val;
        }
    }

    return { el: grid, fields };
}

// ─── Slider row ──────────────────────────────────────────────

/**
 * Add a labelled slider + number input row to a container.
 *
 * @param {HTMLElement} parent
 * @param {string}      label
 * @param {number}      min
 * @param {number}      max
 * @param {number}      step
 * @param {Function}    getter   () => currentValue
 * @param {Function}    setter   (newValue) => void
 * @param {object}      [opts]
 * @param {boolean}     [opts.logarithmic=false]
 * @param {boolean}     [opts.integer=false]
 * @returns {{ slider: HTMLInputElement, numInput: HTMLInputElement }}
 */
export function addSlider(parent, label, min, max, step, getter, setter, opts = {}) {
    const { logarithmic = false, integer = false } = opts;

    const row = document.createElement('div');
    row.className = 'dash-row';

    const lbl = document.createElement('label');
    lbl.className = 'dash-label';
    lbl.textContent = label;

    const group = document.createElement('div');
    group.className = 'dash-slider-group';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'dash-slider';
    slider.min = logarithmic ? Math.log10(min) : min;
    slider.max = logarithmic ? Math.log10(max) : max;
    slider.step = logarithmic ? 0.001 : step;
    slider.value = logarithmic ? Math.log10(getter()) : getter();

    const numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.className = 'dash-number';
    numInput.min = min;
    numInput.max = max;
    numInput.step = step;
    numInput.value = logarithmic ? Number(getter().toFixed(4)) : getter();

    function sync(raw) {
        const parsed = integer ? parseInt(raw, 10) : parseFloat(raw);
        const v = Math.max(min, Math.min(max, isNaN(parsed) ? getter() : parsed));
        slider.value = logarithmic ? Math.log10(v) : v;
        numInput.value = logarithmic ? Number(v.toFixed(4)) : v;
        setter(v);
    }

    function fromSlider() {
        const rawVal = parseFloat(slider.value);
        const v = logarithmic ? Math.pow(10, rawVal) : rawVal;
        const clamped = Math.max(min, Math.min(max, v));
        setter(clamped);
        numInput.value = Number(clamped.toFixed(4));
    }

    function fromNumber() {
        const v = Math.max(min, Math.min(max, parseFloat(numInput.value) || min));
        setter(v);
        slider.value = logarithmic ? Math.log10(v) : v;
        numInput.value = Number(v.toFixed(4));
    }

    if (logarithmic) {
        slider.addEventListener('input', fromSlider);
        numInput.addEventListener('change', fromNumber);
    } else {
        slider.addEventListener('input', () => sync(slider.value));
        numInput.addEventListener('change', () => sync(numInput.value));
    }

    numInput.addEventListener('keydown', (e) => e.stopPropagation());

    group.appendChild(slider);
    group.appendChild(numInput);
    row.appendChild(lbl);
    row.appendChild(group);
    parent.appendChild(row);

    return { slider, numInput };
}

// ─── Segmented control ───────────────────────────────────────

/**
 * Build a row with a label and segmented buttons.
 *
 * @param {string}          label
 * @param {string[]}        options     Button labels/values.
 * @param {string}          activeValue Currently active value.
 * @param {Function}        onChange    (value) => void
 * @returns {{ el: HTMLDivElement, buttons: Record<string, HTMLButtonElement> }}
 */
export function createSegmentedControl(label, options, activeValue, onChange) {
    const row = document.createElement('div');
    row.className = 'dash-row';

    const lbl = document.createElement('span');
    lbl.className = 'dash-label';
    lbl.textContent = label;

    const seg = document.createElement('div');
    seg.className = 'seg-control';

    const buttons = {};
    for (const value of options) {
        const btn = document.createElement('button');
        btn.className = 'seg-btn' + (activeValue === value ? ' active' : '');
        btn.textContent = value;
        btn.addEventListener('click', () => {
            seg.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            onChange(value);
        });
        seg.appendChild(btn);
        buttons[value] = btn;
    }

    row.appendChild(lbl);
    row.appendChild(seg);

    return { el: row, buttons };
}

// ─── Action bar ──────────────────────────────────────────────

/**
 * Create an action bar container with buttons.
 *
 * @param {Array<{label:string, onClick:Function, className?:string}>} actions
 * @returns {{ el: HTMLDivElement, buttons: Record<string, HTMLButtonElement> }}
 */
export function createActionBar(actions) {
    const bar = document.createElement('div');
    bar.className = 'action-bar';
    const buttons = {};

    for (const { label, onClick, className } of actions) {
        const btn = document.createElement('button');
        btn.className = 'dash-btn action-btn' + (className ? ' ' + className : '');
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        bar.appendChild(btn);
        buttons[label] = btn;
    }

    return { el: bar, buttons };
}
