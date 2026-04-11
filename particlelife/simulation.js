// simulation.js — Particle Life simulation state and GPU pipeline management.

import { computeForcesWGSL, integrateWGSL } from './shaders.js';

export class Simulation {
    constructor(device, settings) {
        this.device = device;
        this.settings = settings;

        // GPU buffers (created on reset)
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.speciesBuffer = null;
        this.rulesBuffer = null;
        this.paramsBuffer = null;

        // Pipelines
        this.forcesPipeline = null;
        this.integratePipeline = null;
        this.forcesBindGroup = null;
        this.integrateBindGroup = null;

        this._buildPipelines();
    }

    _buildPipelines() {
        const device = this.device;

        // Force computation pipeline
        const forcesModule = device.createShaderModule({ code: computeForcesWGSL });
        this.forcesLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            ],
        });
        this.forcesPipeline = device.createComputePipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.forcesLayout] }),
            compute: { module: forcesModule, entryPoint: 'main' },
        });

        // Integration pipeline
        const integrateModule = device.createShaderModule({ code: integrateWGSL });
        this.integrateLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            ],
        });
        this.integratePipeline = device.createComputePipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.integrateLayout] }),
            compute: { module: integrateModule, entryPoint: 'main' },
        });

        // Params uniform buffer (fixed size)
        this.paramsBuffer = device.createBuffer({
            size: 12 * 4, // 12 floats/u32s (padded to 48 bytes for alignment)
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }

    /** Initialize / reset particles and rules. */
    reset(canvasWidth, canvasHeight) {
        const s = this.settings;
        const device = this.device;
        const n = s.particleCount;
        const k = s.speciesCount;

        s.bx = canvasWidth / 2;
        s.by = canvasHeight / 2;

        // Destroy old buffers
        this.positionBuffer?.destroy();
        this.velocityBuffer?.destroy();
        this.speciesBuffer?.destroy();
        this.rulesBuffer?.destroy();

        // Positions: random within world bounds
        const positions = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) {
            positions[i * 2]     = (Math.random() - 0.5) * canvasWidth;
            positions[i * 2 + 1] = (Math.random() - 0.5) * canvasHeight;
        }
        this.positionBuffer = device.createBuffer({
            size: positions.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(this.positionBuffer.getMappedRange()).set(positions);
        this.positionBuffer.unmap();

        // Velocities: zero
        this.velocityBuffer = device.createBuffer({
            size: n * 2 * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(this.velocityBuffer.getMappedRange()).fill(0);
        this.velocityBuffer.unmap();

        // Species assignment
        const speciesArr = new Uint32Array(n);
        for (let i = 0; i < n; i++) {
            speciesArr[i] = i % k;
        }
        this.speciesBuffer = device.createBuffer({
            size: speciesArr.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Uint32Array(this.speciesBuffer.getMappedRange()).set(speciesArr);
        this.speciesBuffer.unmap();

        // Generate random rules if needed
        if (!s.rules || s.rules.length !== k * k) {
            s.rules = Simulation.randomRules(k);
        }
        this._uploadRules();
        this._rebuildBindGroups();
    }

    static randomRules(k) {
        const rules = [];
        for (let i = 0; i < k * k; i++) {
            const scale = (Math.random() + 0.5) * 50;
            const s1 = Math.random() + 0.5;
            const s2 = Math.random() + 0.5;
            const s3 = Math.random() + 0.5;
            rules.push({
                dMin:  s1 * scale,
                dStar: (s1 + s2) * scale,
                dMax:  (s1 + s2 + s3) * scale,
                p:     (Math.random() + 0.3) * 2,
                m0:    -(Math.random() + 0.5) * 2,
                m1:    (Math.random() - 0.5) * 2 * 0.5,
                m2:    (Math.random() - 0.5) * 2 * 0.2,
            });
        }
        return rules;
    }

    _uploadRules() {
        const s = this.settings;
        const k = s.speciesCount;
        // Each rule = 7 floats, pad to 8 for alignment (28 bytes -> 32 bytes)
        const data = new Float32Array(k * k * 8);
        for (let i = 0; i < k * k; i++) {
            const r = s.rules[i];
            data[i * 8 + 0] = r.dMin;
            data[i * 8 + 1] = r.dStar;
            data[i * 8 + 2] = r.dMax;
            data[i * 8 + 3] = r.p;
            data[i * 8 + 4] = r.m0;
            data[i * 8 + 5] = r.m1;
            data[i * 8 + 6] = r.m2;
            data[i * 8 + 7] = 0; // padding
        }

        this.rulesBuffer?.destroy();
        this.rulesBuffer = this.device.createBuffer({
            size: data.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(this.rulesBuffer.getMappedRange()).set(data);
        this.rulesBuffer.unmap();
    }

    _rebuildBindGroups() {
        this.forcesBindGroup = this.device.createBindGroup({
            layout: this.forcesLayout,
            entries: [
                { binding: 0, resource: { buffer: this.paramsBuffer } },
                { binding: 1, resource: { buffer: this.positionBuffer } },
                { binding: 2, resource: { buffer: this.velocityBuffer } },
                { binding: 3, resource: { buffer: this.speciesBuffer } },
                { binding: 4, resource: { buffer: this.rulesBuffer } },
            ],
        });

        this.integrateBindGroup = this.device.createBindGroup({
            layout: this.integrateLayout,
            entries: [
                { binding: 0, resource: { buffer: this.paramsBuffer } },
                { binding: 1, resource: { buffer: this.positionBuffer } },
                { binding: 2, resource: { buffer: this.velocityBuffer } },
            ],
        });
    }

    /** Upload updated rules to GPU (call after editing rules in settings). */
    uploadRules() {
        this._uploadRules();
        this._rebuildBindGroups();
    }

    /** Run one simulation step. */
    step() {
        const s = this.settings;
        const n = s.particleCount;

        // Upload params
        const paramsData = new ArrayBuffer(12 * 4);
        const u32 = new Uint32Array(paramsData);
        const f32 = new Float32Array(paramsData);
        u32[0] = n;
        u32[1] = s.speciesCount;
        f32[2] = s.dt;
        f32[3] = s.friction;
        f32[4] = s.bx;
        f32[5] = s.by;
        f32[6] = s.mouseX;
        f32[7] = s.mouseY;
        f32[8] = s.mouseForce;
        f32[9] = 0; // pad
        f32[10] = 0;
        f32[11] = 0;
        this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

        const workgroups = Math.ceil(n / 256);
        const encoder = this.device.createCommandEncoder();

        // Force pass
        const forcesPass = encoder.beginComputePass();
        forcesPass.setPipeline(this.forcesPipeline);
        forcesPass.setBindGroup(0, this.forcesBindGroup);
        forcesPass.dispatchWorkgroups(workgroups);
        forcesPass.end();

        // Integrate pass
        const intPass = encoder.beginComputePass();
        intPass.setPipeline(this.integratePipeline);
        intPass.setBindGroup(0, this.integrateBindGroup);
        intPass.dispatchWorkgroups(workgroups);
        intPass.end();

        this.device.queue.submit([encoder.finish()]);
    }
}
