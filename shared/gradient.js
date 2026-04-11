/**
 * gradient.js — Shared color gradient utilities.
 *
 * Provides gradient interpolation, preview rendering, and color conversion helpers
 * used by both the gradient editor widget and project-specific renderers.
 */

// ─── Interpolation ───────────────────────────────────────────

function linear(x, x0, x1, y0, y1) {
    if (x1 - x0 === 0) return (y0 + y1) / 2;
    return y0 + (x - x0) * (y1 - y0) / (x1 - x0);
}

/**
 * Compute a gradient color for a given value.
 *
 * @param {number}   v          Current value
 * @param {number}   minV       Minimum value (0)
 * @param {number}   maxV       Maximum value
 * @param {Array}    colors     Array of {r, g, b, a} color stops
 * @param {Array}    weights    Array of segment weights (length = colors.length - 1)
 * @param {Function} gradientFn Non-linear mapping [0,1] → [0,1]
 * @returns {{r:number, g:number, b:number, a:number}}
 */
export function getLinearGradient(v, minV, maxV, colors, weights, gradientFn) {
    const sumWeights = weights.reduce((a, b) => a + b, 0);

    let base;
    if (maxV - minV === 0) {
        base = 0;
    } else {
        base = (v - minV) / (maxV - minV);
    }

    base = gradientFn(base) * sumWeights;

    let i = 0;
    while (i < weights.length - 1 && base > weights[i]) {
        base -= weights[i];
        i++;
    }

    if (i >= weights.length) i = weights.length - 1;
    base = Math.min(base, weights[i]);

    const r = Math.round(Math.max(0, Math.min(255, linear(base, 0, weights[i], colors[i].r, colors[i + 1].r))));
    const g = Math.round(Math.max(0, Math.min(255, linear(base, 0, weights[i], colors[i].g, colors[i + 1].g))));
    const b = Math.round(Math.max(0, Math.min(255, linear(base, 0, weights[i], colors[i].b, colors[i + 1].b))));
    const a = Math.round(Math.max(0, Math.min(255, linear(base, 0, weights[i], colors[i].a, colors[i + 1].a))));

    return { r, g, b, a };
}

// ─── Preview drawing ─────────────────────────────────────────

/**
 * Draw the color gradient as a horizontal bar onto a 2D canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Array}  colors     Color stop array [{r,g,b,a}, ...]
 * @param {Array}  weights    Segment weight array
 * @param {Function} gradientFn Non-linear mapping [0,1] → [0,1]
 */
export function drawGradientPreview(canvas, colors, weights, gradientFn) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    for (let x = 0; x < w; x++) {
        const c = getLinearGradient(x, 0, w - 1, colors, weights, gradientFn);
        ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
        ctx.fillRect(x, 0, 1, h);
    }
}

// ─── Color conversion helpers ────────────────────────────────

export function toHex(c) {
    return '#' +
        c.r.toString(16).padStart(2, '0') +
        c.g.toString(16).padStart(2, '0') +
        c.b.toString(16).padStart(2, '0');
}

export function fromHex(hex) {
    const h = hex.replace('#', '');
    return {
        r: parseInt(h.slice(0, 2), 16) || 0,
        g: parseInt(h.slice(2, 4), 16) || 0,
        b: parseInt(h.slice(4, 6), 16) || 0,
        a: 255,
    };
}

/**
 * Convert colors[] + weights[] to position-based color stops.
 * Useful for shaders that expect {position, r, g, b} format.
 *
 * @param {Array}    colors  [{r,g,b,a}, ...]
 * @param {Array}    weights Segment weights
 * @param {Function} [gradientFn]  Optional non-linear mapping (default: identity)
 * @returns {Array<{position:number, r:number, g:number, b:number}>}
 */
export function toPositionStops(colors, weights, gradientFn) {
    const identity = (x) => x;
    const fn = gradientFn || identity;
    const total = weights.reduce((a, b) => a + b, 0);
    if (total === 0) {
        return colors.map((c, i, a) => ({
            position: i / Math.max(1, a.length - 1),
            r: c.r, g: c.g, b: c.b,
        }));
    }
    const stops = [];
    let cum = 0;
    for (let i = 0; i < colors.length; i++) {
        const pos = i === 0 ? 0 : fn(cum / total);
        stops.push({ position: pos, r: colors[i].r, g: colors[i].g, b: colors[i].b });
        if (i < weights.length) cum += weights[i];
    }
    return stops;
}
