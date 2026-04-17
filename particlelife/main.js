// main.js — Entry point for Particle Life. Initializes WebGPU, wires simulation + renderer + UI.

import { Simulation } from './simulation.js';
import { Renderer } from './renderer.js';
import { buildUI } from './ui.js';
import { decodeShareHash, applyShareData } from './storage.js';
import { EntropyAnalyzer, CriticalityOptimizer } from './entropy.js';

// ── Settings ─────────────────────────────────────────────────

const settings = {
    particleCount: 16384,
    speciesCount:  5,
    dt:            0.02,
    friction:      10,
    mouseStrength: 5000,
    paused:        false,
    particleAlpha:  0.75,
    particleRadius: 2.0,

    // Species colors (hex strings for UI, converted to RGBA for GPU)
    speciesColors: [
        '#ffffff', '#ff9f7a', '#8fee8f', '#00ffff', '#ffb5c2',
        '#add8e6', '#ffff99', '#db9fdb', '#ffd700', '#80ffd4',
    ],

    // Set by simulation
    bx: 0,
    by: 0,
    rules: null,

    // Mouse state (updated by input handlers)
    mouseX: 0,
    mouseY: 0,
    mouseForce: 0,
};

// A share-link hash overrides defaults (including pre-seeded rules)
{
    const shareData = window.location.hash ? decodeShareHash(window.location.hash) : null;
    applyShareData(settings, shareData);
}

const stats = { fps: 0, frameMs: 0 };

// ── Error display ────────────────────────────────────────────

function showError(msg) {
    const el = document.getElementById('error-message');
    el.textContent = msg;
    el.classList.remove('hidden');
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
    if (!navigator.gpu) {
        showError('WebGPU is not supported in this browser. Please use Chrome 113+, Edge 113+, or Firefox Nightly.');
        return;
    }

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) { showError('Failed to obtain a WebGPU adapter.'); return; }

    const device = await adapter.requestDevice({
        requiredLimits: {
            maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
            maxBufferSize: adapter.limits.maxBufferSize,
        },
    });
    device.lost.then((info) => {
        console.error('WebGPU device lost:', info.message);
        if (info.reason !== 'destroyed') showError('WebGPU device lost: ' + info.message);
    });

    // Canvas setup
    const canvas = document.getElementById('particle-canvas');
    const ctx = canvas.getContext('webgpu');
    const presentFormat = navigator.gpu.getPreferredCanvasFormat();

    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(canvas.clientWidth * dpr);
        canvas.height = Math.round(canvas.clientHeight * dpr);
        ctx.configure({ device, format: presentFormat, alphaMode: 'opaque' });
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Simulation and renderer
    const simulation = new Simulation(device, settings);
    const renderer = new Renderer(device, presentFormat);

    // Entropy analysis and criticality optimizer
    const entropyAnalyzer = new EntropyAnalyzer(16, 200);
    const criticalityOptimizer = new CriticalityOptimizer();

    function fullReset() {
        resizeCanvas();
        simulation.reset(canvas.width, canvas.height);
        renderer.rebuild(simulation);
        entropyAnalyzer.reset();
        criticalityOptimizer.reset();
    }

    fullReset();

    // UI callbacks
    const callbacks = {
        onReset() {
            fullReset();
            ui.rebuildRules();
        },
        onResetKeepRules() {
            resizeCanvas();
            simulation.reset(canvas.width, canvas.height);
            renderer.rebuild(simulation);
            entropyAnalyzer.reset();
            criticalityOptimizer.reset();
        },
        onRandomizeRules() {
            settings.rules = Simulation.randomRules(settings.speciesCount);
            simulation.uploadRules();
            entropyAnalyzer.reset();
            criticalityOptimizer.reset();
        },
        onRulesChanged() {
            simulation.uploadRules();
        },
        onColorsChanged() {
            renderer.updateColors(settings);
        },
    };

    const ui = buildUI(document.body, settings, stats, callbacks, entropyAnalyzer, criticalityOptimizer);

    // Mouse interaction
    let mouseDown = 0; // 0=none, 1=left, 2=right
    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0) mouseDown = 1;
        if (e.button === 2) mouseDown = 2;
    });
    canvas.addEventListener('mouseup', () => { mouseDown = 0; });
    canvas.addEventListener('mouseleave', () => { mouseDown = 0; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        settings.mouseX = (e.clientX - rect.left) * dpr - canvas.width / 2;
        settings.mouseY = (e.clientY - rect.top) * dpr - canvas.height / 2;
    });

    // Touch support
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        mouseDown = 1;
        const t = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        settings.mouseX = (t.clientX - rect.left) * dpr - canvas.width / 2;
        settings.mouseY = (t.clientY - rect.top) * dpr - canvas.height / 2;
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const t = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        settings.mouseX = (t.clientX - rect.left) * dpr - canvas.width / 2;
        settings.mouseY = (t.clientY - rect.top) * dpr - canvas.height / 2;
    }, { passive: false });
    canvas.addEventListener('touchend', () => { mouseDown = 0; });

    // ── Animation loop ───────────────────────────────────────

    let lastTime = performance.now();
    let frameCount = 0;
    let fpsAccum = 0;

    function frame(now) {
        requestAnimationFrame(frame);

        const dt = now - lastTime;
        lastTime = now;
        fpsAccum += dt;
        frameCount++;
        if (fpsAccum >= 500) {
            stats.fps = Math.round(frameCount / (fpsAccum / 1000));
            stats.frameMs = fpsAccum / frameCount;
            frameCount = 0;
            fpsAccum = 0;
        }

        // Update mouse force
        if (mouseDown === 1) {
            settings.mouseForce = settings.mouseStrength;
        } else if (mouseDown === 2) {
            settings.mouseForce = -settings.mouseStrength;
        } else {
            settings.mouseForce = 0;
        }

        if (!settings.paused) {
            simulation.step();
            entropyAnalyzer.maybeSample(device, simulation, settings);
            criticalityOptimizer.step(entropyAnalyzer, settings, () => {
                simulation.uploadRules();
                if (ui.onRulesUpdatedExternally) ui.onRulesUpdatedExternally();
            });
        }

        renderer.draw(ctx, simulation, canvas.width, canvas.height);
    }

    requestAnimationFrame(frame);
}

main();
