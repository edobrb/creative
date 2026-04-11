/**
 * storage.js — Share-link encoding for Slime Mold simulation.
 *
 * Encodes the tunable settings into a base64url URL hash so configurations
 * can be shared via link (mirrors the approach used in the Mandelbrot viewer).
 */

/**
 * Encode current settings into a base64url string for use as a URL hash.
 * @param {object} settings
 */
export function encodeShareHash(settings) {
    const data = {
        ac: settings.agentsCount,
        dt: settings.dt,
        as: settings.agentSpeed,
        ar: settings.agentRotationSpeed,
        df: settings.diffusionFactor,
        ef: settings.evaporationFactor,
        c:  settings.colors.map(({ r, g, b }) => [r, g, b]),
        w:  settings.weights,
    };
    const json = JSON.stringify(data);
    // btoa needs a binary string; use TextEncoder to support arbitrary characters
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode a base64url share hash back into a plain object.
 * Returns null if the hash is missing or malformed.
 * @param {string} hash — raw hash string (with or without leading '#')
 */
export function decodeShareHash(hash) {
    try {
        const b64 = hash.replace(/^#/, '').replace(/-/g, '+').replace(/_/g, '/');
        const binary = atob(b64);
        const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
        const json = new TextDecoder().decode(bytes);
        return JSON.parse(json);
    } catch {
        return null;
    }
}
