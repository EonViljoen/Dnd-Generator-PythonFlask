// Editing tables in the browser: pure functions on the stored custom record (no DOM),
// so they can be tested in Node.
//
// Custom record (see data.js): { mode: 'merge' | 'replace', name, data, overrides, icons, tables, prompts, ... }
//   data:      { category: { table: [entries] } } (the user's own tables and personal copies)
//   overrides: ["category|table", ...] built-in tables the user has a personal copy of (merge mode).
//              In merge mode a personal copy replaces the built-in table instead of adding to it.

export const MAX_ENTRY_LENGTH = 5000;
export const MAX_TABLE_NAME = 120;
export const DEFAULT_RECORD_NAME = 'My tables';

export const tableKey = (category, sub) => category + '|' + sub;

export function emptyRecord(now = new Date().toISOString()) {
    return { mode: 'merge', name: DEFAULT_RECORD_NAME, uploadedAt: now, data: {}, overrides: [], icons: {}, tables: 0, prompts: 0 };
}

const clone = (record) => ({
    ...record,
    data: JSON.parse(JSON.stringify(record.data || {})),
    overrides: [...(record.overrides || [])],
    icons: { ...(record.icons || {}) },
});

export function recount(record) {
    let tables = 0;
    let prompts = 0;
    for (const subs of Object.values(record.data)) {
        for (const entries of Object.values(subs)) { tables += 1; prompts += entries.length; }
    }
    return { ...record, tables, prompts };
}

// 'builtin' (not yet edited), 'copy' (personal copy of a built-in table) or 'own' (the user's table)
export function tableStatus(record, category, sub, isBuiltIn) {
    if (record?.mode === 'replace') return 'own';
    if (record?.overrides?.includes(tableKey(category, sub))) return 'copy';
    return isBuiltIn ? 'builtin' : 'own';
}

// Make the record hold an editable copy of the table exactly as it's shown now.
// For a built-in table this creates the personal copy. Returns { record, copied }.
export function ensureEditable(record, category, sub, shownEntries, isBuiltIn) {
    const r = clone(record || emptyRecord());
    const status = tableStatus(r, category, sub, isBuiltIn);
    r.data[category] = r.data[category] || {};
    if (status === 'builtin') {
        r.data[category][sub] = shownEntries.slice();
        r.overrides.push(tableKey(category, sub));
        return { record: r, copied: true };
    }
    if (!r.data[category][sub]) r.data[category][sub] = shownEntries.slice();
    return { record: r, copied: false };
}

export function cleanText(text) {
    const t = String(text ?? '').trim();
    if (!t) throw new Error('An entry can’t be empty.');
    if (t.length > MAX_ENTRY_LENGTH) throw new Error('Entries can be up to ' + MAX_ENTRY_LENGTH.toLocaleString() + ' characters.');
    return t;
}

function tableOf(record, category, sub) {
    const table = record.data[category]?.[sub];
    if (!table) throw new Error('That table isn’t editable yet.');
    return table;
}

export function addEntry(record, category, sub, text) {
    const r = clone(record);
    tableOf(r, category, sub).push(cleanText(text));
    return recount(r);
}

export function updateEntry(record, category, sub, index, text) {
    const r = clone(record);
    const table = tableOf(r, category, sub);
    if (!(index >= 0 && index < table.length)) throw new Error('That entry no longer exists.');
    table[index] = cleanText(text);
    return recount(r);
}

// -> { record, removed }
export function deleteEntry(record, category, sub, index) {
    const r = clone(record);
    const table = tableOf(r, category, sub);
    if (!(index >= 0 && index < table.length)) throw new Error('That entry no longer exists.');
    if (table.length === 1) throw new Error('A table needs at least one entry.');
    const [removed] = table.splice(index, 1);
    return { record: recount(r), removed };
}

export function restoreEntry(record, category, sub, index, text) {
    const r = clone(record);
    const table = tableOf(r, category, sub);
    table.splice(Math.min(Math.max(index, 0), table.length), 0, cleanText(text));
    return recount(r);
}

