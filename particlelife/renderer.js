// renderer.js — WebGPU render pipeline for drawing particles as points.

import { renderVertexWGSL, renderFragmentWGSL } from './shaders.js';

function hexToRGBA(hex, alpha = 0.75) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b, alpha];
}

export class Renderer {
    constructor(device, presentFormat) {
        this.device = device;
        this.presentFormat = presentFormat;

        this.renderPipeline = null;
        this.renderBindGroupLayout = null;
        this.uniformBuffer = null;
        this.colorsBuffer = null;
        this.renderBindGroup = null;

        this._buildPipeline();
    }

    _buildPipeline() {
        const device = this.device;

        const vertModule = device.createShaderModule({ code: renderVertexWGSL });
        const fragModule = device.createShaderModule({ code: renderFragmentWGSL });

        this.renderBindGroupLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            ],
        });

        this.renderPipeline = device.createRenderPipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.renderBindGroupLayout] }),
            vertex: {
                module: vertModule,
                entryPoint: 'main',
            },
            fragment: {
                module: fragModule,
                entryPoint: 'main',
                targets: [{
                    format: this.presentFormat,
                    blend: {
                        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
                    },
                }],
            },
            primitive: {
                topology: 'triangle-list',
            },
        });

        // Render uniforms: viewportSize(vec2), halfWorld(vec2), alpha(f32), radius(f32), pad(2xf32) = 32 bytes
        this.uniformBuffer = device.createBuffer({
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }

    /** Rebuild colors buffer and bind group after reset/species count change. */
    rebuild(simulation) {
        const device = this.device;
        const k = simulation.settings.speciesCount;
        const colors = simulation.settings.speciesColors;

        this.colorsBuffer?.destroy();
        const colorData = new Float32Array(k * 4);
        for (let i = 0; i < k; i++) {
            const c = hexToRGBA(colors[i % colors.length]);
            colorData[i * 4 + 0] = c[0];
            colorData[i * 4 + 1] = c[1];
            colorData[i * 4 + 2] = c[2];
            colorData[i * 4 + 3] = c[3];
        }
        this.colorsBuffer = device.createBuffer({
            size: colorData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(this.colorsBuffer.getMappedRange()).set(colorData);
        this.colorsBuffer.unmap();

        this._simulation = simulation;

        this.renderBindGroup = device.createBindGroup({
            layout: this.renderBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: simulation.positionBuffer } },
                { binding: 2, resource: { buffer: simulation.speciesBuffer } },
                { binding: 3, resource: { buffer: this.colorsBuffer } },
            ],
        });
    }

    /** Update colors buffer without full rebuild. */
    updateColors(settings) {
        if (!this.colorsBuffer || !this._simulation) return;
        const k = settings.speciesCount;
        const colors = settings.speciesColors;
        const colorData = new Float32Array(k * 4);
        for (let i = 0; i < k; i++) {
            const c = hexToRGBA(colors[i % colors.length]);
            colorData[i * 4 + 0] = c[0];
            colorData[i * 4 + 1] = c[1];
            colorData[i * 4 + 2] = c[2];
            colorData[i * 4 + 3] = c[3];
        }
        this.device.queue.writeBuffer(this.colorsBuffer, 0, colorData);
    }

    /** Draw all particles. */
    draw(ctx, simulation, canvasWidth, canvasHeight) {
        const s = simulation.settings;
        const uni = new Float32Array([
            canvasWidth, canvasHeight,
            s.bx, s.by,
            s.particleAlpha, s.particleRadius,
            0, 0, // padding
        ]);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uni);

        const encoder = this.device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: ctx.getCurrentTexture().createView(),
                clearValue: { r: 0.02, g: 0.02, b: 0.03, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });
        pass.setPipeline(this.renderPipeline);
        pass.setBindGroup(0, this.renderBindGroup);
        pass.draw(6, s.particleCount); // 6 vertices per quad, instanced
        pass.end();

        this.device.queue.submit([encoder.finish()]);
    }
}
