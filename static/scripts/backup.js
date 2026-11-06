// Backup file: everything this browser keeps, in one JSON file the user downloads and
// restores themselves on another device. No accounts and nothing sent to the server.
// Pure functions (no DOM or storage), so they can be tested in Node.
//
// File shape: { kind, version, exportedAt, tables?, builds?, rolls?, characters?, parties?, initiative?, settings?, history? }
//   tables:     the custom record (own JSON, personal copies, edits, renames, category icons)
//   builds:     user Quick builds         rolls:   saved dice rolls
//   characters: the players' characters   parties: named groups of them (restored together)
//   initiative: the tracker               history: recent results
//   settings:   { theme, pins, hidden, dice, rollCount, noRepeat } (localStorage values)
// The saved offline copy of the built-in tables is left out: it downloads again in one click.

import { ValidationError, parseCustomJson, cleanBuild, cleanRoll, ICON_CHOICES, MAX_SAVED_ROLLS } from './data.js';
import { recount, isEmptyRecord, DEFAULT_RECORD_NAME } from './edits.js';
import { normalizeState } from './initiative.js';
import { normalizeParty, normalizeParties } from './party.js';

export const BACKUP_KIND = 'dnd-prompt-helper-backup';
export const BACKUP_VERSION = 1;
const MAX_LIST = 200;

// localStorage keys (must match app.js and theme.js)
export const SETTINGS_KEYS = {
    theme: 'dnd.theme', pins: 'dnd.pins', hidden: 'dnd.hidden',
    dice: 'dnd.dice', rollCount: 'dnd.rollCount', noRepeat: 'dnd.noRepeat',
};
export const INITIATIVE_KEY = 'dnd.initiative';
export const HISTORY_KEY = 'dnd.history';

// The parts a user can choose to restore, in the order they're shown
export const PARTS = ['tables', 'builds', 'rolls', 'characters', 'initiative', 'settings', 'history'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ICONS = new Set(ICON_CHOICES);
const plural = (n, word, many = word + 's') => n.toLocaleString() + ' ' + (n === 1 ? word : many);

export function backupFilename(now = new Date()) {
    return 'dnd-prompt-helper-backup-' + now.toISOString().slice(0, 10) + '.json';
}

// state: { custom, builds, rolls, initiative, history, settings: { theme, pins, ... } }
// Empty parts are left out, so the file only holds what the user actually has.
export function makeBackup(state, now = new Date()) {
    const out = { kind: BACKUP_KIND, version: BACKUP_VERSION, exportedAt: now.toISOString() };
    if (state.custom && !isEmptyRecord(state.custom)) out.tables = state.custom;
    if (state.builds?.length) out.builds = state.builds;
    if (state.rolls?.length) out.rolls = state.rolls;
    if (state.characters?.length) {
        out.characters = state.characters;
        if (state.parties?.length) out.parties = state.parties;
    }
    if (state.initiative?.combatants?.length) out.initiative = state.initiative;
    if (state.history?.length) out.history = state.history;
    const settings = {};
    for (const [name, value] of Object.entries(state.settings || {})) {
        if (value !== null && value !== undefined) settings[name] = value;
    }
    if (Object.keys(settings).length) out.settings = settings;
    return out;
}

export const hasContent = (backup) => PARTS.some((p) => p in backup);

function cleanTables(raw) {
    if (!isPlainObject(raw) || !isPlainObject(raw.data)) throw new ValidationError(['The tables in this backup are damaged.']);
    const mode = raw.mode === 'replace' ? 'replace' : 'merge';
    // Same checks as uploading your own JSON (names, entries are text, ...)
    const data = Object.keys(raw.data).length ? parseCustomJson(JSON.stringify(raw.data)).data : {};
    const overrides = Array.isArray(raw.overrides)
        ? [...new Set(raw.overrides.filter((k) => typeof k === 'string' && data[k.split('|')[0]]?.[k.split('|').slice(1).join('|')]))]
        : [];
    const icons = {};
    if (isPlainObject(raw.icons)) for (const [cat, icon] of Object.entries(raw.icons)) if (ICONS.has(icon)) icons[cat] = icon;
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 120) : DEFAULT_RECORD_NAME;
    const uploadedAt = typeof raw.uploadedAt === 'string' ? raw.uploadedAt : new Date().toISOString();
    if (mode === 'replace' && !Object.keys(data).length) throw new ValidationError(['The tables in this backup are empty.']);
    return recount({ mode, name, uploadedAt, data, overrides, icons });
}

