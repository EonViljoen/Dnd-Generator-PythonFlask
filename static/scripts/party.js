// Characters and parties: the players' characters with a basic sheet (D&D 5e), and named
// parties to group them.
// Pure functions (no DOM or storage), so they can be tested in Node.
//
// Character: { id, name, player, race, cls, subclass, background, alignment, level,
//              maxHp, hp, tempHp, ac, speed, scores: { str, dex, con, int, wis, cha },
//              perceptionProf, armor, shield, weapons: [{ name, attack, damage }],
//              inventory: [{ name, qty, notes }], coins: { cp, sp, ep, gp, pp }, notes,
//              conditions: [name], exhaustion, inspiration, deathSaves: { success, fail },
//              hitDie (null = by class), hitDiceUsed, slots: [{ max, used }] (spell levels 1-9), pactMagic,
//              createdAt, updatedAt }
// maxHp, hp and ac are null until filled in. Hit dice total = level (one class).

import { CONDITIONS } from './initiative.js';

export { CONDITIONS };
export const HIT_DICE = [6, 8, 10, 12];
export const MAX_EXHAUSTION = 6;
export const SPELL_LEVELS = 9;
const CLASS_HIT_DIE = { barbarian: 12, fighter: 10, paladin: 10, ranger: 10, sorcerer: 6, wizard: 6 };
// Usual hit die for a class name (d8 for the rest and for anything unknown)
export const hitDieFor = (cls) => CLASS_HIT_DIE[String(cls || '').trim().toLowerCase()] || 8;

export const LIMITS = {
    maxCharacters: 50, maxText: 60, maxNotes: 4000, maxItems: 100, maxWeapons: 20,
    maxLevel: 20, maxSlots: 9, maxHp: 9999, maxAc: 99, maxSpeed: 999, maxScore: 30, maxCoins: 9999999, maxQty: 9999,
};

export const ABILITIES = [
    { key: 'str', label: 'Strength', short: 'STR' },
    { key: 'dex', label: 'Dexterity', short: 'DEX' },
    { key: 'con', label: 'Constitution', short: 'CON' },
    { key: 'int', label: 'Intelligence', short: 'INT' },
    { key: 'wis', label: 'Wisdom', short: 'WIS' },
    { key: 'cha', label: 'Charisma', short: 'CHA' },
];
export const COINS = ['cp', 'sp', 'ep', 'gp', 'pp'];

// Suggestions only: any text is allowed (homebrew, other settings)
export const CLASSES = ['Artificer', 'Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk', 'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard'];
export const RACES = ['Aasimar', 'Dragonborn', 'Dwarf', 'Elf', 'Gnome', 'Goliath', 'Half-Elf', 'Half-Orc', 'Halfling', 'Human', 'Orc', 'Tiefling'];
export const ALIGNMENTS = ['Lawful Good', 'Neutral Good', 'Chaotic Good', 'Lawful Neutral', 'True Neutral', 'Chaotic Neutral', 'Lawful Evil', 'Neutral Evil', 'Chaotic Evil'];

let seq = 0;
export const newId = () => 'p-' + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Whole number in [lo, hi], or the fallback for blanks and junk
export function clampInt(v, lo, hi, fallback) {
    if (v === '' || v === null || v === undefined) return fallback;
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}
const text = (v, max = LIMITS.maxText) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '');

// ---------- Rules ----------
export const modifier = (score) => Math.floor((score - 10) / 2);
export const proficiency = (level) => 2 + Math.floor((Math.max(1, level) - 1) / 4);
export const signed = (n) => (n >= 0 ? '+' : '−') + Math.abs(n);
export const initiativeBonus = (c) => modifier(c.scores.dex);
export const passivePerception = (c) => 10 + modifier(c.scores.wis) + (c.perceptionProf ? proficiency(c.level) : 0);

// "Level 5 Fighter (Champion) · Human"
export function summary(c) {
    const cls = [c.cls, c.subclass ? '(' + c.subclass + ')' : ''].filter(Boolean).join(' ');
    const first = ['Level ' + c.level, cls].filter(Boolean).join(' ');
    return [first, c.race].filter(Boolean).join(' · ');
}

