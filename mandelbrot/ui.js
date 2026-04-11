/**
 * ui.js — Settings dashboard.
 *
 * Layout (top → bottom):
 *   Live stats · Rendering · Colors · Navigation · Bookmarks · Action bar
 */

import { randomPalette } from './colors.js';
import { getBookmarks, addBookmark, removeBookmark, encodeShareHash } from './storage.js';
import {
    createDashboard, createFloatToggle, createSection,
    createStatsGrid, addSlider as sharedAddSlider,
    createSegmentedControl, createActionBar,
} from '../shared/dashboard.js';
import { GradientEditor } from '../shared/gradient-editor.js';

export class UI {
    constructor(container, settings, state, callbacks = {}) {
        this.container = container;
        this.settings = settings;
        this.state = state;
        this.callbacks = callbacks;

        this._visible = true;
        this._panel = null;
        this._fields = {};
        this._bookmarksList = null;
        this._ge = null;
        this._floatBtn = null;
        this._helpEl = null;

        this._build();
    }

    // ─── Build ───────────────────────────────────────

    _build() {
        const dash = createDashboard(this.container, 'Mandelbrot set explorer');
        const panel = dash.panel;
        this._dash = dash;

        panel.appendChild(createSection('Coordinates', this._buildLive(), true));
        panel.appendChild(createSection('Iterations', this._buildRendering()));
        panel.appendChild(createSection('Colors', this._buildColors()));
        panel.appendChild(createSection('Bookmarks', this._buildBookmarks()));
        panel.appendChild(createSection('Controls', this._buildNavigation()));
        panel.appendChild(this._buildActionBar());

        const help = document.createElement('div');
        help.className = 'dash-help';
        panel.appendChild(help);
        this._helpEl = help;
        this._updateHelp();

        this._panel = panel;

        // Floating toggle button (always visible)
        this._floatBtn = createFloatToggle(document.body, () => this.toggle());
        dash.setFloatBtn(this._floatBtn);
    }

    // _section removed — using shared createSection instead

    // ─── Live stats ──────────────────────────────────

    _buildLive() {
        const { el, fields } = createStatsGrid([
            { key: 'centerX', label: 'Center X', editable: true },
            { key: 'centerY', label: 'Center Y', editable: true },
            { key: 'zoom',    label: 'Zoom',     editable: true },
            { key: 'iters',   label: 'Iterations' },
            { key: 'frameMs', label: 'Frame ms' },
            { key: 'res',     label: 'Resolution' },
        ]);

        // Wire up editable field blur handlers
        for (const key of ['centerX', 'centerY', 'zoom']) {
            fields[key].addEventListener('blur', () => this._applyStatInput(key, fields[key].value));
        }

        Object.assign(this._fields, fields);
        return el;
    }

    // ─── Rendering ───────────────────────────────────

    _buildRendering() {
        const wrap = document.createElement('div');

        const { el: modeRow, buttons: modeButtons } = createSegmentedControl(
            'Max iter mode',
            ['Dynamic', 'Fixed'],
            this.state.maxiterMode,
            (value) => { this.state.maxiterMode = value; this.state.dirty = true; }
        );
        this._fields['maxiterMode_Dynamic'] = modeButtons['Dynamic'];
        this._fields['maxiterMode_Fixed'] = modeButtons['Fixed'];
        wrap.appendChild(modeRow);

        this._addSlider(wrap, 'Max iterations', 'baseMaxIter',
            10, 10000, 1, true,
            () => this.state.baseMaxIter,
            (v) => { this.state.baseMaxIter = v; this.state.dirty = true; }
        );

        return wrap;
    }

    // ─── Colors ──────────────────────────────────────

    _buildColors() {
        const wrap = document.createElement('div');

        this._addSlider(wrap, 'Color period', 'colorPeriod',
            8, 4096, 1, true,
            () => this.settings.colorPeriod,
            (v) => { this.settings.colorPeriod = v; this.state.dirty = true; }
        );

        // ── Gradient Editor (shared widget) ──
        this._ge = new GradientEditor({
            colors:           this.settings.colors,
            weights:          this.settings.weights,
            gradientFunction: this.settings.gradientFunction,
            onChange:          () => this._geNotify(),
        });

        // Add randomize button to its toolbar
        const randomBtn = document.createElement('button');
        randomBtn.className = 'dash-btn ge-dice';
        randomBtn.textContent = '🎲';
        randomBtn.title = 'Random palette';
        randomBtn.addEventListener('click', () => this._geRandomize());
        this._ge.toolbar.appendChild(randomBtn);

        wrap.appendChild(this._ge.el);
        this._ge.rebuild();

        return wrap;
    }