function removeTable(r, category, sub) {
    if (r.data[category]) {
        delete r.data[category][sub];
        if (!Object.keys(r.data[category]).length) delete r.data[category];
    }
    r.overrides = r.overrides.filter((k) => k !== tableKey(category, sub));
    return recount(r);
}

// Drop the personal copy so the built-in table shows again
export const resetTable = (record, category, sub) => removeTable(clone(record), category, sub);
export const deleteTable = (record, category, sub) => removeTable(clone(record), category, sub);

// Names are joined as "category|table" internally, so "|" isn't allowed in them
export function cleanName(name, what) {
    const n = String(name ?? '').trim();
    if (!n) throw new Error('Give the ' + what + ' a name.');
    if (n.length > MAX_TABLE_NAME) throw new Error(what[0].toUpperCase() + what.slice(1) + ' names can be up to ' + MAX_TABLE_NAME + ' characters.');
    if (n.includes('|')) throw new Error('Names can’t contain “|”.');
    return n;
}

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

// existingNames: every table name currently in the category (built-in and custom)
export function createTable(record, category, name, firstEntry, existingNames = []) {
    return createTableFrom(record, category, name, [firstEntry], existingNames);
}

// New own table from a list of entries (also used to duplicate a built-in table)
export function createTableFrom(record, category, name, entries, existingNames = []) {
    const cat = cleanName(category, 'category');
    const sub = cleanName(name, 'table');
    const taken = existingNames.find((n) => sameName(n, sub));
    if (taken) throw new Error('There’s already a table called “' + taken + '” in ' + cat + '.');
    const cleaned = entries.map(cleanText);
    if (!cleaned.length) throw new Error('A table needs at least one entry.');
    const r = clone(record || emptyRecord());
    r.data[cat] = r.data[cat] || {};
    r.data[cat][sub] = cleaned;
    return { record: recount(r), category: cat, sub };
}

// Rename and/or move an own table. targetNames: table names already in the target category.
export function moveTable(record, fromCat, fromSub, toCat, toSub, targetNames = []) {
    const r = clone(record);
    const entries = tableOf(r, fromCat, fromSub);
    const cat = cleanName(toCat, 'category');
    const sub = cleanName(toSub, 'table');
    if (cat === fromCat && sub === fromSub) return { record: recount(r), category: cat, sub, changed: false };
    const clash = targetNames.find((n) => sameName(n, sub) && !(cat === fromCat && n === fromSub));
    if (clash) throw new Error('There’s already a table called “' + clash + '” in ' + cat + '.');
    delete r.data[fromCat][fromSub];
    if (!Object.keys(r.data[fromCat]).length) delete r.data[fromCat];
    r.data[cat] = r.data[cat] || {};
    r.data[cat][sub] = entries;
    return { record: recount(r), category: cat, sub, changed: true };
}

// Rename an own category (all of its tables move with it, and its icon). otherCategories: every other category name.
export function renameCategory(record, fromCat, toCat, otherCategories = []) {
    const r = clone(record);
    if (!r.data[fromCat]) throw new Error('That category isn’t editable.');
    const cat = cleanName(toCat, 'category');
    if (cat === fromCat) return { record: recount(r), category: cat, changed: false };
    const clash = otherCategories.find((n) => n !== fromCat && sameName(n, cat));
    if (clash) throw new Error('There’s already a category called “' + clash + '”.');
    r.data[cat] = { ...(r.data[cat] || {}), ...r.data[fromCat] };
    delete r.data[fromCat];
    if (r.icons[fromCat]) { r.icons[cat] = r.icons[fromCat]; delete r.icons[fromCat]; }
    r.overrides = r.overrides.map((k) => (k.startsWith(fromCat + '|') ? cat + k.slice(fromCat.length) : k));
    return { record: recount(r), category: cat, changed: true };
}

// True when nothing is left worth keeping (no tables, no icon choices): the record can be removed
export const isEmptyRecord = (record) => record.mode === 'merge' && record.tables === 0 && !Object.keys(record.icons || {}).length;
