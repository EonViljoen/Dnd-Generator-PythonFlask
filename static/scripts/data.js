// Data layer for the generator: where tables come from and how they're rolled.
//
// - ServerSource: the default tables, rolled by the Flask API.
// - LocalSource:  tables held in the browser (a user's custom JSON, optionally
//                 merged with the defaults). Rolling/searching happen here.
//
// Custom JSON is stored only in this browser (IndexedDB). It is never sent
// to the server.

import { parse as parseDice } from './dice.js';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Icons users can pick for their own categories (Bootstrap Icons names, all present in v1.11.3)
export const DEFAULT_CUSTOM_ICON = 'journal-bookmark';
export const ICON_CHOICES = [
    'journal-bookmark', 'book', 'book-half', 'bookmark-star', 'dice-5', 'dice-3', 'puzzle', 'magic',
    'stars', 'star', 'moon-stars', 'moon', 'sun', 'fire', 'droplet', 'snow', 'cloud-lightning', 'tornado',
    'tsunami', 'tree', 'flower1', 'bricks', 'door-closed', 'key', 'lock', 'map', 'compass', 'signpost-split',
    'geo-alt', 'globe', 'binoculars', 'house-door', 'buildings', 'shop', 'cup-straw', 'cup-hot',
    'music-note-beamed', 'palette', 'cart', 'bag', 'basket', 'gift', 'coin', 'cash-coin', 'gem', 'trophy',
    'award', 'shield-shaded', 'shield', 'crosshair', 'bullseye', 'hammer', 'tools', 'flag', 'lightning-charge',
    'people', 'person', 'person-badge', 'incognito', 'mask', 'emoji-angry', 'emoji-smile', 'heart',
    'heartbreak', 'eye', 'feather', 'bug', 'virus', 'capsule', 'radioactive', 'hourglass-split', 'bell',
    'chat-quote', 'envelope-paper',
];
const ICON_SET = new Set(ICON_CHOICES);
const MAX_NAME_LENGTH = 120;
const MAX_REPORTED_ISSUES = 8;

// ---------- API ----------
export function api(path, params) {
    const qs = params ? '?' + new URLSearchParams(params) : '';
    return fetch('/api/' + path.map(encodeURIComponent).join('/') + qs).then((res) => {
        if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
        return res.json();
    });
}

// ---------- IndexedDB key/value store ----------
const DB_NAME = 'dnd-prompt-helper';
const STORE = 'kv';
let dbPromise = null;

function openDb() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) {
                reject(new Error('This browser does not support IndexedDB'));
                return;
            }
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
}

async function idb(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = tx.onabort = () => reject(tx.error || req.error);
    });
}

export const storage = {
    get: (key) => idb('readonly', (s) => s.get(key)),
    set: (key, value) => idb('readwrite', (s) => s.put(value, key)),
    del: (key) => idb('readwrite', (s) => s.delete(key)),
};

// ---------- Custom data ----------
// Stored shape: { mode: 'merge' | 'replace', name, uploadedAt, data, tables, prompts,
//                 icons: { categoryName: iconName } }
const CUSTOM_KEY = 'custom';

export const customData = {
    async load() {
        try { return (await storage.get(CUSTOM_KEY)) || null; }
        catch { return null; }
    },
    async save(record) {
        await storage.set(CUSTOM_KEY, record);
        // Ask the browser not to evict it under storage pressure (best-effort)
        try { await navigator.storage?.persist?.(); } catch { /* ignore */ }
    },
    clear: () => storage.del(CUSTOM_KEY),
};

// ---------- User-made Quick builds ----------
// Stored under one key as an ordered array:
//   [{ id, title, icon, parts: [{ label, category, sub }], createdAt, updatedAt }]
// Parts use the same shape as the built-in builds from /api/combos.
const BUILDS_KEY = 'builds';
export const DEFAULT_BUILD_ICON = 'lightning-charge';
export const MAX_BUILD_LINES = 12;
export const MIN_BUILD_LINES = 2;
export const MAX_TITLE_LENGTH = 60;

const isText = (v) => typeof v === 'string' && v.trim() !== '';