const textItems = (list) => (Array.isArray(list)
    ? list.filter((i) => isPlainObject(i) && typeof i.text === 'string').slice(0, MAX_LIST)
    : []);

function cleanSettings(raw) {
    if (!isPlainObject(raw)) return {};
    const out = {};
    if (isPlainObject(raw.theme) && typeof raw.theme.preset === 'string') out.theme = raw.theme;
    if (Array.isArray(raw.pins)) out.pins = textItems(raw.pins);
    if (Array.isArray(raw.hidden)) out.hidden = raw.hidden.filter((k) => typeof k === 'string');
    if (isPlainObject(raw.dice)) out.dice = raw.dice;          // clamped by app.js when loaded
    if (Number.isInteger(raw.rollCount)) out.rollCount = raw.rollCount;
    if (typeof raw.noRepeat === 'boolean') out.noRepeat = raw.noRepeat;
    return out;
}

// Read a backup file. Returns { exportedAt, parts: { name: { value, title, detail } } }
// with only the parts that have something in them, or throws ValidationError.
export function parseBackup(text) {
    let raw;
    try { raw = JSON.parse(text); } catch { throw new ValidationError(['This file isn’t valid JSON, so it can’t be a backup.']); }
    if (!isPlainObject(raw) || raw.kind !== BACKUP_KIND) {
        throw new ValidationError(['This isn’t a backup from D&D Prompt Helper. To load your own tables, use “Your own JSON” below.']);
    }
    if (!Number.isInteger(raw.version) || raw.version > BACKUP_VERSION) {
        throw new ValidationError(['This backup was made by a newer version of the app. Reload the page to update, then try again.']);
    }

    const parts = {};
    if ('tables' in raw) {
        const t = cleanTables(raw.tables);
        const copies = t.overrides.length ? ' (' + plural(t.overrides.length, 'personal copy', 'personal copies') + ')' : '';
        parts.tables = {
            value: t,
            title: 'Your tables',
            detail: plural(t.tables, 'table') + ', ' + plural(t.prompts, 'prompt') + copies
                + (t.mode === 'replace' ? ' · replaces the defaults' : ''),
        };
    }
    const builds = Array.isArray(raw.builds) ? raw.builds.map(cleanBuild).filter(Boolean) : [];
    if (builds.length) parts.builds = { value: builds, title: 'Quick builds', detail: plural(builds.length, 'build') };
    const rolls = Array.isArray(raw.rolls) ? raw.rolls.map(cleanRoll).filter(Boolean).slice(0, MAX_SAVED_ROLLS) : [];
    if (rolls.length) parts.rolls = { value: rolls, title: 'Saved dice rolls', detail: plural(rolls.length, 'roll') };
    const characters = normalizeParty(raw.characters);
    if (characters.length) {
        const parties = normalizeParties(raw.parties, characters.map((c) => c.id));
        parts.characters = {
            value: { characters, parties },
            title: 'Characters and parties',
            detail: plural(characters.length, 'character') + (parties.length ? ', ' + plural(parties.length, 'party', 'parties') : '')
                + ': ' + characters.slice(0, 6).map((c) => c.name).join(', ') + (characters.length > 6 ? '…' : ''),
        };
    }
    if ('initiative' in raw) {
        const init = normalizeState(raw.initiative);
        if (init.combatants.length) {
            parts.initiative = {
                value: init,
                title: 'Initiative tracker',
                detail: plural(init.combatants.length, 'combatant') + (init.round ? ' · round ' + init.round : ''),
            };
        }
    }
    const settings = cleanSettings(raw.settings);
    if (Object.keys(settings).length) {
        const bits = [];
        if (settings.theme) bits.push('theme');
        if (settings.pins?.length) bits.push(plural(settings.pins.length, 'pin'));
        if (settings.hidden?.length) bits.push(plural(settings.hidden.length, 'hidden table'));
        if (settings.dice || 'rollCount' in settings || 'noRepeat' in settings) bits.push('dice and rolling options');
        parts.settings = { value: settings, title: 'Theme and settings', detail: bits.join(', ') || 'Default settings' };
    }
    const history = textItems(raw.history);
    if (history.length) parts.history = { value: history, title: 'Recent results', detail: plural(history.length, 'result') };

    if (!Object.keys(parts).length) throw new ValidationError(['This backup is empty: there’s nothing in it to restore.']);
    return { exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : null, parts };
}
