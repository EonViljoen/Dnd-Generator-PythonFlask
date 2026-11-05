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