export function cleanBuild(b) {
    if (!isPlainObject(b) || !isText(b.id) || !isText(b.title) || !Array.isArray(b.parts)) return null;
    const parts = b.parts
        .filter((p) => isPlainObject(p) && isText(p.label) && isText(p.category) && isText(p.sub))
        .slice(0, MAX_BUILD_LINES)
        .map((p) => ({ label: p.label.trim(), category: p.category, sub: p.sub }));
    if (!parts.length) return null;
    return {
        id: b.id,
        title: b.title.trim().slice(0, MAX_TITLE_LENGTH),
        icon: ICON_SET.has(b.icon) ? b.icon : DEFAULT_BUILD_ICON,
        parts,
        createdAt: b.createdAt || null,
        updatedAt: b.updatedAt || null,
    };
}

export const userBuilds = {
    async load() {
        try {
            const raw = await storage.get(BUILDS_KEY);
            return Array.isArray(raw) ? raw.map(cleanBuild).filter(Boolean) : [];
        } catch {
            return [];
        }
    },
    async save(builds) {
        await storage.set(BUILDS_KEY, builds);
        try { await navigator.storage?.persist?.(); } catch { /* ignore */ }
    },
};

// ---------- Saved dice rolls ----------
// Stored under one key as an ordered array: [{ id, name, notation, mode, createdAt, updatedAt }]
// mode is 'normal' | 'adv' | 'dis'.
const SAVED_ROLLS_KEY = 'savedRolls';
export const MAX_ROLL_NAME = 40;
export const MAX_SAVED_ROLLS = 50;
const ROLL_MODES = new Set(['normal', 'adv', 'dis']);

export function cleanRoll(r) {
    if (!isPlainObject(r) || !isText(r.id) || !isText(r.name) || !isText(r.notation)) return null;
    try { parseDice(r.notation); } catch { return null; }
    return {
        id: r.id,
        name: r.name.trim().slice(0, MAX_ROLL_NAME),
        notation: r.notation.trim(),
        mode: ROLL_MODES.has(r.mode) ? r.mode : 'normal',
        createdAt: r.createdAt || null,
        updatedAt: r.updatedAt || null,
    };
}

export const savedRolls = {
    async load() {
        try {
            const raw = await storage.get(SAVED_ROLLS_KEY);
            return Array.isArray(raw) ? raw.map(cleanRoll).filter(Boolean).slice(0, MAX_SAVED_ROLLS) : [];
        } catch {
            return [];
        }
    },
    async save(list) {
        await storage.set(SAVED_ROLLS_KEY, list);
        try { await navigator.storage?.persist?.(); } catch { /* ignore */ }
    },
};

export const newRollId = () => 'r-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const newBuildId = () => 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export class ValidationError extends Error {
    constructor(issues) {
        super(issues[0]);
        this.issues = issues;
    }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Parse and validate an uploaded file: { category: { table: [entries] } }.
