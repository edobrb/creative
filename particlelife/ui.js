// ui.js — Settings dashboard for Particle Life simulation.

import {
    createDashboard, createFloatToggle, createSection,
    createStatsGrid, addSlider, createActionBar,
} from '../shared/dashboard.js';
import { getBookmarks, addBookmark, removeBookmark, encodeShareHash } from './storage.js';

/**
 * @param {HTMLElement} container
 * @param {object} settings
 * @param {object} stats    { fps, frameMs }
 * @param {object} callbacks { onReset, onRandomizeRules, onResetKeepRules, onRulesChanged, onColorsChanged }
 * @param {import('./entropy.js').EntropyAnalyzer} entropyAnalyzer
 * @param {import('./entropy.js').CriticalityOptimizer} criticalityOptimizer
 */
export function buildUI(container, settings, stats, callbacks, entropyAnalyzer, criticalityOptimizer) {
    const dash = createDashboard(container, 'Particle Life');
    const panel = dash.panel;

    // ── Stats section ─────────────────────────────────────────
    const { el: statsEl, fields: sf } = createStatsGrid([
        { key: 'fps',       label: 'FPS' },
        { key: 'frameMs',   label: 'Frame time' },
        { key: 'particles', label: 'Particles' },
        { key: 'species',   label: 'Species' },
    ]);
    panel.appendChild(createSection('Live Stats', statsEl, true));

    // ── Simulation section ────────────────────────────────────
    panel.appendChild(createSection('Simulation', buildSimControls(settings, callbacks)));

    // ── Species Colors section ────────────────────────────────
    const colorsWrap = document.createElement('div');
    colorsWrap.id = 'colors-container';
    buildColorsUI(colorsWrap, settings, callbacks);
    panel.appendChild(createSection('Species Colors', colorsWrap, false));

    // ── Force Rules matrix section ────────────────────────────
    const rulesWrap = document.createElement('div');
    rulesWrap.id = 'rules-container';
    buildRulesMatrixUI(rulesWrap, settings, callbacks);
    panel.appendChild(createSection('Force Rules', rulesWrap, false));

    // ── Entropy Analysis section ─────────────────────────────
    const entropyWrap = document.createElement('div');
    const entropyChart = buildEntropyChart(entropyAnalyzer, settings);
    entropyWrap.appendChild(entropyChart.el);
    panel.appendChild(createSection('Entropy Analysis', entropyWrap, true));

    // ── Criticality Optimizer section ────────────────────────
    const optimizerWrap = document.createElement('div');
    buildOptimizerUI(optimizerWrap, criticalityOptimizer, entropyAnalyzer);
    panel.appendChild(createSection('Criticality Optimizer', optimizerWrap, false));

    // ── Bookmarks section ─────────────────────────────────────
    const bookmarksWrap = document.createElement('div');
    const bookmarksList = document.createElement('div');
    bookmarksList.className = 'bookmarks-list';
    buildBookmarksUI(bookmarksWrap, bookmarksList, settings, callbacks, rebuildAll);
    panel.appendChild(createSection('Bookmarks', bookmarksWrap));

    // ── Actions ───────────────────────────────────────────────
    const SHARE_LABEL = '🔗 Share link';
    const { el: actionBarEl, buttons: actionButtons } = createActionBar([
        {
            label: '🎲 Randomize',
            onClick: () => {
                callbacks.onRandomizeRules();
                rebuildRulesMatrixUI(rulesWrap, settings, callbacks);
            },
        },
        {
            label: SHARE_LABEL,
            onClick: () => {
                const shareBtn = actionButtons[SHARE_LABEL];
                const hash = encodeShareHash(settings);
                const url = `${location.origin}${location.pathname}#${hash}`;
                navigator.clipboard.writeText(url).then(() => {
                    shareBtn.textContent = 'Copied ✓';
                    setTimeout(() => { shareBtn.textContent = SHARE_LABEL; }, 2000);
                }).catch(() => {
                    location.hash = hash;
                    shareBtn.textContent = 'Link in URL bar ✓';
                    setTimeout(() => { shareBtn.textContent = SHARE_LABEL; }, 2500);
                });
            },
        },
        {
            label: '⏸ Pause',
            onClick: () => {
                settings.paused = !settings.paused;
                actionButtons['⏸ Pause'].textContent = settings.paused ? '▶ Resume' : '⏸ Pause';
            },
        },
        {
            label: '↻ Reset',
            onClick: () => {
                callbacks.onReset();
                rebuildAll();
            },
        },
    ]);
    panel.appendChild(actionBarEl);

    // Toggle button
    const floatBtn = createFloatToggle(container, () => dash.toggle());
    dash.setFloatBtn(floatBtn);

    // Update stats
    setInterval(() => {
        sf.fps.textContent = stats.fps;
        sf.frameMs.textContent = stats.frameMs.toFixed(1) + ' ms';
        sf.particles.textContent = settings.particleCount.toLocaleString();
        sf.species.textContent = settings.speciesCount;
        entropyChart.update();
    }, 250);

    function rebuildAll() {
        rebuildRulesMatrixUI(rulesWrap, settings, callbacks);
        rebuildColorsUI(colorsWrap, settings, callbacks);
        refreshBookmarksList(bookmarksList, settings, callbacks, rebuildAll);
    }

    return {
        panel,
        rebuildRules() { rebuildAll(); },
        onRulesUpdatedExternally() { rebuildRulesMatrixUI(rulesWrap, settings, callbacks); },
    };
}