// ---------- Making and cleaning characters ----------
export function createCharacter(fields = {}, now = new Date().toISOString()) {
    return normalizeCharacter({ ...fields, id: fields.id || newId(), createdAt: fields.createdAt || now, updatedAt: now });
}

function cleanList(list, max, fn) {
    return Array.isArray(list) ? list.flatMap((x) => (isPlainObject(x) ? fn(x) : [])).slice(0, max) : [];
}

// Anything (a saved character, a backup, a form) → a valid character, or null without a name
export function normalizeCharacter(raw) {
    if (!isPlainObject(raw)) return null;
    const name = text(raw.name);
    if (!name) return null;
    const scores = {};
    for (const { key } of ABILITIES) scores[key] = clampInt(raw.scores?.[key], 1, LIMITS.maxScore, 10);
    const coins = {};
    for (const k of COINS) coins[k] = clampInt(raw.coins?.[k], 0, LIMITS.maxCoins, 0);
    const maxHp = clampInt(raw.maxHp, 1, LIMITS.maxHp, null);
    const level = clampInt(raw.level, 1, LIMITS.maxLevel, 1);
    return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
        name,
        player: text(raw.player),
        race: text(raw.race),
        cls: text(raw.cls),
        subclass: text(raw.subclass),
        background: text(raw.background),
        alignment: text(raw.alignment),
        level,
        maxHp,
        hp: maxHp === null ? null : clampInt(raw.hp, 0, maxHp, maxHp),
        tempHp: clampInt(raw.tempHp, 0, LIMITS.maxHp, 0),
        ac: clampInt(raw.ac, 0, LIMITS.maxAc, null),
        speed: clampInt(raw.speed, 0, LIMITS.maxSpeed, 30),
        scores,
        perceptionProf: raw.perceptionProf === true,
        armor: text(raw.armor),
        shield: raw.shield === true,
        weapons: cleanList(raw.weapons, LIMITS.maxWeapons, (w) => {
            const n = text(w.name);
            return n ? [{ name: n, attack: text(w.attack, 20), damage: text(w.damage) }] : [];
        }),
        inventory: cleanList(raw.inventory, LIMITS.maxItems, (i) => {
            const n = text(i.name);
            return n ? [{ name: n, qty: clampInt(i.qty, 0, LIMITS.maxQty, 1), notes: text(i.notes, 200) }] : [];
        }),
        coins,
        notes: typeof raw.notes === 'string' ? raw.notes.slice(0, LIMITS.maxNotes) : '',
        ...trackingFields(raw, level, maxHp),
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    };
}

// Step 2 fields: things that change during play
function trackingFields(raw, level, maxHp) {
    const conditions = Array.isArray(raw.conditions) ? CONDITIONS.filter((c) => raw.conditions.includes(c)) : [];
    const slots = Array.from({ length: SPELL_LEVELS }, (_, i) => {
        const s = Array.isArray(raw.slots) ? raw.slots[i] : null;
        const max = clampInt(s?.max, 0, LIMITS.maxSlots, 0);
        return { max, used: clampInt(s?.used, 0, max, 0) };
    });
    const hpZero = maxHp !== null && clampInt(raw.hp, 0, maxHp, maxHp) === 0;
    return {
        conditions,
        exhaustion: clampInt(raw.exhaustion, 0, MAX_EXHAUSTION, 0),
        inspiration: raw.inspiration === true,
        // Death saves only matter at 0 HP
        deathSaves: hpZero
            ? { success: clampInt(raw.deathSaves?.success, 0, 3, 0), fail: clampInt(raw.deathSaves?.fail, 0, 3, 0) }
            : { success: 0, fail: 0 },
        hitDie: HIT_DICE.includes(Number(raw.hitDie)) ? Number(raw.hitDie) : null,   // null: the class's usual die
        hitDiceUsed: clampInt(raw.hitDiceUsed, 0, level, 0),
        slots,
        pactMagic: raw.pactMagic === true,
    };
}