// Returns { data, tables, prompts, warnings } or throws ValidationError.
export function parseCustomJson(text) {
    let raw;
    try {
        raw = JSON.parse(text);
    } catch (err) {
        throw new ValidationError(['This file isn’t valid JSON (' + err.message + ').']);
    }
    if (!isPlainObject(raw)) {
        throw new ValidationError(['The file must be an object of categories, like { "Town": { "Tavern Names": ["…"] } }.']);
    }

    const issues = [];
    const warnings = [];
    const data = {};
    let tables = 0;
    let prompts = 0;
    const issue = (msg) => { if (issues.length < MAX_REPORTED_ISSUES) issues.push(msg); else issues.overflow = true; };

    for (const [rawCat, subs] of Object.entries(raw)) {
        const cat = rawCat.trim();
        if (!cat) { issue('A category has an empty name.'); continue; }
        if (cat.length > MAX_NAME_LENGTH) { issue('Category “' + cat.slice(0, 40) + '…” has a name longer than ' + MAX_NAME_LENGTH + ' characters.'); continue; }
        if (!isPlainObject(subs)) { issue('“' + cat + '” must be an object of tables, like { "Table name": ["entry", …] }.'); continue; }

        const outSubs = {};
        for (const [rawSub, entries] of Object.entries(subs)) {
            const sub = rawSub.trim();
            const where = cat + ' › ' + (sub || '(unnamed)');
            if (!sub) { issue('A table in “' + cat + '” has an empty name.'); continue; }
            if (sub.length > MAX_NAME_LENGTH) { issue(where.slice(0, 60) + '… has a name longer than ' + MAX_NAME_LENGTH + ' characters.'); continue; }
            if (!Array.isArray(entries)) { issue(where + ' must be a list of entries, like ["entry one", "entry two"].'); continue; }

            const out = [];
            entries.forEach((entry, i) => {
                if (typeof entry === 'number') entry = String(entry);
                if (typeof entry !== 'string') { issue(where + ': entry ' + (i + 1) + ' isn’t text.'); return; }
                const trimmed = entry.trim();
                if (trimmed) out.push(trimmed);
            });
            if (!out.length) { warnings.push(where + ' has no entries and was skipped.'); continue; }
            if (out.length < entries.length) warnings.push(where + ': ' + (entries.length - out.length) + ' empty entr' + (entries.length - out.length === 1 ? 'y was' : 'ies were') + ' skipped.');
            outSubs[sub] = out;
            tables += 1;
            prompts += out.length;
        }
        if (Object.keys(outSubs).length) data[cat] = outSubs;
        else if (isPlainObject(subs)) warnings.push('“' + cat + '” has no usable tables and was skipped.');
    }

    if (issues.length) {
        if (issues.overflow) issues.push('…and more. Fix these first and try again.');
        throw new ValidationError(issues);
    }
    if (!tables) throw new ValidationError(['The file doesn’t contain any tables with entries.']);
    return { data, tables, prompts, warnings };
}

// Defaults plus custom: new categories/tables are added, and entries for an
// existing table are appended (exact duplicates skipped). Tables listed in
// `overrides` ("category|table") are personal copies and replace the built-in table.
export function mergeData(base, custom, overrides = []) {
    const replaced = new Set(overrides);
    const out = {};
    for (const [cat, subs] of Object.entries(base)) {
        out[cat] = {};
        for (const [sub, entries] of Object.entries(subs)) out[cat][sub] = entries.slice();
    }
    for (const [cat, subs] of Object.entries(custom)) {
        out[cat] = out[cat] || {};
        for (const [sub, entries] of Object.entries(subs)) {
            const existing = out[cat][sub];
            if (!existing || replaced.has(cat + '|' + sub)) { out[cat][sub] = entries.slice(); continue; }
            const seen = new Set(existing);
            for (const e of entries) if (!seen.has(e)) { existing.push(e); seen.add(e); }
        }
    }
    return out;
}

export function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Sources ----------
// Both sources expose the same async interface:
//   structure() -> [{ name, icon, blurb, total, subcategories: [{ name, count }] }]
//   roll(category, sub) -> text
//   entry(category, sub, index) -> text   (used for no-repeat and multi rolls, picked in the browser)
//   entries(category, sub) -> [text]
//   search(q, limit) -> { total, results: [{ category, sub, index, text }] }

export class ServerSource {
    constructor(structure) {
        this.kind = 'server';
        this._structure = structure;
    }
    async structure() { return this._structure; }
    roll(category, sub) { return api(['r', category], { arg: sub }); }
    entry(category, sub, index) { return api([category], { arg: sub, id: index }); }
    entries(category, sub) { return api([category], { arg: sub }); }
    search(q, limit) { return api(['search'], { q, limit }); }
}

