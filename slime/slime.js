// slime.js — Main entry: initializes WebGPU, builds pipelines, runs the simulation loop.

import {
    initAgentsWGSL,
    updateAgentsWGSL,
    sumAndResetWGSL,
    smoothWGSL,
    colorizeWGSL,
    renderVertexWGSL,
    renderFragmentWGSL,
} from './shaders.js';

import { buildUI } from './ui.js';
import { toPositionStops } from '../shared/gradient.js';

// ─── Settings (mutable, bound to UI) ────────────────────────

const settings = {
    mapSizeX:           0,
    mapSizeY:           0,
    agentsCount:        1_000_000,
    dt:                 1 / 8,
    agentSpeed:         8.0,
    agentRotationSpeed: 6.0,
    diffusionFactor:    2.0,
    evaporationFactor:  0.2,
    paused:             false,
    colors: [
        { r: 0,   g: 0,   b: 0,   a: 255 },
        { r: 255, g: 255, b: 255, a: 255 },
    ],
    weights: [1],
    _colorsDirty: true,
};

// ─── Show error ──────────────────────────────────────────────

function showError(msg) {
    const el = document.getElementById('error-message');
    el.textContent = msg;
    el.classList.remove('hidden');
}

// ─── Bootstrap ───────────────────────────────────────────────

