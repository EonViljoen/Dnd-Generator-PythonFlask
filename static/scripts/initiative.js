// Initiative tracker state: pure functions, no DOM, so it can be tested in Node.
//
// State: { combatants: [Combatant], round, activeId }
//   round 0 = combat not started.
// Combatant: { id, name, kind: 'pc' | 'npc', mod, init, maxHp, hp, ac, conditions: [] }
//   maxHp/hp/ac are null when not tracked.

export const CONDITIONS = [
    'Blinded', 'Charmed', 'Concentrating', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated',
    'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious',
];
export const LIMITS = { maxCombatants: 40, maxCount: 20, maxName: 40, maxHp: 9999, maxMod: 30, maxInit: 99 };

export const emptyState = () => ({ combatants: [], round: 0, activeId: null });

const clampInt = (v, lo, hi, fallback = null) => {
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : fallback;
};

let seq = 0;
export const newId = () => 'c-' + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);

export function createCombatant({ name, kind = 'npc', mod = 0, init = null, hp = null, ac = null, id = newId() }) {
    const maxHp = clampInt(hp, 1, LIMITS.maxHp);
    return {
        id,
        name: String(name || '').trim().slice(0, LIMITS.maxName) || (kind === 'pc' ? 'Player' : 'Monster'),
        kind: kind === 'pc' ? 'pc' : 'npc',
        mod: clampInt(mod, -LIMITS.maxMod, LIMITS.maxMod, 0),
        init: clampInt(init, -LIMITS.maxInit, LIMITS.maxInit),
        maxHp,
        hp: maxHp,
        ac: clampInt(ac, 0, 99),
        conditions: [],
    };
}

// "Goblin", 3 -> ["Goblin 1", "Goblin 2", "Goblin 3"]; numbering continues after existing ones
export function numberedNames(name, count, existingNames = []) {
    const base = String(name || '').trim();
    const n = clampInt(count, 1, LIMITS.maxCount, 1);
    if (n === 1 && !existingNames.includes(base)) return [base];
    const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' (\\d+)$');
    let start = existingNames.reduce((max, existing) => {
        const m = existing.match(re);
        return m ? Math.max(max, Number(m[1])) : max;
    }, existingNames.includes(base) ? 1 : 0);
    return Array.from({ length: n }, () => base + ' ' + (++start));
}

// Highest initiative first; ties: higher modifier, then players before monsters, then name.
// Combatants without an initiative go last, in the order they were added.
export function sortOrder(combatants) {
    return combatants
        .map((c, i) => ({ c, i }))
        .sort((a, b) => {
            const ai = a.c.init, bi = b.c.init;
            if (ai === null || bi === null) return (ai === null) - (bi === null) || a.i - b.i;
            return bi - ai
                || b.c.mod - a.c.mod
                || (a.c.kind === b.c.kind ? 0 : a.c.kind === 'pc' ? -1 : 1)
                || a.c.name.localeCompare(b.c.name, undefined, { numeric: true })
                || a.i - b.i;
        })
        .map(({ c }) => c);
}

// Defeated monsters (0 HP) are skipped when taking turns; players at 0 HP still get turns (death saves).
export const isDefeated = (c) => c.kind === 'npc' && c.maxHp !== null && c.hp <= 0;

function step(state, direction) {
    const order = sortOrder(state.combatants);
    if (!order.length) return { ...state, round: 0, activeId: null };
    const alive = (c) => !isDefeated(c);
    if (!order.some(alive)) return { ...state }; // everyone is down: nothing to do
    if (state.round === 0) {
        const first = direction > 0 ? order.find(alive) : [...order].reverse().find(alive);
        return { ...state, round: 1, activeId: first.id };
    }
    let idx = order.findIndex((c) => c.id === state.activeId);
    let round = state.round;
    if (idx === -1) idx = direction > 0 ? -1 : order.length;
    for (let tries = 0; tries < order.length * 2; tries++) {
        idx += direction;
        if (idx >= order.length) { idx = 0; round += 1; }
        if (idx < 0) {
            if (round <= 1) return { ...state }; // can't go back before the first turn
            idx = order.length - 1;
            round -= 1;
        }
        if (alive(order[idx])) return { ...state, round, activeId: order[idx].id };
    }
    return { ...state };
}

export const nextTurn = (state) => step(state, 1);
export const prevTurn = (state) => step(state, -1);
export const endCombat = (state) => ({ ...state, round: 0, activeId: null });

// Remove a combatant. If it was their turn, the turn passes to the next one first.
export function removeCombatant(state, id) {
    let next = state;
    if (state.activeId === id && state.round > 0) {
        next = nextTurn(state);
        if (next.activeId === id) next = { ...next, activeId: null };
    }
    const combatants = next.combatants.filter((c) => c.id !== id);
    return combatants.length ? { ...next, combatants } : emptyState();
}

export function updateCombatant(state, id, fn) {
    return { ...state, combatants: state.combatants.map((c) => (c.id === id ? fn(c) : c)) };
}

// Damage (negative) or heal (positive); HP stays between 0 and max.
export function changeHp(c, delta) {
    if (c.maxHp === null) return c;
    return { ...c, hp: Math.min(c.maxHp, Math.max(0, c.hp + Math.trunc(delta))) };
}

export function toggleCondition(c, condition) {
    if (!CONDITIONS.includes(condition)) return c;
    const has = c.conditions.includes(condition);
    return { ...c, conditions: has ? c.conditions.filter((x) => x !== condition) : [...c.conditions, condition] };
}

// Restore a saved state, dropping anything malformed.
export function normalizeState(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.combatants)) return emptyState();
    const combatants = raw.combatants.slice(0, LIMITS.maxCombatants).flatMap((c) => {
        if (!c || typeof c !== 'object' || typeof c.id !== 'string') return [];
        const base = createCombatant({ ...c, hp: c.maxHp, id: c.id });
        const hp = base.maxHp === null ? null : clampInt(c.hp, 0, base.maxHp, base.maxHp);
        const conditions = Array.isArray(c.conditions) ? c.conditions.filter((x) => CONDITIONS.includes(x)) : [];
        return [{ ...base, hp, conditions }];
    });
    if (!combatants.length) return emptyState();
    const round = clampInt(raw.round, 0, 9999, 0);
    const activeId = combatants.some((c) => c.id === raw.activeId) ? raw.activeId : null;
    return { combatants, round: activeId ? round : 0, activeId: round ? activeId : null };
}
