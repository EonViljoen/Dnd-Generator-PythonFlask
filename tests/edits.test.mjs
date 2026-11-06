// Table editing tests. Run with: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    emptyRecord, tableStatus, ensureEditable, addEntry, updateEntry, deleteEntry, restoreEntry,
    resetTable, deleteTable, createTable, isEmptyRecord, recount,
} from '../static/scripts/edits.js';
import { mergeData } from '../static/scripts/data.js';

const base = { Town: { Rumors: ['A', 'B', 'C'], Laws: ['L1'] } };

test('editing a built-in table makes a personal copy that replaces it', () => {
    assert.equal(tableStatus(null, 'Town', 'Rumors', true), 'builtin');
    const { record, copied } = ensureEditable(null, 'Town', 'Rumors', base.Town.Rumors, true);
    assert.equal(copied, true);
    assert.deepEqual(record.overrides, ['Town|Rumors']);
    assert.equal(tableStatus(record, 'Town', 'Rumors', true), 'copy');
    const edited = deleteEntry(addEntry(record, 'Town', 'Rumors', '  D  '), 'Town', 'Rumors', 0).record;
    assert.deepEqual(edited.data.Town.Rumors, ['B', 'C', 'D']);
    // merged: the copy replaces the built-in table (no "A" coming back), other tables untouched
    const merged = mergeData(base, edited.data, edited.overrides);
    assert.deepEqual(merged.Town.Rumors, ['B', 'C', 'D']);
    assert.deepEqual(merged.Town.Laws, ['L1']);
    assert.deepEqual(base.Town.Rumors, ['A', 'B', 'C']); // base not mutated
});

test('without an override, custom entries are still appended (uploads keep working)', () => {
    assert.deepEqual(mergeData(base, { Town: { Rumors: ['B', 'Z'] } }).Town.Rumors, ['A', 'B', 'C', 'Z']);
});

test('a merged upload table becomes a copy of exactly what is shown', () => {
    const uploaded = recount({ ...emptyRecord(), data: { Town: { Rumors: ['Z'] } } });
    const shown = mergeData(base, uploaded.data).Town.Rumors;
    const { record, copied } = ensureEditable(uploaded, 'Town', 'Rumors', shown, true);
    assert.equal(copied, true);
    assert.deepEqual(mergeData(base, record.data, record.overrides).Town.Rumors, ['A', 'B', 'C', 'Z']);
});

test('reset drops the copy; the built-in table shows again', () => {
    const { record } = ensureEditable(null, 'Town', 'Rumors', base.Town.Rumors, true);
    const reset = resetTable(updateEntry(record, 'Town', 'Rumors', 1, 'b!'), 'Town', 'Rumors');
    assert.deepEqual(reset.overrides, []);
    assert.deepEqual(reset.data, {});
    assert.equal(isEmptyRecord(reset), true);
    assert.deepEqual(mergeData(base, reset.data, reset.overrides).Town.Rumors, ['A', 'B', 'C']);
});

test('own tables: create, edit, keep at least one entry, delete', () => {
    const { record, sub } = createTable(null, 'Town', ' Omens ', 'Red moon', ['Rumors', 'Laws']);
    assert.equal(sub, 'Omens');
    assert.equal(tableStatus(record, 'Town', 'Omens', false), 'own');
    assert.deepEqual([record.tables, record.prompts], [1, 1]);
    assert.throws(() => deleteEntry(record, 'Town', 'Omens', 0), /at least one entry/);
    assert.throws(() => createTable(record, 'Town', 'rumors', 'x', ['Rumors']), /already a table/);
    assert.throws(() => createTable(record, 'Town', '  ', 'x'), /name/);
    assert.throws(() => addEntry(record, 'Town', 'Omens', '   '), /empty/);
    const gone = deleteTable(record, 'Town', 'Omens');
    assert.deepEqual(gone.data, {});
});

test('undo puts a deleted entry back where it was', () => {
    const { record } = ensureEditable(null, 'Town', 'Rumors', base.Town.Rumors, true);
    const { record: after, removed } = deleteEntry(record, 'Town', 'Rumors', 1);
    assert.equal(removed, 'B');
    assert.deepEqual(restoreEntry(after, 'Town', 'Rumors', 1, removed).data.Town.Rumors, ['A', 'B', 'C']);
});

test('replace mode: every table is the user\'s own', () => {
    const r = { ...emptyRecord(), mode: 'replace', data: { Town: { Rumors: ['X'] } } };
    assert.equal(tableStatus(r, 'Town', 'Rumors', true), 'own');
    const { record, copied } = ensureEditable(r, 'Town', 'Rumors', ['X'], true);
    assert.equal(copied, false);
    assert.deepEqual(record.overrides, []);
});

import { createTableFrom, moveTable, renameCategory, cleanName } from '../static/scripts/edits.js';

test('names: trimmed, required, no "|"', () => {
    assert.equal(cleanName('  Omens ', 'table'), 'Omens');
    assert.throws(() => cleanName('a|b', 'table'), /can’t contain/);
    assert.throws(() => cleanName('   ', 'category'), /Give the category a name/);
    assert.throws(() => createTable(null, 'Town', 'x|y', 'e'), /can’t contain/);
});

test('duplicate a built-in table as an own table', () => {
    const { record, category, sub } = createTableFrom(null, 'Town', 'Waterdeep Rumors', base.Town.Rumors, ['Rumors', 'Laws']);
    assert.deepEqual([category, sub, record.data.Town['Waterdeep Rumors']], ['Town', 'Waterdeep Rumors', ['A', 'B', 'C']]);
    assert.deepEqual(record.overrides, []); // an own table, not a personal copy
    assert.deepEqual(mergeData(base, record.data, record.overrides).Town.Rumors, ['A', 'B', 'C']);
});

test('rename and move own tables (case-only rename allowed, clashes refused)', () => {
    let { record } = createTable(null, 'Homebrew', 'omens', 'Red moon');
    let moved = moveTable(record, 'Homebrew', 'omens', 'Homebrew', 'Omens', ['omens']);
    assert.deepEqual(Object.keys(moved.record.data.Homebrew), ['Omens']);
    moved = moveTable(moved.record, 'Homebrew', 'Omens', 'Sky Signs', 'Moon Omens', []);
    assert.deepEqual(moved.record.data, { 'Sky Signs': { 'Moon Omens': ['Red moon'] } }); // empty category removed
    assert.equal(moved.changed, true);
    assert.throws(() => moveTable(moved.record, 'Sky Signs', 'Moon Omens', 'Town', 'rumors', ['Rumors']), /already a table/);
    assert.equal(moveTable(moved.record, 'Sky Signs', 'Moon Omens', 'Sky Signs', 'Moon Omens').changed, false);
});

test('rename an own category: tables and icon move with it', () => {
    let { record } = createTable(null, 'Homebrew', 'Omens', 'Red moon');
    record = { ...record, icons: { Homebrew: 'moon-stars' } };
    const { record: r2, category } = renameCategory(record, 'Homebrew', 'Sky Signs', ['Town', 'Homebrew']);
    assert.equal(category, 'Sky Signs');
    assert.deepEqual(r2.data, { 'Sky Signs': { Omens: ['Red moon'] } });
    assert.deepEqual(r2.icons, { 'Sky Signs': 'moon-stars' });
    assert.throws(() => renameCategory(record, 'Homebrew', 'town', ['Town', 'Homebrew']), /already a category/);
    assert.equal(renameCategory(record, 'Homebrew', 'homebrew', ['Town', 'Homebrew']).changed, true); // case-only
});