    _geNotify() {
        this.settings._colorVersion = (this.settings._colorVersion || 0) + 1;
        this.state.dirty = true;
    }

    _geRandomize() {
        const palette = randomPalette();
        this.settings.colors = palette.colors;
        this.settings.weights = palette.weights;
        this.settings.colorPeriod = palette.colorPeriod;
        if (this._fields['colorPeriod_slider']) this._fields['colorPeriod_slider'].value = palette.colorPeriod;
        if (this._fields['colorPeriod_num']) this._fields['colorPeriod_num'].value = palette.colorPeriod;
        // Re-sync the shared editor with new data
        this._ge.colors = this.settings.colors;
        this._ge.weights = this.settings.weights;
        this._ge.rebuild();
        this._geNotify();
    }

    // Called by reset handler in action bar.
    _onStopsChanged() {
        this._ge.colors = this.settings.colors;
        this._ge.weights = this.settings.weights;
        this._ge.rebuild();
        this._geNotify();
    }

    // ─── Navigation ──────────────────────────────────

    _buildNavigation() {
        const wrap = document.createElement('div');

        this._addSlider(wrap, 'Scroll zoom speed', 'zoomSpeed',
            0.50, 0.99, 0.01, false,
            () => this.settings.zoomSpeed,
            (v) => { this.settings.zoomSpeed = v; }
        );
        this._addSlider(wrap, 'Key zoom speed', 'keyZoomSpeed',
            0.50, 0.99, 0.01, false,
            () => this.settings.keyZoomSpeed,
            (v) => { this.settings.keyZoomSpeed = v; }
        );
        this._addSlider(wrap, 'Pan speed', 'panSpeed',
            0.01, 0.40, 0.01, false,
            () => this.settings.panSpeed,
            (v) => { this.settings.panSpeed = v; }
        );

        return wrap;
    }

    // ─── Bookmarks ───────────────────────────────────

    _buildBookmarks() {
        const wrap = document.createElement('div');

        const saveRow = document.createElement('div');
        saveRow.className = 'dash-row';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'dash-text-input';
        nameInput.placeholder = 'Name…';
        nameInput.maxLength = 60;

        const saveBtn = document.createElement('button');
        saveBtn.className = 'dash-btn';
        saveBtn.textContent = 'Save current';

        const settingsRow = document.createElement('div');
        settingsRow.className = 'dash-row dash-row--checkbox';
        const settingsCheck = document.createElement('input');
        settingsCheck.type = 'checkbox';
        settingsCheck.id = 'bm-save-settings';
        settingsCheck.className = 'dash-checkbox';
        settingsCheck.checked = true;
        const settingsLbl = document.createElement('label');
        settingsLbl.htmlFor = 'bm-save-settings';
        settingsLbl.className = 'dash-label dash-label--minor';
        settingsLbl.textContent = 'Also save color & iter settings';
        settingsRow.appendChild(settingsCheck);
        settingsRow.appendChild(settingsLbl);

        saveBtn.addEventListener('click', () => {
            const name = nameInput.value.trim() || `Point ${getBookmarks().length + 1}`;
            const bm = {
                name,
                x: this.state.centerBF_X
                    ? this.state.centerBF_X.toDecimalString(40)
                    : String(this.state.centerX),
                y: this.state.centerBF_Y
                    ? this.state.centerBF_Y.toDecimalString(40)
                    : String(this.state.centerY),
                viewport: this.state.viewportSizeY,
            };
            if (settingsCheck.checked) {
                bm.settings = {
                    colors: this.settings.colors.map(c => ({ ...c })),
                    weights: [...this.settings.weights],
                    colorPeriod: this.settings.colorPeriod,
                    maxiterMode: this.state.maxiterMode,
                    baseMaxIter: this.state.baseMaxIter,
                };
            }
            addBookmark(bm);
            nameInput.value = '';
            this._refreshBookmarksList();
        });

        saveRow.appendChild(nameInput);
        saveRow.appendChild(saveBtn);
        wrap.appendChild(saveRow);
        wrap.appendChild(settingsRow);

        this._bookmarksList = document.createElement('div');
        this._bookmarksList.className = 'bookmarks-list';
        wrap.appendChild(this._bookmarksList);
        this._refreshBookmarksList();

        return wrap;
    }

