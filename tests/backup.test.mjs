// Backup file tests. Run with: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBackup, parseBackup, backupFilename, hasContent, BACKUP_KIND, BACKUP_VERSION } from '../static/scripts/backup.js';
import { emptyRecord } from '../static/scripts/edits.js';
import { ValidationError } from '../static/scripts/data.js';

const NOW = new Date('2026-11-06T10:00:00Z');
const record = {
    ...emptyRecord('2026-11-01T00:00:00Z'),
    data: { Town: { Rumors: ['A new rumor', 'Another'] }, Mine: { Ideas: ['One'] } },
    overrides: ['Town|Rumors', 'Nope|Missing'],
    icons: { Mine: 'gem', Bad: 'not-an-icon' },
};
const build = { id: 'u-1', title: 'Shop', icon: 'shop', parts: [{ label: 'Name', category: 'Town', sub: 'Rumors' }] };
const roll = { id: 'r-1', name: 'Fireball', notation: '8d6', mode: 'normal' };
const combatant = { id: 'c-1', name: 'Goblin', kind: 'npc', mod: 2, init: 14, maxHp: 7, hp: 3, ac: 15, conditions: ['Prone'] };
const state = {
    custom: record, builds: [build], rolls: [roll],
    initiative: { combatants: [combatant], round: 2, activeId: 'c-1' },
    history: [{ category: 'Town', sub: 'Rumors', text: 'A new rumor' }],
    settings: { theme: { preset: 'forest' }, pins: [], hidden: ['Town|Rumors'], dice: { count: 2 }, rollCount: 3, noRepeat: true },
};

const roundTrip = (s) => parseBackup(JSON.stringify(makeBackup(s, NOW)));

test('a backup holds everything and restores it', () => {
    const backup = makeBackup(state, NOW);
    assert.equal(backup.kind, BACKUP_KIND);
    assert.equal(backup.version, BACKUP_VERSION);
    assert.equal(backup.exportedAt, NOW.toISOString());
    const { parts, exportedAt } = roundTrip(state);
    assert.equal(exportedAt, NOW.toISOString());
    assert.deepEqual(Object.keys(parts), ['tables', 'builds', 'rolls', 'initiative', 'settings', 'history']);
    assert.deepEqual(parts.tables.value.data, record.data);
    assert.equal(parts.tables.value.tables, 2);
    assert.equal(parts.tables.value.prompts, 3);
    assert.equal(parts.tables.detail, '2 tables, 3 prompts (1 personal copy)');
    assert.equal(parts.builds.value[0].title, 'Shop');
    assert.equal(parts.rolls.value[0].notation, '8d6');
    assert.equal(parts.initiative.value.combatants[0].hp, 3);
    assert.equal(parts.initiative.detail, '1 combatant · round 2');
    assert.equal(parts.settings.value.rollCount, 3);
    assert.equal(parts.history.value.length, 1);
});

test('broken references and unknown icons are dropped from tables', () => {
    const t = roundTrip(state).parts.tables.value;
    assert.deepEqual(t.overrides, ['Town|Rumors']);
    assert.deepEqual(t.icons, { Mine: 'gem' });
});

test('empty parts are left out of the file', () => {
    const backup = makeBackup({ custom: null, builds: [], rolls: [], initiative: { combatants: [] }, history: [], settings: { theme: null } }, NOW);
    assert.equal(hasContent(backup), false);
    assert.throws(() => parseBackup(JSON.stringify(backup)), /nothing in it/);
});

test('only valid builds and rolls are restored', () => {
    const file = { kind: BACKUP_KIND, version: 1, builds: [build, { id: 'x' }], rolls: [roll, { id: 'r-2', name: 'Bad', notation: 'banana' }] };
    const { parts } = parseBackup(JSON.stringify(file));
    assert.equal(parts.builds.value.length, 1);
    assert.equal(parts.rolls.value.length, 1);
});

test('files that are not backups are refused with a clear message', () => {
    assert.throws(() => parseBackup('not json'), ValidationError);
    assert.throws(() => parseBackup(JSON.stringify({ Town: { Rumors: ['x'] } })), /Your own JSON/);
    assert.throws(() => parseBackup(JSON.stringify({ kind: BACKUP_KIND, version: 99 })), /newer version/);
    assert.throws(() => parseBackup(JSON.stringify({ kind: BACKUP_KIND, version: 1, tables: { data: { T: { S: [42, {}] } } } })), ValidationError);
});

test('filename includes the date', () => {
    assert.equal(backupFilename(NOW), 'dnd-prompt-helper-backup-2026-11-06.json');
});
