// Initiative tracker tests. Run with: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createCombatant, numberedNames, sortOrder, nextTurn, prevTurn, endCombat, removeCombatant,
    changeHp, toggleCondition, normalizeState, isDefeated, emptyState,
} from '../static/scripts/initiative.js';

const c = (name, init, extra = {}) => createCombatant({ name, init, id: name, ...extra });
const names = (list) => list.map((x) => x.name);

test('sorts by initiative, then modifier, players first, then name', () => {
    const list = [
        c('Goblin 2', 12, { mod: 2 }), c('Goblin 10', 12, { mod: 2 }), c('Aria', 12, { kind: 'pc', mod: 2 }),
        c('Ogre', 15), c('Bard', 12, { kind: 'pc', mod: 4 }), c('Unrolled', null), c('Wolf', 8),
    ];
    assert.deepEqual(names(sortOrder(list)), ['Ogre', 'Bard', 'Aria', 'Goblin 2', 'Goblin 10', 'Wolf', 'Unrolled']);
});

test('numbers repeated monsters and continues existing numbering', () => {
    assert.deepEqual(numberedNames('Goblin', 1), ['Goblin']);
    assert.deepEqual(numberedNames('Goblin', 3), ['Goblin 1', 'Goblin 2', 'Goblin 3']);
    assert.deepEqual(numberedNames('Goblin', 2, ['Goblin 1', 'Goblin 2', 'Orc']), ['Goblin 3', 'Goblin 4']);
    assert.deepEqual(numberedNames('Goblin', 1, ['Goblin']), ['Goblin 2']);
    assert.deepEqual(numberedNames('Mr. (Odd)', 2, ['Mr. (Odd) 1']), ['Mr. (Odd) 2', 'Mr. (Odd) 3']);
});

test('turns advance through the order and roll over into new rounds', () => {
    let s = { ...emptyState(), combatants: [c('A', 20), c('B', 10), c('C', 5)] };
    const seen = [];
    for (let i = 0; i < 7; i++) { s = nextTurn(s); seen.push(s.activeId + s.round); }
    assert.deepEqual(seen, ['A1', 'B1', 'C1', 'A2', 'B2', 'C2', 'A3']);
    s = prevTurn(s); assert.equal(s.activeId + s.round, 'C2');
    s = prevTurn(prevTurn(s)); assert.equal(s.activeId + s.round, 'A2');
    s = prevTurn(s); assert.equal(s.activeId + s.round, 'C1');
    s = endCombat(s); assert.deepEqual([s.round, s.activeId], [0, null]);
});

test('cannot go back before the first turn', () => {
    let s = nextTurn({ ...emptyState(), combatants: [c('A', 20), c('B', 10)] });
    assert.equal(prevTurn(s).activeId, 'A');
    assert.equal(prevTurn(s).round, 1);
});

test('defeated monsters are skipped, downed players are not', () => {
    const ogre = changeHp(c('Ogre', 15, { hp: 30 }), -30);
    const pc = changeHp(c('Aria', 12, { kind: 'pc', hp: 10 }), -99);
    assert.equal(isDefeated(ogre), true);
    assert.equal(isDefeated(pc), false);
    let s = { ...emptyState(), combatants: [ogre, pc, c('Wolf', 5)] };
    s = nextTurn(s); assert.equal(s.activeId, 'Aria');
    s = nextTurn(s); assert.equal(s.activeId, 'Wolf');
    s = nextTurn(s); assert.deepEqual([s.activeId, s.round], ['Aria', 2]);
});

test('removing the active combatant passes the turn on', () => {
    let s = nextTurn({ ...emptyState(), combatants: [c('A', 20), c('B', 10), c('C', 5)] });
    s = removeCombatant(s, 'A');
    assert.deepEqual([s.activeId, names(s.combatants)], ['B', ['B', 'C']]);
    s = removeCombatant(removeCombatant(s, 'B'), 'C');
    assert.deepEqual(s, emptyState());
});

test('HP stays between 0 and max; untracked HP is ignored', () => {
    const g = c('G', 10, { hp: 7 });
    assert.equal(changeHp(g, -5).hp, 2);
    assert.equal(changeHp(g, -50).hp, 0);
    assert.equal(changeHp(changeHp(g, -5), 99).hp, 7);
    const noHp = c('X', 10);
    assert.deepEqual([noHp.maxHp, noHp.hp, noHp.ac], [null, null, null]); // not tracked, not 0
    assert.equal(changeHp(noHp, -5), noHp);
});

test('conditions toggle and unknown ones are ignored', () => {
    let g = toggleCondition(c('G', 1), 'Prone');
    g = toggleCondition(g, 'Poisoned');
    assert.deepEqual(g.conditions, ['Prone', 'Poisoned']);
    assert.deepEqual(toggleCondition(g, 'Prone').conditions, ['Poisoned']);
    assert.deepEqual(toggleCondition(g, 'Sleepy').conditions, ['Prone', 'Poisoned']);
});

test('inputs are clamped and blanks become null', () => {
    const x = createCombatant({ name: '  ', kind: 'pc', mod: '45', hp: '', ac: '-3', init: '7' });
    assert.deepEqual([x.name, x.mod, x.maxHp, x.ac, x.init], ['Player', 30, null, 0, 7]);
});

test('normalizeState restores saved data and drops junk', () => {
    const saved = {
        round: 2, activeId: 'b',
        combatants: [
            { id: 'a', name: 'Aria', kind: 'pc', mod: 3, init: 18, maxHp: 20, hp: 25, ac: 15, conditions: ['Prone', 'Nope'] },
            { id: 'b', name: 'Orc', init: 9, maxHp: 15, hp: 4 },
            null, { name: 'no id' },
        ],
    };
    const s = normalizeState(saved);
    assert.equal(s.combatants.length, 2);
    assert.deepEqual([s.combatants[0].hp, s.combatants[0].conditions], [20, ['Prone']]);
    assert.deepEqual([s.round, s.activeId], [2, 'b']);
    assert.deepEqual(normalizeState({ combatants: [], round: 3 }), emptyState());
    assert.deepEqual(normalizeState('garbage'), emptyState());
    assert.deepEqual(normalizeState({ combatants: saved.combatants, round: 2, activeId: 'gone' }).round, 0);
});

test('characters join as linked players, once each', async () => {
    const { addCharacters } = await import('../static/scripts/initiative.js');
    const start = { combatants: [createCombatant({ name: 'Goblin', init: 12 })], round: 0, activeId: null };
    const entries = [
        { charId: 'p-1', name: 'Aria', mod: 3, hp: 36, currentHp: 20, ac: 15 },
        { charId: 'p-2', name: 'Nyx', mod: 2, hp: null, currentHp: null, ac: 13 },
    ];
    const first = addCharacters(start, entries);
    assert.equal(first.added.length, 2);
    const aria = first.state.combatants.find((c) => c.charId === 'p-1');
    assert.deepEqual([aria.kind, aria.init, aria.maxHp, aria.hp, aria.ac, aria.mod], ['pc', null, 36, 20, 15, 3]);
    assert.equal(first.state.combatants.find((c) => c.charId === 'p-2').maxHp, null);
    const again = addCharacters(first.state, entries);
    assert.equal(again.added.length, 0, 'already in the tracker');
    assert.equal(again.state, first.state);
    assert.equal(normalizeState(JSON.parse(JSON.stringify(first.state))).combatants[1].charId, 'p-1', 'the link survives saving');
});