    _refreshBookmarksList() {
        const list = this._bookmarksList;
        list.innerHTML = '';
        const bookmarks = getBookmarks();

        if (bookmarks.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'bookmarks-empty';
            empty.textContent = 'No saved points yet.';
            list.appendChild(empty);
            return;
        }

        bookmarks.forEach((bm, idx) => {
            const row = document.createElement('div');
            row.className = 'bookmark-row';

            const goBtn = document.createElement('button');
            goBtn.className = 'dash-btn dash-btn--go';
            goBtn.textContent = '▶';
            goBtn.title = 'Navigate here';
            goBtn.addEventListener('click', () => {
                if (this.callbacks.navigateTo) {
                    this.callbacks.navigateTo(bm.x, bm.y, bm.viewport, bm.settings);
                    if (bm.settings) {
                        this._syncInputs();
                        this._geRebuild();
                    }
                }
            });

            const info = document.createElement('div');
            info.className = 'bookmark-info';
            const nameLine = document.createElement('div');
            nameLine.className = 'bookmark-name';
            nameLine.textContent = bm.name;
            const zoomLine = document.createElement('div');
            zoomLine.className = 'bookmark-zoom';
            const settingsTag = bm.settings ? ' · ⚙' : '';
            zoomLine.textContent = `zoom 10^${(-Math.log10(bm.viewport)).toFixed(1)}${settingsTag}`;
            info.appendChild(nameLine);
            info.appendChild(zoomLine);

            const delBtn = document.createElement('button');
            delBtn.className = 'dash-btn dash-btn--danger dash-btn--icon';
            delBtn.textContent = '×';
            delBtn.title = 'Delete';
            delBtn.addEventListener('click', () => { removeBookmark(idx); this._refreshBookmarksList(); });

            row.appendChild(goBtn);
            row.appendChild(info);
            row.appendChild(delBtn);
            list.appendChild(row);
        });
    }

    // ─── Action bar ──────────────────────────────────

    _buildActionBar() {
        const bar = document.createElement('div');
        bar.className = 'action-bar';

        const screenshotBtn = document.createElement('button');
        screenshotBtn.className = 'dash-btn action-btn';
        screenshotBtn.textContent = '📷 Screenshot';
        screenshotBtn.addEventListener('click', () => {
            if (this.callbacks.takeScreenshot) this.callbacks.takeScreenshot();
        });

        const shareBtn = document.createElement('button');
        shareBtn.className = 'dash-btn action-btn';
        shareBtn.textContent = '🔗 Share link';
        shareBtn.addEventListener('click', () => {
            const hash = encodeShareHash(this.settings, this.state);
            const url = `${location.origin}${location.pathname}#${hash}`;
            navigator.clipboard.writeText(url).then(() => {
                shareBtn.textContent = 'Copied ✓';
                setTimeout(() => { shareBtn.textContent = '🔗 Share link'; }, 2000);
            }).catch(() => {
                // Fallback: update the URL bar and let the user copy manually
                location.hash = hash;
                shareBtn.textContent = 'Link in URL bar ✓';
                setTimeout(() => { shareBtn.textContent = '🔗 Share link'; }, 2500);
            });
        });

        const resetBtn = document.createElement('button');
        resetBtn.className = 'dash-btn action-btn dash-btn--danger';
        resetBtn.textContent = 'Reset';
        resetBtn.addEventListener('click', () => {
            const def = this.callbacks.defaultSettings;
            if (!def) return;
            this.settings.colors              = def.colors.map(c => ({ ...c }));
            this.settings.weights             = [...def.weights];
            this.settings.colorPeriod         = def.colorPeriod;
            this.settings.zoomSpeed           = def.zoomSpeed;
            this.settings.panSpeed            = def.panSpeed;
            this.settings.keyZoomSpeed        = def.keyZoomSpeed;
            this.settings.maxIterAdjustFactor = def.maxIterAdjustFactor;
            this.settings._colorVersion       = (this.settings._colorVersion || 0) + 1;
            this.state.baseMaxIter            = def.initialMaxIter;
            this.state.maxiterMode            = def.maxiterMode;
            this.state.dirty                  = true;
            if (this.callbacks.navigateTo) {
                this.callbacks.navigateTo(
                    String(def.initialCenterX),
                    String(def.initialCenterY),
                    def.initialViewportSizeY,
                    null
                );
            }
            this._syncInputs();
            this._onStopsChanged();
        });

        bar.appendChild(screenshotBtn);
        bar.appendChild(shareBtn);
        bar.appendChild(resetBtn);
        return bar;
    }