export const hitDieOf = (c) => c.hitDie || hitDieFor(c.cls);
export const hasSlots = (c) => c.slots.some((s) => s.max > 0);
export const hitDiceLeft = (c) => c.level - c.hitDiceUsed;

export function normalizeParty(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    return raw.map(normalizeCharacter).filter((c) => c && !seen.has(c.id) && seen.add(c.id)).slice(0, LIMITS.maxCharacters);
}

// ---------- Changes ----------
const touch = (c, now) => ({ ...c, updatedAt: now || new Date().toISOString() });

export function levelUp(c, now) {
    return c.level >= LIMITS.maxLevel ? c : touch({ ...c, level: c.level + 1 }, now);
}

// Damage (negative) comes off temporary HP first; healing stops at max HP.
// Healing from 0 HP clears death saves and wakes them up (removes Unconscious).
export function changeHp(c, delta, now) {
    if (c.maxHp === null || !delta) return c;
    if (delta > 0) {
        const woke = c.hp === 0 ? c.conditions.filter((x) => x !== 'Unconscious') : c.conditions;
        return touch({ ...c, hp: Math.min(c.maxHp, c.hp + delta), deathSaves: { success: 0, fail: 0 }, conditions: woke }, now);
    }
    let dmg = -delta;
    const fromTemp = Math.min(c.tempHp, dmg);
    dmg -= fromTemp;
    return touch({ ...c, tempHp: c.tempHp - fromTemp, hp: Math.max(0, c.hp - dmg) }, now);
}

export const toggleCondition = (c, name, now) => (CONDITIONS.includes(name)
    ? touch({ ...c, conditions: c.conditions.includes(name) ? c.conditions.filter((x) => x !== name) : CONDITIONS.filter((x) => x === name || c.conditions.includes(x)) }, now)
    : c);
export const setExhaustion = (c, n, now) => touch({ ...c, exhaustion: clampInt(n, 0, MAX_EXHAUSTION, 0) }, now);
export const toggleInspiration = (c, now) => touch({ ...c, inspiration: !c.inspiration }, now);

// Click the nth box (1-3): fills up to it, or clears it if it was the last one filled
export function setDeathSave(c, kind, n, now) {
    const cur = c.deathSaves[kind];
    return touch({ ...c, deathSaves: { ...c.deathSaves, [kind]: cur === n ? n - 1 : clampInt(n, 0, 3, 0) } }, now);
}
// 3 successes: stable at 0 HP. 3 failures: dead.
export const deathState = (c) => (c.deathSaves.fail >= 3 ? 'dead' : c.deathSaves.success >= 3 ? 'stable' : null);

// Same click rule for spell slot boxes at a spell level (1-9)
export function setSlotsUsed(c, level, n, now) {
    const slots = c.slots.map((s, i) => (i === level - 1 ? { ...s, used: s.used === n ? n - 1 : clampInt(n, 0, s.max, 0) } : s));
    return touch({ ...c, slots }, now);
}

const restoreSlots = (slots) => slots.map((s) => ({ ...s, used: 0 }));

// Short rest: spend hit dice (rolls = the dice results), each heals roll + CON modifier (at
// least 0). Pact Magic slots come back.
export function shortRest(c, rolls = [], now) {
    const spend = rolls.slice(0, hitDiceLeft(c));
    const con = modifier(c.scores.con);
    const healed = spend.reduce((n, r) => n + Math.max(0, r + con), 0);
    let next = { ...c, hitDiceUsed: c.hitDiceUsed + spend.length, slots: c.pactMagic ? restoreSlots(c.slots) : c.slots };
    if (healed) next = changeHp(next, healed, now);
    return { character: touch(next, now), spent: spend.length, healed };
}

// Long rest: full HP, temporary HP gone, all spell slots back, half your hit dice back (at
// least 1), death saves cleared and one level of exhaustion removed.
export function longRest(c, now) {
    const regain = Math.max(1, Math.floor(c.level / 2));
    return touch({
        ...c,
        hp: c.maxHp,
        tempHp: 0,
        slots: restoreSlots(c.slots),
        hitDiceUsed: Math.max(0, c.hitDiceUsed - regain),
        deathSaves: { success: 0, fail: 0 },
        exhaustion: Math.max(0, c.exhaustion - 1),
    }, now);
}

