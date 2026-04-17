// entropy.js — Shannon entropy computation and criticality optimizer for Particle Life.

/**
 * EntropyAnalyzer computes the spatial Shannon entropy of the particle system.
 * 
 * It discretizes the world into a grid, counts particles per cell per species,
 * and computes H = -Σ p_i log2(p_i) for the joint (cell, species) distribution.
 * 
 * A rolling time window keeps track of recent entropy values for charting and
 * for the criticality optimizer.
 */
export class EntropyAnalyzer {
    /**
     * @param {number} gridSize  Number of grid cells per axis (gridSize × gridSize grid).
     * @param {number} windowSize  Number of samples to keep in the rolling window.
     */
    constructor(gridSize = 16, windowSize = 200) {
        this.gridSize = gridSize;
        this.windowSize = windowSize;
        this.history = [];           // rolling window of { entropy, time }
        this.stepCounter = 0;
        this.sampleInterval = 4;     // compute entropy every N steps
        this._readbackBuffer = null;
        this._speciesReadbackBuffer = null;
        this._pendingReadback = false;
    }

    /**
     * Ensure GPU readback buffers exist with the right size.
     */
    _ensureBuffers(device, particleCount) {
        const posSize = particleCount * 2 * 4;
        const specSize = particleCount * 4;

        if (!this._readbackBuffer || this._readbackBuffer.size < posSize) {
            this._readbackBuffer?.destroy();
            this._readbackBuffer = device.createBuffer({
                size: posSize,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
        }
        if (!this._speciesReadbackBuffer || this._speciesReadbackBuffer.size < specSize) {
            this._speciesReadbackBuffer?.destroy();
            this._speciesReadbackBuffer = device.createBuffer({
                size: specSize,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
        }
    }

    /**
     * Schedule an async readback of positions + species, compute entropy.
     * Call this every simulation step; it will only actually sample every sampleInterval steps.
     * 
     * @param {GPUDevice} device
     * @param {Simulation} simulation
     * @param {object} settings
     */
    maybeSample(device, simulation, settings) {
        this.stepCounter++;
        if (this.stepCounter % this.sampleInterval !== 0) return;
        if (this._pendingReadback) return;

        const n = settings.particleCount;
        const k = settings.speciesCount;
        const bx = settings.bx;
        const by = settings.by;

        this._ensureBuffers(device, n);

        // Copy GPU buffers to readback buffers
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(simulation.positionBuffer, 0, this._readbackBuffer, 0, n * 2 * 4);
        encoder.copyBufferToBuffer(simulation.speciesBuffer, 0, this._speciesReadbackBuffer, 0, n * 4);
        device.queue.submit([encoder.finish()]);

        this._pendingReadback = true;

        // Async readback
        Promise.all([
            this._readbackBuffer.mapAsync(GPUMapMode.READ),
            this._speciesReadbackBuffer.mapAsync(GPUMapMode.READ),
        ]).then(() => {
            const positions = new Float32Array(this._readbackBuffer.getMappedRange().slice(0));
            const species = new Uint32Array(this._speciesReadbackBuffer.getMappedRange().slice(0));
            this._readbackBuffer.unmap();
            this._speciesReadbackBuffer.unmap();
            this._pendingReadback = false;

            const entropy = this._computeEntropy(positions, species, n, k, bx, by);
            this.history.push({ entropy, step: this.stepCounter });
            if (this.history.length > this.windowSize) {
                this.history.shift();
            }
        }).catch(() => {
            this._pendingReadback = false;
        });
    }

    /**
     * Compute Shannon entropy of the joint (cell, species) distribution.
     */
    _computeEntropy(positions, species, n, k, bx, by) {
        const g = this.gridSize;
        const totalBins = g * g * k;
        const counts = new Uint32Array(totalBins);

        const worldW = bx * 2;
        const worldH = by * 2;

        for (let i = 0; i < n; i++) {
            const px = positions[i * 2];
            const py = positions[i * 2 + 1];
            const sp = species[i];

            // Map position from [-bx, bx] to [0, g-1]
            let gx = Math.floor(((px + bx) / worldW) * g);
            let gy = Math.floor(((py + by) / worldH) * g);
            gx = Math.max(0, Math.min(g - 1, gx));
            gy = Math.max(0, Math.min(g - 1, gy));

            const binIdx = (gy * g + gx) * k + sp;
            counts[binIdx]++;
        }

        // Shannon entropy: H = -Σ p_i * log2(p_i)
        let H = 0;
        for (let i = 0; i < totalBins; i++) {
            if (counts[i] > 0) {
                const p = counts[i] / n;
                H -= p * Math.log2(p);
            }
        }

        return H;
    }

    /** Get the last computed entropy value. */
    get currentEntropy() {
        return this.history.length > 0 ? this.history[this.history.length - 1].entropy : 0;
    }

    /** Get average entropy over the window. */
    get averageEntropy() {
        if (this.history.length === 0) return 0;
        let sum = 0;
        for (const h of this.history) sum += h.entropy;
        return sum / this.history.length;
    }

    /** Get the max possible entropy for current config. */
    maxEntropy(speciesCount) {
        const totalBins = this.gridSize * this.gridSize * speciesCount;
        return Math.log2(totalBins);
    }

    /** Get entropy standard deviation over the window. */
    get entropyStdDev() {
        if (this.history.length < 2) return 0;
        const avg = this.averageEntropy;
        let sumSq = 0;
        for (const h of this.history) {
            const d = h.entropy - avg;
            sumSq += d * d;
        }
        return Math.sqrt(sumSq / this.history.length);
    }

    /** Reset history (e.g. on simulation reset). */
    reset() {
        this.history = [];
        this.stepCounter = 0;
        this._pendingReadback = false;
    }
}

/**
 * CriticalityOptimizer tweaks force matrix values to keep the system
 * at the "edge of chaos" — maximizing entropy fluctuations (variance)
 * while keeping average entropy in a moderate range.
 * 
 * Strategy: Systems at criticality exhibit maximal variance in order parameters.
 * We use the coefficient of variation (stddev/mean) of entropy as a proxy for
 * criticality and apply small perturbations to the force matrix, keeping changes
 * that increase the CV.
 */
export class CriticalityOptimizer {
    constructor() {
        this.enabled = false;
        this.strength = 0.02;      // perturbation magnitude
        this.interval = 60;        // steps between perturbations
        this._stepCount = 0;
        this._lastCV = 0;
        this._lastPerturbation = null; // { ruleIdx, field, delta }
        this._warmup = 100;        // min history samples before optimizing
    }

    /**
     * Called every simulation step. May tweak rules.
     * @param {EntropyAnalyzer} analyzer
     * @param {object} settings
     * @param {Function} onRulesChanged  callback to upload rules to GPU
     */
    step(analyzer, settings, onRulesChanged) {
        if (!this.enabled) return;
        this._stepCount++;
        if (this._stepCount % this.interval !== 0) return;
        if (analyzer.history.length < this._warmup) return;

        const rules = settings.rules;
        if (!rules || rules.length === 0) return;

        const currentCV = analyzer.entropyStdDev / Math.max(analyzer.averageEntropy, 0.001);

        // Evaluate last perturbation: did it improve criticality (higher CV)?
        if (this._lastPerturbation) {
            if (currentCV < this._lastCV) {
                // Revert: the perturbation made things worse
                const p = this._lastPerturbation;
                rules[p.ruleIdx][p.field] -= p.delta;
            }
            // else: keep it (already applied)
        }

        this._lastCV = currentCV;

        // Apply a new random perturbation
        const ruleIdx = Math.floor(Math.random() * rules.length);
        const fields = ['m0', 'm1', 'm2'];
        const field = fields[Math.floor(Math.random() * fields.length)];
        const delta = (Math.random() - 0.5) * 2 * this.strength;

        // Clamp to reasonable bounds
        const rule = rules[ruleIdx];
        const oldVal = rule[field];
        let newVal = oldVal + delta;

        if (field === 'm0') newVal = Math.max(-5, Math.min(0, newVal));
        else newVal = Math.max(-2, Math.min(2, newVal));

        rule[field] = newVal;

        this._lastPerturbation = { ruleIdx, field, delta: newVal - oldVal };
        onRulesChanged();
    }

    reset() {
        this._stepCount = 0;
        this._lastCV = 0;
        this._lastPerturbation = null;
    }
}
