// Dice engine tests. Run with: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, format, applyMode, roll, rollDie, describe, DiceError } from '../static/scripts/dice.js';

const t = test;

t('formats canonical notation', () => {
  for (const [inp, out] of [['d20', '1d20'], ['1D20 + 5', '1d20+5'], ['2d6+1d4-1', '2d6+1d4-1'], ['d%', '1d100'], ['4d6k3', '4d6kh3'], ['2d20kl1', '2d20kl1'], ['-1+1d4', '-1+1d4']])
    assert.equal(format(parse(inp)), out, inp);
});
t('rejects bad input with DiceError', () => {
  for (const bad of ['', 'hello', '2d', 'd1', '1d1001', '0d6', '4d6kh5', '101d6', '1d20kh', '5', '1d6+1001', '2d6**2', '1d6'.repeat(1) + '+1'.repeat(12)])
    assert.throws(() => parse(bad), DiceError, bad);
});
t('advantage turns single d20s into 2d20kh1, leaves others', () => {
  const { parsed, applied } = applyMode(parse('1d20+1d20+2d20+1d6'), 'adv');
  assert.equal(applied, true);
  assert.deepEqual(parsed.terms.map((x) => [x.count, x.keep?.which]), [[2, 'high'], [2, 'high'], [2, undefined], [1, undefined]]);
  assert.equal(format(parsed), '1d20+1d20+2d20+1d6'); // label stays readable
  assert.equal(applyMode(parse('2d6'), 'dis').applied, false);
});
t('keep highest / lowest with fixed rolls', () => {
  const seq = [1, 6, 3, 5]; let i = 0; const rng = () => seq[i++];
  const r = roll(parse('4d6kh3'), rng);
  assert.equal(r.total, 14);
  assert.deepEqual(r.terms[0].rolls.map((x) => x.kept), [false, true, true, true]);
  i = 0;
  assert.equal(roll(parse('4d6kl1+2'), rng).total, 3);
});
t('ties keep the earliest die', () => {
  const seq = [4, 4]; let i = 0;
  const r = roll(applyMode(parse('1d20'), 'adv').parsed, () => seq[i++]);
  assert.deepEqual(r.terms[0].rolls.map((x) => x.kept), [true, false]);
});
t('crit flags only on kept d20s', () => {
  let seq = [20, 3]; let i = 0;
  let r = roll(applyMode(parse('1d20+5'), 'dis').parsed, () => seq[i++]);
  assert.equal(r.total, 8); assert.equal(r.nat20, false);
  seq = [20]; i = 0; r = roll(parse('1d20'), () => seq[i++]); assert.equal(r.nat20, true);
  seq = [1]; i = 0; r = roll(parse('1d20'), () => seq[i++]); assert.equal(r.nat1, true);
  seq = [1, 20]; i = 0; r = roll(parse('2d6'), () => 1); assert.equal(r.nat1, false); // d6, not d20
});
t('subtraction and describe()', () => {
  const r = roll(parse('1d8-2'), () => 1);
  assert.equal(r.total, -1);
  assert.equal(describe('1d8-2', r), '1d8-2 = -1 · 1d8 [1] −2');
  const seq = [12, 7]; let i = 0;
  const a = roll(applyMode(parse('1d20+5'), 'adv').parsed, () => seq[i++]);
  assert.equal(describe('1d20+5 (advantage)', a), '1d20+5 (advantage) = 17 · 1d20 adv [12, (7)] +5');
});
t('rollDie is in range and roughly uniform', () => {
  const counts = new Array(21).fill(0);
  const N = 200000;
  for (let k = 0; k < N; k++) counts[rollDie(20)]++;
  assert.equal(counts[0], 0);
  for (let f = 1; f <= 20; f++) assert.ok(Math.abs(counts[f] / N - 0.05) < 0.003, 'face ' + f + ': ' + counts[f]);
  for (const s of [2, 3, 4, 6, 8, 10, 12, 100, 1000]) for (let k = 0; k < 2000; k++) { const v = rollDie(s); assert.ok(v >= 1 && v <= s); }
});

import { findInlineDice } from '../static/scripts/dice.js';
const found = (s) => findInlineDice(s).map((d) => [d.text, d.notation, d.multiplier]);

test('finds dice written in prompts', () => {
  assert.deepEqual(found('The trap resets in 1d4 days.'), [['1d4', '1d4', 1]]);
  assert.deepEqual(found('roll a d6 to see what happens'), [['d6', '1d6', 1]]);
  assert.deepEqual(found('Roll a D20; if the roll is a 20, roll a D100'), [['D20', '1d20', 1], ['D100', '1d100', 1]]);
  assert.deepEqual(found('deals 2d6 + 3 fire damage'), [['2d6 + 3', '2d6+3', 1]]);
  assert.deepEqual(found('a series of (d4 + 2) disks'), [['d4 + 2', '1d4+2', 1]]);
  assert.deepEqual(found('heals 1d8−1'), [['1d8−1', '1d8-1', 1]]);
  assert.deepEqual(found('worth 2d4x100gp.'), [['2d4x100', '2d4', 100]]);
  assert.deepEqual(found('(d3 x 100gp each)'), [['d3 x 100', '1d3', 100]]);
  assert.deepEqual(found('2d10/4d10 damage'), [['2d10', '2d10', 1], ['4d10', '4d10', 1]]);
  assert.deepEqual(found('a 1d10-foot drop'), [['1d10', '1d10', 1]]);
  assert.deepEqual(found('D20+DEX: 1-10 miss'), [['D20', '1d20', 1]]);
  assert.deepEqual(found('25+2D10 gold'), [['2D10', '2d10', 1]]);
});

test('ignores lists, words and impossible dice', () => {
  assert.deepEqual(found('Roll a d3- 1: Melee 2: Magic'), [['d3', '1d3', 1]]);
  for (const s of ['dmg1d2;', 'Room D1 is empty', '0d6', 'add 1000d6', 'hand d', 'v1.d6'])
    assert.deepEqual(found(s), [], s);
  assert.deepEqual(found('rolls two d6s'), [['d6', '1d6', 1]]); // plural dice still count
});
