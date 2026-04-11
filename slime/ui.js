/**
 * ui.js — Settings dashboard for slime mold simulation.
 *
 * Sections: Stats · Agent · Diffusion · Colors · Actions
 */

import {
    createDashboard, createFloatToggle, createSection,
    createStatsGrid, addSlider, createActionBar,
} from '../shared/dashboard.js';
import { GradientEditor } from '../shared/gradient-editor.js';
import { encodeShareHash } from './storage.js';

export function buildUI(container, settings, stats) {
    const dash = createDashboard(container, 'Slime Mold Simulation');
    const panel = dash.panel;

    // Stats section (auto-updating)
    const { el: statsEl, fields: statsFields } = createStatsGrid([
        { key: 'fps',     label: 'FPS' },
        { key: 'frameMs', label: 'Frame time' },
        { key: 'agents',  label: 'Agents' },
        { key: 'mapSize', label: 'Map size' },
    ]);
    panel.appendChild(createSection('Live Stats', statsEl, true));

    // Agent section
    panel.appendChild(createSection('Agent', buildAgentControls(settings)));

    // Diffusion section
    panel.appendChild(createSection('Diffusion & Evaporation', buildDiffusionControls(settings)));

    // Simulation section
    panel.appendChild(createSection('Simulation', buildSimControls(settings)));

    // Colors section
    panel.appendChild(createSection('Color Ramp', buildColorControls(settings)));

    // Action bar
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
            label: SHARE_LABEL,
            onClick: () => {
                const shareBtn = actionButtons[SHARE_LABEL];
                const hash = encodeShareHash(settings);
                const url = `${location.origin}${location.pathname}#${hash}`;
                navigator.clipboard.writeText(url).then(() => {
                    shareBtn.textContent = 'Copied ✓';
                    setTimeout(() => { shareBtn.textContent = SHARE_LABEL; }, 2000);
                }).catch(() => {
                    // Fallback: update the URL bar and let the user copy manually
                    location.hash = hash;
                    shareBtn.textContent = 'Link in URL bar ✓';
                    setTimeout(() => { shareBtn.textContent = SHARE_LABEL; }, 2500);
                });
            },
        },
        {
            label: 'Reset',
            onClick: () => {
                settings._reinitAgents(settings.agentsCount);
            },
        },
    ]);
    panel.appendChild(actionBarEl);

    // Toggle button
    const floatBtn = createFloatToggle(container, () => dash.toggle());
    dash.setFloatBtn(floatBtn);

    // Update stats periodically
    setInterval(() => {
        statsFields.fps.textContent = stats.fps;
        statsFields.frameMs.textContent = stats.frameMs.toFixed(1) + ' ms';
        statsFields.agents.textContent = settings.agentsCount.toLocaleString();
        statsFields.mapSize.textContent = settings.mapSizeX + ' × ' + settings.mapSizeY;
    }, 250);

    return panel;
}

// ─── Section builders ────────────────────────────────────────

function buildAgentControls(settings) {
    const wrap = document.createElement('div');

    // Agent count row (custom — half/double/apply buttons)
    const countRow = document.createElement('div');
    countRow.className = 'dash-row';

    const countLabel = document.createElement('span');
    countLabel.className = 'dash-label';
    countLabel.textContent = 'Count';

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
    countInput.min = 1000;
    countInput.max = 1000_000_000;
    countInput.step = 10000;
    countInput.value = settings.agentsCount;

    const doubleBtn = document.createElement('button');
    doubleBtn.className = 'dash-btn';
    doubleBtn.textContent = '×2';
    doubleBtn.style.padding = '2px 6px';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'dash-btn';
    applyBtn.textContent = 'Apply';
    applyBtn.style.padding = '2px 8px';

    function applyCount() {
        const count = Math.max(1000, Math.min(1000_000_000, parseInt(countInput.value) || settings.agentsCount));
        countInput.value = count;
        if (settings._reinitAgents) settings._reinitAgents(count);
    }

    halfBtn.addEventListener('click', () => {
        countInput.value = Math.max(1000, Math.floor(settings.agentsCount / 2));
        applyCount();
    });
    doubleBtn.addEventListener('click', () => {
        countInput.value = Math.min(1000_000_000, settings.agentsCount * 2);
        applyCount();
    });
    applyBtn.addEventListener('click', applyCount);
    countInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') applyCount(); });

    countGroup.appendChild(halfBtn);
    countGroup.appendChild(countInput);
    countGroup.appendChild(doubleBtn);
    countGroup.appendChild(applyBtn);
    countRow.appendChild(countLabel);
    countRow.appendChild(countGroup);
    wrap.appendChild(countRow);

    addSlider(wrap, 'Speed', 0.1, 20, 0.1,
        () => settings.agentSpeed,
        (v) => { settings.agentSpeed = v; }
    );

    addSlider(wrap, 'Rotation speed', 0.1, 10, 0.01,
        () => settings.agentRotationSpeed,
        (v) => { settings.agentRotationSpeed = v; }
    );

    return wrap;
}

function buildDiffusionControls(settings) {
    const wrap = document.createElement('div');

    addSlider(wrap, 'Diffusion', 0.01, 10, 0.01,
        () => settings.diffusionFactor,
        (v) => { settings.diffusionFactor = v; }
    );

    addSlider(wrap, 'Evaporation', 0.001, 2, 0.001,
        () => settings.evaporationFactor,
        (v) => { settings.evaporationFactor = v; }
    );

    return wrap;
}

function buildSimControls(settings) {
    const wrap = document.createElement('div');

    addSlider(wrap, 'Time step (dt)', 0.01, 1, 0.01,
        () => settings.dt,
        (v) => { settings.dt = v; }
    );

    return wrap;
}

function buildColorControls(settings) {
    const wrap = document.createElement('div');

    const ge = new GradientEditor({
        colors:  settings.colors,
        weights: settings.weights,
        onChange: () => { settings._colorsDirty = true; },
    });

    wrap.appendChild(ge.el);
    ge.rebuild();

    return wrap;
}
