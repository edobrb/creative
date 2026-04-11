/**
 * gradient-editor.js — Reusable gradient editor widget.
 *
 * Visual gradient bar with draggable color-stop handles,
 * inline color picker, and add/remove stop support.
 *
 * Usage:
 *   const ge = new GradientEditor({
 *       colors:           [{r,g,b,a}, ...],
 *       weights:          [1, 1, ...],
 *       gradientFunction: (t) => t,        // optional, default identity
 *       onChange:          () => { ... },   // called on every edit
 *   });
 *   container.appendChild(ge.el);
 *   ge.rebuild();   // call after external changes to colors/weights
 */

import { drawGradientPreview, toHex, fromHex } from './gradient.js';

export class GradientEditor {
    /**
     * @param {object} opts
     * @param {Array}    opts.colors           Mutable color stop array [{r,g,b,a}, ...]
     * @param {Array}    opts.weights          Mutable segment weight array
     * @param {Function} [opts.gradientFunction] Non-linear mapping [0,1]→[0,1] (default: identity)
     * @param {Function} [opts.onChange]        Called after every edit
     */
    constructor(opts) {
        this._colors  = opts.colors;
        this._weights = opts.weights;
        this._gradFn  = opts.gradientFunction || ((t) => t);
        this._onChange = opts.onChange || (() => {});

        this._canvas    = null;
        this._rail      = null;
        this._editor    = null;
        this._activeIdx = -1;

        this.el = this._build();
    }

    // ─── Accessors (allow swapping data after construction) ──

    get colors()  { return this._colors; }
    set colors(c) { this._colors = c; }

    get weights()  { return this._weights; }
    set weights(w) { this._weights = w; }

    get gradientFunction()  { return this._gradFn; }
    set gradientFunction(f) { this._gradFn = f; }

    // ─── Build DOM ───────────────────────────────────────────