// ── Simulation controls ──────────────────────────────────────

function buildSimControls(settings, callbacks) {
    const wrap = document.createElement('div');

    // Particle count
    const countRow = document.createElement('div');
    countRow.className = 'dash-row';
    const countLbl = document.createElement('span');
    countLbl.className = 'dash-label';
    countLbl.textContent = 'Particles';
    const countGroup = document.createElement('div');
    countGroup.className = 'dash-slider-group';
    countGroup.style.gap = '4px';

    const halfBtn = document.createElement('button');
    halfBtn.className = 'dash-btn';
    halfBtn.textContent = '÷2';
    halfBtn.style.padding = '2px 6px';
    const countInput = document.createElement('input');
    countInput.type = 'number';
    countInput.className = 'dash-number';
    countInput.min = 100;
    countInput.max = 100000;
    countInput.step = 100;
    countInput.value = settings.particleCount;
    const doubleBtn = document.createElement('button');
    doubleBtn.className = 'dash-btn';
    doubleBtn.textContent = '×2';
    doubleBtn.style.padding = '2px 6px';
    const applyBtn = document.createElement('button');
    applyBtn.className = 'dash-btn';
    applyBtn.textContent = 'Apply';
    applyBtn.style.padding = '2px 8px';

    function applyCount() {
        const v = Math.max(100, Math.min(100000, parseInt(countInput.value) || settings.particleCount));
        countInput.value = v;
        settings.particleCount = v;
        callbacks.onResetKeepRules();
    }

    halfBtn.addEventListener('click', () => { countInput.value = Math.max(100, Math.floor(settings.particleCount / 2)); applyCount(); });
    doubleBtn.addEventListener('click', () => { countInput.value = Math.min(100000, settings.particleCount * 2); applyCount(); });
    applyBtn.addEventListener('click', applyCount);
    countInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') applyCount(); });

    countGroup.append(halfBtn, countInput, doubleBtn, applyBtn);
    countRow.append(countLbl, countGroup);
    wrap.appendChild(countRow);

    // Species count
    const speciesRow = document.createElement('div');
    speciesRow.className = 'dash-row';
    const speciesLbl = document.createElement('span');
    speciesLbl.className = 'dash-label';
    speciesLbl.textContent = 'Species';
    const speciesGroup = document.createElement('div');
    speciesGroup.className = 'dash-slider-group';
    speciesGroup.style.gap = '4px';
    const speciesInput = document.createElement('input');
    speciesInput.type = 'number';
    speciesInput.className = 'dash-number';
    speciesInput.min = 2;
    speciesInput.max = 10;
    speciesInput.step = 1;
    speciesInput.value = settings.speciesCount;
    const speciesApply = document.createElement('button');
    speciesApply.className = 'dash-btn';
    speciesApply.textContent = 'Apply';
    speciesApply.style.padding = '2px 8px';

    function applySpecies() {
        const v = Math.max(2, Math.min(10, parseInt(speciesInput.value) || settings.speciesCount));
        speciesInput.value = v;
        settings.speciesCount = v;
        settings.rules = null; // force new random rules
        callbacks.onReset();
    }
    speciesApply.addEventListener('click', applySpecies);
    speciesInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') applySpecies(); });

    speciesGroup.append(speciesInput, speciesApply);
    speciesRow.append(speciesLbl, speciesGroup);
    wrap.appendChild(speciesRow);

    addSlider(wrap, 'Time step', 0.001, 0.1, 0.001,
        () => settings.dt, (v) => { settings.dt = v; });

    addSlider(wrap, 'Friction', 1, 50, 0.5,
        () => settings.friction, (v) => { settings.friction = v; });

    addSlider(wrap, 'Mouse force', 100, 10000, 100,
        () => settings.mouseStrength, (v) => { settings.mouseStrength = v; });

    addSlider(wrap, 'Alpha', 0.05, 1, 0.05,
        () => settings.particleAlpha, (v) => { settings.particleAlpha = v; });

    addSlider(wrap, 'Draw radius', 0.5, 10, 0.5,
        () => settings.particleRadius, (v) => { settings.particleRadius = v; });

    return wrap;
}

