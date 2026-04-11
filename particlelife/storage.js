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