    _build() {
        const ge = document.createElement('div');
        ge.className = 'ge';

        // Toolbar: hint + dice button (optional, consumers can hide)
        const toolbar = document.createElement('div');
        toolbar.className = 'ge-toolbar';
        const hint = document.createElement('span');
        hint.className = 'ge-hint';
        hint.textContent = 'Click gradient to add · click handle to edit';
        toolbar.appendChild(hint);
        this._toolbar = toolbar;
        ge.appendChild(toolbar);

        // Track: canvas + handle rail
        const track = document.createElement('div');
        track.className = 'ge-track';

        const canvas = document.createElement('canvas');
        canvas.className = 'ge-canvas';
        canvas.height = 28;
        track.appendChild(canvas);
        this._canvas = canvas;

        const rail = document.createElement('div');
        rail.className = 'ge-rail';
        track.appendChild(rail);
        this._rail = rail;

        // Click on track → add stop
        let trackDownPos = null;
        track.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.ge-handle')) return;
            trackDownPos = { x: e.clientX, y: e.clientY };
        });
        track.addEventListener('pointerup', (e) => {
            if (!trackDownPos) return;
            const dx = Math.abs(e.clientX - trackDownPos.x);
            const dy = Math.abs(e.clientY - trackDownPos.y);
            trackDownPos = null;
            if (dx > 4 || dy > 4) return;
            if (e.target.closest('.ge-handle')) return;
            const rect = canvas.getBoundingClientRect();
            const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            this._addStop(p);
        });

        ge.appendChild(track);

        // Inline editor
        const editor = document.createElement('div');
        editor.className = 'ge-editor';
        ge.appendChild(editor);
        this._editor = editor;
        this._activeIdx = -1;

        return ge;
    }

    // ─── Public API ──────────────────────────────────────────

    /** Re-render the gradient bar and rebuild all handles. Call after external data changes. */
    rebuild() {
        this._rail.classList.remove('ge-rail--dragging');
        const displayW = this._canvas.offsetWidth;
        if (displayW > 0) this._canvas.width = displayW;
        this._redraw();
        this._rebuildHandles();
        if (this._activeIdx >= 0 && this._activeIdx < this._colors.length) {
            this._showEditor(this._activeIdx);
        } else {
            this._closeEditor();
        }
    }

    /** Access the toolbar element to append extra buttons (e.g. randomize). */
    get toolbar() { return this._toolbar; }

    // ─── Coordinate conversion ───────────────────────────────

    _invertGradFn(y) {
        const fn = this._gradFn;
        let lo = 0, hi = 1;
        for (let k = 0; k < 40; k++) {
            const mid = (lo + hi) / 2;
            if (fn(mid) < y) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2;
    }

    _weightToVisual(wf) {
        if (wf <= 0) return 0;
        if (wf >= 1) return 1;
        return this._invertGradFn(wf);
    }

    _visualToWeight(vf) {
        return this._gradFn(Math.max(0, Math.min(1, vf)));
    }

    _getPositions() {
        const weights = this._weights;
        const total = weights.reduce((a, b) => a + b, 0);
        if (total === 0) return this._colors.map((_, i, a) => i / Math.max(1, a.length - 1));
        const positions = [0];
        let cum = 0;
        for (let i = 0; i < weights.length; i++) {
            cum += weights[i];
            positions.push(this._weightToVisual(cum / total));
        }
        return positions;
    }

    _setPositionsAsWeights(positions) {
        const oldTotal = this._weights.reduce((a, b) => a + b, 0) || 1;
        const wFracs = positions.map(p => this._visualToWeight(p));
        const newWeights = [];
        for (let i = 0; i < wFracs.length - 1; i++) {
            newWeights.push(Math.max(1e-6, (wFracs[i + 1] - wFracs[i]) * oldTotal));
        }
        // Mutate in place so the caller's reference stays valid
        this._weights.length = 0;
        this._weights.push(...newWeights);
    }

    // ─── Rendering ───────────────────────────────────────────

    _redraw() {
        drawGradientPreview(this._canvas, this._colors, this._weights, this._gradFn);
    }

    _rebuildHandles() {
        const rail = this._rail;
        rail.innerHTML = '';

        const positions = this._getPositions();
        const colors = this._colors;

        colors.forEach((color, i) => {
            const isDraggable = i > 0 && i < colors.length - 1;
            const pos = positions[i];

            const handle = document.createElement('div');
            handle.className = 'ge-handle';
            if (!isDraggable) handle.classList.add('ge-handle--endpoint');
            if (i === this._activeIdx) handle.classList.add('ge-handle--active');
            handle.style.left = (pos * 100) + '%';
            handle.style.setProperty('--stop-color', toHex(color));
            handle.setAttribute('role', 'slider');
            handle.setAttribute('aria-label', `Color stop ${i + 1}`);
            handle.setAttribute('tabindex', '0');

            let dragState = null;

            handle.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                handle.setPointerCapture(e.pointerId);
                dragState = {
                    pointerId: e.pointerId,
                    startX: e.clientX,
                    dragging: false,
                    curIdx: i,
                    draggedColor: { ...this._colors[i] },
                    positions: null,
                    handles: null,
                };
            });

            handle.addEventListener('pointermove', (e) => {
                if (!dragState || dragState.pointerId !== e.pointerId) return;
                if (!isDraggable) return;

                const dx = Math.abs(e.clientX - dragState.startX);
                if (!dragState.dragging && dx < 4) return;

                if (!dragState.dragging) {
                    dragState.dragging = true;
                    dragState.positions = this._getPositions();
                    dragState.handles = Array.from(rail.children);
                    rail.classList.add('ge-rail--dragging');
                    handle.classList.add('ge-handle--dragging');
                    this._closeEditor();
                }

                const railRect = rail.getBoundingClientRect();
                const rawP = Math.max(0, Math.min(1, (e.clientX - railRect.left) / railRect.width));
                const margin = 6 / (railRect.width || 300);
                const clampedP = Math.max(margin, Math.min(1 - margin, rawP));

                const cols = this._colors;
                const pos = dragState.positions;
                const handles = dragState.handles;
                let ci = dragState.curIdx;

                while (ci > 1 && clampedP < pos[ci - 1]) {
                    pos[ci] = pos[ci - 1];
                    [cols[ci], cols[ci - 1]] = [cols[ci - 1], cols[ci]];
                    [handles[ci], handles[ci - 1]] = [handles[ci - 1], handles[ci]];
                    ci--;
                }

                while (ci < cols.length - 2 && clampedP > pos[ci + 1]) {
                    pos[ci] = pos[ci + 1];
                    [cols[ci], cols[ci + 1]] = [cols[ci + 1], cols[ci]];
                    [handles[ci], handles[ci + 1]] = [handles[ci + 1], handles[ci]];
                    ci++;
                }

                pos[ci] = clampedP;
                dragState.curIdx = ci;
                cols[ci] = { ...dragState.draggedColor };

                this._setPositionsAsWeights(pos);
                this._redraw();
                this._onChange();

                for (let j = 0; j < handles.length; j++) {
                    handles[j].style.left = (pos[j] * 100) + '%';
                    handles[j].style.setProperty('--stop-color', toHex(cols[j]));
                }
            });

            handle.addEventListener('pointerup', (e) => {
                if (!dragState || dragState.pointerId !== e.pointerId) return;
                const wasDrag = dragState.dragging;
                rail.classList.remove('ge-rail--dragging');
                handle.classList.remove('ge-handle--dragging');
                dragState = null;

                if (!wasDrag) {
                    if (this._activeIdx === i) {
                        this._closeEditor();
                    } else {
                        this._showEditor(i);
                    }
                } else {
                    this.rebuild();
                }
            });

            handle.addEventListener('lostpointercapture', () => {
                if (dragState) {
                    rail.classList.remove('ge-rail--dragging');
                    handle.classList.remove('ge-handle--dragging');
                    dragState = null;
                    this.rebuild();
                }
            });

            handle.addEventListener('keydown', (e) => {
                if (!isDraggable) return;
                const step = e.shiftKey ? 0.05 : 0.01;
                let delta = 0;
                if (e.key === 'ArrowLeft') delta = -step;
                else if (e.key === 'ArrowRight') delta = step;
                else if (e.key === 'Delete' || e.key === 'Backspace') {
                    if (colors.length > 2) { this._removeStop(i); }
                    e.preventDefault();
                    return;
                }
                if (delta === 0) return;
                e.preventDefault();

                const curPositions = this._getPositions();
                const m = 0.01;
                const leftBound = curPositions[i - 1] + m;
                const rightBound = curPositions[i + 1] - m;
                curPositions[i] = Math.max(leftBound, Math.min(rightBound, curPositions[i] + delta));
                this._setPositionsAsWeights(curPositions);
                this.rebuild();
                this._onChange();
            });

            rail.appendChild(handle);
        });
    }

    // ─── Inline color editor ─────────────────────────────────

    _showEditor(idx) {
        this._activeIdx = idx;
        const editor = this._editor;
        editor.innerHTML = '';
        editor.classList.add('ge-editor--open');

        const colors = this._colors;
        const color = colors[idx];

        this._rail.querySelectorAll('.ge-handle').forEach((h, j) => {
            h.classList.toggle('ge-handle--active', j === idx);
        });

        const header = document.createElement('div');
        header.className = 'ge-editor__header';
        const title = document.createElement('span');
        title.textContent = idx === 0 ? 'First stop' : idx === colors.length - 1 ? 'Last stop' : `Stop ${idx + 1} of ${colors.length}`;
        header.appendChild(title);
        const closeBtn = document.createElement('button');
        closeBtn.className = 'ge-editor__close';
        closeBtn.textContent = '×';
        closeBtn.title = 'Close editor';
        closeBtn.addEventListener('click', () => this._closeEditor());
        header.appendChild(closeBtn);
        editor.appendChild(header);

        const colorRow = document.createElement('div');
        colorRow.className = 'ge-editor__color-row';

        const colorInp = document.createElement('input');
        colorInp.type = 'color';
        colorInp.className = 'ge-editor__picker';
        colorInp.value = toHex(color);

        const hexInp = document.createElement('input');
        hexInp.type = 'text';
        hexInp.className = 'ge-editor__hex';
        hexInp.value = toHex(color).toUpperCase();
        hexInp.maxLength = 7;
        hexInp.spellcheck = false;
        hexInp.placeholder = '#RRGGBB';

        const applyColor = (hex) => {
            const c = fromHex(hex);
            this._colors[idx] = c;
            const handle = this._rail.children[idx];
            if (handle) handle.style.setProperty('--stop-color', toHex(c));
            this._redraw();
            this._onChange();
        };

        colorInp.addEventListener('input', () => {
            hexInp.value = colorInp.value.toUpperCase();
            applyColor(colorInp.value);
        });

        hexInp.addEventListener('input', () => {
            const v = hexInp.value.trim();
            if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                colorInp.value = v;
                applyColor(v);
            }
        });

        hexInp.addEventListener('blur', () => {
            hexInp.value = toHex(this._colors[idx]).toUpperCase();
        });

        colorRow.appendChild(colorInp);
        colorRow.appendChild(hexInp);

        if (colors.length > 2) {
            const delBtn = document.createElement('button');
            delBtn.className = 'dash-btn dash-btn--danger ge-editor__delete';
            delBtn.textContent = '✕ Remove';
            delBtn.addEventListener('click', () => this._removeStop(idx));
            colorRow.appendChild(delBtn);
        }

        editor.appendChild(colorRow);
    }

    _closeEditor() {
        this._activeIdx = -1;
        this._editor.classList.remove('ge-editor--open');
        this._editor.innerHTML = '';
        if (this._rail) {
            this._rail.querySelectorAll('.ge-handle').forEach(h => h.classList.remove('ge-handle--active'));
        }
    }

    // ─── Actions ─────────────────────────────────────────────

    _addStop(visualPos) {
        const colors = this._colors;
        const weights = this._weights;
        const total = weights.reduce((a, b) => a + b, 0);

        const wPos = this._visualToWeight(visualPos) * total;

        let cumW = 0, k = 0;
        for (; k < weights.length - 1; k++) {
            if (cumW + weights[k] > wPos) break;
            cumW += weights[k];
        }

        const t = weights[k] > 0 ? (wPos - cumW) / weights[k] : 0.5;
        const c0 = colors[k], c1 = colors[k + 1];
        const newColor = {
            r: Math.round(c0.r + (c1.r - c0.r) * t),
            g: Math.round(c0.g + (c1.g - c0.g) * t),
            b: Math.round(c0.b + (c1.b - c0.b) * t),
            a: 255,
        };

        const leftW = wPos - cumW;
        const rightW = weights[k] - leftW;
        colors.splice(k + 1, 0, newColor);
        weights.splice(k, 1, leftW, rightW);

        this.rebuild();
        this._onChange();
        this._showEditor(k + 1);
    }

    _removeStop(idx) {
        const weights = this._weights;
        if (idx === 0) {
            weights.splice(0, 1);
        } else if (idx >= weights.length) {
            weights.splice(idx - 1, 1);
        } else {
            weights[idx - 1] += weights[idx];
            weights.splice(idx, 1);
        }
        this._colors.splice(idx, 1);
        this._closeEditor();
        this.rebuild();
        this._onChange();
    }
}