// ── Species Colors UI ────────────────────────────────────────

const SPECIES_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

function rebuildColorsUI(container, settings, callbacks) {
    container.innerHTML = '';
    buildColorsUI(container, settings, callbacks);
}

function buildColorsUI(container, settings, callbacks) {
    const k = settings.speciesCount;
    const colors = settings.speciesColors;

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(60px,1fr));gap:6px;';

    for (let i = 0; i < k; i++) {
        const cell = document.createElement('div');
        cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:3px;';

        const label = document.createElement('span');
        label.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.5);';
        label.textContent = SPECIES_LABELS[i];

        const input = document.createElement('input');
        input.type = 'color';
        input.value = colors[i];
        input.style.cssText = 'width:36px;height:24px;border:1px solid rgba(255,255,255,0.15);border-radius:4px;background:transparent;cursor:pointer;padding:0;';
        input.addEventListener('input', () => {
            settings.speciesColors[i] = input.value;
            if (callbacks.onColorsChanged) callbacks.onColorsChanged();
        });

        cell.append(label, input);
        grid.appendChild(cell);
    }
    container.appendChild(grid);
}

// ── Force Rules Matrix UI ────────────────────────────────────

function forceColor(m1) {
    // Map m1 value to a color: negative=red, zero=gray, positive=green
    const t = Math.max(-2, Math.min(2, m1));
    if (t < 0) {
        const f = -t / 2; // 0..1
        const r = Math.round(60 + 195 * f);
        const g = Math.round(60 * (1 - f));
        const b = Math.round(60 * (1 - f));
        return `rgb(${r},${g},${b})`;
    } else {
        const f = t / 2; // 0..1
        const r = Math.round(60 * (1 - f));
        const g = Math.round(60 + 195 * f);
        const b = Math.round(60 * (1 - f));
        return `rgb(${r},${g},${b})`;
    }
}

function rebuildRulesMatrixUI(container, settings, callbacks) {
    container.innerHTML = '';
    buildRulesMatrixUI(container, settings, callbacks);
}

function buildRulesMatrixUI(container, settings, callbacks) {
    const k = settings.speciesCount;
    const rules = settings.rules;
    if (!rules) return;

    const colors = settings.speciesColors;

    // Header hint
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.35);margin-bottom:6px;';
    hint.textContent = 'Click a cell to edit. Row → Column. Color = m1 force.';
    container.appendChild(hint);

    // Build grid table
    const table = document.createElement('div');
    table.className = 'rules-matrix';
    table.style.cssText = `display:grid;grid-template-columns:24px repeat(${k},1fr);gap:2px;`;

    // Top-left corner (empty)
    const corner = document.createElement('div');
    corner.style.cssText = 'width:24px;height:24px;';
    table.appendChild(corner);

    // Column headers
    for (let j = 0; j < k; j++) {
        const hdr = document.createElement('div');
        hdr.style.cssText = `text-align:center;font-size:10px;font-weight:700;color:${colors[j]};line-height:24px;`;
        hdr.textContent = SPECIES_LABELS[j];
        table.appendChild(hdr);
    }

    // Detail editor area (shown when a cell is clicked)
    let activeEditor = null;
    let activeCell = null;

    for (let i = 0; i < k; i++) {
        // Row header
        const rowHdr = document.createElement('div');
        rowHdr.style.cssText = `font-size:10px;font-weight:700;color:${colors[i]};line-height:24px;text-align:center;`;
        rowHdr.textContent = SPECIES_LABELS[i];
        table.appendChild(rowHdr);

        for (let j = 0; j < k; j++) {
            const idx = i * k + j;
            const rule = rules[idx];

            const cell = document.createElement('div');
            cell.className = 'rules-matrix-cell';
            cell.style.cssText = `
                background:${forceColor(rule.m1)};
                border-radius:3px;
                text-align:center;
                font-size:9px;
                font-family:'SF Mono','Fira Code','Consolas',monospace;
                color:rgba(255,255,255,0.9);
                line-height:24px;
                height:24px;
                cursor:pointer;
                transition:outline 0.1s;
                user-select:none;
            `;
            cell.textContent = rule.m1.toFixed(2);
            cell.title = `${SPECIES_LABELS[i]}→${SPECIES_LABELS[j]}: m1=${rule.m1.toFixed(2)}`;

            cell.addEventListener('click', () => {
                if (activeCell === cell) {
                    // Toggle off
                    if (activeEditor) { activeEditor.remove(); activeEditor = null; }
                    cell.style.outline = '';
                    activeCell = null;
                    return;
                }
                // Remove previous editor
                if (activeEditor) { activeEditor.remove(); activeEditor = null; }
                if (activeCell) activeCell.style.outline = '';

                activeCell = cell;
                cell.style.outline = '1px solid rgba(255,255,255,0.5)';

                activeEditor = buildRuleEditor(rule, colors[i], colors[j], SPECIES_LABELS[i], SPECIES_LABELS[j], () => {
                    cell.style.background = forceColor(rule.m1);
                    cell.textContent = rule.m1.toFixed(2);
                    cell.title = `${SPECIES_LABELS[i]}→${SPECIES_LABELS[j]}: m1=${rule.m1.toFixed(2)}`;
                    callbacks.onRulesChanged();
                });
                container.appendChild(activeEditor);
            });

            table.appendChild(cell);
        }
    }

    container.appendChild(table);
}