export class LocalSource {
    // meta: { categoryName: { icon, blurb } } from the server, for categories that share a name
    constructor(data, meta = {}) {
        this.kind = 'local';
        this.data = data;
        this._structure = Object.entries(data).map(([name, subs]) => {
            const subcategories = Object.entries(subs).map(([sub, entries]) => ({ name: sub, count: entries.length }));
            return {
                name,
                icon: meta[name]?.icon || DEFAULT_CUSTOM_ICON,
                blurb: meta[name]?.blurb || '',
                total: subcategories.reduce((n, s) => n + s.count, 0),
                subcategories,
            };
        });
    }
    _table(category, sub) {
        const table = this.data[category]?.[sub];
        if (!table) throw new Error('table not found');
        return table;
    }
    async structure() { return this._structure; }
    async roll(category, sub) {
        const table = this._table(category, sub);
        return table[Math.floor(Math.random() * table.length)];
    }
    async entry(category, sub, index) {
        const text = this._table(category, sub)[index];
        if (text === undefined) throw new Error('entry not found');
        return text;
    }
    async entries(category, sub) { return this._table(category, sub); }
    async search(q, limit = 50) {
        const needle = q.trim().toLowerCase();
        const results = [];
        let total = 0;
        if (!needle) return { total, results };
        for (const [category, subs] of Object.entries(this.data)) {
            for (const [sub, entries] of Object.entries(subs)) {
                entries.forEach((text, index) => {
                    if (!text.toLowerCase().includes(needle)) return;
                    total += 1;
                    if (results.length < limit) results.push({ category, sub, index, text });
                });
            }
        }
        return { total, results };
    }
}

// Icon chosen for a category: the user's pick, else the built-in icon, else the default
export function iconFor(category, custom, serverStructure) {
    const picked = custom?.icons?.[category];
    if (picked && ICON_SET.has(picked)) return picked;
    return serverStructure.find((c) => c.name === category)?.icon || DEFAULT_CUSTOM_ICON;
}

let baseData = null; // the built-in tables, cached once loaded (merge mode)

// The built-in tables, from the saved offline copy, so merge mode doesn't need the server
export function setBaseData(data) { baseData = data; }

// Pick the source: the saved offline copy, the stored custom data, or the server.
export async function createSource(custom, serverStructure, offline = null) {
    if (!custom) {
        if (!offline) return new ServerSource(serverStructure);
        return new LocalSource(offline.data, Object.fromEntries(serverStructure.map((c) => [c.name, { ...c }])));
    }
    const meta = Object.fromEntries(serverStructure.map((c) => [c.name, { ...c }]));
    for (const cat of Object.keys(custom.data)) {
        meta[cat] = { ...meta[cat], icon: iconFor(cat, custom, serverStructure) };
    }
    if (custom.mode === 'replace') return new LocalSource(custom.data, meta);
    baseData = baseData || await api(['getall']); // fetched once per page, reused after edits
    return new LocalSource(mergeData(baseData, custom.data, custom.overrides || []), meta);
}

// ---------- Share links ----------
// Shared data travels in the URL fragment (#share=...), which browsers never send to the server.
// Payload: { v: 1, type: 'build' | 'roll' | 'result', ... } as base64url-encoded UTF-8 JSON.
export const MAX_SHARE_LENGTH = 6000;

export function encodeShare(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, ...payload }));
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeShare(token) {
    if (typeof token !== 'string' || !token || token.length > MAX_SHARE_LENGTH * 2) return null;
    try {
        let b64 = token.replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        const bin = atob(b64);
        const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
        const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        return isPlainObject(data) && data.v === 1 ? data : null;
    } catch {
        return null;
    }
}

// ---------- Offline copy of the built-in tables (opt-in) ----------
// Saved only after the user agrees. Stored shape:
//   { version, savedAt, structure, combos, data, prompts }
const OFFLINE_KEY = 'offline';

export const offlineData = {
    async load() {
        try {
            const r = await storage.get(OFFLINE_KEY);
            return r && isPlainObject(r.data) && Array.isArray(r.structure) ? r : null;
        } catch {
            return null;
        }
    },
    async save(bundle) {
        let prompts = 0;
        for (const subs of Object.values(bundle.data)) for (const entries of Object.values(subs)) prompts += entries.length;
        const record = {
            version: bundle.version,
            savedAt: new Date().toISOString(),
            structure: bundle.structure,
            combos: bundle.combos || [],
            data: bundle.data,
            prompts,
        };
        await storage.set(OFFLINE_KEY, record);
        try { await navigator.storage?.persist?.(); } catch { /* ignore */ }
        return record;
    },
    clear: () => storage.del(OFFLINE_KEY),
};

// fetch JSON with a time limit (used to check for updates without hanging on a sleeping server)
export async function fetchJson(path, ms = 8000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        const res = await fetch(path, { signal: ctrl.signal, cache: 'no-store' });
        if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}
