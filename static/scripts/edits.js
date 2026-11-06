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

// existingNames: every table name currently in the category (built-in and custom)
export function createTable(record, category, name, firstEntry, existingNames = []) {
    const sub = String(name ?? '').trim();
    if (!sub) throw new Error('Give the table a name.');
    if (sub.length > MAX_TABLE_NAME) throw new Error('Table names can be up to ' + MAX_TABLE_NAME + ' characters.');
    if (existingNames.some((n) => n.toLowerCase() === sub.toLowerCase())) throw new Error('There’s already a table called “' + sub + '” here.');
    const r = clone(record || emptyRecord());
    r.data[category] = r.data[category] || {};
    r.data[category][sub] = [cleanText(firstEntry)];
    return { record: recount(r), sub };
}

// True when nothing is left worth keeping (no tables, no icon choices): the record can be removed
export const isEmptyRecord = (record) => record.mode === 'merge' && record.tables === 0 && !Object.keys(record.icons || {}).length;
