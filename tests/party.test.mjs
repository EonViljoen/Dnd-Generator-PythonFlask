// Party tracker tests. Run with: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createCharacter, normalizeCharacter, normalizeParty, levelUp, changeHp, upsert, remove,
    createParty, renameParty, deleteParty, addMember, removeMember, setActive, removeCharacterEverywhere, roster, normalizeParties,
    toggleCondition, setExhaustion, toggleInspiration, setDeathSave, deathState, setSlotsUsed, shortRest, longRest,
    hitDieFor, hitDieOf, hitDiceLeft, hasSlots,
    modifier, proficiency, passivePerception, initiativeBonus, summary, signed, LIMITS,
} from '../static/scripts/party.js';

const NOW = '2026-11-06T10:00:00.000Z';

test('ability modifiers and proficiency follow the 5e tables', () => {
    assert.deepEqual([1, 8, 9, 10, 11, 12, 15, 20, 30].map(modifier), [-5, -1, -1, 0, 0, 1, 2, 5, 10]);
    assert.deepEqual([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(proficiency), [2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
    assert.equal(signed(3), '+3');
    assert.equal(signed(-1), '−1');
});

test('a new character gets sensible defaults', () => {
    const c = createCharacter({ name: '  Aria ' }, NOW);
    assert.equal(c.name, 'Aria');
    assert.equal(c.level, 1);
    assert.equal(c.maxHp, null);
    assert.equal(c.hp, null);
    assert.equal(c.ac, null);
    assert.equal(c.speed, 30);
    assert.deepEqual(c.scores, { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    assert.deepEqual(c.coins, { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
    assert.equal(c.createdAt, NOW);
    assert.match(c.id, /^p-/);
});

test('derived numbers come from scores and level', () => {
    const c = createCharacter({ name: 'Aria', level: 5, scores: { dex: 16, wis: 14 }, perceptionProf: true });
    assert.equal(initiativeBonus(c), 3);
    assert.equal(passivePerception(c), 10 + 2 + 3);
    assert.equal(passivePerception({ ...c, perceptionProf: false }), 12);
    assert.equal(summary({ ...c, cls: 'Fighter', subclass: 'Champion', race: 'Human' }), 'Level 5 Fighter (Champion) · Human');
    assert.equal(summary(c), 'Level 5');
});

test('form values are cleaned and clamped', () => {
    const c = normalizeCharacter({
        name: 'Bram', level: '25', maxHp: '30', hp: '45', tempHp: '-2', ac: '', speed: 'fast',
        scores: { str: '18', dex: 'x', con: 0 },
        weapons: [{ name: 'Longsword', attack: '+5', damage: '1d8+3 slashing' }, { name: '' }, 'junk'],
        inventory: [{ name: 'Rope', qty: '' }, { name: 'Torch', qty: '5', notes: 'lit' }],
        coins: { gp: '12', sp: -4 },
    });
    assert.equal(c.level, LIMITS.maxLevel);
    assert.equal(c.maxHp, 30);
    assert.equal(c.hp, 30, 'HP can’t go above max');
    assert.equal(c.tempHp, 0);
    assert.equal(c.ac, null);
    assert.equal(c.speed, 30);
    assert.deepEqual(c.scores, { str: 18, dex: 10, con: 1, int: 10, wis: 10, cha: 10 });
    assert.deepEqual(c.weapons, [{ name: 'Longsword', attack: '+5', damage: '1d8+3 slashing' }]);
    assert.deepEqual(c.inventory, [{ name: 'Rope', qty: 1, notes: '' }, { name: 'Torch', qty: 5, notes: 'lit' }]);
    assert.equal(c.coins.gp, 12);
    assert.equal(c.coins.sp, 0);
});

test('a character needs a name', () => {
    assert.equal(normalizeCharacter({ name: '   ' }), null);
    assert.equal(normalizeCharacter('Aria'), null);
});

test('level up stops at 20', () => {
    const c = createCharacter({ name: 'Aria', level: 19 });
    const up = levelUp(c, NOW);
    assert.equal(up.level, 20);
    assert.equal(up.updatedAt, NOW);
    assert.equal(levelUp(up), up);
});

test('damage takes temporary HP first, healing stops at max', () => {
    const c = createCharacter({ name: 'Aria', maxHp: 20, hp: 15, tempHp: 5 });
    const hit = changeHp(c, -8);
    assert.equal(hit.tempHp, 0);
    assert.equal(hit.hp, 12);
    assert.equal(changeHp(hit, -50).hp, 0);
    assert.equal(changeHp(hit, 50).hp, 20);
    const noHp = createCharacter({ name: 'Bram' });
    assert.equal(changeHp(noHp, -5), noHp);
});

test('party lists add, replace, remove and drop bad entries', () => {
    const a = createCharacter({ name: 'Aria' });
    const b = createCharacter({ name: 'Bram' });
    let party = upsert(upsert([], a), b);
    assert.deepEqual(party.map((c) => c.name), ['Aria', 'Bram']);
    party = upsert(party, { ...a, name: 'Aria the Bold' });
    assert.deepEqual(party.map((c) => c.name), ['Aria the Bold', 'Bram']);
    assert.deepEqual(remove(party, a.id).map((c) => c.name), ['Bram']);
    assert.equal(normalizeParty([a, a, { name: '' }, null, b]).length, 2);
    assert.deepEqual(normalizeParty('nope'), []);
});

test('parties: create, rename, members and the active switch', () => {
    const a = createCharacter({ name: 'Aria' });
    const b = createCharacter({ name: 'Bram' });
    let { parties, party } = createParty([], ' Tuesday group ');
    assert.equal(party.name, 'Tuesday group');
    assert.throws(() => createParty(parties, 'tuesday GROUP'), /already a party/);
    assert.throws(() => createParty(parties, '  '), /name/);
    parties = addMember(addMember(addMember(parties, party.id, a.id), party.id, b.id), party.id, a.id);
    assert.deepEqual(parties[0].members, [{ id: a.id, active: true }, { id: b.id, active: true }]);
    parties = setActive(parties, party.id, b.id, false);
    assert.deepEqual(roster(parties[0], [a, b]).map((c) => [c.name, c.active]), [['Aria', true], ['Bram', false]]);
    parties = renameParty(parties, party.id, 'Curse of Strahd');
    assert.equal(parties[0].name, 'Curse of Strahd');
    parties = removeMember(parties, party.id, a.id);
    assert.deepEqual(parties[0].members.map((m) => m.id), [b.id]);
    parties = removeCharacterEverywhere(parties, b.id);
    assert.deepEqual(parties[0].members, []);
    assert.deepEqual(deleteParty(parties, party.id), []);
});

test('saved parties are cleaned up', () => {
    const raw = [
        { id: 'g-1', name: 'One', members: [{ id: 'p-1' }, { id: 'p-1' }, { id: 'p-x', active: false }, 'junk'] },
        { id: 'g-2', name: 'one' },
        { id: 'g-1', name: 'Dupe id' },
        { name: 'No id' },
    ];
    assert.deepEqual(normalizeParties(raw, ['p-1', 'p-x']).map((p) => [p.name, p.members]),
        [['One', [{ id: 'p-1', active: true }, { id: 'p-x', active: false }]]]);
    assert.deepEqual(normalizeParties(raw, ['p-1'])[0].members, [{ id: 'p-1', active: true }]);
});

test('new fields for play have safe defaults', () => {
    const c = createCharacter({ name: 'Aria', cls: 'Ranger', level: 3 });
    assert.deepEqual(c.conditions, []);
    assert.equal(c.exhaustion, 0);
    assert.equal(c.inspiration, false);
    assert.deepEqual(c.deathSaves, { success: 0, fail: 0 });
    assert.equal(c.hitDie, null);
    assert.equal(hitDieOf(c), 10);
    assert.equal(hitDieOf({ ...c, cls: 'Wizard' }), 6, 'follows the class until one is chosen');
    assert.equal(hitDiceLeft(c), 3);
    assert.equal(c.slots.length, 9);
    assert.equal(hasSlots(c), false);
    assert.deepEqual([hitDieFor('Wizard'), hitDieFor('barbarian'), hitDieFor('Bard'), hitDieFor('Homebrew')], [6, 12, 8, 8]);
    assert.equal(hitDieOf(createCharacter({ name: 'X', cls: 'Wizard', hitDie: 10 })), 10, 'a chosen hit die wins');
});

test('saved values are clamped', () => {
    const c = normalizeCharacter({
        name: 'Bram', level: 2, maxHp: 10, hp: 5, conditions: ['Prone', 'Nope', 'Blinded'], exhaustion: 9,
        deathSaves: { success: 2, fail: 1 }, hitDiceUsed: 7, slots: [{ max: 12, used: 20 }, { max: 2, used: -1 }],
    });
    assert.deepEqual(c.conditions, ['Blinded', 'Prone']);
    assert.equal(c.exhaustion, 6);
    assert.deepEqual(c.deathSaves, { success: 0, fail: 0 }, 'death saves only kept at 0 HP');
    assert.equal(c.hitDiceUsed, 2);
    assert.deepEqual(c.slots.slice(0, 2), [{ max: 9, used: 9 }, { max: 2, used: 0 }]);
    const down = normalizeCharacter({ name: 'Bram', maxHp: 10, hp: 0, deathSaves: { success: 2, fail: 5 } });
    assert.deepEqual(down.deathSaves, { success: 2, fail: 3 });
});

test('conditions, exhaustion and inspiration', () => {
    let c = createCharacter({ name: 'Aria' });
    c = toggleCondition(toggleCondition(c, 'Prone'), 'Blinded');
    assert.deepEqual(c.conditions, ['Blinded', 'Prone'], 'kept in list order');
    assert.deepEqual(toggleCondition(c, 'Prone').conditions, ['Blinded']);
    assert.equal(toggleCondition(c, 'Nope'), c);
    assert.equal(setExhaustion(c, 8).exhaustion, 6);
    assert.equal(setExhaustion(c, -1).exhaustion, 0);
    assert.equal(toggleInspiration(c).inspiration, true);
});

test('death saves fill up to a box, and clear on healing', () => {
    let c = createCharacter({ name: 'Aria', maxHp: 10, hp: 3 });
    c = changeHp(c, -10);
    assert.equal(c.hp, 0);
    c = setDeathSave(c, 'success', 2);
    assert.deepEqual(c.deathSaves, { success: 2, fail: 0 });
    assert.deepEqual(setDeathSave(c, 'success', 2).deathSaves, { success: 1, fail: 0 }, 'clicking the last filled box clears it');
    c = setDeathSave(c, 'fail', 3);
    assert.equal(deathState(c), 'dead');
    assert.equal(deathState(setDeathSave(c, 'success', 3)), 'dead', 'three failures win');
    assert.equal(deathState(setDeathSave(setDeathSave(c, 'fail', 3), 'success', 3)), 'stable');
    assert.deepEqual(changeHp(c, 4).deathSaves, { success: 0, fail: 0 });
    assert.deepEqual(changeHp(toggleCondition(c, 'Unconscious'), 4).conditions, [], 'healing from 0 HP wakes them');
    assert.deepEqual(changeHp(toggleCondition({ ...c, hp: 2 }, 'Unconscious'), 4).conditions, ['Unconscious'], 'but not otherwise');
});

test('spell slots are used and restored', () => {
    let c = createCharacter({ name: 'Nyx', slots: [{ max: 4 }, { max: 3 }] });
    assert.equal(hasSlots(c), true);
    c = setSlotsUsed(c, 1, 3);
    assert.equal(c.slots[0].used, 3);
    assert.equal(setSlotsUsed(c, 1, 3).slots[0].used, 2);
    assert.equal(setSlotsUsed(c, 2, 9).slots[1].used, 3);
});

test('short rest spends hit dice and only restores Pact Magic slots', () => {
    const base = createCharacter({ name: 'Aria', level: 4, maxHp: 30, hp: 10, scores: { con: 14 }, slots: [{ max: 2, used: 2 }] });
    const { character, spent, healed } = shortRest(base, [6, 1]);
    assert.equal(spent, 2);
    assert.equal(healed, 8 + 3);
    assert.equal(character.hp, 21);
    assert.equal(character.hitDiceUsed, 2);
    assert.equal(character.slots[0].used, 2);
    const warlock = shortRest({ ...base, pactMagic: true }, []);
    assert.equal(warlock.character.slots[0].used, 0);
    assert.equal(warlock.spent, 0);
    const weak = createCharacter({ name: 'X', level: 2, maxHp: 10, hp: 1, scores: { con: 3 } });
    assert.equal(shortRest(weak, [1]).healed, 0, 'a low roll never hurts');
    assert.equal(shortRest({ ...base, hitDiceUsed: 4 }, [6]).spent, 0, 'no dice left');
});

test('long rest restores HP, slots, half the hit dice and one exhaustion level', () => {
    const c = createCharacter({ name: 'Aria', level: 5, maxHp: 40, hp: 0, tempHp: 4, exhaustion: 2, hitDiceUsed: 5, deathSaves: { fail: 2 }, slots: [{ max: 4, used: 4 }] });
    const r = longRest(c);
    assert.equal(r.hp, 40);
    assert.equal(r.tempHp, 0);
    assert.equal(r.slots[0].used, 0);
    assert.equal(r.hitDiceUsed, 3);
    assert.equal(r.exhaustion, 1);
    assert.deepEqual(r.deathSaves, { success: 0, fail: 0 });
    assert.equal(longRest(createCharacter({ name: 'Y', level: 1, hitDiceUsed: 1 })).hitDiceUsed, 0, 'at least one die back');
});
