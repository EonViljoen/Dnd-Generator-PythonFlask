// Dice engine: parse standard dice notation and roll it fairly.
//
// Supported notation (case-insensitive, spaces ignored):
//   d20, 1d20+5, 2d6+1d4-1, d% (= d100)
//   4d6kh3 / 4d6k3  keep highest 3     2d20kl1  keep lowest 1
// Modes: 'adv' / 'dis' turn every single d20 (1d20 with no keep) into 2d20kh1 / 2d20kl1.
//
// No DOM code here, so it can be tested in Node.

export const LIMITS = { maxDice: 100, maxSides: 1000, minSides: 2, maxConst: 1000, maxTerms: 12 };
export const STANDARD_DICE = [4, 6, 8, 10, 12, 20, 100];

export class DiceError extends Error {}

const TERM = /^(\d*)d(\d+|%)(?:(kh|kl|k)(\d+))?$|^(\d+)$/;

// "2d6 + 3" -> { terms: [{ sign, kind: 'dice', count, sides, keep }, { sign, kind: 'const', value }] }
export function parse(input) {
    const src = String(input || '').toLowerCase().replace(/\s+/g, '');
    if (!src) throw new DiceError('Type some dice to roll, like 2d6+3.');
    if (!/^[-+]?[0-9d%khl]+([-+][0-9d%khl]+)*$/.test(src)) {
        throw new DiceError('“' + input + '” isn’t dice notation. Try something like 2d6+3 or 4d6kh3.');
    }

    const terms = [];
    let totalDice = 0;
    for (const match of src.matchAll(/([-+]?)([^-+]+)/g)) {
        const sign = match[1] === '-' ? -1 : 1;
        const body = match[2];
        const m = body.match(TERM);
        if (!m) throw new DiceError('“' + body + '” isn’t a valid dice term. Use NdS (2d6), NdSkhK (4d6kh3) or a number.');

        if (m[5] !== undefined) {
            const value = Number(m[5]);
            if (value > LIMITS.maxConst) throw new DiceError('Modifiers can be at most ' + LIMITS.maxConst + '.');
            terms.push({ sign, kind: 'const', value });
            continue;
        }

        const count = m[1] === '' ? 1 : Number(m[1]);
        const sides = m[2] === '%' ? 100 : Number(m[2]);
        if (count < 1) throw new DiceError('Roll at least one die (“' + body + '”).');
        if (sides < LIMITS.minSides || sides > LIMITS.maxSides) {
            throw new DiceError('Dice need between ' + LIMITS.minSides + ' and ' + LIMITS.maxSides + ' sides (“' + body + '”).');
        }
        let keep = null;
        if (m[3]) {
            const n = Number(m[4]);
            if (n < 1 || n > count) throw new DiceError('Can’t keep ' + n + ' of ' + count + ' dice (“' + body + '”).');
            keep = { which: m[3] === 'kl' ? 'low' : 'high', n };
        }
        totalDice += count;
        terms.push({ sign, kind: 'dice', count, sides, keep });
    }

    if (terms.length > LIMITS.maxTerms) throw new DiceError('That’s a lot of terms. Keep it to ' + LIMITS.maxTerms + ' or fewer.');
    if (totalDice > LIMITS.maxDice) throw new DiceError('That’s more than ' + LIMITS.maxDice + ' dice in one roll.');
    if (!terms.some((t) => t.kind === 'dice')) throw new DiceError('Add at least one die, like 1d20.');
    return { terms };
}

// Apply advantage/disadvantage to every plain single d20. Returns { parsed, applied }.
export function applyMode(parsed, mode) {
    if (mode !== 'adv' && mode !== 'dis') return { parsed, applied: false };
    let applied = false;
    const terms = parsed.terms.map((t) => {
        if (t.kind === 'dice' && t.sides === 20 && t.count === 1 && !t.keep) {
            applied = true;
            return { ...t, count: 2, keep: { which: mode === 'adv' ? 'high' : 'low', n: 1 }, fromMode: mode };
        }
        return t;
    });
    return { parsed: { terms }, applied };
}

export function formatTerm(t) {
    if (t.kind === 'const') return String(t.value);
    const base = (t.fromMode ? 1 : t.count) + 'd' + t.sides;
    if (t.fromMode) return base;
    if (!t.keep) return base;
    return base + (t.keep.which === 'low' ? 'kl' : 'kh') + t.keep.n;
}

// Canonical notation, e.g. "1d20+5" or "4d6kh3-1"
export function format(parsed) {
    return parsed.terms.map((t, i) => {
        const s = formatTerm(t);
        if (i === 0) return t.sign < 0 ? '-' + s : s;
        return (t.sign < 0 ? '-' : '+') + s;
    }).join('');
}

// Unbiased integer in [1, sides] from the browser's (or Node's) crypto RNG
export function rollDie(sides, cryptoObj = globalThis.crypto) {
    const range = 2 ** 32;
    const limit = range - (range % sides); // reject the tail to avoid modulo bias
    const buf = new Uint32Array(1);
    let x;
    do {
        cryptoObj.getRandomValues(buf);
        x = buf[0];
    } while (x >= limit);
    return (x % sides) + 1;
}

// Roll a parsed expression. Each dice term gets rolls: [{ value, kept }], subtotal.
// Flags crits on kept d20s: nat20 / nat1.
export function roll(parsed, rng = rollDie) {
    let total = 0;
    let nat20 = false;
    let nat1 = false;
    const terms = parsed.terms.map((t) => {
        if (t.kind === 'const') {
            total += t.sign * t.value;
            return { ...t, subtotal: t.sign * t.value };
        }
        const values = Array.from({ length: t.count }, () => rng(t.sides));
        const kept = new Array(values.length).fill(true);
        if (t.keep) {
            const order = values.map((v, i) => i).sort((a, b) =>
                t.keep.which === 'high' ? values[b] - values[a] || a - b : values[a] - values[b] || a - b);
            kept.fill(false);
            for (const i of order.slice(0, t.keep.n)) kept[i] = true;
        }
        const rolls = values.map((value, i) => ({ value, kept: kept[i] }));
        const sum = rolls.reduce((n, r) => n + (r.kept ? r.value : 0), 0);
        if (t.sides === 20) {
            for (const r of rolls) {
                if (!r.kept) continue;
                if (r.value === 20) nat20 = true;
                if (r.value === 1) nat1 = true;
            }
        }
        total += t.sign * sum;
        return { ...t, rolls, subtotal: t.sign * sum };
    });
    return { terms, total, nat20, nat1 };
}

// Plain-text summary for history, copy and pins: "1d20+5 = 17 · 1d20 [12] +5"
export function describe(label, result) {
    const parts = result.terms.map((t, i) => {
        const sign = t.sign < 0 ? '−' : (i === 0 ? '' : '+');
        if (t.kind === 'const') return sign + t.value;
        const dice = t.rolls.map((r) => (r.kept ? String(r.value) : '(' + r.value + ')')).join(', ');
        return sign + formatTerm(t) + (t.fromMode ? (t.fromMode === 'adv' ? ' adv' : ' dis') : '') + ' [' + dice + ']';
    });
    return label + ' = ' + result.total + ' · ' + parts.join(' ');
}
