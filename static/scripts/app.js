// D&D Prompt Helper – cards page (ES module)
import {
    api, customData, createSource, parseCustomJson, ValidationError, downloadJson, MAX_FILE_BYTES,
    ICON_CHOICES, iconFor, userBuilds, newBuildId,
    savedRolls, newRollId, MAX_ROLL_NAME, MAX_SAVED_ROLLS,
    encodeShare, decodeShare, cleanBuild, cleanRoll, MAX_SHARE_LENGTH,
    DEFAULT_BUILD_ICON, MAX_BUILD_LINES, MIN_BUILD_LINES, MAX_TITLE_LENGTH,
} from './data.js';
import * as Dice from './dice.js';
import * as Init from './initiative.js';

{
    const HISTORY_KEY = 'dnd.history';
    const HIDDEN_KEY = 'dnd.hidden';
    const PINS_KEY = 'dnd.pins';
    const HISTORY_LIMIT = 10;
    const MIN_TEXT_SEARCH = 3;

    const QUICK_HASH = 'quick-builds';
    const QUICK_LABEL = 'Quick build';
    const DICE_HASH = 'dice';
    const DICE_KEY = 'dnd.dice';
    const INIT_HASH = 'initiative';
    const INIT_KEY = 'dnd.initiative';


    const $ = (id) => document.getElementById(id);
    const els = {
        nav: $('cat-nav-list'),
        content: $('content'),
        banner: $('data-banner'),
        customize: $('btn-customize'),
        search: $('search-input'),
        surprise: $('btn-surprise'),
        searchForm: $('search-form'),
        panel: $('result-panel'),
        crumb: $('result-crumb'),
        text: $('result-text'),
        reroll: $('btn-reroll'),
        copy: $('btn-copy'),
        pin: $('btn-pin'),
        share: $('btn-share'),
        collapse: $('result-collapse'),
        pinnedList: $('pinned-list'),
        pinnedEmpty: $('pinned-empty'),
        historyList: $('history-list'),
        historyEmpty: $('history-empty'),
        clearHistory: $('btn-clear-history'),
        modalKicker: $('entriesModalKicker'),
        modalTitle: $('entriesModalLabel'),
        modalList: $('entriesList'),
        modalFilter: $('entriesFilter'),
        modalCount: $('entriesCount'),
        toast: $('copy-toast'),
    };

    let source = null;        // ServerSource | LocalSource (see data.js)
    let serverStructure = []; // default tables, used for category icons/blurbs
    let custom = null;        // stored custom JSON record, or null
    let allStructure = [];    // every table in the active source
    let structure = [];       // visible tables only (hidden ones removed)
    let serverRecipes = [];   // built-in quick builds from the server
    let builds = [];          // the user's own quick builds (IndexedDB)
    let recipes = [];         // built-in + own builds
    let combos = [];          // recipes limited to parts whose tables are available
    let view = null;          // { type: 'category', name } | { type: 'combos' } | { type: 'search', q }
    let lastCategory = null;
    let current = null;       // { category, sub, text } or a combo: { comboId, category, sub, text, parts }
    let activeKey = null;     // "category|sub" of the last rolled table
    let rollSeq = 0;          // ignore stale roll responses
    let searchSeq = 0;        // ignore stale search responses

    // ---------- Storage (best-effort; page works without it) ----------
    function load(key) {
        try { return JSON.parse(localStorage.getItem(key)) || []; }
        catch { return []; }
    }
    function save(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
    }
    let history = load(HISTORY_KEY);
    let pins = load(PINS_KEY);
    let hidden = new Set(load(HIDDEN_KEY));

    // ---------- DOM helpers ----------
    function el(tag, attrs = {}, ...children) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (v === undefined || v === null || v === false) continue;
            if (k === 'class') node.className = v;
            else if (k === 'text') node.textContent = v;
            else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
            else node.setAttribute(k, v === true ? '' : v);
        }
        for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c);
        return node;
    }
    // Like node.replaceChildren(), but skips null/undefined/false (as el() does) instead of
    // inserting them as the text "null"
    function fill(node, ...children) {
        node.replaceChildren(...children.filter((c) => c !== null && c !== undefined && c !== false));
    }
    const icon = (name, cls = '') => el('i', { class: ('bi bi-' + name + ' ' + cls).trim(), 'aria-hidden': 'true' });
    const keyOf = (category, sub) => category + '|' + sub;
    const crumbOf = (item) => item.category + ' › ' + item.sub;
    const sameItem = (a, b) => a && b && a.category === b.category && a.sub === b.sub && a.text === b.text;
    const plural = (n, word, many = word + 's') => n.toLocaleString() + ' ' + (n === 1 ? word : many);
    const countLabel = (n) => plural(n, 'entry', 'entries');

    // Text with case-insensitive matches of `needle` wrapped in <mark> (safe: text nodes only)
    function highlight(text, needle) {
        const frag = document.createDocumentFragment();
        if (!needle) { frag.append(text); return frag; }
        const lower = text.toLowerCase();
        const n = needle.toLowerCase();
        let i = 0;
        for (let j = lower.indexOf(n); j !== -1; j = lower.indexOf(n, i)) {
            frag.append(text.slice(i, j), el('mark', { text: text.slice(j, j + n.length) }));
            i = j + n.length;
        }
        frag.append(text.slice(i));
        return frag;
    }

    let toastTimer;
    function toast(message) {
        els.toast.textContent = message;
        els.toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1600);
    }

    // ---------- Navigation ----------
    function navButton({ iconName, label, count, title, current, onclick, extraClass = '' }) {
        return el('li', {},
            el('button', {
                type: 'button',
                class: ('cat-btn ' + extraClass).trim(),
                'aria-current': current ? 'true' : 'false',
                title,
                onclick,
            },
                icon(iconName),
                el('span', { text: label }),
                count !== undefined ? el('span', { class: 'cat-count', text: count }) : null));
    }

    function renderNav() {
        const items = structure.map((cat) => navButton({
            iconName: cat.icon,
            label: cat.name,
            count: cat.subcategories.length,
            title: plural(cat.total, 'prompt'),
            current: view && view.type === 'category' && view.name === cat.name,
            onclick: () => goToCategory(cat.name),
        }));
        {
            items.push(el('li', { class: 'cat-nav-sep', 'aria-hidden': 'true' }));
            items.push(navButton({
                iconName: 'lightning-charge',
                label: 'Quick builds',
                count: combos.filter(isRollable).length,
                title: 'Roll several tables at once, or make your own',
                current: view && view.type === 'combos',
                onclick: goToCombos,
                extraClass: 'cat-btn-quick',
            }));
            items.push(el('li', { class: 'cat-nav-heading', text: 'Tools', 'aria-hidden': 'true' }));
            items.push(navButton({
                iconName: 'dice-3',
                label: 'Dice',
                title: 'Roll any dice: d4 to d100, modifiers, advantage',
                current: view && view.type === 'dice',
                onclick: goToDice,
                extraClass: 'cat-btn-tool',
            }));
            items.push(navButton({
                iconName: 'list-ol',
                label: 'Initiative',
                count: initState.combatants.length || undefined,
                title: 'Track turn order, HP and conditions in combat',
                current: view && view.type === 'initiative',
                onclick: goToInitiative,
                extraClass: 'cat-btn-tool',
            }));
        }
        fill(els.nav, ...items);
        const currentBtn = els.nav.querySelector('[aria-current="true"]');
        if (currentBtn) currentBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    function goToCategory(name) {
        if (els.search.value) els.search.value = '';
        const hash = '#' + encodeURIComponent(name);
        if (location.hash !== hash) history_replace(hash);
        setView({ type: 'category', name });
    }
    // Replace rather than push so the back button leaves the page instead of cycling tabs
    const history_replace = (hash) => window.history.replaceState(null, '', hash);

    function goToCombos() {
        if (els.search.value) els.search.value = '';
        if (location.hash !== '#' + QUICK_HASH) history_replace('#' + QUICK_HASH);
        setView({ type: 'combos' });
    }

    function goToInitiative() {
        if (els.search.value) els.search.value = '';
        if (location.hash !== '#' + INIT_HASH) history_replace('#' + INIT_HASH);
        setView({ type: 'initiative' });
    }

    function goToDice() {
        if (els.search.value) els.search.value = '';
        if (location.hash !== '#' + DICE_HASH) history_replace('#' + DICE_HASH);
        setView({ type: 'dice' });
    }

    // View named by the URL hash, or null if it doesn't match anything
    function viewFromHash() {
        const name = decodeURIComponent(location.hash.slice(1));
        if (name === QUICK_HASH) return { type: 'combos' };
        if (name === DICE_HASH) return { type: 'dice' };
        if (name === INIT_HASH) return { type: 'initiative' };
        return structure.some((c) => c.name === name) ? { type: 'category', name } : null;
    }

    function setView(next) {
        view = next;
        document.body.dataset.view = view.type; // lets CSS adapt per view (e.g. hide the result sheet on phones)
        if (view.type === 'category') lastCategory = view.name;
        renderNav();
        renderContent();
    }

    // First thing worth showing: the hash, the current view if still valid, else the first category
    function fallbackView() {
        const stillValid = view && (
            (view.type === 'category' && structure.some((c) => c.name === view.name)) ||
            view.type === 'combos' ||
            view.type === 'dice' ||
            view.type === 'initiative' ||
            view.type === 'search');
        if (stillValid) return view;
        if (structure.length) return { type: 'category', name: structure[0].name };
        if (builds.length) return { type: 'combos' };
        return { type: 'empty' };
    }

    // ---------- Content ----------
    function renderContent() {
        if (view.type === 'category') renderCategory(view.name);
        else if (view.type === 'combos') renderCombos();
        else if (view.type === 'dice') renderDice();
        else if (view.type === 'initiative') renderInitiative();
        else if (view.type === 'search') renderSearch(view.q);
        else renderEmpty();
    }

    function renderEmpty() {
        fill(els.content, 
            el('div', { class: 'empty-state empty-state-lg' },
                icon('eye-slash'),
                el('p', { text: 'Every table is hidden.' }),
                el('button', { type: 'button', class: 'btn-gold', onclick: openCustomize },
                    icon('sliders'), el('span', { text: 'Choose tables to show' }))));
    }

    function renderCategory(name) {
        const cat = structure.find((c) => c.name === name);
        fill(els.content, 
            el('div', { class: 'content-head content-head-split' },
                el('div', {},
                    el('div', { class: 'content-kicker', text: plural(cat.subcategories.length, 'table') + ' · ' + plural(cat.total, 'prompt') }),
                    el('h1', { class: 'content-title', text: cat.name }),
                    el('p', { class: 'content-blurb', text: cat.blurb })),
                el('button', {
                    type: 'button',
                    class: 'btn-outline-gold',
                    title: 'Roll on a random ' + cat.name + ' table',
                    onclick: () => rollRandomTable(cat),
                }, icon('shuffle'), el('span', { text: 'Roll any table' }))),
            el('div', { class: 'tiles' }, ...cat.subcategories.map((sub) => renderTile(cat.name, sub))));
    }

    function renderTile(category, sub, { showCategory = false, needle = '' } = {}) {
        return el('div', { class: 'tile' + (activeKey === keyOf(category, sub.name) ? ' active' : ''), 'data-key': keyOf(category, sub.name) },
            el('button', {
                type: 'button',
                class: 'tile-roll',
                title: 'Roll on ' + sub.name,
                onclick: () => roll(category, sub.name),
            },
                el('span', { class: 'tile-name' }, highlight(sub.name, needle)),
                el('span', { class: 'tile-meta' },
                    icon('dice-5'),
                    el('span', { text: (showCategory ? category + ' · ' : '') + countLabel(sub.count) }))),
            el('button', {
                type: 'button',
                class: 'tile-browse',
                title: 'Browse all ' + sub.name,
                'aria-label': 'Browse all ' + sub.name,
                onclick: () => showEntries(category, sub.name),
            }, icon('list-ul')));
    }

    function markActiveTile() {
        for (const tile of els.content.querySelectorAll('.tile, .combo-card')) {
            tile.classList.toggle('active', tile.dataset.key === activeKey);
        }
    }

    // ---------- Quick builds ----------
    const isRollable = (combo) => combo.parts.length >= MIN_BUILD_LINES;

    function renderCombos() {
        const builtIn = combos.filter((c) => !c.own);
        const own = combos.filter((c) => c.own);
        fill(els.content, 
            el('div', { class: 'content-head content-head-split' },
                el('div', {},
                    el('div', { class: 'content-kicker', text: plural(combos.filter(isRollable).length, 'generator') }),
                    el('h1', { class: 'content-title', text: 'Quick builds' }),
                    el('p', { class: 'content-blurb', text: 'Roll several tables at once for a ready-to-use NPC, tavern, town and more. Reroll any single line you don’t like, or make your own builds.' })),
                el('button', { type: 'button', class: 'btn-outline-gold', onclick: () => openBuilder() },
                    icon('plus-lg'), el('span', { text: 'New build' }))),
            el('h2', { class: 'section-label', text: 'Your builds' + (own.length ? ' (' + own.length + ')' : '') }),
            el('div', { class: 'combo-grid' },
                ...own.map(renderComboCard),
                el('button', { type: 'button', class: 'combo-card combo-new', onclick: () => openBuilder() },
                    el('span', { class: 'combo-icon' }, icon('plus-lg')),
                    el('span', { class: 'combo-title', text: 'New build' }),
                    el('span', { class: 'combo-blurb', text: own.length ? 'Pick tables to roll together.' : 'Pick the tables you always roll together, like a shopkeeper’s name, wares and quirk.' }))),
            builtIn.length ? el('h2', { class: 'section-label', text: 'Built-in' }) : null,
            builtIn.length ? el('div', { class: 'combo-grid' }, ...builtIn.map(renderComboCard)) : null);
    }

    function renderComboCard(combo) {
        const skipped = combo.totalParts - combo.parts.length;
        const rollable = isRollable(combo);
        return el('article', { class: 'combo-card' + (activeKey === 'combo|' + combo.id ? ' active' : '') + (rollable ? '' : ' is-disabled'), 'data-key': 'combo|' + combo.id },
            el('div', { class: 'combo-head' },
                el('span', { class: 'combo-icon' }, icon(combo.icon)),
                el('h2', { class: 'combo-title', text: combo.title }),
                combo.own ? el('span', { class: 'combo-badge', text: 'Yours' }) : null),
            combo.blurb ? el('p', { class: 'combo-blurb', text: combo.blurb }) : null,
            el('ul', { class: 'combo-parts' }, ...combo.parts.map((p) =>
                el('li', { title: p.category + ' › ' + p.sub, text: p.label }))),
            skipped ? el('p', { class: 'combo-warn' }, icon('exclamation-triangle'),
                ' ' + plural(skipped, 'line') + ' skipped: table hidden or missing' + (rollable ? '' : '. Needs at least ' + MIN_BUILD_LINES + ' available.')) : null,
            el('div', { class: 'combo-actions' },
                el('button', {
                    type: 'button',
                    class: 'btn-gold',
                    disabled: !rollable,
                    onclick: () => rollCombo(combo.id),
                }, icon('dice-5'), el('span', { text: 'Roll ' + combo.title.replace(/^Quick /, '') })),
                combo.own
                    ? el('span', { class: 'combo-tools' },
                        el('button', { type: 'button', class: 'icon-btn', title: 'Share a link to ' + combo.title, 'aria-label': 'Share ' + combo.title, onclick: () => shareBuild(combo.id) }, icon('link-45deg')),
                        el('button', { type: 'button', class: 'icon-btn', title: 'Edit ' + combo.title, 'aria-label': 'Edit ' + combo.title, onclick: () => openBuilder(combo.id) }, icon('pencil')))
                    : el('button', { type: 'button', class: 'icon-btn', title: 'Make your own version of ' + combo.title, 'aria-label': 'Make your own version of ' + combo.title, onclick: () => copyBuiltIn(combo.id) }, icon('copy'))));
    }

    const comboText = (parts) => parts.map((p) => p.label + ': ' + p.text).join('\n\n');

    function comboItem(id, title, parts) {
        return { comboId: id, category: QUICK_LABEL, sub: title, parts, text: comboText(parts) };
    }

    async function rollCombo(id) {
        const seq = ++rollSeq;
        activeKey = 'combo|' + id;
        markActiveTile();
        startRolling();
        try {
            const combo = combos.find((c) => c.id === id);
            if (!combo || !isRollable(combo)) throw new Error('not available');
            const texts = await Promise.all(combo.parts.map((p) => source.roll(p.category, p.sub)));
            if (seq !== rollSeq) return;
            const parts = combo.parts.map((p, i) => ({ ...p, text: texts[i] }));
            const item = comboItem(combo.id, combo.title, parts);
            showResult(item, { animate: true });
            addToHistory(item);
        } catch (err) {
            if (seq === rollSeq) showRollError(QUICK_LABEL, id, err);
        } finally {
            if (seq === rollSeq) els.panel.classList.remove('loading');
        }
    }

    async function rerollPart(index) {
        if (!current || !current.parts) return;
        const before = current;
        const part = before.parts[index];
        const row = els.text.querySelectorAll('.result-part')[index];
        if (row) row.classList.add('loading');
        try {
            const text = await source.roll(part.category, part.sub);
            if (current !== before) return; // something else was shown meanwhile
            const parts = before.parts.map((p, i) => (i === index ? { ...p, text } : p));
            const item = comboItem(before.comboId, before.sub, parts);
            history = history.map((h) => (sameItem(h, before) ? item : h));
            save(HISTORY_KEY, history);
            renderHistory();
            showResult(item, { animatePart: index });
        } catch (err) {
            if (row) row.classList.remove('loading');
            toast('Could not reroll (' + err.message + ')');
        }
    }

    // ---------- Initiative tracker ----------
    let initState = (() => {
        try { return Init.normalizeState(JSON.parse(localStorage.getItem(INIT_KEY))); }
        catch { return Init.emptyState(); }
    })();
    let initKind = 'npc';  // last type chosen in the add form
    let initUi = null;     // live references into the rendered view

    function saveInit() {
        try { localStorage.setItem(INIT_KEY, JSON.stringify(initState)); } catch { /* ignore */ }
    }

    // Apply a state change, save it and redraw the bar and list (the add form keeps its input)
    function initAction(fn, ...args) {
        initState = fn(initState, ...args);
        saveInit();
        renderInitBar();
        renderInitList();
        renderNav();
    }

    function rollInitiative(mod) {
        const notation = '1d20' + (mod ? (mod > 0 ? '+' : '') + mod : '');
        const r = Dice.roll(Dice.parse(notation));
        return { value: r.total, detail: Dice.describe(notation, r), nat20: r.nat20, nat1: r.nat1 };
    }

    function renderInitiative() {
        const bar = el('section', { class: 'dice-card init-bar', 'aria-live': 'polite' });
        const list = el('section', { class: 'init-list-wrap', 'aria-label': 'Turn order' });
        els.content.replaceChildren(
            el('div', { class: 'content-head' },
                el('div', { class: 'content-kicker', text: 'Tools' }),
                el('h1', { class: 'content-title', text: 'Initiative' }),
                el('p', { class: 'content-blurb', text: 'Add your party and the monsters, then step through turns. HP, AC and conditions are tracked for you, and everything is saved in this browser.' })),
            bar,
            renderInitForm(),
            list);
        initUi = { bar, list };
        renderInitBar();
        renderInitList();
    }

    function renderInitBar() {
        if (!initUi || view?.type !== 'initiative') return;
        const { round, activeId, combatants } = initState;
        const active = combatants.find((c) => c.id === activeId);
        const started = round > 0;
        fill(initUi.bar,
            el('div', { class: 'init-round' },
                el('span', { class: 'init-round-label', text: started ? 'Round' : 'Combat' }),
                el('span', { class: 'init-round-value', text: started ? round : 'Not started' })),
            el('div', { class: 'init-now' }, started && active
                ? el('span', {}, el('span', { class: 'init-now-label', text: 'Now: ' }), el('strong', { text: active.name }))
                : el('span', { class: 'init-now-label', text: combatants.length ? 'Ready when you are.' : 'Add combatants below to begin.' })),
            el('div', { class: 'init-controls' },
                started ? el('button', {
                    type: 'button', class: 'btn-outline-gold', title: 'Previous turn', 'aria-label': 'Previous turn',
                    onclick: () => initAction(Init.prevTurn),
                }, icon('chevron-left')) : null,
                el('button', {
                    type: 'button',
                    class: 'btn-gold',
                    disabled: !combatants.length,
                    title: started ? 'Next turn (N)' : 'Start combat (N)',
                    onclick: () => initAction(Init.nextTurn),
                }, icon(started ? 'chevron-right' : 'play-fill'), el('span', { text: started ? 'Next turn' : 'Start combat' })),
                started ? el('button', {
                    type: 'button', class: 'btn-outline-gold', title: 'End combat (keeps everyone, resets the round)',
                    onclick: () => initAction(Init.endCombat),
                }, icon('stop-fill'), el('span', { class: 'init-hide-sm', text: 'End' })) : null));
    }

    function renderInitForm() {
        const field = (label, input, cls = '') => el('label', { class: ('be-field ' + cls).trim() }, el('span', { text: label }), input);
        const num = (attrs) => el('input', { type: 'number', inputmode: 'numeric', class: 'be-input', ...attrs });
        const name = el('input', { type: 'text', class: 'be-input', maxlength: Init.LIMITS.maxName, placeholder: 'e.g. Goblin', autocomplete: 'off', required: true });
        const count = num({ min: 1, max: Init.LIMITS.maxCount, value: 1 });
        const mod = num({ min: -Init.LIMITS.maxMod, max: Init.LIMITS.maxMod, placeholder: '+0' });
        const init = num({ min: -Init.LIMITS.maxInit, max: Init.LIMITS.maxInit, placeholder: 'Roll' });
        const hp = num({ min: 1, max: Init.LIMITS.maxHp, placeholder: '—' });
        const ac = num({ min: 0, max: 99, placeholder: '—' });
        const error = el('p', { class: 'dice-error', role: 'alert' });
        const countField = field('How many', count, 'init-count');

        const kindButtons = [['pc', 'Player', 'person-fill'], ['npc', 'Monster', 'emoji-angry']].map(([value, text, ic]) =>
            el('button', {
                type: 'button', class: 'dice-mode-btn', 'data-kind': value,
                onclick: () => { initKind = value; syncKind(); name.focus(); },
            }, icon(ic), ' ', text));
        const syncKind = () => {
            for (const b of kindButtons) b.setAttribute('aria-pressed', String(b.dataset.kind === initKind));
            countField.hidden = initKind !== 'npc';
            name.placeholder = initKind === 'pc' ? 'e.g. Aria' : 'e.g. Goblin';
            init.placeholder = initKind === 'pc' ? 'Their roll' : 'Roll';
            init.title = initKind === 'pc' ? 'Type the player\'s roll, or leave blank to roll for them' : 'Leave blank to roll d20 + modifier';
        };

        const form = el('form', {
            class: 'dice-card init-form',
            novalidate: true,
            onsubmit: (e) => {
                e.preventDefault();
                error.textContent = '';
                const base = name.value.trim();
                if (!base) { error.textContent = 'Give them a name.'; name.focus(); return; }
                const room = Init.LIMITS.maxCombatants - initState.combatants.length;
                const n = initKind === 'npc' ? Math.min(Number(count.value) || 1, Init.LIMITS.maxCount) : 1;
                if (n > room) { error.textContent = room ? 'Only ' + room + ' more can join (max ' + Init.LIMITS.maxCombatants + ').' : 'The tracker is full (max ' + Init.LIMITS.maxCombatants + ').'; return; }
                const names = Init.numberedNames(base, n, initState.combatants.map((c) => c.name));
                const rolled = [];
                const added = names.map((nm) => {
                    const c = Init.createCombatant({ name: nm, kind: initKind, mod: mod.value, init: init.value, hp: hp.value, ac: ac.value });
                    if (c.init === null) { const r = rollInitiative(c.mod); c.init = r.value; rolled.push(r.value); }
                    return c;
                });
                initAction((st) => ({ ...st, combatants: [...st.combatants, ...added] }));
                const who = added.length > 1 ? added[0].name + '–' + added[added.length - 1].name.replace(base + ' ', '') : added[0].name;
                toast('Added ' + who + (rolled.length ? ' (rolled ' + rolled.join(', ') + ')' : ''));
                name.value = ''; init.value = ''; count.value = 1;
                name.focus();
            },
        },
            el('div', { class: 'init-form-head' },
                el('h2', { class: 'dice-card-title', text: 'Add to combat' }),
                el('div', { class: 'dice-mode-row', role: 'group', 'aria-label': 'Type' }, ...kindButtons)),
            el('div', { class: 'init-form-fields' },
                field('Name', name, 'init-name-field'),
                countField,
                field('Init mod', mod),
                field('Initiative', init),
                field('HP', hp),
                field('AC', ac),
                el('button', { type: 'submit', class: 'btn-gold init-add' }, icon('plus-lg'), el('span', { text: 'Add' }))),
            error);
        syncKind();
        return form;
    }

    function renderInitList() {
        if (!initUi || view?.type !== 'initiative') return;
        const order = Init.sortOrder(initState.combatants);
        if (!order.length) {
            fill(initUi.list, el('p', { class: 'empty-state', text: 'No one in combat yet. Add your party and the monsters above. Leave Initiative blank to roll d20 + modifier.' }));
            return;
        }
        const hasMonsters = order.some((c) => c.kind === 'npc');
        fill(initUi.list,
            el('ol', { class: 'init-list' }, ...order.map(renderInitRow)),
            el('div', { class: 'init-list-actions' },
                el('span', { class: 'init-hint' }, 'Press ', el('kbd', { text: 'N' }), ' for the next turn'),
                hasMonsters ? el('button', {
                    type: 'button', class: 'link-btn', title: 'Remove every monster and reset the round, keeping the party',
                    onclick: () => initAction((st) => ({ ...Init.endCombat(st), combatants: st.combatants.filter((c) => c.kind === 'pc') })),
                }, 'Remove monsters') : null,
                el('button', {
                    type: 'button', class: 'link-btn',
                    onclick: () => { if (window.confirm('Remove everyone from the tracker?')) initAction(() => Init.emptyState()); },
                }, 'Clear all')));
    }

    function renderInitRow(c) {
        const active = c.id === initState.activeId;
        const down = c.maxHp !== null && c.hp <= 0;
        const update = (fn) => initAction(Init.updateCombatant, c.id, fn);

        const score = el('input', {
            type: 'number', inputmode: 'numeric', class: 'init-score',
            'aria-label': 'Initiative for ' + c.name, title: 'Initiative (edit to change the order)',
            onchange: (e) => update((x) => ({ ...x, init: e.currentTarget.value === '' ? null : Init.createCombatant({ init: e.currentTarget.value }).init })),
        });
        score.value = c.init ?? '';

        const reroll = el('button', {
            type: 'button', class: 'icon-btn init-reroll', title: 'Roll initiative (d20 ' + (c.mod >= 0 ? '+ ' : '− ') + Math.abs(c.mod) + ')',
            'aria-label': 'Roll initiative for ' + c.name,
            onclick: () => {
                const r = rollInitiative(c.mod);
                update((x) => ({ ...x, init: r.value }));
                toast(c.name + ': ' + r.detail.replace(/^.*? = /, '') + (r.nat20 ? ' (natural 20!)' : r.nat1 ? ' (natural 1)' : ''));
            },
        }, icon('dice-5'));

        const condSelect = el('select', {
            class: 'init-cond-add', 'aria-label': 'Add a condition to ' + c.name,
            onchange: (e) => { const v = e.currentTarget.value; if (v) update((x) => Init.toggleCondition(x, v)); },
        }, el('option', { value: '', text: '+ Condition' }),
            ...Init.CONDITIONS.filter((x) => !c.conditions.includes(x)).map((x) => el('option', { value: x, text: x })));

        let hpBlock;
        if (c.maxHp === null) {
            hpBlock = el('div', { class: 'init-hp init-hp-none' }, el('span', { class: 'init-muted', text: 'HP not tracked' }));
        } else {
            const pct = Math.round((c.hp / c.maxHp) * 100);
            const amount = el('input', { type: 'number', inputmode: 'numeric', min: 1, class: 'init-hp-amount', placeholder: 'Amt', 'aria-label': 'Damage or healing for ' + c.name });
            const apply = (sign) => {
                const v = Math.abs(Math.trunc(Number(amount.value)));
                if (!v) { amount.focus(); return; }
                update((x) => Init.changeHp(x, sign * v));
            };
            hpBlock = el('form', {
                class: 'init-hp',
                onsubmit: (e) => { e.preventDefault(); apply(-1); },
            },
                el('div', { class: 'init-hp-top' },
                    el('span', { class: 'init-hp-text' }, el('strong', { text: c.hp }), ' / ' + c.maxHp),
                    el('div', { class: 'init-hp-bar', role: 'progressbar', 'aria-label': c.name + ' hit points', 'aria-valuemin': 0, 'aria-valuemax': c.maxHp, 'aria-valuenow': c.hp },
                        el('span', { class: 'init-hp-fill ' + (pct > 50 ? 'is-high' : pct > 25 ? 'is-mid' : 'is-low'), style: 'width:' + pct + '%' }))),
                el('div', { class: 'init-hp-edit' },
                    amount,
                    el('button', { type: 'submit', class: 'init-hp-btn is-dmg', title: 'Damage (Enter)', 'aria-label': 'Damage ' + c.name }, icon('dash-lg')),
                    el('button', { type: 'button', class: 'init-hp-btn is-heal', title: 'Heal', 'aria-label': 'Heal ' + c.name, onclick: () => apply(1) }, icon('plus-lg'))));
        }

        return el('li', { class: 'init-row is-' + c.kind + (active ? ' is-active' : '') + (down ? ' is-down' : ''), 'aria-current': active ? 'true' : null },
            el('div', { class: 'init-left' },
                el('span', { class: 'init-turn', 'aria-hidden': 'true' }, active ? icon('caret-right-fill') : null),
                score,
                reroll),
            el('div', { class: 'init-main' },
                el('div', { class: 'init-name-row' },
                    el('span', { class: 'init-kind', title: c.kind === 'pc' ? 'Player' : 'Monster' }, icon(c.kind === 'pc' ? 'person-fill' : 'emoji-angry')),
                    el('span', { class: 'init-name', text: c.name }),
                    c.ac !== null ? el('span', { class: 'init-badge', title: 'Armor Class' }, icon('shield-fill'), ' ' + c.ac) : null,
                    el('span', { class: 'init-mod', title: 'Initiative modifier', text: (c.mod >= 0 ? '+' : '−') + Math.abs(c.mod) }),
                    down ? el('span', { class: 'init-down', text: c.kind === 'pc' ? 'Down' : 'Defeated' }) : null),
                el('div', { class: 'init-conds' },
                    ...c.conditions.map((x) => el('button', {
                        type: 'button', class: 'init-cond', title: 'Remove ' + x, 'aria-label': 'Remove ' + x + ' from ' + c.name,
                        onclick: () => update((y) => Init.toggleCondition(y, x)),
                    }, x, icon('x'))),
                    condSelect)),
            hpBlock,
            el('button', {
                type: 'button', class: 'icon-btn init-remove', title: 'Remove ' + c.name, 'aria-label': 'Remove ' + c.name,
                onclick: () => initAction(Init.removeCombatant, c.id),
            }, icon('x-lg')));
    }

    // ---------- Dice ----------
    const DICE_EXAMPLES = [
        { notation: '1d20', hint: 'Check' },
        { notation: '2d6+3', hint: 'Shortsword' },
        { notation: '4d6kh3', hint: 'Ability score' },
        { notation: '8d6', hint: 'Fireball' },
        { notation: '1d20+1d4', hint: 'With Bless' },
        { notation: '1d100', hint: 'Percentile' },
    ];
    const MODE_LABELS = { normal: 'Normal', adv: 'Advantage', dis: 'Disadvantage' };

    function loadDiceSettings() {
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem(DICE_KEY)) || {}; } catch { /* ignore */ }
        const clamp = (v, lo, hi, d) => (Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d);
        return {
            count: clamp(saved.count, 1, 20, 1),
            mod: clamp(saved.mod, -20, 20, 0),
            mode: MODE_LABELS[saved.mode] ? saved.mode : 'normal',
        };
    }
    const diceSettings = loadDiceSettings();
    const saveDiceSettings = () => {
        try { localStorage.setItem(DICE_KEY, JSON.stringify(diceSettings)); } catch { /* ignore */ }
    };

    const signed = (n) => (n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '+0');
    const standardNotation = (sides) =>
        diceSettings.count + 'd' + sides + (diceSettings.mod ? (diceSettings.mod > 0 ? '+' : '') + diceSettings.mod : '');

    let diceUi = null; // live references into the rendered dice view

    function renderDice() {
        const stepper = (label, key, min, max, fmt) => {
            const value = el('output', { class: 'dice-step-value', 'aria-live': 'polite' });
            const dec = el('button', { type: 'button', class: 'dice-step-btn', 'aria-label': 'Decrease ' + label.toLowerCase(), onclick: () => step(key, -1, min, max) }, icon('dash-lg'));
            const inc = el('button', { type: 'button', class: 'dice-step-btn', 'aria-label': 'Increase ' + label.toLowerCase(), onclick: () => step(key, 1, min, max) }, icon('plus-lg'));
            return { node: el('div', { class: 'dice-step' }, el('span', { class: 'dice-control-label', text: label }), el('div', { class: 'dice-step-row' }, dec, value, inc)), value, dec, inc, fmt, key, min, max };
        };
        const count = stepper('Dice', 'count', 1, 20, (v) => '× ' + v);
        const mod = stepper('Modifier', 'mod', -20, 20, signed);

        const modeButtons = Object.entries(MODE_LABELS).map(([value, text]) => el('button', {
            type: 'button',
            class: 'dice-mode-btn',
            'aria-pressed': 'false',
            'data-mode': value,
            onclick: () => setDiceMode(value),
        }, text));

        const dieButtons = Dice.STANDARD_DICE.map((sides) => {
            const btn = el('button', {
                type: 'button',
                class: 'die-btn',
                'data-sides': sides,
                onclick: () => rollDice(standardNotation(sides)),
            },
                el('span', { class: 'die-shape die-d' + sides, 'aria-hidden': 'true' }, el('span', { text: sides === 100 ? '%' : sides })),
                el('span', { class: 'die-name', text: sides === 100 ? 'd100' : 'd' + sides }));
            return btn;
        });

        const input = el('input', {
            type: 'text',
            id: 'dice-input',
            class: 'be-input dice-input',
            placeholder: 'e.g. 2d6+3, 4d6kh3, 1d20+1d4',
            autocomplete: 'off',
            spellcheck: 'false',
            'aria-label': 'Dice to roll',
            'aria-describedby': 'dice-error',
        });
        const error = el('p', { class: 'dice-error', id: 'dice-error', role: 'alert' });
        const note = el('p', { class: 'dice-info', 'aria-live': 'polite' });
        const modeHint = el('p', { class: 'dice-mode-hint', 'aria-live': 'polite' });
        const savedCard = el('section', { class: 'dice-card saved-rolls', 'aria-labelledby': 'saved-rolls-title' });
        const form = el('form', {
            class: 'dice-form',
            onsubmit: (e) => { e.preventDefault(); if (rollDice(input.value)) input.select(); },
        }, input,
            el('button', { type: 'submit', class: 'btn-gold' }, icon('dice-5'), el('span', { text: 'Roll' })),
            el('button', {
                type: 'button',
                class: 'btn-outline-gold',
                title: 'Save this roll with a name',
                onclick: () => openRollEditor(null, { notation: input.value.trim(), mode: diceSettings.mode }),
            }, icon('bookmark-plus'), el('span', { class: 'dice-save-label', text: 'Save' })));

        fill(els.content, 
            el('div', { class: 'content-head' },
                el('div', { class: 'content-kicker', text: 'Tools' }),
                el('h1', { class: 'content-title', text: 'Dice' }),
                el('p', { class: 'content-blurb', text: 'Fair, cryptographically random rolls. Results land in the panel, so you can roll again, copy or pin them.' })),

            el('section', { class: 'dice-card' },
                el('div', { class: 'dice-buttons' }, ...dieButtons),
                el('div', { class: 'dice-controls' },
                    count.node,
                    mod.node,
                    el('div', { class: 'dice-mode' },
                        el('span', { class: 'dice-control-label', text: 'd20 rolls' }),
                        el('div', { class: 'dice-mode-row', role: 'group', 'aria-label': 'd20 roll mode' }, ...modeButtons))),
                modeHint),

            savedCard,

            el('section', { class: 'dice-card' },
                el('h2', { class: 'dice-card-title', text: 'Type any roll' }),
                form,
                error,
                note,
                el('span', { class: 'dice-control-label dice-examples-label', id: 'dice-examples-label', text: 'Examples' }),
                el('div', { class: 'dice-examples', role: 'group', 'aria-labelledby': 'dice-examples-label' }, ...DICE_EXAMPLES.map((ex) => el('button', {
                    type: 'button',
                    class: 'dice-example',
                    onclick: () => { input.value = ex.notation; rollDice(ex.notation); },
                }, el('code', { text: ex.notation }), el('span', { text: ex.hint })))),
                el('details', { class: 'dice-help' },
                    el('summary', { text: 'Notation guide' }),
                    el('dl', {},
                        el('dt', {}, el('code', { text: '2d6+3' })), el('dd', { text: 'Roll two six-sided dice and add 3. Combine any dice and numbers with + and −.' }),
                        el('dt', {}, el('code', { text: '4d6kh3' })), el('dd', { text: 'Roll four d6 and keep the highest three (kl keeps the lowest).' }),
                        el('dt', {}, el('code', { text: 'd%' })), el('dd', { text: 'Percentile die, the same as 1d100.' }),
                        el('dt', {}, el('span', { text: 'Advantage' })), el('dd', { text: 'With Advantage or Disadvantage selected, every single d20 in a roll is rolled twice, keeping the higher or lower.' })))));

        diceUi = { count, mod, modeButtons, dieButtons, input, error, note, modeHint, savedCard };
        updateDiceControls();
        renderSavedRolls();
    }

    // Advantage/disadvantage roll one d20 twice, so they only make sense with a single die
    function setDiceMode(mode) {
        diceSettings.mode = mode;
        if (mode !== 'normal') diceSettings.count = 1;
        saveDiceSettings();
        updateDiceControls();
    }

    function step(key, delta, min, max) {
        diceSettings[key] = Math.min(max, Math.max(min, diceSettings[key] + delta));
        if (key === 'count' && diceSettings.count > 1 && diceSettings.mode !== 'normal') {
            diceSettings.mode = 'normal'; // more than one die: back to a normal roll
            if (diceUi) diceUi.modeHint.textContent = 'Switched to Normal: advantage and disadvantage use a single d20.';
            saveDiceSettings();
            updateDiceControls(false);
            return;
        }
        saveDiceSettings();
        updateDiceControls();
    }

    function updateDiceControls(resetHint = true) {
        if (!diceUi) return;
        if (resetHint) {
            diceUi.modeHint.textContent = diceSettings.mode === 'adv'
                ? 'Rolls 2d20 and keeps the higher. Dice is set to 1.'
                : diceSettings.mode === 'dis' ? 'Rolls 2d20 and keeps the lower. Dice is set to 1.' : '';
        }
        for (const s of [diceUi.count, diceUi.mod]) {
            s.value.textContent = s.fmt(diceSettings[s.key]);
            s.dec.disabled = diceSettings[s.key] <= s.min;
            s.inc.disabled = diceSettings[s.key] >= s.max;
        }
        for (const b of diceUi.modeButtons) b.setAttribute('aria-pressed', String(b.dataset.mode === diceSettings.mode));
        for (const b of diceUi.dieButtons) {
            const notation = standardNotation(Number(b.dataset.sides));
            const withMode = Number(b.dataset.sides) === 20 && diceSettings.mode !== 'normal' ? ' with ' + MODE_LABELS[diceSettings.mode].toLowerCase() : '';
            b.title = 'Roll ' + notation + withMode;
            b.setAttribute('aria-label', 'Roll ' + notation + withMode);
        }
    }

    // Roll notation in the given mode (optionally under a saved roll's name). Returns true on success.
    function rollDice(notation, mode = diceSettings.mode, name = null) {
        let parsed;
        try {
            parsed = Dice.parse(notation);
        } catch (err) {
            if (!(err instanceof Dice.DiceError)) throw err;
            if (diceUi && view?.type === 'dice') diceUi.error.textContent = err.message;
            else toast(err.message);
            return false;
        }
        const { parsed: rolled, applied } = Dice.applyMode(parsed, mode);
        if (diceUi) {
            diceUi.error.textContent = '';
            diceUi.note.textContent = mode !== 'normal' && !applied
                ? MODE_LABELS[mode] + ' only applies to a single d20 (like 1d20+5), so this was rolled normally.'
                : '';
        }
        const base = Dice.format(parsed);
        const label = (name ? name + ' · ' : '') + base + (applied ? (mode === 'adv' ? ' (advantage)' : ' (disadvantage)') : '');
        const result = Dice.roll(rolled);
        const item = {
            kind: 'dice',
            category: 'Dice',
            sub: label,
            notation: base,
            mode: applied ? mode : 'normal',
            name: name || null,
            dice: result,
            text: Dice.describe(label, result),
        };
        ++rollSeq; // cancel any in-flight table roll
        activeKey = null;
        markActiveTile();
        els.panel.classList.remove('loading');
        restartAnimation('rolling');
        expandPanel();
        showResult(item, { animate: true });
        addToHistory(item);
        return true;
    }

    // ---------- Saved rolls ----------
    let rollList = [];   // [{ id, name, notation, mode }]
    let rollDraft = null; // { id | null, name, notation, mode } while the editor is open

    const MODE_SHORT = { adv: 'Adv', dis: 'Dis' };

    function renderSavedRolls() {
        if (!diceUi) return;
        const card = diceUi.savedCard;
        const full = rollList.length >= MAX_SAVED_ROLLS;
        fill(card, 
            el('div', { class: 'saved-rolls-head' },
                el('h2', { class: 'dice-card-title', id: 'saved-rolls-title' },
                    el('span', { text: 'Saved rolls' }),
                    rollList.length ? el('span', { class: 'saved-rolls-count', text: rollList.length }) : null),
                rollDraft ? null : el('button', {
                    type: 'button',
                    class: 'btn-outline-gold btn-sm-gold',
                    disabled: full,
                    title: full ? 'You can save up to ' + MAX_SAVED_ROLLS + ' rolls' : 'Save a roll you use often',
                    onclick: () => openRollEditor(),
                }, icon('plus-lg'), el('span', { text: 'New' }))),
            rollDraft ? renderRollEditor() : null,
            rollList.length
                ? el('ul', { class: 'saved-roll-list' }, ...rollList.map(renderSavedRoll))
                : (rollDraft ? null : el('p', { class: 'side-list-empty', text: 'Save the rolls you make all the time, like “Longsword attack: 1d20+5” or “Sneak attack: 3d6”, and roll them in one click.' })));
    }

    function renderSavedRoll(r) {
        const editing = rollDraft?.id === r.id;
        return el('li', { class: 'saved-roll' + (editing ? ' is-editing' : '') },
            el('button', {
                type: 'button',
                class: 'saved-roll-main',
                title: 'Roll ' + r.name + ' (' + r.notation + (r.mode !== 'normal' ? ', ' + MODE_LABELS[r.mode].toLowerCase() : '') + ')',
                onclick: () => rollDice(r.notation, r.mode, r.name),
            },
                el('span', { class: 'saved-roll-icon' }, icon('dice-5')),
                el('span', { class: 'saved-roll-text' },
                    el('span', { class: 'saved-roll-name', text: r.name }),
                    el('span', { class: 'saved-roll-meta' },
                        el('code', { text: r.notation }),
                        r.mode !== 'normal' ? el('span', { class: 'saved-roll-badge', text: MODE_SHORT[r.mode] }) : null))),
            el('button', { type: 'button', class: 'icon-btn', title: 'Share a link to ' + r.name, 'aria-label': 'Share ' + r.name, onclick: () => shareRoll(r.id) }, icon('link-45deg')),
            el('button', { type: 'button', class: 'icon-btn', title: 'Edit ' + r.name, 'aria-label': 'Edit ' + r.name, onclick: () => openRollEditor(r.id) }, icon('pencil')),
            el('button', { type: 'button', class: 'icon-btn', title: 'Delete ' + r.name, 'aria-label': 'Delete ' + r.name, onclick: () => deleteRoll(r.id) }, icon('trash')));
    }

    function openRollEditor(id = null, prefill = {}) {
        const existing = id ? rollList.find((r) => r.id === id) : null;
        if (!existing && rollList.length >= MAX_SAVED_ROLLS) {
            toast('You can save up to ' + MAX_SAVED_ROLLS + ' rolls');
            return;
        }
        rollDraft = existing
            ? { id: existing.id, name: existing.name, notation: existing.notation, mode: existing.mode }
            : { id: null, name: '', notation: prefill.notation || '', mode: prefill.mode || 'normal' };
        if (view?.type !== 'dice') goToDice();
        renderSavedRolls();
        const field = diceUi.savedCard.querySelector(rollDraft.name ? '#roll-notation' : '#roll-name');
        field?.focus();
        diceUi.savedCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function closeRollEditor() {
        rollDraft = null;
        renderSavedRolls();
    }

    function renderRollEditor() {
        const error = el('p', { class: 'dice-error', role: 'alert' });
        const nameInput = el('input', {
            type: 'text', id: 'roll-name', class: 'be-input', maxlength: MAX_ROLL_NAME, autocomplete: 'off',
            placeholder: 'e.g. Longsword attack', oninput: (e) => { rollDraft.name = e.currentTarget.value; },
        });
        nameInput.value = rollDraft.name;
        const notationInput = el('input', {
            type: 'text', id: 'roll-notation', class: 'be-input dice-input', autocomplete: 'off', spellcheck: 'false',
            placeholder: 'e.g. 1d20+5', oninput: (e) => { rollDraft.notation = e.currentTarget.value; },
        });
        notationInput.value = rollDraft.notation;
        const modeSelect = el('select', {
            id: 'roll-mode', class: 'be-input',
            onchange: (e) => { rollDraft.mode = e.currentTarget.value; },
        }, ...Object.entries(MODE_LABELS).map(([value, text]) => {
            const opt = el('option', { value, text });
            opt.selected = value === rollDraft.mode;
            return opt;
        }));

        return el('form', {
            class: 'saved-roll-editor',
            novalidate: true,
            onsubmit: (e) => { e.preventDefault(); saveRollDraft(error); },
            onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeRollEditor(); } },
        },
            el('div', { class: 'saved-roll-fields' },
                el('label', { class: 'be-field' }, el('span', { text: 'Name' }), nameInput),
                el('label', { class: 'be-field' }, el('span', { text: 'Roll' }), notationInput),
                el('label', { class: 'be-field' }, el('span', { text: 'd20 rolls' }), modeSelect)),
            error,
            el('div', { class: 'saved-roll-actions' },
                el('button', { type: 'button', class: 'btn-outline-gold btn-sm-gold', onclick: closeRollEditor }, 'Cancel'),
                el('button', { type: 'submit', class: 'btn-gold btn-sm-gold' }, icon('check-lg'), el('span', { text: rollDraft.id ? 'Save changes' : 'Save roll' }))));
    }

    async function saveRollDraft(errorEl) {
        const name = rollDraft.name.trim();
        const notation = rollDraft.notation.trim();
        const fail = (msg, fieldId) => {
            errorEl.textContent = msg;
            diceUi.savedCard.querySelector('#' + fieldId)?.focus();
        };
        if (!name) return fail('Give the roll a name.', 'roll-name');
        let parsed;
        try {
            parsed = Dice.parse(notation);
        } catch (err) {
            if (!(err instanceof Dice.DiceError)) throw err;
            return fail(err.message, 'roll-notation');
        }
        if (rollDraft.mode !== 'normal' && !Dice.applyMode(parsed, rollDraft.mode).applied) {
            return fail(MODE_LABELS[rollDraft.mode] + ' needs a single d20 in the roll, like 1d20+5.', 'roll-mode');
        }
        const now = new Date().toISOString();
        const existing = rollDraft.id ? rollList.find((r) => r.id === rollDraft.id) : null;
        const record = {
            id: existing ? existing.id : newRollId(),
            name: name.slice(0, MAX_ROLL_NAME),
            notation: Dice.format(parsed),
            mode: rollDraft.mode,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        };
        const next = existing ? rollList.map((r) => (r.id === record.id ? record : r)) : [...rollList, record];
        try {
            await savedRolls.save(next);
        } catch (err) {
            return fail('Could not save in this browser: ' + (err.message || err), 'roll-name');
        }
        rollList = next;
        rollDraft = null;
        renderSavedRolls();
        toast((existing ? 'Saved changes to “' : 'Saved “') + record.name + '”');
    }

    async function deleteRoll(id) {
        const r = rollList.find((x) => x.id === id);
        if (!r || !window.confirm('Delete the saved roll “' + r.name + '”?')) return;
        const next = rollList.filter((x) => x.id !== id);
        try {
            await savedRolls.save(next);
        } catch (err) {
            toast('Could not delete (' + (err.message || err) + ')');
            return;
        }
        rollList = next;
        if (rollDraft?.id === id) rollDraft = null;
        renderSavedRolls();
        toast('Deleted “' + r.name + '”');
    }

    // ---------- Dice inside prompt text ----------
    // "Lasts 1d4 hours" -> "Lasts [🎲 1d4] hours"; clicking rolls it in place (not added to history).
    function withInlineDice(text) {
        const frag = document.createDocumentFragment();
        let i = 0;
        for (const d of Dice.findInlineDice(text)) {
            frag.append(text.slice(i, d.index), inlineDieButton(d));
            i = d.index + d.length;
        }
        frag.append(text.slice(i));
        return frag;
    }

    function inlineDieButton(d) {
        const what = d.notation + (d.multiplier > 1 ? ' × ' + d.multiplier.toLocaleString() : '');
        const total = el('span', { class: 'inline-die-total', 'aria-live': 'polite' });
        const btn = el('button', {
            type: 'button',
            class: 'inline-die',
            title: 'Roll ' + what,
            'aria-label': 'Roll ' + what,
        }, icon('dice-5'), el('span', { text: d.text }), total);
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const r = Dice.roll(Dice.parse(d.notation));
            const value = r.total * d.multiplier;
            total.textContent = '= ' + value.toLocaleString();
            btn.classList.add('is-rolled');
            btn.classList.toggle('is-crit', r.nat20);
            btn.classList.toggle('is-fumble', r.nat1);
            const detail = Dice.describe(d.notation, r) + (d.multiplier > 1 ? ' × ' + d.multiplier.toLocaleString() + ' = ' + value.toLocaleString() : '');
            btn.title = detail + ' (click to roll again)';
            btn.setAttribute('aria-label', 'Rolled ' + what + ': ' + value.toLocaleString() + '. Roll again');
            total.classList.remove('pop');
            void total.offsetWidth;
            total.classList.add('pop');
        });
        return btn;
    }

    function renderDiceResult(r) {
        const op = (t, i) => (i === 0 ? (t.sign < 0 ? '−' : '') : (t.sign < 0 ? '−' : '+'));
        return el('div', { class: 'dice-result' + (r.nat20 ? ' is-crit' : '') + (r.nat1 ? ' is-fumble' : '') },
            el('div', { class: 'dice-total', text: r.total }),
            el('div', { class: 'dice-breakdown' }, ...r.terms.map((t, i) => {
                if (t.kind === 'const') return el('span', { class: 'dice-const', text: op(t, i) + t.value });
                return el('span', { class: 'dice-term' },
                    op(t, i) ? el('span', { class: 'dice-op', text: op(t, i) }) : null,
                    el('span', { class: 'dice-term-label', text: Dice.formatTerm(t) + (t.fromMode ? (t.fromMode === 'adv' ? ' adv' : ' dis') : '') }),
                    ...t.rolls.map((d) => el('span', {
                        class: 'die-chip'
                            + (d.kept ? '' : ' is-dropped')
                            + (t.sides === 20 && d.kept && d.value === 20 ? ' is-20' : '')
                            + (t.sides === 20 && d.kept && d.value === 1 ? ' is-1' : ''),
                        title: d.kept ? null : 'Dropped',
                        text: d.value,
                    })));
            })),
            r.nat20 ? el('div', { class: 'dice-note', text: 'Natural 20!' })
                : r.nat1 ? el('div', { class: 'dice-note', text: 'Natural 1…' }) : null);
    }

    // ---------- Search ----------
    function renderSearch(q) {
        const needle = q.trim();
        const lower = needle.toLowerCase();
        const tableHits = [];
        for (const cat of structure) {
            for (const sub of cat.subcategories) {
                if (sub.name.toLowerCase().includes(lower)) tableHits.push([cat.name, sub]);
            }
        }

        const promptSection = el('div', {}, el('p', { class: 'loading', text: 'Searching prompts…' }));
        fill(els.content, 
            el('div', { class: 'content-head' },
                el('div', { class: 'content-kicker', text: 'Search' }),
                el('h1', { class: 'content-title', text: '“' + needle + '”' })),
            el('h2', { class: 'section-label', text: 'Tables (' + tableHits.length + ')' }),
            tableHits.length
                ? el('div', { class: 'tiles' }, ...tableHits.map(([c, s]) => renderTile(c, s, { showCategory: true, needle })))
                : el('p', { class: 'empty-state', text: 'No table names match.' }),
            el('h2', { class: 'section-label', text: 'Prompts' }),
            promptSection);

        if (needle.length < MIN_TEXT_SEARCH) {
            fill(promptSection, el('p', { class: 'side-list-empty', text: 'Type at least ' + MIN_TEXT_SEARCH + ' letters to search inside prompts.' }));
            return;
        }

        const seq = ++searchSeq;
        const anyHidden = allStructure.some((c) => c.subcategories.some((s) => hidden.has(keyOf(c.name, s.name))));
        source.search(needle, anyHidden ? 200 : 50)
            .then(({ total, results }) => {
                if (seq !== searchSeq) return;
                if (anyHidden) {
                    // Hidden tables are filtered here, so the exact total isn't known
                    const more = total > results.length;
                    results = results.filter((r) => !hidden.has(keyOf(r.category, r.sub)));
                    total = results.length + (more ? 1 : 0);
                    results = results.slice(0, 50);
                }
                promptSection.previousSibling.textContent = 'Prompts (' + total.toLocaleString() + ')';
                if (!results.length) {
                    fill(promptSection, el('p', { class: 'empty-state', text: 'No prompts contain “' + needle + '”.' }));
                    return;
                }
                fill(promptSection, 
                    el('ul', { class: 'prompt-hits' }, ...results.map((r) => {
                        const item = { category: r.category, sub: r.sub, text: r.text };
                        return el('li', {}, el('button', {
                            type: 'button',
                            class: 'prompt-hit',
                            onclick: () => { showResult(item, { animate: true }); expandPanel(); },
                        }, el('span', { class: 'hit-crumb', text: crumbOf(item) + ' · #' + (r.index + 1) }), highlight(r.text, needle)));
                    })),
                    total > results.length
                        ? el('p', { class: 'side-list-empty mt-2', text: 'Showing the first ' + results.length + ' of ' + total.toLocaleString() + '. Try a more specific search.' })
                        : null);
            })
            .catch((err) => {
                if (seq !== searchSeq) return;
                fill(promptSection, el('p', { class: 'empty-state', text: 'Search failed (' + err.message + ').' }));
            });
    }

    let searchTimer;
    els.search.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            const q = els.search.value.trim();
            if (q) setView({ type: 'search', q });
            else if (lastCategory) setView({ type: 'category', name: lastCategory });
        }, 200);
    });
    els.searchForm.addEventListener('submit', (e) => e.preventDefault());
    els.search.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            els.search.value = '';
            els.search.dispatchEvent(new Event('input'));
            els.search.blur();
        }
    });

    // ---------- Rolling ----------
    async function roll(category, sub) {
        const seq = ++rollSeq;
        activeKey = keyOf(category, sub);
        markActiveTile();
        startRolling();
        try {
            const text = await source.roll(category, sub);
            if (seq !== rollSeq) return;
            const item = { category, sub, text };
            showResult(item, { animate: true });
            addToHistory(item);
        } catch (err) {
            if (seq === rollSeq) showRollError(category, sub, err);
        } finally {
            if (seq === rollSeq) els.panel.classList.remove('loading');
        }
    }

    function startRolling() {
        els.panel.classList.add('loading');
        restartAnimation('rolling');
        expandPanel();
    }

    function showRollError(category, sub, err) {
        els.crumb.textContent = category + ' › ' + sub;
        els.text.textContent = 'The dice rolled off the table (' + err.message + '). Try again.';
        els.text.className = 'result-text is-error';
    }

    function addToHistory(item) {
        history = [item, ...history.filter((h) => !sameItem(h, item))].slice(0, HISTORY_LIMIT);
        save(HISTORY_KEY, history);
        renderHistory();
    }

    // Uniform over tables (not entries), so small tables come up as often as big ones
    function rollRandomTable(cat) {
        const tables = (cat ? [cat] : structure).flatMap((c) => c.subcategories.map((s) => [c.name, s.name]));
        if (!tables.length) return;
        const [category, sub] = tables[Math.floor(Math.random() * tables.length)];
        roll(category, sub);
    }
    els.surprise.addEventListener('click', () => rollRandomTable());

    function restartAnimation(cls) {
        els.panel.classList.remove(cls);
        void els.panel.offsetWidth; // reflow so the animation can replay
        els.panel.classList.add(cls);
    }

    function showResult(item, { animate = false, animatePart = -1 } = {}) {
        current = item;
        els.crumb.textContent = crumbOf(item);
        els.text.className = 'result-text';
        if (item.dice) {
            fill(els.text, renderDiceResult(item.dice));
        } else if (item.parts) {
            fill(els.text, el('dl', { class: 'result-parts' }, ...item.parts.map((p, i) =>
                el('div', { class: 'result-part' + (i === animatePart ? ' revealed' : '') },
                    el('dt', {},
                        el('span', { text: p.label }),
                        el('button', {
                            type: 'button',
                            class: 'part-reroll',
                            title: 'Reroll ' + p.label.toLowerCase(),
                            'aria-label': 'Reroll ' + p.label.toLowerCase(),
                            onclick: () => rerollPart(i),
                        }, icon('arrow-repeat'))),
                    el('dd', {}, withInlineDice(p.text))))));
        } else {
            fill(els.text, withInlineDice(item.text));
        }
        if (animate) restartAnimation('revealed');
        els.reroll.disabled = els.copy.disabled = els.pin.disabled = els.share.disabled = false;
        updatePinButton();
    }

    // ---------- Share links ----------
    // Everything travels in the URL after "#", so nothing is uploaded or stored on the server.
    const shareUrlFor = (payload) => {
        const token = encodeShare(payload);
        return token.length > MAX_SHARE_LENGTH ? null : location.origin + '/cards#share=' + token;
    };

    async function shareLink(payload, title) {
        const url = shareUrlFor(payload);
        if (!url) { toast('That’s too long to share as a link'); return; }
        if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
            try { await navigator.share({ title, url }); return; }
            catch (err) { if (err?.name === 'AbortError') return; }
        }
        try {
            await copyText(url);
            toast('Link copied. Anyone with it can open it');
        } catch {
            window.prompt('Copy this link:', url);
        }
    }

    function shareBuild(id) {
        const b = builds.find((x) => x.id === id);
        if (b) shareLink({ type: 'build', build: { title: b.title, icon: b.icon, parts: b.parts } }, b.title);
    }

    function shareRoll(id) {
        const r = rollList.find((x) => x.id === id);
        if (r) shareLink({ type: 'roll', roll: { name: r.name, notation: r.notation, mode: r.mode } }, r.name);
    }

    function resultPayload(item) {
        if (item.kind === 'dice') {
            const values = item.dice.terms.flatMap((t) => (t.rolls ? t.rolls.map((d) => d.value) : []));
            return { type: 'result', result: { kind: 'dice', notation: item.notation, mode: item.mode, name: item.name || null, values } };
        }
        if (item.parts) {
            return { type: 'result', result: { kind: 'build', title: item.sub, icon: combos.find((c) => c.id === item.comboId)?.icon, parts: item.parts.map(({ label, category, sub, text }) => ({ label, category, sub, text })) } };
        }
        return { type: 'result', result: { kind: 'prompt', category: item.category, sub: item.sub, text: item.text } };
    }
    els.share.addEventListener('click', () => current && shareLink(resultPayload(current), crumbOf(current)));

    // Opening a link: #share=<token>
    function takeShareToken() {
        if (!location.hash.startsWith('#share=')) return null;
        const token = location.hash.slice('#share='.length);
        window.history.replaceState(null, '', location.pathname + location.search);
        return token;
    }

    const shareModalEl = $('shareModal');
    const shareModal = new bootstrap.Modal(shareModalEl);
    const shareUi = { title: $('shareModalLabel'), body: $('share-body'), accept: $('share-accept') };

    // No acceptLabel (e.g. already saved, or the list is full) means preview only, no button
    function openShareModal(title, body, acceptLabel, onAccept) {
        if (!acceptLabel) onAccept = null;
        shareUi.title.textContent = title;
        fill(shareUi.body, ...body);
        shareUi.accept.hidden = !onAccept;
        shareUi.accept.disabled = !onAccept;
        fill(shareUi.accept, ...(acceptLabel ? [icon('plus-lg'), ' ', acceptLabel] : []));
        shareUi.accept.onclick = onAccept ? async () => { shareUi.accept.disabled = true; if (await onAccept() !== false) shareModal.hide(); else shareUi.accept.disabled = false; } : null;
        shareModal.show();
    }

    const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
    const tableExists = (category, sub) => allStructure.some((c) => c.name === category && c.subcategories.some((s) => s.name === sub));

    function handleShareToken(token) {
        const data = decodeShare(token);
        if (!data) { toast('That share link couldn’t be read'); return; }
        if (data.type === 'build') return previewSharedBuild(data.build);
        if (data.type === 'roll') return previewSharedRoll(data.roll);
        if (data.type === 'result') return showSharedResult(data.result);
        toast('That share link couldn’t be read');
    }

    function previewSharedBuild(raw) {
        const b = cleanBuild({ ...(raw || {}), id: 'shared' });
        if (!b) { toast('That shared build couldn’t be read'); return; }
        const missing = b.parts.filter((p) => !tableExists(p.category, p.sub)).length;
        const dupe = builds.some((x) => x.title === b.title && JSON.stringify(x.parts) === JSON.stringify(b.parts));
        openShareModal('Quick build: ' + b.title, [
            el('div', { class: 'share-preview' },
                el('span', { class: 'combo-icon' }, icon(b.icon)),
                el('ol', { class: 'share-lines' }, ...b.parts.map((p) => el('li', {},
                    el('strong', { text: p.label }),
                    el('span', { class: 'share-line-table', text: p.category + ' › ' + p.sub }),
                    tableExists(p.category, p.sub) ? null : el('span', { class: 'share-missing', text: 'not in your tables' }))))),
            missing ? el('p', { class: 'dice-info', text: plural(missing, 'line') + ' use tables you don’t have, so they’ll be skipped when rolling.' }) : null,
            dupe ? el('p', { class: 'side-list-empty', text: 'You already have this build.' }) : null,
        ], dupe ? null : 'Add to my builds', async () => {
            const now = new Date().toISOString();
            const record = { ...b, id: newBuildId(), createdAt: now, updatedAt: now };
            if (!(await saveBuilds([...builds, record]))) { toast('Could not save the build in this browser'); return false; }
            activeKey = 'combo|' + record.id;
            goToCombos();
            toast('Added “' + record.title + '” to your builds');
        });
    }

    function previewSharedRoll(raw) {
        const r = cleanRoll({ ...(raw || {}), id: 'shared' });
        if (!r) { toast('That shared roll couldn’t be read'); return; }
        const dupe = rollList.some((x) => x.name === r.name && x.notation === r.notation && x.mode === r.mode);
        const full = rollList.length >= MAX_SAVED_ROLLS;
        openShareModal('Saved roll: ' + r.name, [
            el('div', { class: 'share-preview' },
                el('span', { class: 'saved-roll-icon' }, icon('dice-5')),
                el('div', {},
                    el('code', { class: 'share-notation', text: r.notation }),
                    r.mode !== 'normal' ? el('span', { class: 'saved-roll-badge', text: MODE_LABELS[r.mode] }) : null)),
            dupe ? el('p', { class: 'side-list-empty', text: 'You already have this roll.' }) : null,
            full ? el('p', { class: 'dice-info', text: 'Your saved rolls are full (' + MAX_SAVED_ROLLS + '). Delete one to add this.' }) : null,
        ], dupe || full ? null : 'Add to my rolls', async () => {
            const now = new Date().toISOString();
            const record = { ...r, id: newRollId(), createdAt: now, updatedAt: now };
            const next = [...rollList, record];
            try { await savedRolls.save(next); } catch { toast('Could not save the roll in this browser'); return false; }
            rollList = next;
            goToDice();
            toast('Added “' + record.name + '” to your saved rolls');
        });
    }

    function showSharedResult(r) {
        if (!r || typeof r !== 'object') { toast('That shared result couldn’t be read'); return; }
        let item = null;
        if (r.kind === 'prompt') {
            const category = text(r.category, 120), sub = text(r.sub, 200), body = text(r.text, 5000);
            if (category && sub && body) item = { category, sub, text: body };
        } else if (r.kind === 'build' && Array.isArray(r.parts) && r.parts.length <= MAX_BUILD_LINES) {
            const parts = r.parts.map((p) => ({ label: text(p?.label, 40), category: text(p?.category, 120), sub: text(p?.sub, 200), text: text(p?.text, 5000) }));
            const title = text(r.title, MAX_TITLE_LENGTH);
            if (title && parts.length && parts.every((p) => p.label && p.category && p.sub && p.text)) {
                const match = combos.find((c) => c.title === title);
                item = comboItem(match ? match.id : null, title, parts);
            }
        } else if (r.kind === 'dice') {
            item = sharedDiceItem(r);
        }
        if (!item) { toast('That shared result couldn’t be read'); return; }
        showResult(item, { animate: true });
        expandPanel();
        toast('Shared with you: ' + crumbOf(item));
    }

    // Rebuild a shared dice roll from its notation and the exact die values, so it shows the same total
    function sharedDiceItem(r) {
        const mode = ['adv', 'dis'].includes(r.mode) ? r.mode : 'normal';
        const name = text(r.name, MAX_ROLL_NAME);
        let parsed;
        try { parsed = Dice.parse(r.notation); } catch { return null; }
        const { parsed: rolled, applied } = Dice.applyMode(parsed, mode);
        const values = Array.isArray(r.values) ? r.values : [];
        let i = 0, ok = true;
        const result = Dice.roll(rolled, (sides) => {
            const v = values[i++];
            if (!Number.isInteger(v) || v < 1 || v > sides) ok = false;
            return ok ? v : 1;
        });
        if (!ok || i !== values.length) return null;
        const base = Dice.format(parsed);
        const label = (name ? name + ' · ' : '') + base + (applied ? (mode === 'adv' ? ' (advantage)' : ' (disadvantage)') : '');
        return { kind: 'dice', category: 'Dice', sub: label, notation: base, mode: applied ? mode : 'normal', name, dice: result, text: Dice.describe(label, result) };
    }

    // ---------- Result actions ----------
    const rollAgain = () => {
        if (!current) return;
        if (current.kind === 'dice') rollDice(current.notation, current.mode, current.name);
        else if (current.parts) {
            if (current.comboId && combos.some((c) => c.id === current.comboId)) rollCombo(current.comboId);
            else toast('Add this build to your builds to roll it again');
        } else roll(current.category, current.sub);
    };
    els.reroll.addEventListener('click', rollAgain);

    els.copy.addEventListener('click', () => current && copyAndToast(current.text));

    async function copyAndToast(text) {
        try {
            await copyText(text);
            toast('Copied to clipboard');
        } catch {
            toast('Could not copy');
        }
    }

    async function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            try { return await navigator.clipboard.writeText(text); }
            catch { /* blocked (e.g. permissions policy) – fall back below */ }
        }
        const area = el('textarea', { style: 'position:fixed;opacity:0' });
        area.value = text;
        document.body.append(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        if (!ok) throw new Error('copy failed');
    }

    els.pin.addEventListener('click', () => current && togglePin(current));

    const isPinned = (item) => pins.some((p) => sameItem(p, item));

    function togglePin(item) {
        pins = isPinned(item) ? pins.filter((p) => !sameItem(p, item)) : [{ ...item }, ...pins];
        save(PINS_KEY, pins);
        renderPins();
        renderHistory();
        updatePinButton();
        return isPinned(item);
    }

    function updatePinButton() {
        const pinned = !!current && isPinned(current);
        els.pin.querySelector('span').textContent = pinned ? 'Pinned' : 'Pin';
        els.pin.querySelector('i').className = 'bi ' + (pinned ? 'bi-pin-angle-fill' : 'bi-pin-angle');
        els.pin.classList.toggle('is-on', pinned);
    }

    // Keyboard: R = roll again, / = focus search (ignored while typing or with a modal open)
    document.addEventListener('keydown', (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
        if (document.querySelector('.modal.show')) return;
        if (e.key === '/') {
            e.preventDefault();
            els.search.focus();
        } else if (e.key.toLowerCase() === 'r' && current) {
            e.preventDefault();
            rollAgain();
        } else if (e.key.toLowerCase() === 's' && structure.length) {
            e.preventDefault();
            rollRandomTable();
        } else if (e.key.toLowerCase() === 'n' && view?.type === 'initiative') {
            e.preventDefault();
            initAction(Init.nextTurn);
        }
    });

    // ---------- Mobile collapse ----------
    function setCollapsed(collapsed) {
        els.panel.classList.toggle('collapsed', collapsed);
        document.body.classList.toggle('result-collapsed', collapsed);
        els.collapse.setAttribute('aria-expanded', String(!collapsed));
        els.collapse.setAttribute('aria-label', collapsed ? 'Expand result' : 'Collapse result');
    }
    const expandPanel = () => setCollapsed(false);
    els.collapse.addEventListener('click', () => setCollapsed(!els.panel.classList.contains('collapsed')));

    // ---------- Pinned & history lists ----------
    function renderSideItem(item, action) {
        return el('li', { class: 'side-item' },
            el('button', {
                type: 'button',
                class: 'side-item-body',
                title: 'Show this prompt',
                onclick: () => { showResult(item, { animate: true }); expandPanel(); },
            },
                el('span', { class: 'side-item-crumb', text: crumbOf(item) }),
                el('span', { class: 'side-item-text', text: item.text })),
            el('button', {
                type: 'button',
                class: 'icon-btn' + (action.on ? ' is-on' : ''),
                title: action.label,
                'aria-label': action.label,
                onclick: action.run,
            }, icon(action.icon)));
    }

    function renderPins() {
        fill(els.pinnedList, ...pins.map((p) =>
            renderSideItem(p, { icon: 'x-lg', label: 'Unpin', run: () => togglePin(p) })));
        els.pinnedEmpty.hidden = pins.length > 0;
    }

    function renderHistory() {
        fill(els.historyList, ...history.map((h) => {
            const pinned = isPinned(h);
            return renderSideItem(h, {
                icon: pinned ? 'pin-angle-fill' : 'pin-angle',
                label: pinned ? 'Unpin' : 'Pin',
                on: pinned,
                run: () => togglePin(h),
            });
        }));
        els.historyEmpty.hidden = history.length > 0;
        els.clearHistory.hidden = history.length === 0;
    }

    els.clearHistory.addEventListener('click', () => {
        history = [];
        save(HISTORY_KEY, history);
        renderHistory();
    });

    // ---------- Entries modal ----------
    const modalEl = $('entriesModal');
    const modal = new bootstrap.Modal(modalEl);
    let modalTable = null; // { category, sub, entries }

    async function showEntries(category, sub) {
        modalTable = { category, sub, entries: [] };
        els.modalKicker.textContent = category;
        els.modalTitle.textContent = sub;
        els.modalFilter.value = '';
        els.modalCount.textContent = '';
        fill(els.modalList, el('li', { class: 'text-body-secondary', text: 'Loading…' }));
        modal.show();
        try {
            const entries = await source.entries(category, sub);
            if (!modalTable || modalTable.category !== category || modalTable.sub !== sub) return;
            modalTable.entries = entries;
            renderEntries();
        } catch (err) {
            fill(els.modalList, el('li', { class: 'text-danger', text: 'Could not load entries (' + err.message + ').' }));
        }
    }

    function renderEntries() {
        const { category, sub, entries } = modalTable;
        const needle = els.modalFilter.value.trim();
        const lower = needle.toLowerCase();
        const rows = [];
        entries.forEach((text, i) => {
            if (lower && !text.toLowerCase().includes(lower)) return;
            const item = { category, sub, text };
            const pinned = isPinned(item);
            rows.push(el('li', { value: i + 1 },
                el('div', { class: 'entry-row' },
                    el('button', {
                        type: 'button',
                        class: 'entry-text',
                        title: 'Show in the result panel',
                        onclick: () => { showResult(item, { animate: true }); expandPanel(); modal.hide(); },
                    }, highlight(text, needle)),
                    el('div', { class: 'entry-actions' },
                        el('button', {
                            type: 'button', class: 'icon-btn', title: 'Copy', 'aria-label': 'Copy entry ' + (i + 1),
                            onclick: () => copyAndToast(text),
                        }, icon('clipboard')),
                        el('button', {
                            type: 'button', class: 'icon-btn' + (pinned ? ' is-on' : ''),
                            title: pinned ? 'Unpin' : 'Pin', 'aria-label': (pinned ? 'Unpin' : 'Pin') + ' entry ' + (i + 1),
                            onclick: (e) => {
                                const on = togglePin(item);
                                const btn = e.currentTarget;
                                btn.classList.toggle('is-on', on);
                                btn.title = on ? 'Unpin' : 'Pin';
                                fill(btn, icon(on ? 'pin-angle-fill' : 'pin-angle'));
                            },
                        }, icon(pinned ? 'pin-angle-fill' : 'pin-angle'))))));
        });
        fill(els.modalList, ...(rows.length ? rows : [el('li', { class: 'text-body-secondary', text: 'No entries match.' })]));
        els.modalCount.textContent = needle ? rows.length + ' of ' + entries.length : countLabel(entries.length);
    }

    els.modalFilter.addEventListener('input', () => modalTable && renderEntries());
    modalEl.addEventListener('shown.bs.modal', () => {
        if (window.matchMedia('(pointer: fine)').matches) els.modalFilter.focus();
    });

    // ---------- Data source & visibility ----------
    function recomputeVisible() {
        structure = allStructure
            .map((cat) => {
                const subcategories = cat.subcategories.filter((s) => !hidden.has(keyOf(cat.name, s.name)));
                return { ...cat, subcategories, total: subcategories.reduce((n, s) => n + s.count, 0) };
            })
            .filter((cat) => cat.subcategories.length);
        const available = new Set(structure.flatMap((c) => c.subcategories.map((s) => keyOf(c.name, s.name))));
        recipes = [...builds.map((b) => ({ ...b, own: true, blurb: '' })), ...serverRecipes];
        combos = recipes
            .map((r) => ({ ...r, totalParts: r.parts.length, parts: r.parts.filter((p) => available.has(keyOf(p.category, p.sub))) }))
            // Built-ins need 2+ available lines (one line isn't much of a "build"); own builds always
            // show so they can be fixed, but can't be rolled until they have enough lines.
            .filter((r) => r.own || isRollable(r));
        els.surprise.disabled = !structure.length;
    }

    async function loadSource() {
        custom = await customData.load();
        source = await createSource(custom, serverStructure);
        allStructure = await source.structure();
        recomputeVisible();
        renderBanner();
    }

    function refresh() {
        recomputeVisible();
        renderBanner();
        const next = fallbackView();
        if (next.type === 'category') history_replace('#' + encodeURIComponent(next.name));
        else if (next.type === 'combos') history_replace('#' + QUICK_HASH);
        else if (next.type === 'dice') history_replace('#' + DICE_HASH);
        else if (next.type === 'initiative') history_replace('#' + INIT_HASH);
        setView(next);
    }

    function hiddenCount() {
        let n = 0;
        for (const c of allStructure) for (const s of c.subcategories) if (hidden.has(keyOf(c.name, s.name))) n += 1;
        return n;
    }

    function renderBanner() {
        const nHidden = hiddenCount();
        const parts = [];
        if (custom) {
            parts.push(el('span', {},
                icon('file-earmark-code'), ' Using ',
                el('strong', { text: custom.name || 'your file' }),
                custom.mode === 'replace' ? ' instead of the defaults' : ' with the defaults'));
        }
        if (nHidden) parts.push(el('span', {}, icon('eye-slash'), ' ' + plural(nHidden, 'table') + ' hidden'));
        els.banner.hidden = !parts.length;
        if (!parts.length) { fill(els.banner); return; }
        fill(els.banner, 
            el('div', { class: 'data-banner-text' }, ...parts),
            el('button', { type: 'button', class: 'link-btn', onclick: openCustomize, text: 'Customize' }));
    }

    // ---------- Customize modal ----------
    const cz = {
        modalEl: $('customizeModal'),
        status: $('cz-status'),
        file: $('cz-file'),
        drop: $('cz-drop'),
        messages: $('cz-messages'),
        exportBtn: $('cz-export'),
        resetBtn: $('cz-reset'),
        iconsSection: $('cz-icons-section'),
        icons: $('cz-icons'),
        visList: $('cz-vis-list'),
        visCount: $('cz-vis-count'),
        visFilter: $('cz-vis-filter'),
        showAll: $('cz-show-all'),
        hideAll: $('cz-hide-all'),
        modes: () => document.querySelectorAll('input[name="cz-mode"]'),
    };
    const czModal = new bootstrap.Modal(cz.modalEl);

    function openCustomize() {
        renderCustomize();
        czModal.show();
    }
    els.customize.addEventListener('click', openCustomize);

    function renderCustomize() {
        // Status
        if (custom) {
            const when = custom.uploadedAt ? new Date(custom.uploadedAt).toLocaleDateString() : '';
            fill(cz.status, 
                el('div', { class: 'cz-status-card is-custom' },
                    icon('check-circle-fill'),
                    el('div', {},
                        el('strong', { text: custom.name || 'Your file' }),
                        el('small', { text: plural(custom.tables, 'table') + ' · ' + plural(custom.prompts, 'prompt') + (when ? ' · loaded ' + when : '') }))));
        } else {
            fill(cz.status, 
                el('div', { class: 'cz-status-card' },
                    icon('info-circle'),
                    el('div', {},
                        el('strong', { text: 'Using the built-in tables' }),
                        el('small', { text: 'Load a JSON file to add your own tables or replace them entirely.' }))));
        }
        const mode = custom ? custom.mode : pendingMode;
        for (const radio of cz.modes()) radio.checked = radio.value === mode;
        cz.exportBtn.hidden = cz.resetBtn.hidden = !custom;
        renderIcons();
        renderVisibility();
    }

    // ---------- Category icon picker ----------
    let openPicker = null; // category whose picker is expanded
    const iconLabel = (name) => name.replace(/-/g, ' ');

    // Grid of selectable icons (shared by category icons and the build editor)
    function iconGrid(currentIcon, onPick) {
        return el('div', { class: 'cz-icon-grid' }, ...ICON_CHOICES.map((name) => el('button', {
            type: 'button',
            class: 'cz-icon-option' + (name === currentIcon ? ' is-selected' : ''),
            title: iconLabel(name),
            'aria-label': iconLabel(name),
            'aria-pressed': String(name === currentIcon),
            onclick: () => onPick(name),
        }, icon(name))));
    }

    function renderIcons() {
        cz.iconsSection.hidden = !custom;
        if (!custom) { fill(cz.icons); return; }
        fill(cz.icons, ...Object.keys(custom.data).map((cat) => {
            const currentIcon = iconFor(cat, custom, serverStructure);
            const picked = !!custom.icons?.[cat];
            const isOpen = openPicker === cat;
            const pickerId = 'cz-picker-' + cat.replace(/[^a-z0-9]+/gi, '-');
            return el('div', { class: 'cz-icon-row' + (isOpen ? ' is-open' : '') },
                el('button', {
                    type: 'button',
                    class: 'cz-icon-current',
                    'aria-expanded': String(isOpen),
                    'aria-controls': pickerId,
                    title: 'Change the icon for ' + cat,
                    onclick: () => { openPicker = isOpen ? null : cat; renderIcons(); },
                },
                    el('span', { class: 'cz-icon-swatch' }, icon(currentIcon)),
                    el('span', { class: 'cz-icon-name', text: cat }),
                    el('span', { class: 'cz-icon-change', text: isOpen ? 'Done' : 'Change' })),
                isOpen ? el('div', { class: 'cz-icon-picker', id: pickerId, role: 'group', 'aria-label': 'Icons for ' + cat },
                    iconGrid(currentIcon, (name) => setCategoryIcon(cat, name)),
                    picked ? el('button', { type: 'button', class: 'link-btn', onclick: () => setCategoryIcon(cat, null), text: 'Use the default icon' }) : null)
                    : null);
        }));
    }

    async function setCategoryIcon(cat, iconName) {
        const icons = { ...(custom.icons || {}) };
        if (iconName) icons[cat] = iconName;
        else delete icons[cat];
        const record = { ...custom, icons };
        try {
            await customData.save(record);
        } catch (err) {
            showMessages('error', 'Could not save the icon.', [err.message || String(err)]);
            return;
        }
        custom = record;
        // Patch the icon in place; no need to rebuild the source (merge mode would refetch the defaults)
        const entry = allStructure.find((c) => c.name === cat);
        if (entry) entry.icon = iconFor(cat, custom, serverStructure);
        refresh();
        renderIcons();
    }

    let pendingMode = 'merge';
    for (const radio of cz.modes()) {
        radio.addEventListener('change', async () => {
            if (!radio.checked) return;
            pendingMode = radio.value;
            if (!custom || custom.mode === radio.value) return;
            await applyCustom({ ...custom, mode: radio.value },
                radio.value === 'replace' ? 'Now showing only your tables.' : 'Your tables are now added to the defaults.');
        });
    }

    function showMessages(kind, title, lines = []) {
        fill(cz.messages, 
            el('div', { class: 'cz-msg cz-msg-' + kind },
                el('strong', { text: title }),
                lines.length ? el('ul', {}, ...lines.map((l) => el('li', { text: l }))) : null));
    }

    async function applyCustom(record, successMessage) {
        try {
            if (record) await customData.save(record);
            else await customData.clear();
            await loadSource();
            refresh();
            renderCustomize();
            if (successMessage) toast(successMessage);
            return true;
        } catch (err) {
            showMessages('error', 'Could not save your tables in this browser.', [err.message || String(err)]);
            return false;
        }
    }

    async function handleFile(file) {
        fill(cz.messages);
        if (!file) return;
        if (file.size > MAX_FILE_BYTES) {
            showMessages('error', 'That file is too large.', ['The limit is ' + (MAX_FILE_BYTES / 1024 / 1024) + ' MB.']);
            return;
        }
        let parsed;
        try {
            parsed = parseCustomJson(await file.text());
        } catch (err) {
            if (err instanceof ValidationError) showMessages('error', 'That file couldn’t be loaded:', err.issues);
            else showMessages('error', 'That file couldn’t be read.', [err.message]);
            return;
        }
        // Keep icon choices for categories that are still in the new file
        const icons = Object.fromEntries(Object.entries(custom?.icons || {}).filter(([cat]) => cat in parsed.data));
        openPicker = null;
        const ok = await applyCustom({
            mode: pendingMode,
            icons,
            name: file.name,
            uploadedAt: new Date().toISOString(),
            data: parsed.data,
            tables: parsed.tables,
            prompts: parsed.prompts,
        }, 'Loaded ' + plural(parsed.tables, 'table') + ' from ' + file.name);
        if (!ok) return;
        if (parsed.warnings.length) showMessages('warn', 'Loaded, with a few notes:', parsed.warnings.slice(0, 8));
        else showMessages('ok', 'Loaded ' + plural(parsed.tables, 'table') + ' and ' + plural(parsed.prompts, 'prompt') + '.');
    }

    cz.file.addEventListener('change', () => {
        handleFile(cz.file.files[0]);
        cz.file.value = ''; // allow re-selecting the same file
    });
    cz.drop.addEventListener('dragover', (e) => { e.preventDefault(); cz.drop.classList.add('is-over'); });
    cz.drop.addEventListener('dragleave', () => cz.drop.classList.remove('is-over'));
    cz.drop.addEventListener('drop', (e) => {
        e.preventDefault();
        cz.drop.classList.remove('is-over');
        handleFile(e.dataTransfer.files[0]);
    });

    cz.exportBtn.addEventListener('click', () => {
        if (custom) downloadJson(custom.data, (custom.name || 'my-tables.json').replace(/(\.json)?$/i, '.json'));
    });
    cz.resetBtn.addEventListener('click', async () => {
        if (!custom) return;
        if (!window.confirm('Remove “' + (custom.name || 'your file') + '” from this browser? Export it first if you want to keep a copy.')) return;
        fill(cz.messages);
        await applyCustom(null, 'Back to the built-in tables.');
    });

    // Visibility list
    function setHidden(keys, hide) {
        for (const k of keys) { if (hide) hidden.add(k); else hidden.delete(k); }
        save(HIDDEN_KEY, [...hidden]);
        refresh();
        renderVisibility();
    }

    function renderVisibility() {
        const needle = cz.visFilter.value.trim().toLowerCase();
        const total = allStructure.reduce((n, c) => n + c.subcategories.length, 0);
        cz.visCount.textContent = (total - hiddenCount()) + ' of ' + total + ' shown';

        const groups = [];
        for (const cat of allStructure) {
            const subs = cat.subcategories.filter((s) => !needle || s.name.toLowerCase().includes(needle) || cat.name.toLowerCase().includes(needle));
            if (!subs.length) continue;
            const keys = subs.map((s) => keyOf(cat.name, s.name));
            const shown = keys.filter((k) => !hidden.has(k)).length;

            const catBox = el('input', {
                type: 'checkbox',
                'aria-label': 'Show all ' + cat.name + ' tables',
                onchange: (e) => setHidden(keys, !e.currentTarget.checked),
            });
            catBox.checked = shown === keys.length;
            catBox.indeterminate = shown > 0 && shown < keys.length;

            groups.push(el('fieldset', { class: 'cz-group' },
                el('legend', {},
                    el('label', { class: 'cz-group-label' }, catBox, icon(cat.icon), el('span', { text: cat.name })),
                    el('span', { class: 'cz-group-count', text: shown + '/' + keys.length })),
                el('div', { class: 'cz-tables' }, ...subs.map((s) => {
                    const key = keyOf(cat.name, s.name);
                    const box = el('input', { type: 'checkbox', onchange: (e) => setHidden([key], !e.currentTarget.checked) });
                    box.checked = !hidden.has(key);
                    return el('label', { class: 'cz-table' }, box,
                        el('span', { class: 'cz-table-name', text: s.name }),
                        el('span', { class: 'cz-table-count', text: s.count }));
                }))));
        }
        fill(cz.visList, ...(groups.length ? groups : [el('p', { class: 'side-list-empty', text: 'No tables match.' })]));
    }

    cz.visFilter.addEventListener('input', renderVisibility);
    const allKeys = () => allStructure.flatMap((c) => c.subcategories.map((s) => keyOf(c.name, s.name)));
    cz.showAll.addEventListener('click', () => setHidden(allKeys(), false));
    cz.hideAll.addEventListener('click', () => setHidden(allKeys(), true));

    // ---------- Build editor ----------
    const be = {
        modalEl: $('buildModal'),
        form: $('build-form'),
        heading: $('buildModalLabel'),
        title: $('be-title'),
        iconBtn: $('be-icon-btn'),
        swatch: $('be-icon-swatch'),
        picker: $('be-icon-picker'),
        lines: $('be-lines'),
        add: $('be-add'),
        messages: $('be-messages'),
        del: $('be-delete'),
    };
    const beModal = new bootstrap.Modal(be.modalEl);
    let draft = null; // { id | null, title, icon, parts: [{ label, category, sub }] }

    const categoryByName = (name) => allStructure.find((c) => c.name === name);
    function defaultTable(category) {
        const cat = categoryByName(category) || structure[0] || allStructure[0];
        return cat ? { category: cat.name, sub: cat.subcategories[0].name } : { category: '', sub: '' };
    }

    function openBuilder(id = null, template = null) {
        const existing = id ? builds.find((b) => b.id === id) : null;
        const base = existing || template;
        draft = base
            ? { id: existing ? existing.id : null, title: base.title, icon: base.icon || DEFAULT_BUILD_ICON, parts: base.parts.map((p) => ({ ...p })) }
            : { id: null, title: '', icon: DEFAULT_BUILD_ICON, parts: [{ label: '', ...defaultTable() }, { label: '', ...defaultTable() }] };
        be.heading.textContent = existing ? 'Edit build' : 'New build';
        be.title.value = draft.title;
        be.del.hidden = !existing;
        fill(be.messages);
        setPickerOpen(false);
        renderDraftIcon();
        renderLines();
        beModal.show();
    }

    function copyBuiltIn(id) {
        const recipe = serverRecipes.find((r) => r.id === id);
        if (recipe) openBuilder(null, { title: 'My ' + recipe.title.replace(/^Quick /, ''), icon: recipe.icon, parts: recipe.parts });
    }

    be.modalEl.addEventListener('shown.bs.modal', () => {
        if (!draft.title && window.matchMedia('(pointer: fine)').matches) be.title.focus();
    });

    // Icon
    function setPickerOpen(open) {
        be.picker.hidden = !open;
        be.iconBtn.setAttribute('aria-expanded', String(open));
        if (open) fill(be.picker, iconGrid(draft.icon, pickDraftIcon));
    }
    function renderDraftIcon() {
        fill(be.swatch, icon(draft.icon));
        if (!be.picker.hidden) fill(be.picker, iconGrid(draft.icon, pickDraftIcon));
    }
    function pickDraftIcon(name) {
        draft.icon = name;
        renderDraftIcon();
    }
    be.iconBtn.addEventListener('click', () => setPickerOpen(be.picker.hidden));
    be.title.addEventListener('input', () => { draft.title = be.title.value; });

    // Lines
    function tableStatus(p) {
        const cat = categoryByName(p.category);
        if (!cat || !cat.subcategories.some((s) => s.name === p.sub)) return 'missing';
        if (hidden.has(keyOf(p.category, p.sub))) return 'hidden';
        return 'ok';
    }

    function options(select, values, selected, describe) {
        for (const value of values) {
            const opt = el('option', { value, text: value + describe(value) });
            opt.selected = value === selected;
            select.append(opt);
        }
    }

    function renderLines() {
        fill(be.lines, ...draft.parts.map((p, i) => renderLine(p, i)));
        be.add.disabled = draft.parts.length >= MAX_BUILD_LINES;
        be.add.title = be.add.disabled ? 'Up to ' + MAX_BUILD_LINES + ' lines' : '';
    }

    function replaceLine(i) {
        be.lines.children[i].replaceWith(renderLine(draft.parts[i], i));
    }

    function renderLine(p, i) {
        const n = draft.parts.length;
        const lineNo = i + 1;

        const catSelect = el('select', {
            class: 'be-input',
            'aria-label': 'Category for line ' + lineNo,
            onchange: (e) => {
                Object.assign(p, defaultTable(e.currentTarget.value));
                replaceLine(i);
                be.lines.children[i].querySelectorAll('select')[1].focus();
            },
        });
        const catNames = allStructure.map((c) => c.name);
        if (p.category && !catNames.includes(p.category)) catNames.unshift(p.category);
        options(catSelect, catNames, p.category, (name) => (categoryByName(name) ? '' : ' (missing)'));

        const tableSelect = el('select', {
            class: 'be-input',
            'aria-label': 'Table for line ' + lineNo,
            onchange: (e) => {
                p.sub = e.currentTarget.value;
                replaceLine(i);
                be.lines.children[i].querySelectorAll('select')[1].focus();
            },
        });
        const subNames = (categoryByName(p.category)?.subcategories || []).map((s) => s.name);
        if (p.sub && !subNames.includes(p.sub)) subNames.unshift(p.sub);
        options(tableSelect, subNames, p.sub, (name) => {
            if (!categoryByName(p.category)?.subcategories.some((s) => s.name === name)) return ' (missing)';
            return hidden.has(keyOf(p.category, name)) ? ' (hidden)' : '';
        });

        const labelInput = el('input', {
            type: 'text',
            class: 'be-input',
            maxlength: 40,
            placeholder: p.sub || 'Label',
            'aria-label': 'Label for line ' + lineNo,
            oninput: (e) => { p.label = e.currentTarget.value; },
        });
        labelInput.value = p.label;

        const tool = (iconName, label, disabled, run) => el('button', {
            type: 'button', class: 'icon-btn', title: label, 'aria-label': label + ' (line ' + lineNo + ')', disabled, onclick: run,
        }, icon(iconName));

        const status = tableStatus(p);
        return el('li', { class: 'be-line' + (status === 'ok' ? '' : ' has-warning') },
            el('span', { class: 'be-line-no', text: lineNo }),
            el('div', { class: 'be-line-main' },
                el('div', { class: 'be-line-fields' },
                    el('label', { class: 'be-field' }, el('span', { text: 'Label' }), labelInput),
                    el('label', { class: 'be-field' }, el('span', { text: 'Category' }), catSelect),
                    el('label', { class: 'be-field' }, el('span', { text: 'Table' }), tableSelect)),
                status === 'ok' ? null : el('p', { class: 'be-line-warn' }, icon('exclamation-triangle'),
                    status === 'hidden'
                        ? ' This table is hidden, so the line is skipped until you show it again.'
                        : ' This table isn’t in your current tables, so the line is skipped.')),
            el('div', { class: 'be-line-tools' },
                tool('arrow-up', 'Move up', i === 0, () => moveLine(i, -1)),
                tool('arrow-down', 'Move down', i === n - 1, () => moveLine(i, 1)),
                tool('x-lg', 'Remove', n <= 1, () => removeLine(i))));
    }

    function moveLine(i, delta) {
        const j = i + delta;
        [draft.parts[i], draft.parts[j]] = [draft.parts[j], draft.parts[i]];
        renderLines();
        const btn = be.lines.children[j].querySelector(delta < 0 ? '[title="Move up"]' : '[title="Move down"]');
        (btn && !btn.disabled ? btn : be.lines.children[j].querySelector('input')).focus();
    }

    function removeLine(i) {
        draft.parts.splice(i, 1);
        renderLines();
        const row = be.lines.children[Math.min(i, draft.parts.length - 1)];
        if (row) row.querySelector('input').focus();
    }

    be.add.addEventListener('click', () => {
        if (draft.parts.length >= MAX_BUILD_LINES) return;
        const last = draft.parts[draft.parts.length - 1];
        draft.parts.push({ label: '', ...defaultTable(last?.category) });
        renderLines();
        be.lines.lastElementChild.querySelector('input').focus();
    });

    function showBuildMessages(kind, title, lines = []) {
        fill(be.messages, 
            el('div', { class: 'cz-msg cz-msg-' + kind },
                el('strong', { text: title }),
                lines.length ? el('ul', {}, ...lines.map((l) => el('li', { text: l }))) : null));
    }

    async function saveBuilds(next) {
        try {
            await userBuilds.save(next);
        } catch (err) {
            showBuildMessages('error', 'Could not save your builds in this browser.', [err.message || String(err)]);
            return false;
        }
        builds = next;
        recomputeVisible();
        return true;
    }

    be.form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = be.title.value.trim();
        const issues = [];
        if (!title) issues.push('Give the build a name.');
        if (draft.parts.length < MIN_BUILD_LINES) issues.push('Add at least ' + MIN_BUILD_LINES + ' lines.');
        if (draft.parts.some((p) => !p.category || !p.sub)) issues.push('Pick a table for every line.');
        if (issues.length) {
            showBuildMessages('error', 'Almost there:', issues);
            if (!title) be.title.focus();
            return;
        }
        const now = new Date().toISOString();
        const existing = draft.id ? builds.find((b) => b.id === draft.id) : null;
        const record = {
            id: existing ? existing.id : newBuildId(),
            title: title.slice(0, MAX_TITLE_LENGTH),
            icon: draft.icon,
            parts: draft.parts.map((p) => ({ label: (p.label.trim() || p.sub).slice(0, 40), category: p.category, sub: p.sub })),
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        };
        const next = existing ? builds.map((b) => (b.id === record.id ? record : b)) : [...builds, record];
        if (!(await saveBuilds(next))) return;
        beModal.hide();
        activeKey = 'combo|' + record.id;
        goToCombos();
        toast(existing ? 'Saved “' + record.title + '”' : 'Created “' + record.title + '”');
    });

    be.del.addEventListener('click', async () => {
        const existing = draft?.id && builds.find((b) => b.id === draft.id);
        if (!existing) return;
        if (!window.confirm('Delete “' + existing.title + '”? This can’t be undone.')) return;
        if (!(await saveBuilds(builds.filter((b) => b.id !== existing.id)))) return;
        beModal.hide();
        goToCombos();
        toast('Deleted “' + existing.title + '”');
    });

    // ---------- Init ----------
    const pendingShare = takeShareToken();
    renderPins();
    renderHistory();
    Promise.all([api(['structure']), api(['combos']).catch(() => [])])
        .then(async ([data, comboList]) => {
            serverStructure = data;
            serverRecipes = comboList;
            builds = await userBuilds.load();
            rollList = await savedRolls.load();
            try {
                await loadSource();
            } catch (err) {
                // Custom data unusable (e.g. defaults failed to load for merging): fall back to the server
                custom = null;
                source = await createSource(null, serverStructure);
                allStructure = serverStructure;
                recomputeVisible();
                renderBanner();
                toast('Couldn’t load your custom tables, showing the defaults');
            }
            setView(viewFromHash() || fallbackView());
            if (pendingShare) handleShareToken(pendingShare);

            // /cards?customize (linked from the homepage) opens the Customize panel
            const params = new URLSearchParams(location.search);
            if (params.has('customize')) {
                window.history.replaceState(null, '', location.pathname + location.hash);
                openCustomize();
            }
        })
        .catch((err) => {
            fill(els.content, el('div', { class: 'empty-state', text: 'Could not load categories (' + err.message + '). Refresh to try again.' }));
        });

    window.addEventListener('hashchange', () => {
        const token = takeShareToken();
        if (token) { handleShareToken(token); return; }
        const next = viewFromHash();
        if (!next) return;
        if (next.type === 'combos') goToCombos();
        else if (next.type === 'dice') goToDice();
        else if (next.type === 'initiative') goToInitiative();
        else goToCategory(next.name);
    });
}