    // ─── Slider helper ───────────────────────────────

    _addSlider(parent, label, key, min, max, step, integer, getter, setter) {
        const { slider, numInput } = sharedAddSlider(parent, label, min, max, step, getter, setter, { integer });
        this._fields[key + '_slider'] = slider;
        this._fields[key + '_num'] = numInput;
    }

    // ─── Public API ──────────────────────────────────

    toggle() {
        this._visible = !this._visible;
        this._dash.toggle();
        if (this._visible) { this._syncInputs(); this._refreshBookmarksList(); }
    }

    _updateHelp() {
        if (!this._helpEl) return;
        this._helpEl.innerHTML = 'Drag=Pan &nbsp;·&nbsp; Scroll/W/S=Zoom &nbsp;·&nbsp; Pinch=Zoom &nbsp;·&nbsp; Arrows=Pan &nbsp;·&nbsp; ☰=Toggle panel &nbsp;·&nbsp; F11=Fullscreen';
    }

    _syncInputs() {
        const set = (k, v) => {
            if (this._fields[k + '_slider']) this._fields[k + '_slider'].value = v;
            if (this._fields[k + '_num'])    this._fields[k + '_num'].value = v;
        };
        set('baseMaxIter', this.state.baseMaxIter);
        set('colorPeriod', this.settings.colorPeriod);
        set('zoomSpeed', this.settings.zoomSpeed);
        set('keyZoomSpeed', this.settings.keyZoomSpeed);
        set('panSpeed', this.settings.panSpeed);

        // Segmented mode buttons
        ['Dynamic', 'Fixed'].forEach(v => {
            const btn = this._fields['maxiterMode_' + v];
            if (btn) btn.classList.toggle('active', this.state.maxiterMode === v);
        });

    }

    update(state) {
        if (!this._visible) return;
        if (document.activeElement !== this._fields.centerX)
            this._fields.centerX.value = state.centerBF_X
                ? state.centerBF_X.toDecimalString(40) : state.centerX.toFixed(17);
        if (document.activeElement !== this._fields.centerY)
            this._fields.centerY.value = state.centerBF_Y
                ? state.centerBF_Y.toDecimalString(40) : state.centerY.toFixed(17);
        if (document.activeElement !== this._fields.zoom)
            this._fields.zoom.value = state.viewportSizeY.toExponential(4);
        this._fields.iters.textContent = String(state.maxIter);
        this._fields.frameMs.textContent = `${state.frameMs.toFixed(1)} ms`;
        this._fields.res.textContent = `${state.width} × ${state.height}`;
    }

    _applyStatInput(key, raw) {
        const nav = this.callbacks.navigateTo;
        if (!nav) return;
        const state = this.state;
        const x = state.centerBF_X ? state.centerBF_X.toDecimalString(40) : String(state.centerX);
        const y = state.centerBF_Y ? state.centerBF_Y.toDecimalString(40) : String(state.centerY);
        if (key === 'centerX') {
            const v = parseFloat(raw);
            if (!isNaN(v)) nav(raw.trim(), y, state.viewportSizeY);
        } else if (key === 'centerY') {
            const v = parseFloat(raw);
            if (!isNaN(v)) nav(x, raw.trim(), state.viewportSizeY);
        } else if (key === 'zoom') {
            const v = parseFloat(raw);
            if (!isNaN(v) && v > 0) nav(x, y, v);
        }
    }

    destroy() {
        if (this._panel && this._panel.parentNode) this._panel.parentNode.removeChild(this._panel);
        if (this._floatBtn && this._floatBtn.parentNode) this._floatBtn.parentNode.removeChild(this._floatBtn);
    }
}
