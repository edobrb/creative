/**
 * storage.js — localStorage persistence for Particle Life bookmarks.
 */

const BOOKMARKS_KEY = 'particlelife_bookmarks';

export function getBookmarks() {
    try {
        const raw = localStorage.getItem(BOOKMARKS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function setBookmarks(list) {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list));
}

/** @param {{ name: string, settings: object }} bm */
export function addBookmark(bm) {
    const list = getBookmarks();
    list.push(bm);
    setBookmarks(list);
}

/** @param {number} idx */
export function removeBookmark(idx) {
    const list = getBookmarks();
    list.splice(idx, 1);
    setBookmarks(list);
}

// ---------- Share link ----------

/**
 * Encode current settings into a base64url string for use as a URL hash.
 * @param {object} settings
 */
export function encodeShareHash(settings) {
    const data = {
        pc: settings.particleCount,
        sc: settings.speciesCount,
        dt: settings.dt,
        fr: settings.friction,
        ms: settings.mouseStrength,
        pa: settings.particleAlpha,
        pr: settings.particleRadius,
        cl: settings.speciesColors.slice(0, settings.speciesCount),
        // Pack rules as flat array: [dMin,dStar,dMax,p,m0,m1,m2, ...]
        ru: settings.rules
            ? settings.rules.flatMap(r => [r.dMin, r.dStar, r.dMax, r.p, r.m0, r.m1, r.m2])
            : null,
    };
    const json = JSON.stringify(data);
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

/**
 * Apply a decoded share-hash payload to a settings object in-place.
 * Rebuilds the rules array from its packed flat form when present.
 */
export function applyShareData(settings, data) {
    if (!data) return;
    if (data.pc != null) settings.particleCount  = data.pc;
    if (data.sc != null) settings.speciesCount   = data.sc;
    if (data.dt != null) settings.dt             = data.dt;
    if (data.fr != null) settings.friction       = data.fr;
    if (data.ms != null) settings.mouseStrength  = data.ms;
    if (data.pa != null) settings.particleAlpha  = data.pa;
    if (data.pr != null) settings.particleRadius = data.pr;
    if (Array.isArray(data.cl)) {
        for (let i = 0; i < data.cl.length; i++) {
            settings.speciesColors[i] = data.cl[i];
        }
    }
    if (Array.isArray(data.ru) && data.ru.length % 7 === 0) {
        const rules = [];
        for (let i = 0; i < data.ru.length; i += 7) {
            rules.push({
                dMin:  data.ru[i],
                dStar: data.ru[i + 1],
                dMax:  data.ru[i + 2],
                p:     data.ru[i + 3],
                m0:    data.ru[i + 4],
                m1:    data.ru[i + 5],
                m2:    data.ru[i + 6],
            });
        }
        settings.rules = rules;
    }
}
