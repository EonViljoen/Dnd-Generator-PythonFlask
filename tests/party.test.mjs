// Party tracker tests. Run with: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createCharacter, normalizeCharacter, normalizeParty, levelUp, changeHp, upsert, remove,
    createParty, renameParty, deleteParty, addMember, removeMember, setActive, removeCharacterEverywhere, roster, normalizeParties,
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