function buildRuleEditor(rule, colorI, colorJ, labelI, labelJ, onChange) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top:8px;padding:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;';

    const header = document.createElement('div');
    header.style.cssText = 'font-size:11px;font-weight:600;color:rgba(255,255,255,0.6);margin-bottom:6px;';
    header.innerHTML = `<span style="color:${colorI}">${labelI}</span> → <span style="color:${colorJ}">${labelJ}</span>`;
    wrap.appendChild(header);

    const graph = buildForceGraph(rule);
    wrap.appendChild(graph.el);

    const makeSlider = (label, min, max, step, prop) => {
        addSlider(wrap, label, min, max, step,
            () => rule[prop],
            (v) => { rule[prop] = v; graph.update(); onChange(); });
    };

    makeSlider('dMin', 1, 200, 1, 'dMin');
    makeSlider('dStar', 1, 300, 1, 'dStar');
    makeSlider('dMax', 1, 400, 1, 'dMax');
    makeSlider('p', 0.1, 5, 0.1, 'p');
    makeSlider('m0', -5, 0, 0.1, 'm0');
    makeSlider('m1', -2, 2, 0.01, 'm1');
    makeSlider('m2', -2, 2, 0.01, 'm2');

    return wrap;
}

// ── Interactive force-curve graph ───────────────────────────
//
// Mirrors the piecewise force function in shaders.js:
//   dist < dMin     : (pow(dMin/dist, p) - 1) * m0      (short-range repulsion)
//   dMin ≤ dist < dStar : (dist - dMin) * m1            (linear, slope m1)
//   dStar ≤ dist < dMax : (dist - dStar) * m2           (linear, slope m2)
//   dist ≥ dMax     : 0

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
}

function forceAt(rule, dist) {
    const { dMin, dStar, dMax, p, m0, m1, m2 } = rule;
    if (dist >= dMax) return 0;
    if (dist < dMin)  return (Math.pow(dMin / dist, p) - 1.0) * m0;
    if (dist < dStar) return (dist - dMin) * m1;
    return (dist - dStar) * m2;
}

