/**
 * renderer.js — WebGPU setup, pipelines, buffer management, render dispatch.
 *
 * Uses perturbation theory: a single reference orbit (computed on CPU at
 * arbitrary precision) is uploaded to the GPU, and each pixel computes
 * only its lightweight f32 delta orbit. The compute shader writes a
 * smooth iteration value per pixel; the fragment shader does the color
 * LUT lookup and optional gradient-based 3D shading.
 */

// ---------- Render shader (inline WGSL) ----------

const RENDER_SHADER = /* wgsl */`
struct RenderParams {
    width        : u32,
    height       : u32,
    color_period : u32,
    flags        : u32,   // bit 0 = 3D shading enabled
    height_scale : f32,
    ambient      : f32,
    light_azim   : f32,   // radians
    light_elev   : f32,   // radians
};

@group(0) @binding(0) var<uniform> rp : RenderParams;
@group(0) @binding(1) var<storage, read> pixels : array<f32>;
@group(0) @binding(2) var<storage, read> color_lut : array<u32>;

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> @builtin(position) vec4<f32> {
    let x = f32(i32(vi & 1u)) * 4.0 - 1.0;
    let y = f32(i32(vi >> 1u)) * 4.0 - 1.0;
    return vec4<f32>(x, y, 0.0, 1.0);
}

fn unpack_rgb(packed : u32) -> vec3<f32> {
    let r = f32(packed & 0xFFu) / 255.0;
    let g = f32((packed >> 8u)  & 0xFFu) / 255.0;
    let b = f32((packed >> 16u) & 0xFFu) / 255.0;
    return vec3<f32>(r, g, b);
}

fn sample_raw(x : i32, y : i32) -> f32 {
    let cx = clamp(x, 0, i32(rp.width)  - 1);
    let cy = clamp(y, 0, i32(rp.height) - 1);
    return pixels[u32(cy) * rp.width + u32(cx)];
}

// Looks up a color from the LUT with linear interpolation between
// adjacent slots (cyclic, period = color_period). Values < 0 mark
// points inside the Mandelbrot set — return the "inside" slot.
fn lookup_color(v : f32) -> vec3<f32> {
    if (v < 0.0) {
        return unpack_rgb(color_lut[rp.color_period]);
    }
    let period = f32(rp.color_period);
    let t = v - period * floor(v / period);
    let i0 = u32(floor(t)) % rp.color_period;
    let i1 = (i0 + 1u) % rp.color_period;
    let f  = fract(t);
    let c0 = unpack_rgb(color_lut[i0]);
    let c1 = unpack_rgb(color_lut[i1]);
    return mix(c0, c1, f);
}

// Transforms the raw smooth-iteration value into a log height, which
// compresses dynamic range so the 3D relief stays readable across zoom.
fn height_of(v : f32, center : f32) -> f32 {
    let src = select(v, center, v < 0.0);
    return log(src + 1.0);
}

@fragment
fn fs(@builtin(position) pos : vec4<f32>) -> @location(0) vec4<f32> {
    let x = i32(pos.x);
    let y = i32(pos.y);

    if (x >= i32(rp.width) || y >= i32(rp.height)) {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }

    let v = sample_raw(x, y);
    let base = lookup_color(v);

    // Disabled, or pixel is inside the set → flat color.
    if ((rp.flags & 1u) == 0u || v < 0.0) {
        return vec4<f32>(base, 1.0);
    }

    // Central differences over the smooth-iter field, with inside
    // neighbors substituted by the center value to avoid sharp seams
    // at the set boundary.
    let cL = sample_raw(x - 1, y);
    let cR = sample_raw(x + 1, y);
    let cT = sample_raw(x, y - 1);
    let cB = sample_raw(x, y + 1);

    let hL = height_of(cL, v);
    let hR = height_of(cR, v);
    let hT = height_of(cT, v);
    let hB = height_of(cB, v);

    let dx = (hR - hL) * 0.5 * rp.height_scale;
    let dy = (hB - hT) * 0.5 * rp.height_scale;

    let n = normalize(vec3<f32>(-dx, -dy, 1.0));

    let ce = cos(rp.light_elev);
    let L_dir = normalize(vec3<f32>(
        ce * cos(rp.light_azim),
        ce * sin(rp.light_azim),
        sin(rp.light_elev),
    ));

    let diffuse = max(dot(n, L_dir), 0.0);
    // Soft Blinn-Phong highlight for a subtle metallic sheen on ridges.
    let view_dir = vec3<f32>(0.0, 0.0, 1.0);
    let half_dir = normalize(L_dir + view_dir);
    let spec = pow(max(dot(n, half_dir), 0.0), 24.0) * 0.35;

    let light = rp.ambient + (1.0 - rp.ambient) * diffuse;
    let color = base * light + vec3<f32>(spec);

    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;

// ---------- Renderer class ----------

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.device = null;
        this.context = null;
        this.format = null;

        // Pipelines
        this.computePipeline = null;
        this.renderPipeline = null;

        // Buffers
        this.computeParamsBuffer = null;
        this.refOrbitReBuffer = null;
        this.refOrbitImBuffer = null;
        this.colorLUTBuffer = null;
        this.pixelBuffer = null;
        this.renderParamsBuffer = null;

        // Bind groups
        this.computeBindGroup = null;
        this.renderBindGroup = null;
        this.computeBindGroupLayout = null;
        this.renderBindGroupLayout = null;

        this.width = 0;
        this.height = 0;
        this.currentMaxIter = 0;
        this.currentRefOrbitCapacity = 0;
    }

    async init() {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) throw new Error('WebGPU adapter not available.');

        this.device = await adapter.requestDevice({
            requiredLimits: {
                maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
                maxBufferSize: adapter.limits.maxBufferSize,
            },
        });

        this.device.lost.then((info) => {
            console.error('WebGPU device lost:', info.message);
        });

        this.context = this.canvas.getContext('webgpu');
        this.format = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: 'opaque',
        });

        await this._createPipelines();
        this._createStaticBuffers();
    }

    async _createPipelines() {
        // ----- Perturbation compute pipeline -----
        const computeShaderSrc = await fetch('mandelbrot_perturb.wgsl').then((r) => r.text());
        const computeModule = this.device.createShaderModule({ code: computeShaderSrc });

        this.computeBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });

        this.computePipeline = this.device.createComputePipeline({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.computeBindGroupLayout] }),
            compute: { module: computeModule, entryPoint: 'main' },
        });

        // ----- Render pipeline -----
        const renderModule = this.device.createShaderModule({ code: RENDER_SHADER });

        this.renderBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
            ],
        });

        this.renderPipeline = this.device.createRenderPipeline({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.renderBindGroupLayout] }),
            vertex: { module: renderModule, entryPoint: 'vs' },
            fragment: {
                module: renderModule,
                entryPoint: 'fs',
                targets: [{ format: this.format }],
            },
            primitive: { topology: 'triangle-list' },
        });
    }

    _createStaticBuffers() {
        // Compute params uniform (48 bytes: 4 f32 + 8 u32)
        this.computeParamsBuffer = this.device.createBuffer({
            size: 48,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Render params uniform (32 bytes: 4 u32 + 4 f32)
        this.renderParamsBuffer = this.device.createBuffer({
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }

    /**
     * Resize internal buffers to match new canvas pixel dimensions.
     */
    resize(width, height) {
        if (width === this.width && height === this.height) return;
        this.width = width;
        this.height = height;

        this.canvas.width = width;
        this.canvas.height = height;

        // Pixel buffer now stores one f32 per pixel (smooth iteration value).
        if (this.pixelBuffer) this.pixelBuffer.destroy();
        this.pixelBuffer = this.device.createBuffer({
            size: width * height * 4,
            usage: GPUBufferUsage.STORAGE,
        });

        this._rebuildBindGroups();
    }

    /**
     * Upload a new color LUT to the GPU.
     */
    updateColorLUT(lut, maxIter) {
        if (this.colorLUTBuffer) this.colorLUTBuffer.destroy();
        this.colorLUTBuffer = this.device.createBuffer({
            size: lut.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.colorLUTBuffer, 0, lut);
        this.currentMaxIter = maxIter;

        this._rebuildBindGroups();
    }

    /**
     * Upload the reference orbit to the GPU.
     * @param {Float32Array} re - Real parts of reference orbit
     * @param {Float32Array} im - Imaginary parts of reference orbit
     * @param {number} length - Number of valid entries
     */
    updateRefOrbit(re, im, length) {
        const byteSize = (length + 1) * 4; // +1 for safety
        const needRealloc = byteSize > this.currentRefOrbitCapacity;

        if (needRealloc) {
            if (this.refOrbitReBuffer) this.refOrbitReBuffer.destroy();
            if (this.refOrbitImBuffer) this.refOrbitImBuffer.destroy();

            this.refOrbitReBuffer = this.device.createBuffer({
                size: byteSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            this.refOrbitImBuffer = this.device.createBuffer({
                size: byteSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            this.currentRefOrbitCapacity = byteSize;
        }

        this.device.queue.writeBuffer(this.refOrbitReBuffer, 0, re, 0, length + 1);
        this.device.queue.writeBuffer(this.refOrbitImBuffer, 0, im, 0, length + 1);

        if (needRealloc) this._rebuildBindGroups();
    }

    _rebuildBindGroups() {
        if (!this.pixelBuffer || !this.colorLUTBuffer || !this.refOrbitReBuffer || !this.refOrbitImBuffer) return;

        this.computeBindGroup = this.device.createBindGroup({
            layout: this.computeBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.computeParamsBuffer } },
                { binding: 1, resource: { buffer: this.refOrbitReBuffer } },
                { binding: 2, resource: { buffer: this.refOrbitImBuffer } },
                { binding: 3, resource: { buffer: this.pixelBuffer } },
            ],
        });

        this.renderBindGroup = this.device.createBindGroup({
            layout: this.renderBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.renderParamsBuffer } },
                { binding: 1, resource: { buffer: this.pixelBuffer } },
                { binding: 2, resource: { buffer: this.colorLUTBuffer } },
            ],
        });
    }

    /**
     * Render a frame using perturbation theory.
     *
     * @param {number} viewportSizeX  Width of viewport in complex plane units
     * @param {number} viewportSizeY  Height of viewport in complex plane units
     * @param {number} refLength      Length of the reference orbit
     * @param {number} maxIter        Maximum iterations
     * @param {number} colorPeriod    LUT cycle length
     * @param {object} lighting       { enabled, azimuth, elevation, ambient, heightScale }
     */
    render(viewportSizeX, viewportSizeY, refLength, maxIter, colorPeriod, lighting) {
        if (this.width === 0 || this.height === 0) return;
        if (!this.computeBindGroup || !this.renderBindGroup) return;

        // Compute params (unchanged bindings; color_period kept unused-in-shader for backwards padding).
        const cbuf = new ArrayBuffer(48);
        const cf = new Float32Array(cbuf, 0, 4);
        const cu = new Uint32Array(cbuf, 16, 8);
        cf[0] = this.width / 2;
        cf[1] = this.height / 2;
        cf[2] = Math.fround(viewportSizeX / this.width);
        cf[3] = Math.fround(viewportSizeY / this.height);
        cu[0] = this.width;
        cu[1] = this.height;
        cu[2] = maxIter;
        cu[3] = refLength;
        this.device.queue.writeBuffer(this.computeParamsBuffer, 0, cbuf);

        // Render params (32 bytes: 4 u32 + 4 f32).
        const rbuf = new ArrayBuffer(32);
        const ru = new Uint32Array(rbuf, 0, 4);
        const rf = new Float32Array(rbuf, 16, 4);
        ru[0] = this.width;
        ru[1] = this.height;
        ru[2] = colorPeriod;
        ru[3] = lighting.enabled ? 1 : 0;
        rf[0] = lighting.heightScale;
        rf[1] = lighting.ambient;
        rf[2] = lighting.azimuth;
        rf[3] = lighting.elevation;
        this.device.queue.writeBuffer(this.renderParamsBuffer, 0, rbuf);

        const encoder = this.device.createCommandEncoder();

        // Compute pass
        const computePass = encoder.beginComputePass();
        computePass.setPipeline(this.computePipeline);
        computePass.setBindGroup(0, this.computeBindGroup);
        computePass.dispatchWorkgroups(
            Math.ceil(this.width / 16),
            Math.ceil(this.height / 16),
        );
        computePass.end();

        // Render pass
        const textureView = this.context.getCurrentTexture().createView();
        const renderPass = encoder.beginRenderPass({
            colorAttachments: [{
                view: textureView,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
        });
        renderPass.setPipeline(this.renderPipeline);
        renderPass.setBindGroup(0, this.renderBindGroup);
        renderPass.draw(3);
        renderPass.end();

        this.device.queue.submit([encoder.finish()]);
    }

    /**
     * Read the final framebuffer back and return it as a PNG Blob.
     * Uses a one-shot offscreen render target so the screenshot captures
     * the fully-shaded image (including 3D lighting), not just the raw
     * iteration field in the storage buffer.
     */
    async captureScreenshot() {
        const w = this.width, h = this.height;
        if (!this.pixelBuffer || w === 0 || h === 0) return null;

        // Create an offscreen texture matching the swapchain format.
        const texture = this.device.createTexture({
            size: { width: w, height: h },
            format: this.format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });

        const encoder = this.device.createCommandEncoder();
        const renderPass = encoder.beginRenderPass({
            colorAttachments: [{
                view: texture.createView(),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
        });
        renderPass.setPipeline(this.renderPipeline);
        renderPass.setBindGroup(0, this.renderBindGroup);
        renderPass.draw(3);
        renderPass.end();

        const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
        const readback = this.device.createBuffer({
            size: bytesPerRow * h,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        encoder.copyTextureToBuffer(
            { texture },
            { buffer: readback, bytesPerRow, rowsPerImage: h },
            { width: w, height: h },
        );
        this.device.queue.submit([encoder.finish()]);

        await readback.mapAsync(GPUMapMode.READ);
        const raw = new Uint8Array(readback.getMappedRange().slice(0));
        readback.unmap();
        readback.destroy();
        texture.destroy();

        // Tightly pack rows (strip the 256-byte alignment padding) and
        // swap BGRA→RGBA if the preferred format is bgra8unorm.
        const pixels = new Uint8ClampedArray(w * h * 4);
        const bgra = this.format === 'bgra8unorm';
        for (let y = 0; y < h; y++) {
            const srcOff = y * bytesPerRow;
            const dstOff = y * w * 4;
            for (let x = 0; x < w; x++) {
                const s = srcOff + x * 4;
                const d = dstOff + x * 4;
                if (bgra) {
                    pixels[d]     = raw[s + 2];
                    pixels[d + 1] = raw[s + 1];
                    pixels[d + 2] = raw[s];
                    pixels[d + 3] = raw[s + 3];
                } else {
                    pixels[d]     = raw[s];
                    pixels[d + 1] = raw[s + 1];
                    pixels[d + 2] = raw[s + 2];
                    pixels[d + 3] = raw[s + 3];
                }
            }
        }

        const offscreen = new OffscreenCanvas(w, h);
        const ctx = offscreen.getContext('2d');
        ctx.putImageData(new ImageData(pixels, w, h), 0, 0);
        return offscreen.convertToBlob({ type: 'image/png' });
    }

    destroy() {
        if (this.computeParamsBuffer) this.computeParamsBuffer.destroy();
        if (this.renderParamsBuffer) this.renderParamsBuffer.destroy();
        if (this.colorLUTBuffer) this.colorLUTBuffer.destroy();
        if (this.pixelBuffer) this.pixelBuffer.destroy();
        if (this.refOrbitReBuffer) this.refOrbitReBuffer.destroy();
        if (this.refOrbitImBuffer) this.refOrbitImBuffer.destroy();
        this.device?.destroy();
    }
}