export function upsert(party, c) {
    const i = party.findIndex((x) => x.id === c.id);
    if (i === -1) return [...party, c];
    const next = party.slice();
    next[i] = c;
    return next;
}
export const remove = (party, id) => party.filter((c) => c.id !== id);

// ---------- Parties ----------
// Named groups of characters, e.g. one per campaign. A character can be in several parties,
// and each member can be switched off (not playing this session) without leaving the party.
// Party: { id, name, members: [{ id: characterId, active }], createdAt, updatedAt }

export const MAX_PARTIES = 20;
export const MAX_PARTY_NAME = 40;
export const newPartyId = () => 'g-' + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function cleanPartyName(name, parties = [], exceptId = null) {
    const n = text(name, MAX_PARTY_NAME);
    if (!n) throw new Error('Give the party a name.');
    const taken = parties.find((p) => p.id !== exceptId && sameName(p.name, n));
    if (taken) throw new Error('There’s already a party called “' + taken.name + '”.');
    return n;
}

export function createParty(parties, name, now = new Date().toISOString()) {
    if (parties.length >= MAX_PARTIES) throw new Error('You can have up to ' + MAX_PARTIES + ' parties.');
    const party = { id: newPartyId(), name: cleanPartyName(name, parties), members: [], createdAt: now, updatedAt: now };
    return { parties: [...parties, party], party };
}

const editParty = (parties, id, fn, now) => parties.map((p) => (p.id === id ? { ...fn(p), updatedAt: now || new Date().toISOString() } : p));

export const renameParty = (parties, id, name, now) => {
    const n = cleanPartyName(name, parties, id);
    return editParty(parties, id, (p) => ({ ...p, name: n }), now);
};
export const deleteParty = (parties, id) => parties.filter((p) => p.id !== id);

export const addMember = (parties, id, characterId, now) => editParty(parties, id, (p) => (
    p.members.some((m) => m.id === characterId) ? p : { ...p, members: [...p.members, { id: characterId, active: true }] }), now);
export const removeMember = (parties, id, characterId, now) =>
    editParty(parties, id, (p) => ({ ...p, members: p.members.filter((m) => m.id !== characterId) }), now);
export const setActive = (parties, id, characterId, active, now) =>
    editParty(parties, id, (p) => ({ ...p, members: p.members.map((m) => (m.id === characterId ? { ...m, active: !!active } : m)) }), now);

// A deleted character leaves every party
export const removeCharacterEverywhere = (parties, characterId) =>
    parties.map((p) => (p.members.some((m) => m.id === characterId) ? { ...p, members: p.members.filter((m) => m.id !== characterId) } : p));

// Members with their characters, skipping any that no longer exist
export function roster(party, characters) {
    const byId = new Map(characters.map((c) => [c.id, c]));
    return (party?.members || []).flatMap((m) => (byId.has(m.id) ? [{ ...byId.get(m.id), active: m.active }] : []));
}

export function normalizeParties(raw, characterIds = null) {
    if (!Array.isArray(raw)) return [];
    const known = characterIds ? new Set(characterIds) : null;
    const seen = new Set();
    const names = [];
    const out = [];
    for (const p of raw) {
        if (!isPlainObject(p) || typeof p.id !== 'string' || !p.id || seen.has(p.id)) continue;
        const name = text(p.name, MAX_PARTY_NAME);
        if (!name || names.some((n) => sameName(n, name))) continue;
        const memberIds = new Set();
        const members = (Array.isArray(p.members) ? p.members : []).flatMap((m) => {
            if (!isPlainObject(m) || typeof m.id !== 'string' || memberIds.has(m.id) || (known && !known.has(m.id))) return [];
            memberIds.add(m.id);
            return [{ id: m.id, active: m.active !== false }];
        });
        seen.add(p.id);
        names.push(name);
        out.push({ id: p.id, name, members, createdAt: typeof p.createdAt === 'string' ? p.createdAt : null, updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : null });
        if (out.length >= MAX_PARTIES) break;
    }
    return out;
}