function buildForceGraph(rule) {
    const W = 260, H = 130;
    const PAD_L = 26, PAD_R = 10, PAD_T = 12, PAD_B = 22;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%' });
    svg.style.cssText = 'display:block;background:rgba(0,0,0,0.25);border-radius:4px;margin-bottom:8px;overflow:visible;';

    // Plot area border
    const frame = svgEl('rect', {
        x: PAD_L, y: PAD_T, width: plotW, height: plotH,
        fill: 'none', stroke: 'rgba(255,255,255,0.08)',
    });
    svg.appendChild(frame);

    // Zero line
    const zeroLine = svgEl('line', {
        stroke: 'rgba(255,255,255,0.3)', 'stroke-dasharray': '2,2',
    });
    svg.appendChild(zeroLine);

    // Region guides (dMin, dStar, dMax)
    const mkGuide = (color) => svgEl('line', {
        stroke: color, 'stroke-dasharray': '2,3', 'stroke-width': 1,
    });
    const dMinLine  = mkGuide('rgba(255,160,160,0.55)');
    const dStarLine = mkGuide('rgba(255,220,140,0.55)');
    const dMaxLine  = mkGuide('rgba(160,200,255,0.55)');
    svg.append(dMinLine, dStarLine, dMaxLine);

    const mkGuideLabel = (anchor, color) => {
        const t = svgEl('text', {
            fill: color, 'font-size': 8, 'text-anchor': anchor,
            'font-family': 'SF Mono, Consolas, monospace',
        });
        svg.appendChild(t);
        return t;
    };
    const dMinLabel  = mkGuideLabel('middle', 'rgba(255,160,160,0.85)');
    const dStarLabel = mkGuideLabel('middle', 'rgba(255,220,140,0.85)');
    const dMaxLabel  = mkGuideLabel('end',    'rgba(160,200,255,0.85)');

    // Curve path — two paths so we can color attract vs repel
    const pathAttract = svgEl('path', {
        fill: 'none', stroke: 'rgba(120,230,170,0.95)', 'stroke-width': 1.6,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    const pathRepel = svgEl('path', {
        fill: 'none', stroke: 'rgba(255,120,120,0.95)', 'stroke-width': 1.6,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    svg.append(pathAttract, pathRepel);

    // Axis labels
    const mkAxis = (anchor) => svgEl('text', {
        fill: 'rgba(255,255,255,0.5)', 'font-size': 8, 'text-anchor': anchor,
        'font-family': 'SF Mono, Consolas, monospace',
    });
    const yMaxLabel = mkAxis('end');
    const yMinLabel = mkAxis('end');
    const y0Label   = mkAxis('end'); y0Label.textContent = '0';
    const xAxisLabel = mkAxis('middle'); xAxisLabel.textContent = 'distance';
    const yAxisLabel = mkAxis('middle'); yAxisLabel.textContent = 'force';
    yAxisLabel.setAttribute('transform', `rotate(-90 10 ${PAD_T + plotH / 2})`);
    yAxisLabel.setAttribute('x', 10);
    yAxisLabel.setAttribute('y', PAD_T + plotH / 2 + 3);
    svg.append(yMaxLabel, yMinLabel, y0Label, xAxisLabel, yAxisLabel);

    function update() {
        const { dMin, dStar, dMax } = rule;
        const xMax = Math.max(dMax * 1.08, 10);
        const N = 240;
        const samples = [];
        for (let k = 0; k <= N; k++) {
            const d = (k / N) * xMax;
            // Clamp to tiny epsilon to avoid division by zero
            const dSafe = Math.max(d, 0.01);
            samples.push({ x: d, y: forceAt(rule, dSafe) });
        }

        // Auto y-range, clamped so extreme repulsion doesn't flatten the rest
        let yMin = 0, yMax = 0;
        for (const s of samples) {
            if (s.y < yMin) yMin = s.y;
            if (s.y > yMax) yMax = s.y;
        }
        yMin = Math.max(yMin, -20);
        yMax = Math.min(yMax, 20);
        if (yMax - yMin < 0.4) { yMax += 0.2; yMin -= 0.2; }
        const range = yMax - yMin;
        yMin -= range * 0.08;
        yMax += range * 0.08;

        const xToSvg = (x) => PAD_L + (x / xMax) * plotW;
        const yToSvg = (y) => PAD_T + (1 - (y - yMin) / (yMax - yMin)) * plotH;

        // Zero line
        const zeroY = yToSvg(0);
        zeroLine.setAttribute('x1', PAD_L);
        zeroLine.setAttribute('x2', PAD_L + plotW);
        zeroLine.setAttribute('y1', zeroY);
        zeroLine.setAttribute('y2', zeroY);

        // Guide lines
        const setGuide = (line, label, x, name, anchor) => {
            const sx = xToSvg(x);
            line.setAttribute('x1', sx);
            line.setAttribute('x2', sx);
            line.setAttribute('y1', PAD_T);
            line.setAttribute('y2', PAD_T + plotH);
            label.setAttribute('x', sx);
            label.setAttribute('y', PAD_T - 3);
            label.setAttribute('text-anchor', anchor);
            label.textContent = `${name} ${x.toFixed(0)}`;
        };
        setGuide(dMinLine,  dMinLabel,  dMin,  'dMin',  'middle');
        setGuide(dStarLine, dStarLabel, dStar, 'dStar', 'middle');
        setGuide(dMaxLine,  dMaxLabel,  dMax,  'dMax',  'end');

        // Build curve — split into attract (y≥0) and repel (y<0) segments
        // so we can color each side differently. Clamp to visible range.
        const segAttract = [];
        const segRepel = [];
        let curAttract = '';
        let curRepel = '';
        for (const s of samples) {
            const y = Math.max(yMin, Math.min(yMax, s.y));
            const sx = xToSvg(s.x).toFixed(2);
            const sy = yToSvg(y).toFixed(2);
            if (s.y >= 0) {
                curAttract += (curAttract ? ' L ' : 'M ') + sx + ' ' + sy;
                if (curRepel) { segRepel.push(curRepel); curRepel = ''; }
            } else {
                curRepel += (curRepel ? ' L ' : 'M ') + sx + ' ' + sy;
                if (curAttract) { segAttract.push(curAttract); curAttract = ''; }
            }
        }
        if (curAttract) segAttract.push(curAttract);
        if (curRepel)   segRepel.push(curRepel);
        pathAttract.setAttribute('d', segAttract.join(' '));
        pathRepel.setAttribute('d', segRepel.join(' '));

        // Y axis numeric labels
        yMaxLabel.setAttribute('x', PAD_L - 3);
        yMaxLabel.setAttribute('y', PAD_T + 4);
        yMaxLabel.textContent = yMax.toFixed(1);
        yMinLabel.setAttribute('x', PAD_L - 3);
        yMinLabel.setAttribute('y', PAD_T + plotH + 2);
        yMinLabel.textContent = yMin.toFixed(1);
        y0Label.setAttribute('x', PAD_L - 3);
        y0Label.setAttribute('y', zeroY + 3);

        // X axis label
        xAxisLabel.setAttribute('x', PAD_L + plotW / 2);
        xAxisLabel.setAttribute('y', H - 4);
    }

    update();
    return { el: svg, update };
}

// ── Bookmarks UI ─────────────────────────────────────────────

function buildBookmarksUI(container, listEl, settings, callbacks, rebuildAll) {
    const saveRow = document.createElement('div');
    saveRow.className = 'dash-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'dash-text-input';
    nameInput.placeholder = 'Name…';
    nameInput.maxLength = 60;
    nameInput.addEventListener('keydown', (e) => e.stopPropagation());

    const saveBtn = document.createElement('button');
    saveBtn.className = 'dash-btn';
    saveBtn.textContent = 'Save current';

    saveBtn.addEventListener('click', () => {
        const name = nameInput.value.trim() || `Config ${getBookmarks().length + 1}`;
        const bm = {
            name,
            settings: {
                particleCount: settings.particleCount,
                speciesCount: settings.speciesCount,
                dt: settings.dt,
                friction: settings.friction,
                mouseStrength: settings.mouseStrength,
                particleAlpha: settings.particleAlpha,
                particleRadius: settings.particleRadius,
                speciesColors: [...settings.speciesColors],
                rules: settings.rules.map(r => ({ ...r })),
            },
        };
        addBookmark(bm);
        nameInput.value = '';
        refreshBookmarksList(listEl, settings, callbacks, rebuildAll);
    });

    saveRow.append(nameInput, saveBtn);
    container.appendChild(saveRow);
    container.appendChild(listEl);
    refreshBookmarksList(listEl, settings, callbacks, rebuildAll);
}

function refreshBookmarksList(listEl, settings, callbacks, rebuildAll) {
    listEl.innerHTML = '';
    const bookmarks = getBookmarks();

    if (bookmarks.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'bookmarks-empty';
        empty.textContent = 'No saved configurations yet.';
        listEl.appendChild(empty);
        return;
    }

    bookmarks.forEach((bm, idx) => {
        const row = document.createElement('div');
        row.className = 'bookmark-row';

        const goBtn = document.createElement('button');
        goBtn.className = 'dash-btn dash-btn--go';
        goBtn.textContent = '▶';
        goBtn.title = 'Load this configuration';
        goBtn.addEventListener('click', () => {
            const s = bm.settings;
            settings.particleCount = s.particleCount;
            settings.speciesCount = s.speciesCount;
            settings.dt = s.dt;
            settings.friction = s.friction;
            settings.mouseStrength = s.mouseStrength;
            settings.particleAlpha = s.particleAlpha ?? 0.75;
            settings.particleRadius = s.particleRadius ?? 1.0;
            settings.speciesColors = [...s.speciesColors];
            settings.rules = s.rules.map(r => ({ ...r }));
            callbacks.onResetKeepRules();
            if (callbacks.onColorsChanged) callbacks.onColorsChanged();
            rebuildAll();
        });

        const info = document.createElement('div');
        info.className = 'bookmark-info';
        const nameLine = document.createElement('div');
        nameLine.className = 'bookmark-name';
        nameLine.textContent = bm.name;
        const detailLine = document.createElement('div');
        detailLine.className = 'bookmark-zoom';
        detailLine.textContent = `${s(bm).speciesCount} species · ${s(bm).particleCount} particles`;
        info.append(nameLine, detailLine);

        const delBtn = document.createElement('button');
        delBtn.className = 'dash-btn dash-btn--danger dash-btn--icon';
        delBtn.textContent = '×';
        delBtn.title = 'Delete';
        delBtn.addEventListener('click', () => {
            removeBookmark(idx);
            refreshBookmarksList(listEl, settings, callbacks, rebuildAll);
        });

        row.append(goBtn, info, delBtn);
        listEl.appendChild(row);
    });
}

function s(bm) { return bm.settings || {}; }

// ── Entropy Chart ────────────────────────────────────────────

const SVG_NS_E = 'http://www.w3.org/2000/svg';
function svgElE(tag, attrs) {
    const el = document.createElementNS(SVG_NS_E, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
}

function buildEntropyChart(analyzer, settings) {
    const W = 280, H = 150;
    const PAD_L = 32, PAD_R = 8, PAD_T = 16, PAD_B = 20;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    const wrap = document.createElement('div');

    // Stats line
    const statsLine = document.createElement('div');
    statsLine.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.6);margin-bottom:6px;font-family:"SF Mono","Fira Code","Consolas",monospace;display:flex;justify-content:space-between;';
    const entropyVal = document.createElement('span');
    entropyVal.textContent = 'H: —';
    const avgVal = document.createElement('span');
    avgVal.textContent = 'Avg: —';
    const stdVal = document.createElement('span');
    stdVal.textContent = 'σ: —';
    statsLine.append(entropyVal, avgVal, stdVal);
    wrap.appendChild(statsLine);

    // SVG chart
    const svg = svgElE('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%' });
    svg.style.cssText = 'display:block;background:rgba(0,0,0,0.25);border-radius:4px;overflow:visible;';

    // Plot frame
    svg.appendChild(svgElE('rect', {
        x: PAD_L, y: PAD_T, width: plotW, height: plotH,
        fill: 'none', stroke: 'rgba(255,255,255,0.08)',
    }));

    // Average line
    const avgLine = svgElE('line', {
        stroke: 'rgba(255,200,60,0.5)', 'stroke-dasharray': '3,3', 'stroke-width': 1,
    });
    svg.appendChild(avgLine);

    // Entropy curve
    const curvePath = svgElE('path', {
        fill: 'none', stroke: 'rgba(100,200,255,0.9)', 'stroke-width': 1.4,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    });
    svg.appendChild(curvePath);

    // Fill area under curve
    const fillPath = svgElE('path', {
        fill: 'rgba(100,200,255,0.08)', stroke: 'none',
    });
    svg.insertBefore(fillPath, curvePath);

    // Y axis labels
    const yMaxLabel = svgElE('text', {
        fill: 'rgba(255,255,255,0.45)', 'font-size': 8, 'text-anchor': 'end',
        'font-family': 'SF Mono, Consolas, monospace',
    });
    const yMinLabel = svgElE('text', {
        fill: 'rgba(255,255,255,0.45)', 'font-size': 8, 'text-anchor': 'end',
        'font-family': 'SF Mono, Consolas, monospace',
    });
    const xLabel = svgElE('text', {
        fill: 'rgba(255,255,255,0.35)', 'font-size': 8, 'text-anchor': 'middle',
        'font-family': 'SF Mono, Consolas, monospace',
        x: PAD_L + plotW / 2, y: H - 3,
    });
    xLabel.textContent = 'time →';
    svg.append(yMaxLabel, yMinLabel, xLabel);

    wrap.appendChild(svg);

    function update() {
        const history = analyzer.history;
        if (history.length < 2) {
            entropyVal.textContent = 'H: —';
            avgVal.textContent = 'Avg: —';
            stdVal.textContent = 'σ: —';
            curvePath.setAttribute('d', '');
            fillPath.setAttribute('d', '');
            return;
        }

        const current = analyzer.currentEntropy;
        const avg = analyzer.averageEntropy;
        const std = analyzer.entropyStdDev;
        const maxH = analyzer.maxEntropy(settings.speciesCount);

        entropyVal.textContent = `H: ${current.toFixed(2)}`;
        avgVal.textContent = `Avg: ${avg.toFixed(2)}`;
        stdVal.textContent = `σ: ${std.toFixed(3)}`;

        // Compute y range
        let yMin = Infinity, yMax = -Infinity;
        for (const h of history) {
            if (h.entropy < yMin) yMin = h.entropy;
            if (h.entropy > yMax) yMax = h.entropy;
        }
        const pad = Math.max((yMax - yMin) * 0.1, 0.1);
        yMin = Math.max(0, yMin - pad);
        yMax = yMax + pad;

        const xToSvg = (i) => PAD_L + (i / (history.length - 1)) * plotW;
        const yToSvg = (y) => PAD_T + (1 - (y - yMin) / (yMax - yMin)) * plotH;

        // Draw curve
        let d = '';
        let fillD = '';
        for (let i = 0; i < history.length; i++) {
            const sx = xToSvg(i).toFixed(2);
            const sy = yToSvg(history[i].entropy).toFixed(2);
            d += (i === 0 ? 'M ' : ' L ') + sx + ' ' + sy;
            fillD += (i === 0 ? 'M ' : ' L ') + sx + ' ' + sy;
        }
        // Close fill path
        fillD += ` L ${xToSvg(history.length - 1).toFixed(2)} ${(PAD_T + plotH).toFixed(2)}`;
        fillD += ` L ${xToSvg(0).toFixed(2)} ${(PAD_T + plotH).toFixed(2)} Z`;

        curvePath.setAttribute('d', d);
        fillPath.setAttribute('d', fillD);

        // Average line
        const avgY = yToSvg(avg);
        avgLine.setAttribute('x1', PAD_L);
        avgLine.setAttribute('x2', PAD_L + plotW);
        avgLine.setAttribute('y1', avgY);
        avgLine.setAttribute('y2', avgY);

        // Y labels
        yMaxLabel.setAttribute('x', PAD_L - 3);
        yMaxLabel.setAttribute('y', PAD_T + 4);
        yMaxLabel.textContent = yMax.toFixed(1);
        yMinLabel.setAttribute('x', PAD_L - 3);
        yMinLabel.setAttribute('y', PAD_T + plotH + 2);
        yMinLabel.textContent = yMin.toFixed(1);
    }

    return { el: wrap, update };
}

// ── Criticality Optimizer UI ─────────────────────────────────

function buildOptimizerUI(container, optimizer, analyzer) {
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.4);margin-bottom:8px;line-height:1.4;';
    desc.textContent = 'Tweaks force values to maximize criticality — keeping the system at the edge between order and chaos (maximizes entropy fluctuations).';
    container.appendChild(desc);

    // Status line
    const statusLine = document.createElement('div');
    statusLine.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.6);margin-bottom:8px;font-family:"SF Mono","Fira Code","Consolas",monospace;';
    statusLine.textContent = 'Status: OFF';
    container.appendChild(statusLine);

    // CV display
    const cvLine = document.createElement('div');
    cvLine.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.5);margin-bottom:8px;font-family:"SF Mono","Fira Code","Consolas",monospace;';
    cvLine.textContent = 'CV: —';
    container.appendChild(cvLine);

    // Enable toggle
    const toggleRow = document.createElement('div');
    toggleRow.className = 'dash-row';
    const toggleLbl = document.createElement('span');
    toggleLbl.className = 'dash-label';
    toggleLbl.textContent = 'Enable';
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'dash-btn';
    toggleBtn.textContent = 'OFF';
    toggleBtn.style.cssText = 'padding:3px 12px;min-width:50px;';
    toggleBtn.addEventListener('click', () => {
        optimizer.enabled = !optimizer.enabled;
        toggleBtn.textContent = optimizer.enabled ? 'ON' : 'OFF';
        toggleBtn.style.background = optimizer.enabled ? 'rgba(100,200,100,0.2)' : '';
        toggleBtn.style.borderColor = optimizer.enabled ? 'rgba(100,200,100,0.4)' : '';
    });
    toggleRow.append(toggleLbl, toggleBtn);
    container.appendChild(toggleRow);

    // Strength slider
    addSlider(container, 'Strength', 0.001, 0.2, 0.001,
        () => optimizer.strength,
        (v) => { optimizer.strength = v; });

    // Interval slider
    addSlider(container, 'Interval', 10, 300, 10,
        () => optimizer.interval,
        (v) => { optimizer.interval = Math.round(v); },
        { integer: true });

    // Update optimizer status display
    setInterval(() => {
        if (optimizer.enabled) {
            const avg = analyzer.averageEntropy;
            const std = analyzer.entropyStdDev;
            const cv = avg > 0.001 ? (std / avg) : 0;
            statusLine.textContent = `Status: ON — optimizing`;
            statusLine.style.color = 'rgba(100,200,100,0.8)';
            cvLine.textContent = `CV: ${cv.toFixed(4)} (σ/μ = ${std.toFixed(3)} / ${avg.toFixed(2)})`;
        } else {
            statusLine.textContent = 'Status: OFF';
            statusLine.style.color = 'rgba(255,255,255,0.6)';
            const avg = analyzer.averageEntropy;
            const std = analyzer.entropyStdDev;
            const cv = avg > 0.001 ? (std / avg) : 0;
            cvLine.textContent = `CV: ${cv.toFixed(4)}`;
        }
    }, 500);
}