async function main() {
    // --- Check WebGPU support ---
    if (!navigator.gpu) {
        showError('WebGPU is not supported in this browser. Please use Chrome 113+, Edge 113+, or Firefox Nightly with dom.webgpu.enabled.');
        return;
    }

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
        showError('Failed to obtain a WebGPU adapter.');
        return;
    }

    const device = await adapter.requestDevice({
        requiredLimits: {
            maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
            maxBufferSize: adapter.limits.maxBufferSize,
        },
    });

    device.lost.then((info) => {
        console.error('WebGPU device lost:', info.message);
        if (info.reason !== 'destroyed') { showError('WebGPU device lost: ' + info.message); }
    });

    // --- Canvas setup ---
    const canvas = document.getElementById('slime-canvas');
    const ctx = canvas.getContext('webgpu');
    const presentFormat = navigator.gpu.getPreferredCanvasFormat();

    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(canvas.clientWidth * dpr);
        canvas.height = Math.round(canvas.clientHeight * dpr);
        ctx.configure({ device, format: presentFormat, alphaMode: 'opaque' });
    }

    // ─── Size-dependent GPU resources (rebuilt on resize) ────

    let sizeX, sizeY;
    let trailMapA, trailMapB, depositMap, rgbaMap;
    let displayTexture, renderBindGroup;
    let pixelWorkgroups, smoothWGX, smoothWGY;

    // Agent buffers (recreated on count change or resize)
    let agentPosXBuf = null;
    let agentPosYBuf = null;
    let agentRotBuf  = null;

    // ─── Uniform buffers (persistent) ───────────────────────

    // Update-agents params: sizeX, sizeY, agentCount, seed, dt, speed, rotSpeed, dispatchStride
    const agentParamsBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // SumAndReset params: totalPixels + pad×3
    const sumParamsBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Smooth params: sizeX, sizeY, diffusion, evaporation, dt, pad×3
    const smoothParamsBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Colorize params: sizeX, sizeY, numStops, pad
    const colorizeParamsBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Color stops buffer (max 16 stops × 16 bytes each)
    const colorStopsBuf = device.createBuffer({ size: 16 * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

    // Init params: sizeX, sizeY, agentCount, seed, dispatchStride, pad×3 (32 bytes)
    const initAgentParamsBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // ─── Create compute pipelines ────────────────────────────

    const initAgentsPipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code: initAgentsWGSL }), entryPoint: 'main' },
    });

    const updateAgentsPipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code: updateAgentsWGSL }), entryPoint: 'main' },
    });

    const sumAndResetPipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code: sumAndResetWGSL }), entryPoint: 'main' },
    });

    const smoothPipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code: smoothWGSL }), entryPoint: 'main' },
    });

    const colorizePipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code: colorizeWGSL }), entryPoint: 'main' },
    });

    // ─── Render pipeline (fullscreen quad) ───────────────────

    const renderPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({ code: renderVertexWGSL }),
            entryPoint: 'main',
        },
        fragment: {
            module: device.createShaderModule({ code: renderFragmentWGSL }),
            entryPoint: 'main',
            targets: [{ format: presentFormat }],
        },
        primitive: { topology: 'triangle-list' },
    });

    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    // ─── Bind groups (double-buffered trail maps) ────────────

    let pingBGs, pongBGs;
    let usePing = true;

    function makeBindGroups(src, dst) {
        const agentBG = device.createBindGroup({
            layout: updateAgentsPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: dst } },
                { binding: 1, resource: { buffer: depositMap } },
                { binding: 2, resource: { buffer: agentPosXBuf } },
                { binding: 3, resource: { buffer: agentPosYBuf } },
                { binding: 4, resource: { buffer: agentRotBuf } },
                { binding: 5, resource: { buffer: agentParamsBuf } },
            ],
        });

        const sumBG = device.createBindGroup({
            layout: sumAndResetPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: depositMap } },
                { binding: 1, resource: { buffer: dst } },
                { binding: 2, resource: { buffer: sumParamsBuf } },
            ],
        });

        const smoothBG = device.createBindGroup({
            layout: smoothPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: dst } },
                { binding: 1, resource: { buffer: src } },
                { binding: 2, resource: { buffer: smoothParamsBuf } },
            ],
        });

        const colorizeBG = device.createBindGroup({
            layout: colorizePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: src } },
                { binding: 1, resource: { buffer: rgbaMap } },
                { binding: 2, resource: { buffer: colorizeParamsBuf } },
                { binding: 3, resource: { buffer: colorStopsBuf } },
            ],
        });

        return { agentBG, sumBG, smoothBG, colorizeBG };
    }

    // ─── Dispatch helper ─────────────────────────────────────

    let agentWGX, agentWGY, agentStride;

    function agentDispatch(count) {
        const wgX = Math.min(Math.ceil(count / 256), 65535);
        const wgY = Math.ceil(count / (wgX * 256));
        return { wgX, wgY, stride: wgX * 256 };
    }

    // ─── Agent init / reinit ─────────────────────────────────

    function initAgents(count) {
        if (agentPosXBuf) { agentPosXBuf.destroy(); agentPosYBuf.destroy(); agentRotBuf.destroy(); }

        agentPosXBuf = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.STORAGE });
        agentPosYBuf = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.STORAGE });
        agentRotBuf  = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.STORAGE });

        const seed = (Math.random() * 0xFFFFFFFF) >>> 0;
        const d = agentDispatch(count);
        device.queue.writeBuffer(initAgentParamsBuf, 0, new Uint32Array([sizeX, sizeY, count, seed, d.stride, 0, 0, 0]));

        const initBG = device.createBindGroup({
            layout: initAgentsPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: agentPosXBuf } },
                { binding: 1, resource: { buffer: agentPosYBuf } },
                { binding: 2, resource: { buffer: agentRotBuf } },
                { binding: 3, resource: { buffer: initAgentParamsBuf } },
            ],
        });

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(initAgentsPipeline);
        pass.setBindGroup(0, initBG);
        pass.dispatchWorkgroups(d.wgX, d.wgY);
        pass.end();
        device.queue.submit([encoder.finish()]);

        settings.agentsCount = count;
        agentWGX    = d.wgX;
        agentWGY    = d.wgY;
        agentStride = d.stride;

        pingBGs = makeBindGroups(trailMapA, trailMapB);
        pongBGs = makeBindGroups(trailMapB, trailMapA);
    }

    // ─── Rebuild map-size-dependent resources ────────────────

    function rebuildMap(width, height) {
        if (trailMapA) {
            trailMapA.destroy(); trailMapB.destroy();
            depositMap.destroy(); rgbaMap.destroy();
            displayTexture.destroy();
        }

        // bytesPerRow in copyBufferToTexture must be a multiple of 256 (= sizeX * 4 must be multiple of 256).
        // Round sizeX up to the nearest multiple of 64 to satisfy this.
        sizeX = Math.ceil(width / 64) * 64;
        sizeY = height;
        settings.mapSizeX = sizeX;
        settings.mapSizeY = sizeY;

        const totalPixels = sizeX * sizeY;

        trailMapA  = device.createBuffer({ size: totalPixels * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        trailMapB  = device.createBuffer({ size: totalPixels * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        depositMap = device.createBuffer({ size: totalPixels * 4, usage: GPUBufferUsage.STORAGE });
        rgbaMap    = device.createBuffer({ size: totalPixels * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

        displayTexture = device.createTexture({
            size: { width: sizeX, height: sizeY },
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });

        renderBindGroup = device.createBindGroup({
            layout: renderPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: sampler },
                { binding: 1, resource: displayTexture.createView() },
            ],
        });

        device.queue.writeBuffer(sumParamsBuf, 0, new Uint32Array([totalPixels, 0, 0, 0]));

        pixelWorkgroups = Math.ceil(totalPixels / 256);
        smoothWGX = Math.ceil(sizeX / 16);
        smoothWGY = Math.ceil(sizeY / 16);

        initAgents(settings.agentsCount);
        uploadColorStops();
    }

    // ─── Upload color stops ──────────────────────────────────

    function uploadColorStops() {
        const stops = toPositionStops(settings.colors, settings.weights);
        const data = new Float32Array(stops.length * 4);
        for (let i = 0; i < stops.length; i++) {
            data[i * 4 + 0] = stops[i].position;
            data[i * 4 + 1] = stops[i].r;
            data[i * 4 + 2] = stops[i].g;
            data[i * 4 + 3] = stops[i].b;
        }
        device.queue.writeBuffer(colorStopsBuf, 0, data);
        device.queue.writeBuffer(colorizeParamsBuf, 0, new Uint32Array([sizeX, sizeY, stops.length, 0]));
        settings._colorsDirty = false;
    }

    // ─── Stats ───────────────────────────────────────────────

    const stats = { fps: 0, frameMs: 0 };
    let frameCount = 0;
    let lastStatsTime = performance.now();
    let lastFrameTime = performance.now();

    // ─── Build UI ────────────────────────────────────────────

    settings._reinitAgents = initAgents;
    buildUI(document.body, settings, stats);

    // ─── Initial setup ───────────────────────────────────────

    resizeCanvas();
    rebuildMap(canvas.width, canvas.height);

    // Rebuild map on window resize (debounced to avoid thrashing)
    let resizeTimer;
    window.addEventListener('resize', () => {
        resizeCanvas();
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => rebuildMap(canvas.width, canvas.height), 150);
    });

    // ─── Frame loop ──────────────────────────────────────────

    let seedCounter = 1;

    function frame() {
        requestAnimationFrame(frame);

        const now = performance.now();
        stats.frameMs = now - lastFrameTime;
        lastFrameTime = now;
        frameCount++;
        if (now - lastStatsTime >= 1000) {
            stats.fps = frameCount;
            frameCount = 0;
            lastStatsTime = now;
        }

        if (settings.paused) {
            renderToScreen();
            return;
        }

        // Update dynamic uniforms
        const seed = (seedCounter++ * 1013904223) >>> 0;

        // Agent params
        {
            const buf = new ArrayBuffer(32);
            const u = new Uint32Array(buf);
            const f = new Float32Array(buf);
            u[0] = sizeX;
            u[1] = sizeY;
            u[2] = settings.agentsCount;
            u[3] = seed;
            f[4] = settings.dt;
            f[5] = settings.agentSpeed;
            f[6] = settings.agentRotationSpeed;
            u[7] = agentStride;
            device.queue.writeBuffer(agentParamsBuf, 0, buf);
        }

        // Smooth params
        {
            const buf = new ArrayBuffer(32);
            const u = new Uint32Array(buf);
            const f = new Float32Array(buf);
            u[0] = sizeX;
            u[1] = sizeY;
            f[2] = settings.diffusionFactor;
            f[3] = settings.evaporationFactor;
            f[4] = settings.dt;
            f[5] = 0; f[6] = 0; f[7] = 0;
            device.queue.writeBuffer(smoothParamsBuf, 0, buf);
        }

        if (settings._colorsDirty) {
            uploadColorStops();
        }

        const bgs = usePing ? pingBGs : pongBGs;

        const encoder = device.createCommandEncoder();

        // Pass 1: Update agents
        {
            const pass = encoder.beginComputePass();
            pass.setPipeline(updateAgentsPipeline);
            pass.setBindGroup(0, bgs.agentBG);
            pass.dispatchWorkgroups(agentWGX, agentWGY);
            pass.end();
        }

        // Pass 2: Sum and reset
        {
            const pass = encoder.beginComputePass();
            pass.setPipeline(sumAndResetPipeline);
            pass.setBindGroup(0, bgs.sumBG);
            pass.dispatchWorkgroups(pixelWorkgroups);
            pass.end();
        }

        // Pass 3: Smooth (diffuse + evaporate)
        {
            const pass = encoder.beginComputePass();
            pass.setPipeline(smoothPipeline);
            pass.setBindGroup(0, bgs.smoothBG);
            pass.dispatchWorkgroups(smoothWGX, smoothWGY);
            pass.end();
        }

        // Pass 4: Colorize
        {
            const pass = encoder.beginComputePass();
            pass.setPipeline(colorizePipeline);
            pass.setBindGroup(0, bgs.colorizeBG);
            pass.dispatchWorkgroups(pixelWorkgroups);
            pass.end();
        }

        // Copy rgbaMap buffer → display texture
        encoder.copyBufferToTexture(
            { buffer: rgbaMap, bytesPerRow: sizeX * 4, rowsPerImage: sizeY },
            { texture: displayTexture },
            { width: sizeX, height: sizeY },
        );

        // Render to screen
        const textureView = ctx.getCurrentTexture().createView();
        const renderPass = encoder.beginRenderPass({
            colorAttachments: [{
                view: textureView,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
        });
        renderPass.setPipeline(renderPipeline);
        renderPass.setBindGroup(0, renderBindGroup);
        renderPass.draw(3);
        renderPass.end();

        device.queue.submit([encoder.finish()]);

        usePing = !usePing;
    }

    function renderToScreen() {
        const encoder = device.createCommandEncoder();

        const textureView = ctx.getCurrentTexture().createView();
        const renderPass = encoder.beginRenderPass({
            colorAttachments: [{
                view: textureView,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
        });
        renderPass.setPipeline(renderPipeline);
        renderPass.setBindGroup(0, renderBindGroup);
        renderPass.draw(3);
        renderPass.end();

        device.queue.submit([encoder.finish()]);
    }

    requestAnimationFrame(frame);
}

main();
