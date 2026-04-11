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
 */
export function buildUI(container, settings, stats, callbacks) {
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
            label: '⏸ Pause',
            onClick: () => {
                settings.paused = !settings.paused;
                actionButtons['⏸ Pause'].textContent = settings.paused ? '▶ Resume' : '⏸ Pause';
            },
        },
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
    }, 250);

    function rebuildAll() {
        rebuildRulesMatrixUI(rulesWrap, settings, callbacks);
        rebuildColorsUI(colorsWrap, settings, callbacks);
        refreshBookmarksList(bookmarksList, settings, callbacks, rebuildAll);
    }

    return {
        panel,
        rebuildRules() { rebuildAll(); },
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

    const makeSlider = (label, min, max, step, prop) => {
        addSlider(wrap, label, min, max, step,
            () => rule[prop],
            (v) => { rule[prop] = v; onChange(); });
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
