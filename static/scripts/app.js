// D&D Prompt Helper – cards page (ES module)
import {
    api, customData, createSource, parseCustomJson, ValidationError, downloadJson, MAX_FILE_BYTES,
    ICON_CHOICES, iconFor, userBuilds, newBuildId,
    savedRolls, newRollId, MAX_ROLL_NAME, MAX_SAVED_ROLLS,
    encodeShare, decodeShare, cleanBuild, cleanRoll, MAX_SHARE_LENGTH,
    offlineData, setBaseData, fetchJson, characterData, partiesData,
    DEFAULT_BUILD_ICON, MAX_BUILD_LINES, MIN_BUILD_LINES, MAX_TITLE_LENGTH,
} from './data.js';
import * as Dice from './dice.js';
import * as Init from './initiative.js';
import * as Party from './party.js';
import * as Edits from './edits.js';
import * as Backup from './backup.js';

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
    const CHAR_HASH = 'characters';
    const PARTY_HASH = 'party';


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
    let characters = [];      // the players' characters (IndexedDB, see party.js)
    let parties = [];         // named groups of characters (IndexedDB)
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
    const crumbOf = (item) => item.category + ' › ' + item.sub + (item.multi ? ' ×' + item.multi : '');
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
            items.push(el('li', {}, el('button', {
                type: 'button', class: 'cat-btn cat-btn-add', title: 'Create a category of your own',
                onclick: openNewCategory,
            }, icon('plus-lg'), el('span', { text: 'New category' }))));
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
            items.push(navButton({
                iconName: 'person-vcard',
                label: 'Characters',
                count: characters.length || undefined,
                title: 'Your players’ characters: level, HP, AC, scores and gear',
                current: view && view.type === 'characters',
                onclick: goToCharacters,
                extraClass: 'cat-btn-tool',
            }));
            items.push(navButton({
                iconName: 'people',
                label: 'Party',
                count: parties.length || undefined,
                title: 'Group characters into parties and track them during a session',
                current: view && view.type === 'party',
                onclick: goToParty,
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

    function goToCharacters() {
        if (els.search.value) els.search.value = '';
        if (location.hash !== '#' + CHAR_HASH) history_replace('#' + CHAR_HASH);
        setView({ type: 'characters' });
    }

    function goToParty() {
        if (els.search.value) els.search.value = '';
        if (location.hash !== '#' + PARTY_HASH) history_replace('#' + PARTY_HASH);
        setView({ type: 'party' });
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
        if (name === CHAR_HASH) return { type: 'characters' };
        if (name === PARTY_HASH) return { type: 'party' };
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
            view.type === 'characters' ||
            view.type === 'party' ||
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
        else if (view.type === 'characters') renderCharacters();
        else if (view.type === 'party') renderParty();
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
                    el('h1', { class: 'content-title' }, el('span', { text: cat.name }),
                        isOwnCategory(cat.name) ? el('button', {
                            type: 'button', class: 'icon-btn cat-rename', title: 'Rename this category', 'aria-label': 'Rename ' + cat.name,
                            onclick: (e) => startCategoryRename(e.currentTarget.closest('.content-title'), cat.name),
                        }, icon('pencil')) : null),
                    el('p', { class: 'content-blurb', text: cat.blurb })),
                el('div', { class: 'content-head-tools' },
                    renderRollCount(),
                    el('button', {
                        type: 'button',
                        class: 'btn-outline-gold',
                        title: 'Roll on a random ' + cat.name + ' table',
                        onclick: () => rollRandomTable(cat),
                    }, icon('shuffle'), el('span', { text: 'Roll any table' })))),
            el('div', { class: 'tiles' }, ...cat.subcategories.map((sub) => renderTile(cat.name, sub)), renderNewTableTile(cat.name)));
    }

    // A category is the user's own when it holds only their tables (or everything is theirs)
    const isOwnCategory = (name) => !!custom?.data?.[name] && (custom.mode === 'replace' || !serverStructure.some((c) => c.name === name));

    function startCategoryRename(heading, oldName) {
        const input = el('input', { type: 'text', class: 'be-input cat-rename-input', maxlength: Edits.MAX_TABLE_NAME, 'aria-label': 'Category name', autocomplete: 'off' });
        input.value = oldName;
        const error = el('p', { class: 'dice-error', role: 'alert' });
        const cancel = () => renderContent();
        const form = el('form', {
            class: 'cat-rename-form',
            novalidate: true,
            onsubmit: async (e) => {
                e.preventDefault();
                let res;
                try { res = Edits.renameCategory(custom, oldName, input.value, allStructure.map((c) => c.name)); }
                catch (err) { error.textContent = err.message; return; }
                if (!res.changed) { cancel(); return; }
                await remapTables(Object.keys(custom.data[oldName]).map((sub) => [oldName, sub, res.category, sub]));
                if (!(await commitRecord(res.record))) { error.textContent = 'Could not save in this browser.'; return; }
                goToCategory(res.category);
                toast('Renamed to “' + res.category + '”');
            },
            onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); cancel(); } },
        },
            input,
            el('button', { type: 'submit', class: 'btn-gold btn-sm-gold' }, icon('check-lg'), el('span', { text: 'Save' })),
            el('button', { type: 'button', class: 'link-btn', onclick: cancel }, 'Cancel'),
            error);
        heading.replaceWith(form);
        input.focus();
        input.select();
    }

    // ---- New category (from the sidebar) ----
    const nc = { modalEl: $('newCategoryModal'), form: $('new-category-form'), category: $('nc-category'), table: $('nc-table'), entry: $('nc-entry'), error: $('nc-error') };
    const ncModal = new bootstrap.Modal(nc.modalEl);
    function openNewCategory() {
        nc.form.reset();
        nc.error.textContent = '';
        ncModal.show();
    }
    nc.modalEl.addEventListener('shown.bs.modal', () => nc.category.focus());
    nc.form.addEventListener('submit', async (e) => {
        e.preventDefault();
        nc.error.textContent = '';
        const name = nc.category.value.trim();
        const existing = allStructure.find((c) => c.name.toLowerCase() === name.toLowerCase());
        if (existing) {
            nc.error.textContent = 'There’s already a category called “' + existing.name + '”. Add a table to it with “+ New table” instead.';
            return;
        }
        let res;
        try { res = Edits.createTable(custom, name, nc.table.value, nc.entry.value, []); }
        catch (err) { nc.error.textContent = err.message; return; }
        if (!(await commitRecord(res.record))) { nc.error.textContent = 'Could not save in this browser.'; return; }
        ncModal.hide();
        goToCategory(res.category);
        toast('Created the “' + res.category + '” category');
    });

    // "+ New table" tile: turns into a small form
    function renderNewTableTile(category) {
        const tile = el('button', {
            type: 'button',
            class: 'tile-new',
            title: 'Create your own table in ' + category,
            onclick: () => tile.replaceWith(renderNewTableForm(category)),
        }, icon('plus-lg'), el('span', { text: 'New table' }));
        return tile;
    }

    function renderNewTableForm(category) {
        const name = el('input', { type: 'text', class: 'be-input', maxlength: Edits.MAX_TABLE_NAME, placeholder: 'Table name', 'aria-label': 'New table name', autocomplete: 'off' });
        const first = el('textarea', { class: 'be-input', rows: 2, maxlength: Edits.MAX_ENTRY_LENGTH, placeholder: 'First entry', 'aria-label': 'First entry' });
        const error = el('p', { class: 'dice-error', role: 'alert' });
        const form = el('form', {
            class: 'tile-new-form',
            novalidate: true,
            onsubmit: async (e) => {
                e.preventDefault();
                error.textContent = '';
                const existing = allStructure.find((c) => c.name === category)?.subcategories.map((s) => s.name) || [];
                let created;
                try { created = Edits.createTable(custom, category, name.value, first.value, existing); }
                catch (err) { error.textContent = err.message; return; }
                if (!(await commitRecord(created.record))) { error.textContent = 'Could not save in this browser.'; return; }
                toast('Created “' + created.sub + '”. Add more entries now');
                showEntries(category, created.sub, { edit: true });
            },
            onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); form.replaceWith(renderNewTableTile(category)); } },
        },
            el('div', { class: 'tile-new-head' }, icon('journal-plus'), el('strong', { text: 'New table' })),
            name, first, error,
            el('div', { class: 'tile-new-actions' },
                el('button', { type: 'button', class: 'link-btn', onclick: () => form.replaceWith(renderNewTableTile(category)) }, 'Cancel'),
                el('button', { type: 'submit', class: 'btn-gold btn-sm-gold' }, icon('check-lg'), el('span', { text: 'Create' }))));
        setTimeout(() => name.focus(), 0);
        return form;
    }

    const isBuiltInTable = (category, sub) => serverStructure.some((c) => c.name === category && c.subcategories.some((s) => s.name === sub));
    const editStatus = (category, sub) => Edits.tableStatus(custom, category, sub, isBuiltInTable(category, sub));

    // "Roll ×1 ×2 ×3 ×5": how many different entries a table roll gives
    function renderRollCount() {
        return el('div', { class: 'roll-count', role: 'group', 'aria-label': 'Prompts per roll' },
            el('span', { class: 'roll-count-label', text: 'Roll' }),
            ...ROLL_COUNTS.map((n) => el('button', {
                type: 'button',
                class: 'dice-mode-btn',
                'aria-pressed': String(rollCount === n),
                title: n === 1 ? 'One prompt per roll' : n + ' different prompts per roll',
                onclick: (e) => {
                    rollCount = n;
                    save(ROLL_COUNT_KEY, n);
                    for (const b of e.currentTarget.parentElement.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === e.currentTarget));
                },
            }, '×' + n)));
    }

    function tileBadge(category, sub) {
        if (!custom || custom.mode === 'replace') return null;
        const status = editStatus(category, sub);
        if (status === 'copy') return el('span', { class: 'tile-badge', title: 'Your personal copy of a built-in table', text: 'Edited' });
        if (status === 'own') return el('span', { class: 'tile-badge is-own', title: 'Your own table', text: 'Yours' });
        return null;
    }

    function renderTile(category, sub, { showCategory = false, needle = '' } = {}) {
        return el('div', { class: 'tile' + (activeKey === keyOf(category, sub.name) ? ' active' : ''), 'data-key': keyOf(category, sub.name) },
            el('button', {
                type: 'button',
                class: 'tile-roll',
                title: 'Roll on ' + sub.name,
                onclick: () => roll(category, sub.name),
            },
                el('span', { class: 'tile-name' }, highlight(sub.name, needle), tileBadge(category, sub.name)),
                el('span', { class: 'tile-meta' },
                    icon('dice-5'),
                    el('span', { class: 'tile-count', text: (showCategory ? category + ' · ' : '') + tileCountText(category, sub) }))),
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
            const texts = await Promise.all(combo.parts.map((p) => rollEntries(p.category, p.sub, 1).then((r) => r.texts[0])));
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
            // For a multi roll, avoid the other results already on screen
            const avoid = before.multi ? before.parts.filter((_, i) => i !== index).map((p) => p.index) : [];
            const { texts, indices } = await rollEntries(part.category, part.sub, 1, avoid);
            const text = texts[0];
            if (current !== before) return; // something else was shown meanwhile
            const parts = before.parts.map((p, i) => (i === index ? { ...p, text, index: indices[0] } : p));
            const item = before.multi ? multiItem(before.category, before.sub, parts) : comboItem(before.comboId, before.sub, parts);
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
                const v = Math.abs(Math.trunc(Number(amount.value))) || 1;   // empty: 1 HP
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
                    el('button', { type: 'submit', class: 'init-hp-btn is-dmg', title: 'Damage (Enter). Empty: 1 HP', 'aria-label': 'Damage ' + c.name }, icon('dash-lg')),
                    el('button', { type: 'button', class: 'init-hp-btn is-heal', title: 'Heal. Empty: 1 HP', 'aria-label': 'Heal ' + c.name, onclick: () => apply(1) }, icon('plus-lg'))));
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

    // ---------- Characters and parties ----------
    // Characters: every character with a basic sheet (modal), shown as cards.
    // Party: named groups of characters, shown as a compact table for the session; each member
    // can be switched off when they're not playing. All stored in this browser and in backups.
    const CURRENT_PARTY_KEY = 'dnd.currentParty';
    let charList = null;    // the list container while the Characters view is shown
    let partyBody = null;   // the content container while the Party view is shown
    let partyForm = null;   // 'new' | 'rename' while the inline name form is open
    const expandedRows = new Set();   // party rows showing slots, hit dice and rests
    let currentPartyId = (() => { try { return localStorage.getItem(CURRENT_PARTY_KEY); } catch { return null; } })();

    const currentParty = () => parties.find((p) => p.id === currentPartyId) || parties[0] || null;
    function setCurrentParty(id) {
        currentPartyId = id;
        try { localStorage.setItem(CURRENT_PARTY_KEY, id || ''); } catch { /* ignore */ }
    }

    function redrawCharacterViews() {
        renderCharacterList();
        renderPartyBody();
        renderNav();
    }
    async function saveCharacters(next) {
        characters = next;
        try { await characterData.save(characters); } catch { toast('Could not save in this browser'); }
        redrawCharacterViews();
    }
    async function saveParties(next) {
        parties = next;
        try { await partiesData.save(parties); } catch { toast('Could not save in this browser'); }
        redrawCharacterViews();
    }
    const updateCharacter = (c) => saveCharacters(Party.upsert(characters, c));

    function levelUpCharacter(c) {
        const next = Party.levelUp(c);
        const profUp = Party.proficiency(next.level) > Party.proficiency(c.level);
        updateCharacter(next);
        toast(c.name + ' is now level ' + next.level + (profUp ? ' (proficiency ' + Party.signed(Party.proficiency(next.level)) + ')' : ''));
    }

    const ordinal = (n) => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
    const statBox = (label, value, title) => el('div', { class: 'party-stat', title },
        el('span', { class: 'party-stat-label', text: label }), el('strong', { text: value }));

    // HP with quick damage / heal (temporary HP goes first)
    function hpTracker(c) {
        if (c.maxHp === null) {
            return el('div', { class: 'init-hp init-hp-none' }, el('span', { class: 'init-muted', text: 'HP not set' }));
        }
        const pct = Math.round((c.hp / c.maxHp) * 100);
        const amount = el('input', { type: 'number', inputmode: 'numeric', min: 1, class: 'init-hp-amount', placeholder: 'Amt', 'aria-label': 'Damage or healing for ' + c.name });
        const apply = (sign) => {
            const v = Math.abs(Math.trunc(Number(amount.value))) || 1;   // empty: 1 HP
            updateCharacter(Party.changeHp(c, sign * v));
        };
        return el('form', { class: 'init-hp party-hp', onsubmit: (e) => { e.preventDefault(); apply(-1); } },
            el('div', { class: 'init-hp-top' },
                el('span', { class: 'init-hp-text' }, 'HP ', el('strong', { text: c.hp }), ' / ' + c.maxHp,
                    c.tempHp ? el('span', { class: 'party-temp', text: ' +' + c.tempHp + ' temp' }) : null),
                el('div', { class: 'init-hp-bar', role: 'progressbar', 'aria-label': c.name + ' hit points', 'aria-valuemin': 0, 'aria-valuemax': c.maxHp, 'aria-valuenow': c.hp },
                    el('span', { class: 'init-hp-fill ' + (pct > 50 ? 'is-high' : pct > 25 ? 'is-mid' : 'is-low'), style: 'width:' + pct + '%' }))),
            el('div', { class: 'init-hp-edit' },
                amount,
                el('button', { type: 'submit', class: 'init-hp-btn is-dmg', title: 'Damage (Enter). Empty: 1 HP', 'aria-label': 'Damage ' + c.name }, icon('dash-lg')),
                el('button', { type: 'button', class: 'init-hp-btn is-heal', title: 'Heal. Empty: 1 HP', 'aria-label': 'Heal ' + c.name, onclick: () => apply(1) }, icon('plus-lg'))));
    }

    const levelUpButton = (c, small = false) => el('button', {
        type: 'button', class: small ? 'icon-btn pt-icon' : 'btn-outline-gold btn-sm-gold', disabled: c.level >= Party.LIMITS.maxLevel,
        title: c.level >= Party.LIMITS.maxLevel ? 'Already level 20' : 'Level up to ' + (c.level + 1),
        'aria-label': 'Level up ' + c.name,
        onclick: () => levelUpCharacter(c),
    }, icon('arrow-up-circle'), small ? null : ' Level up');

    // ----- Tracking during play (step 2) -----
    const isDown = (c) => c.maxHp !== null && c.hp === 0;
    function downBadge(c) {
        if (!isDown(c)) return null;
        const state = Party.deathState(c);
        return el('span', { class: 'init-down' + (state === 'stable' ? ' is-stable' : ''), text: state === 'dead' ? 'Dead' : state === 'stable' ? 'Stable' : 'Down' });
    }

    // Row of boxes: `filled` of `total` are on; clicking box n calls onPick(n)
    function pips(total, filled, { label, cls = '', onPick, filledLabel = 'used' }) {
        return el('span', { class: 'pt-pips ' + cls, role: 'group', 'aria-label': label },
            ...Array.from({ length: total }, (_, i) => el('button', {
                type: 'button', class: 'pt-pip' + (i < filled ? ' is-on' : ''),
                'aria-pressed': String(i < filled), 'aria-label': label + ' ' + (i + 1) + (i < filled ? ' (' + filledLabel + ')' : ''),
                onclick: () => onPick(i + 1),
            })));
    }

    // Inspiration, conditions and exhaustion: shown on every card and party row
    function statusLine(c) {
        const condSelect = el('select', {
            class: 'init-cond-add', 'aria-label': 'Add a condition to ' + c.name,
            onchange: (e) => {
                const v = e.currentTarget.value;
                if (v === '__exhaustion') updateCharacter(Party.setExhaustion(c, 1));
                else if (v) updateCharacter(Party.toggleCondition(c, v));
            },
        }, el('option', { value: '', text: '+ Condition' }),
            ...Party.CONDITIONS.filter((x) => !c.conditions.includes(x)).map((x) => el('option', { value: x, text: x })),
            c.exhaustion ? null : el('option', { value: '__exhaustion', text: 'Exhaustion' }));
        return el('div', { class: 'init-conds pt-status' },
            el('button', {
                type: 'button', class: 'pt-insp' + (c.inspiration ? ' is-on' : ''), 'aria-pressed': String(c.inspiration),
                title: c.inspiration ? 'Has Inspiration (click to use it)' : 'Give Inspiration',
                onclick: () => updateCharacter(Party.toggleInspiration(c)),
            }, icon(c.inspiration ? 'star-fill' : 'star'), el('span', { class: 'visually-hidden', text: 'Inspiration' })),
            ...c.conditions.map((x) => el('button', {
                type: 'button', class: 'init-cond', title: 'Remove ' + x, 'aria-label': 'Remove ' + x + ' from ' + c.name,
                onclick: () => updateCharacter(Party.toggleCondition(c, x)),
            }, x, icon('x'))),
            c.exhaustion ? el('span', { class: 'init-cond pt-exh' },
                el('button', { type: 'button', class: 'pt-exh-btn', 'aria-label': 'Less exhaustion', onclick: () => updateCharacter(Party.setExhaustion(c, c.exhaustion - 1)) }, icon('dash')),
                'Exhaustion ' + c.exhaustion,
                el('button', { type: 'button', class: 'pt-exh-btn', 'aria-label': 'More exhaustion', disabled: c.exhaustion >= Party.MAX_EXHAUSTION, onclick: () => updateCharacter(Party.setExhaustion(c, c.exhaustion + 1)) }, icon('plus'))) : null,
            condSelect);
    }

    function deathSaves(c) {
        if (!isDown(c)) return null;
        const pick = (kind) => (n) => updateCharacter(Party.setDeathSave(c, kind, n));
        return el('div', { class: 'pt-death' },
            el('span', { class: 'pt-track-label', text: 'Death saves' }),
            el('span', { class: 'pt-death-set' }, 'Successes ', pips(3, c.deathSaves.success, { label: 'Death save success', cls: 'is-good', onPick: pick('success'), filledLabel: 'ticked' })),
            el('span', { class: 'pt-death-set' }, 'Failures ', pips(3, c.deathSaves.fail, { label: 'Death save failure', cls: 'is-bad', onPick: pick('fail'), filledLabel: 'ticked' })));
    }

    // Spell slots, hit dice and rests
    function resources(c) {
        const slotRows = c.slots.flatMap((s, i) => (s.max ? [el('div', { class: 'pt-slot' },
            el('span', { class: 'pt-slot-level', text: ordinal(i + 1) }),
            pips(s.max, s.max - s.used, {
                label: ordinal(i + 1) + '-level slot', cls: 'is-slot', filledLabel: 'available',
                // Boxes show what's left: click a lit box to spend down to it, the first dim one to get one back
                onPick: (n) => updateCharacter(Party.setSlotsUsed(c, i + 1, n <= s.max - s.used ? s.max - n + 1 : s.max - n)),
            }),
            el('span', { class: 'pt-slot-count', text: (s.max - s.used) + '/' + s.max }))] : []));
        const restBox = el('div', { class: 'pt-rest' });
        const left = Party.hitDiceLeft(c);
        const die = Party.hitDieOf(c);
        const showButtons = () => fill(restBox,
            el('span', { class: 'pt-hd', title: 'Hit dice left (one per level)' }, 'Hit dice ', el('strong', { text: left + '/' + c.level }), ' d' + die),
            el('span', { class: 'pt-rest-btns' },
                el('button', { type: 'button', class: 'btn-outline-gold btn-sm-gold', onclick: showShortRest }, icon('cup-hot'), ' Short rest'),
                el('button', {
                    type: 'button', class: 'btn-outline-gold btn-sm-gold',
                    onclick: () => {
                        if (!window.confirm('Long rest for ' + c.name + '? HP and spell slots come back, plus half their hit dice, and one level of exhaustion goes.')) return;
                        updateCharacter(Party.longRest(c));
                        toast(c.name + ' finished a long rest');
                    },
                }, icon('moon-stars'), ' Long rest')));
        function showShortRest() {
            const count = el('input', { type: 'number', inputmode: 'numeric', class: 'init-hp-amount', min: 0, max: left, value: Math.min(1, left), 'aria-label': 'Hit dice to spend' });
            fill(restBox, el('form', {
                class: 'pt-short-rest',
                onsubmit: (e) => {
                    e.preventDefault();
                    const n = Math.min(left, Math.max(0, Math.trunc(Number(count.value) || 0)));
                    const rolls = Array.from({ length: n }, () => Dice.rollDie(die));
                    const r = Party.shortRest(c, rolls);
                    updateCharacter(r.character);
                    const con = Party.modifier(c.scores.con);
                    toast(c.name + ' rested' + (n ? ': rolled ' + rolls.join(', ') + (con ? ' (' + Party.signed(con) + ' CON each)' : '') + ', healed ' + r.healed : '') + (c.pactMagic && Party.hasSlots(c) ? ', slots back' : ''));
                },
            },
                el('span', {}, left ? 'Spend' : 'No hit dice left.'),
                left ? count : null,
                left ? el('span', { text: 'of ' + left + ' × d' + die }) : null,
                el('button', { type: 'submit', class: 'btn-gold btn-sm-gold' }, icon('dice-5'), left ? ' Roll and rest' : ' Rest'),
                el('button', { type: 'button', class: 'link-btn', onclick: showButtons }, 'Cancel')));
            if (left) count.select();
        }
        showButtons();
        return el('div', { class: 'pt-resources' },
            slotRows.length ? el('div', { class: 'pt-slots' }, el('span', { class: 'pt-track-label', text: 'Spell slots' + (c.pactMagic ? ' (Pact Magic)' : '') }), ...slotRows) : null,
            restBox);
    }

    // ----- Characters view -----
    function renderCharacters() {
        charList = el('section', { class: 'party-list-wrap', 'aria-label': 'Characters' });
        els.content.replaceChildren(
            el('div', { class: 'content-head content-head-split' },
                el('div', {},
                    el('div', { class: 'content-kicker', text: 'Tools' }),
                    el('h1', { class: 'content-title', text: 'Characters' }),
                    el('p', { class: 'content-blurb', text: 'Your players’ characters: level, HP, AC, ability scores and gear. Group them into parties under Party. Saved in this browser.' })),
                el('button', { type: 'button', class: 'btn-gold', onclick: () => openSheet(null) }, icon('person-plus'), el('span', { text: 'New character' }))),
            charList);
        renderCharacterList();
    }

    function renderCharacterList() {
        if (!charList || view?.type !== 'characters') return;
        if (!characters.length) {
            fill(charList, el('div', { class: 'empty-state empty-state-lg' },
                icon('person-vcard'),
                el('p', { text: 'No characters yet. Add each player’s character to keep their level, HP, AC and gear in one place.' }),
                el('button', { type: 'button', class: 'btn-outline-gold', onclick: () => openSheet(null) }, icon('person-plus'), ' Add the first character')));
            return;
        }
        fill(charList, el('ul', { class: 'party-grid' }, ...characters.map(renderCharacterCard)));
    }

    function renderCharacterCard(c) {
        const inParties = parties.filter((p) => p.members.some((m) => m.id === c.id)).map((p) => p.name);
        return el('li', { class: 'party-card' + (isDown(c) ? ' is-down' : '') },
            el('div', { class: 'party-card-head' },
                el('div', { class: 'party-name-wrap' },
                    el('h2', { class: 'party-name', text: c.name }),
                    el('p', { class: 'party-summary', text: Party.summary(c) }),
                    c.player ? el('p', { class: 'party-player', text: 'Played by ' + c.player }) : null),
                downBadge(c)),
            statusLine(c),
            el('div', { class: 'party-stats' },
                statBox('AC', c.ac ?? '—', 'Armor Class'),
                statBox('Init', Party.signed(Party.initiativeBonus(c)), 'Initiative bonus (Dexterity)'),
                statBox('Perc', Party.passivePerception(c), 'Passive Perception'),
                statBox('Speed', c.speed + ' ft', 'Speed'),
                statBox('Prof', Party.signed(Party.proficiency(c.level)), 'Proficiency bonus')),
            hpTracker(c),
            deathSaves(c),
            resources(c),
            inParties.length ? el('p', { class: 'party-in' }, icon('people'), ' ' + inParties.join(', ')) : null,
            el('div', { class: 'party-actions' },
                levelUpButton(c),
                el('button', { type: 'button', class: 'btn-gold btn-sm-gold', onclick: () => openSheet(c.id) }, icon('journal-text'), ' Sheet')));
    }

    // ----- Party view -----
    function renderParty() {
        partyBody = el('div', { class: 'pt-body' });
        partyForm = null;
        els.content.replaceChildren(
            el('div', { class: 'content-head' },
                el('div', { class: 'content-kicker', text: 'Tools' }),
                el('h1', { class: 'content-title', text: 'Party' }),
                el('p', { class: 'content-blurb', text: 'Group characters into parties, one per campaign or table. Switch off anyone who isn’t playing this session; they stay in the party.' })),
            partyBody);
        renderPartyBody();
    }

    function partyNameForm(mode) {
        const p = currentParty();
        const input = el('input', { type: 'text', class: 'be-input', maxlength: Party.MAX_PARTY_NAME, placeholder: 'e.g. Tuesday group', autocomplete: 'off', 'aria-label': 'Party name', value: mode === 'rename' ? p.name : '' });
        const error = el('p', { class: 'dice-error', role: 'alert' });
        const close = () => { partyForm = null; renderPartyBody(); };
        const form = el('form', {
            class: 'pt-name-form', novalidate: true,
            onsubmit: (e) => {
                e.preventDefault();
                try {
                    if (mode === 'new') {
                        const made = Party.createParty(parties, input.value);
                        setCurrentParty(made.party.id);
                        partyForm = null;
                        saveParties(made.parties);
                        toast('Created ' + made.party.name);
                    } else {
                        partyForm = null;
                        saveParties(Party.renameParty(parties, p.id, input.value));
                    }
                } catch (err) { error.textContent = err.message; input.focus(); }
            },
        },
            el('div', { class: 'pt-name-row' },
                input,
                el('button', { type: 'submit', class: 'btn-gold btn-sm-gold' }, icon('check-lg'), mode === 'new' ? ' Create' : ' Rename'),
                parties.length ? el('button', { type: 'button', class: 'link-btn', onclick: close }, 'Cancel') : null),
            error);
        input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && parties.length) { e.stopPropagation(); close(); } });
        setTimeout(() => input.focus(), 0);
        return form;
    }

    function renderPartyBody() {
        if (!partyBody || view?.type !== 'party') return;
        if (!parties.length || partyForm === 'new') {
            fill(partyBody,
                !parties.length ? el('p', { class: 'cz-sub', text: 'Start by naming your first party.' }) : null,
                partyNameForm('new'));
            return;
        }
        const p = currentParty();
        const picker = el('select', {
            class: 'be-input pt-select', 'aria-label': 'Party',
            onchange: (e) => { setCurrentParty(e.currentTarget.value); renderPartyBody(); },
        }, ...parties.map((x) => el('option', { value: x.id, text: x.name })));
        picker.value = p.id;
        const bar = el('div', { class: 'pt-bar' },
            picker,
            el('button', { type: 'button', class: 'btn-outline-gold btn-sm-gold', onclick: () => { partyForm = 'new'; renderPartyBody(); } }, icon('plus-lg'), ' New party'),
            el('button', { type: 'button', class: 'link-btn', onclick: () => { partyForm = 'rename'; renderPartyBody(); } }, 'Rename'),
            el('button', {
                type: 'button', class: 'link-btn',
                onclick: () => {
                    if (!window.confirm('Delete the party “' + p.name + '”? The characters stay under Characters.')) return;
                    const rest = Party.deleteParty(parties, p.id);
                    setCurrentParty(rest[0]?.id || null);
                    saveParties(rest);
                    toast('Deleted ' + p.name);
                },
            }, 'Delete'));

        const members = Party.roster(p, characters);
        const active = members.filter((m) => m.active);
        const away = members.filter((m) => !m.active);
        const notIn = characters.filter((c) => !p.members.some((m) => m.id === c.id));

        const adder = el('select', {
            class: 'be-input pt-add-select', 'aria-label': 'Add a character to ' + p.name,
            onchange: (e) => {
                const v = e.currentTarget.value;
                if (v === '__new') { e.currentTarget.value = ''; openSheet(null, p.id); return; }
                if (v) saveParties(Party.addMember(parties, p.id, v));
            },
        }, el('option', { value: '', text: '+ Add a character…' }),
            ...notIn.map((c) => el('option', { value: c.id, text: c.name + ' · ' + Party.summary(c) })),
            el('option', { value: '__new', text: 'New character…' }));

        const levelAll = active.length ? el('button', {
            type: 'button', class: 'btn-outline-gold btn-sm-gold',
            disabled: active.every((c) => c.level >= Party.LIMITS.maxLevel),
            title: 'Level up everyone who is playing',
            onclick: () => {
                if (!window.confirm('Level up ' + active.map((c) => c.name).join(', ') + '?')) return;
                let next = characters;
                for (const c of active) next = Party.upsert(next, Party.levelUp(c));
                saveCharacters(next);
                toast('Levelled up ' + plural(active.length, 'character'));
            },
        }, icon('arrow-up-circle'), ' Level up the party') : null;

        const restAll = active.length ? el('button', {
            type: 'button', class: 'btn-outline-gold btn-sm-gold', title: 'Long rest for everyone playing',
            onclick: () => {
                if (!window.confirm('Long rest for ' + active.map((c) => c.name).join(', ') + '? HP and spell slots come back, plus half their hit dice, and one level of exhaustion goes.')) return;
                let next = characters;
                for (const c of active) next = Party.upsert(next, Party.longRest(c));
                saveCharacters(next);
                toast('The party finished a long rest');
            },
        }, icon('moon-stars'), ' Long rest') : null;

        const avg = active.length ? Math.round(active.reduce((n, c) => n + c.level, 0) / active.length) : 0;
        fill(partyBody,
            partyForm === 'rename' ? partyNameForm('rename') : bar,
            el('div', { class: 'pt-summary' },
                el('span', { class: 'cz-vis-count', text: members.length
                    ? active.length + ' playing' + (away.length ? ' · ' + away.length + ' away' : '') + (active.length ? ' · average level ' + avg : '')
                    : 'No one in this party yet.' }),
                active.length ? el('span', { class: 'pt-summary-btns' }, restAll, levelAll) : null),
            members.length ? el('ul', { class: 'pt-list' }, ...active.map((c) => renderPartyRow(p, c))) : null,
            away.length ? el('h2', { class: 'section-label pt-away-label', text: 'Not playing this session' }) : null,
            away.length ? el('ul', { class: 'pt-list is-away' }, ...away.map((c) => renderPartyRow(p, c))) : null,
            el('div', { class: 'pt-add' }, adder));
    }

    function renderPartyRow(p, c) {
        const toggle = el('input', {
            type: 'checkbox', class: 'pt-toggle', role: 'switch',
            'aria-label': c.name + ' is playing this session', title: c.active ? 'Playing (switch off if they’re away)' : 'Away (switch on when they play)',
            onchange: (e) => saveParties(Party.setActive(parties, p.id, c.id, e.currentTarget.checked)),
        });
        toggle.checked = c.active;
        const down = isDown(c);
        const open = expandedRows.has(c.id);
        const extra = c.active && (open || down) ? el('div', { class: 'pt-extra' }, deathSaves(c), open ? resources(c) : null) : null;
        return el('li', { class: 'pt-row' + (c.active ? '' : ' is-away') + (down ? ' is-down' : '') },
            el('label', { class: 'pt-switch' }, toggle, c.active ? 'Playing' : 'Away'),
            el('div', { class: 'pt-who' },
                el('div', { class: 'pt-name-line' },
                    el('span', { class: 'pt-name', text: c.name }),
                    downBadge(c)),
                el('span', { class: 'pt-meta', text: [Party.summary(c), c.player].filter(Boolean).join(' · ') })),
            c.active ? statusLine(c) : null,
            el('div', { class: 'pt-stats' },
                statBox('AC', c.ac ?? '—', 'Armor Class'),
                statBox('Init', Party.signed(Party.initiativeBonus(c)), 'Initiative bonus'),
                statBox('Perc', Party.passivePerception(c), 'Passive Perception')),
            c.active ? hpTracker(c) : el('span', { class: 'pt-hp-away' }, c.maxHp === null ? '' : 'HP ' + c.hp + ' / ' + c.maxHp),
            el('div', { class: 'pt-tools' },
                c.active ? el('button', {
                    type: 'button', class: 'icon-btn pt-icon', 'aria-expanded': String(open),
                    title: open ? 'Hide slots and rests' : 'Spell slots, hit dice and rests',
                    'aria-label': (open ? 'Hide' : 'Show') + ' spell slots, hit dice and rests for ' + c.name,
                    onclick: () => { if (open) expandedRows.delete(c.id); else expandedRows.add(c.id); renderPartyBody(); },
                }, icon(open ? 'chevron-up' : 'chevron-down')) : null,
                levelUpButton(c, true),
                el('button', { type: 'button', class: 'icon-btn pt-icon', title: 'Open sheet', 'aria-label': 'Open ' + c.name + '’s sheet', onclick: () => openSheet(c.id) }, icon('journal-text')),
                el('button', {
                    type: 'button', class: 'icon-btn pt-icon', title: 'Remove from ' + p.name, 'aria-label': 'Remove ' + c.name + ' from ' + p.name,
                    onclick: () => { saveParties(Party.removeMember(parties, p.id, c.id)); toast(c.name + ' left ' + p.name); },
                }, icon('x-lg'))),
            extra);
    }

    // ----- Character sheet -----
    const sheet = {
        modalEl: $('partyModal'), form: $('party-form'), body: $('party-sheet'), title: $('partyModalLabel'),
        error: $('party-error'), del: $('party-delete'),
    };
    const sheetModal = new bootstrap.Modal(sheet.modalEl);
    let sheetId = null;   // id of the character being edited, or null for a new one
    let sheetAddTo = null; // party to add a new character to

    function openSheet(id, addToParty = null) {
        const c = characters.find((x) => x.id === id) || null;
        if (!c && characters.length >= Party.LIMITS.maxCharacters) { toast('You can have up to ' + Party.LIMITS.maxCharacters + ' characters'); return; }
        sheetId = c ? c.id : null;
        sheetAddTo = c ? null : addToParty;
        sheet.title.textContent = c ? c.name : 'New character';
        sheet.del.hidden = !c;
        sheet.error.textContent = '';
        fill(sheet.body, ...renderSheet(c || Party.createCharacter({ name: '?' })));
        if (!c) sheet.form.elements.name.value = '';
        updateDerived();
        sheetModal.show();
    }
    sheet.modalEl.addEventListener('shown.bs.modal', () => { if (!sheetId) sheet.form.elements.name.focus(); });

    function renderSheet(c) {
        const field = (label, input, cls = '') => el('label', { class: ('be-field ' + cls).trim() }, el('span', { text: label }), input);
        const textIn = (name, value, attrs = {}) => el('input', { type: 'text', class: 'be-input', name, value, maxlength: Party.LIMITS.maxText, autocomplete: 'off', ...attrs });
        const numIn = (name, value, attrs = {}) => el('input', { type: 'number', inputmode: 'numeric', class: 'be-input', name, value: value ?? '', ...attrs });
        const section = (iconName, title, ...children) => el('section', { class: 'ps-section' },
            el('h6', { class: 'cz-heading' }, icon(iconName), ' ' + title), ...children);
        const datalist = (id, options) => el('datalist', { id }, ...options.map((o) => el('option', { value: o })));
        const alignment = el('select', { class: 'be-input', name: 'alignment' },
            el('option', { value: '', text: '—' }),
            ...[...new Set([...Party.ALIGNMENTS, c.alignment].filter(Boolean))].map((a) => el('option', { value: a, text: a })));
        alignment.value = c.alignment;

        const scores = Party.ABILITIES.map(({ key, label, short }) =>
            el('label', { class: 'ps-score', title: label },
                el('span', { class: 'ps-score-label', text: short }),
                numIn('score-' + key, c.scores[key], { min: 1, max: Party.LIMITS.maxScore, 'aria-label': label }),
                el('span', { class: 'ps-score-mod', 'data-mod': key })));

        const shield = el('input', { type: 'checkbox', name: 'shield' });
        shield.checked = c.shield;
        const percProf = el('input', { type: 'checkbox', name: 'perceptionProf' });
        percProf.checked = c.perceptionProf;
        const hitDieSelect = el('select', { class: 'be-input', name: 'hitDie' },
            el('option', { value: '', 'data-auto': '1' }),
            ...Party.HIT_DICE.map((d) => el('option', { value: d, text: 'd' + d })));
        hitDieSelect.value = c.hitDie ? String(c.hitDie) : '';
        const pact = el('input', { type: 'checkbox', name: 'pactMagic' });
        pact.checked = c.pactMagic;
        const derived = (key, label) => el('div', { class: 'party-stat' }, el('span', { class: 'party-stat-label', text: label }), el('strong', { 'data-derived': key }));

        return [
            datalist('ps-classes', Party.CLASSES),
            datalist('ps-races', Party.RACES),
            section('person-vcard', 'Character',
                el('div', { class: 'ps-grid' },
                    field('Name', textIn('name', c.name, { required: true, placeholder: 'e.g. Aria Stormwind' }), 'ps-wide'),
                    field('Player', textIn('player', c.player, { placeholder: 'Who plays them' })),
                    field('Race', textIn('race', c.race, { list: 'ps-races' })),
                    field('Class', textIn('cls', c.cls, { list: 'ps-classes' })),
                    field('Subclass', textIn('subclass', c.subclass)),
                    field('Level', numIn('level', c.level, { min: 1, max: Party.LIMITS.maxLevel })),
                    field('Background', textIn('background', c.background)),
                    field('Alignment', alignment))),
            section('shield-shaded', 'Combat',
                el('div', { class: 'ps-grid' },
                    field('Max HP', numIn('maxHp', c.maxHp, { min: 1, max: Party.LIMITS.maxHp, placeholder: '—' })),
                    field('Current HP', numIn('hp', c.hp, { min: 0, max: Party.LIMITS.maxHp, placeholder: 'Max' })),
                    field('Temp HP', numIn('tempHp', c.tempHp || '', { min: 0, max: Party.LIMITS.maxHp, placeholder: '0' })),
                    field('AC', numIn('ac', c.ac, { min: 0, max: Party.LIMITS.maxAc, placeholder: '—' })),
                    field('Speed (ft)', numIn('speed', c.speed, { min: 0, max: Party.LIMITS.maxSpeed, step: 5 }))),
                el('div', { class: 'party-stats ps-derived' },
                    derived('prof', 'Proficiency'), derived('init', 'Initiative'), derived('perc', 'Passive Perception'))),
            section('magic', 'Hit dice and spell slots',
                el('div', { class: 'ps-grid' },
                    field('Hit die', hitDieSelect),
                    el('p', { class: 'cz-sub ps-hint', 'data-derived': 'hitdice' })),
                el('p', { class: 'cz-sub ps-slots-hint', text: 'Spell slots per spell level. Leave at 0 for characters without spells.' }),
                el('div', { class: 'ps-slots' }, ...c.slots.map((sl, i) =>
                    field(ordinal(i + 1), numIn('slot-' + (i + 1), sl.max || '', { min: 0, max: Party.LIMITS.maxSlots, placeholder: '0' })))),
                el('label', { class: 'ps-check' }, pact, ' Pact Magic (slots come back on a short rest)')),
            section('bar-chart', 'Ability scores',
                el('div', { class: 'ps-scores' }, ...scores),
                el('label', { class: 'ps-check' }, percProf, ' Proficient in Perception')),
            section('shield', 'Armor and weapons',
                el('div', { class: 'ps-grid' },
                    field('Armor', textIn('armor', c.armor, { placeholder: 'e.g. Chain mail' }), 'ps-wide'),
                    el('label', { class: 'ps-check ps-check-inline' }, shield, ' Shield')),
                rowEditor('weapons', 'Weapon', [
                    { key: 'name', label: 'Weapon', placeholder: 'e.g. Longsword', cls: 'ps-row-name' },
                    { key: 'attack', label: 'Attack', placeholder: '+5', maxlength: 20, cls: 'ps-row-small' },
                    { key: 'damage', label: 'Damage', placeholder: '1d8+3 slashing' },
                ], c.weapons, Party.LIMITS.maxWeapons)),
            section('backpack', 'Inventory',
                rowEditor('inventory', 'Item', [
                    { key: 'name', label: 'Item', placeholder: 'e.g. Rope (50 ft)', cls: 'ps-row-name' },
                    { key: 'qty', label: 'Qty', type: 'number', placeholder: '1', cls: 'ps-row-small' },
                    { key: 'notes', label: 'Notes', placeholder: 'Optional', maxlength: 200 },
                ], c.inventory, Party.LIMITS.maxItems),
                el('div', { class: 'ps-coins' }, ...Party.COINS.map((k) =>
                    field(k.toUpperCase(), numIn('coin-' + k, c.coins[k] || '', { min: 0, max: Party.LIMITS.maxCoins, placeholder: '0' }))))),
            section('journal-text', 'Notes',
                el('textarea', { class: 'be-input ps-notes', name: 'notes', rows: 4, maxlength: Party.LIMITS.maxNotes, placeholder: 'Backstory, bonds, features, anything worth remembering' }, c.notes)),
        ];
    }

    // Editable list of rows (weapons, inventory). Rows are read back by data-row / data-key.
    function rowEditor(kind, noun, columns, items, max) {
        const list = el('ul', { class: 'ps-rows', 'data-rows': kind });
        const addBtn = el('button', { type: 'button', class: 'link-btn ps-add' }, icon('plus-lg'), ' Add ' + noun.toLowerCase());
        const head = el('div', { class: 'ps-row ps-rows-head', 'aria-hidden': 'true' },
            ...columns.map((col) => el('span', { class: col.cls || '', text: col.label })), el('span'));
        const sync = () => { addBtn.hidden = list.children.length >= max; head.hidden = !list.children.length; };
        const addRow = (item = {}, focus = false) => {
            const inputs = columns.map((col) => el('input', {
                type: col.type || 'text', class: 'be-input ' + (col.cls || ''), 'data-key': col.key,
                value: item[col.key] ?? '', placeholder: col.placeholder, 'aria-label': col.label,
                maxlength: col.type === 'number' ? null : (col.maxlength || Party.LIMITS.maxText),
                min: col.type === 'number' ? 0 : null, inputmode: col.type === 'number' ? 'numeric' : null,
            }));
            const row = el('li', { class: 'ps-row', 'data-row': kind }, ...inputs,
                el('button', {
                    type: 'button', class: 'icon-btn', title: 'Remove', 'aria-label': 'Remove ' + noun.toLowerCase(),
                    onclick: () => { row.remove(); sync(); },
                }, icon('x-lg')));
            list.append(row);
            sync();
            if (focus) inputs[0].focus();
        };
        for (const item of items) addRow(item);
        addBtn.addEventListener('click', () => addRow({}, true));
        sync();
        return el('div', { class: 'ps-rows-wrap' }, head, list, addBtn);
    }

    function readSheet() {
        const f = sheet.form.elements;
        const v = (name) => f[name]?.value ?? '';
        const rows = (kind) => [...sheet.body.querySelectorAll('[data-row="' + kind + '"]')].map((row) =>
            Object.fromEntries([...row.querySelectorAll('[data-key]')].map((i) => [i.dataset.key, i.value])));
        const existing = characters.find((x) => x.id === sheetId);
        return {
            ...(existing || {}),   // keeps what's tracked during play (conditions, slots used, ...)
            id: sheetId || undefined, createdAt: existing?.createdAt,
            hitDie: v('hitDie'), pactMagic: f.pactMagic.checked,
            slots: Array.from({ length: Party.SPELL_LEVELS }, (_, i) => ({ max: v('slot-' + (i + 1)), used: existing?.slots[i]?.used ?? 0 })),
            name: v('name'), player: v('player'), race: v('race'), cls: v('cls'), subclass: v('subclass'),
            level: v('level'), background: v('background'), alignment: v('alignment'),
            maxHp: v('maxHp'), hp: v('hp') === '' ? v('maxHp') : v('hp'), tempHp: v('tempHp'), ac: v('ac'), speed: v('speed'),
            scores: Object.fromEntries(Party.ABILITIES.map(({ key }) => [key, v('score-' + key)])),
            perceptionProf: f.perceptionProf.checked, armor: v('armor'), shield: f.shield.checked,
            weapons: rows('weapons'), inventory: rows('inventory'),
            coins: Object.fromEntries(Party.COINS.map((k) => [k, v('coin-' + k)])),
            notes: v('notes'),
        };
    }

    // Modifiers, proficiency, initiative and passive Perception follow what's typed
    function updateDerived() {
        const c = Party.normalizeCharacter({ ...readSheet(), name: 'x' });
        for (const node of sheet.body.querySelectorAll('[data-mod]')) node.textContent = Party.signed(Party.modifier(c.scores[node.dataset.mod]));
        const set = (key, value) => { const n = sheet.body.querySelector('[data-derived="' + key + '"]'); if (n) n.textContent = value; };
        set('prof', Party.signed(Party.proficiency(c.level)));
        set('init', Party.signed(Party.initiativeBonus(c)));
        set('perc', Party.passivePerception(c));
        const auto = sheet.body.querySelector('[data-auto]');
        if (auto) auto.textContent = 'd' + Party.hitDieFor(c.cls) + ' (' + (c.cls || 'usual') + ')';
        set('hitdice', c.level + ' hit dice (d' + Party.hitDieOf(c) + '), one per level. Spend them on a short rest.');
    }
    sheet.form.addEventListener('input', updateDerived);

    sheet.form.addEventListener('submit', (e) => {
        e.preventDefault();
        sheet.error.textContent = '';
        const raw = readSheet();
        if (!raw.name.trim()) { sheet.error.textContent = 'Give the character a name.'; sheet.form.elements.name.focus(); return; }
        const c = Party.createCharacter(raw);
        const addTo = parties.find((x) => x.id === sheetAddTo);
        saveCharacters(Party.upsert(characters, c));
        if (addTo) saveParties(Party.addMember(parties, addTo.id, c.id));
        sheetModal.hide();
        toast(sheetId ? 'Saved ' + c.name : 'Added ' + c.name + (addTo ? ' to ' + addTo.name : ''));
    });

    sheet.del.addEventListener('click', () => {
        const c = characters.find((x) => x.id === sheetId);
        if (!c || !window.confirm('Delete ' + c.name + '? Their sheet is removed and they leave every party.')) return;
        saveCharacters(Party.remove(characters, c.id));
        if (parties.some((p) => p.members.some((m) => m.id === c.id))) saveParties(Party.removeCharacterEverywhere(parties, c.id));
        sheetModal.hide();
        toast('Removed ' + c.name);
    });

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

    // ---------- Picking entries (multi rolls + no repeats) ----------
    const ROLL_COUNTS = [1, 2, 3, 5];
    const ROLL_COUNT_KEY = 'dnd.rollCount';
    const NO_REPEAT_KEY = 'dnd.noRepeat';
    const SEEN_KEY = 'dnd.seen';
    const loadJson = (key, fallback) => {
        try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
    };
    let rollCount = ROLL_COUNTS.includes(loadJson(ROLL_COUNT_KEY, 1)) ? loadJson(ROLL_COUNT_KEY, 1) : 1;
    let noRepeat = loadJson(NO_REPEAT_KEY, false) === true;
    let seen = (() => { const v = loadJson(SEEN_KEY, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; })();

    const tableCount = (category, sub) =>
        allStructure.find((c) => c.name === category)?.subcategories.find((s) => s.name === sub)?.count || 0;

    function seenIn(category, sub) {
        const count = tableCount(category, sub);
        const list = Array.isArray(seen[keyOf(category, sub)]) ? seen[keyOf(category, sub)] : [];
        return list.filter((i) => Number.isInteger(i) && i >= 0 && i < count);
    }

    function tileCountText(category, sub) {
        if (!noRepeat) return countLabel(sub.count);
        const left = sub.count - seenIn(category, sub.name).length;
        return left === sub.count ? countLabel(sub.count) : left + ' of ' + sub.count + ' left';
    }

    // Pick n different entries of a table (fair, via the dice engine's crypto RNG), skipping ones
    // already seen when "No repeats" is on, and any indices in `avoid`. Fetches just those entries.
    async function rollEntries(category, sub, n = 1, avoid = []) {
        const count = tableCount(category, sub);
        if (!count) {
            const texts = await Promise.all(Array.from({ length: n }, () => source.roll(category, sub)));
            return { texts, indices: texts.map(() => null), reshuffled: false };
        }
        const key = keyOf(category, sub);
        let used = new Set(noRepeat ? seenIn(category, sub) : []);
        const blocked = new Set(avoid.filter((i) => Number.isInteger(i)));
        const picks = [];
        let reshuffled = false;
        const want = Math.min(n, count);
        while (picks.length < want) {
            let pool = [];
            for (let i = 0; i < count; i++) if (!used.has(i) && !blocked.has(i) && !picks.includes(i)) pool.push(i);
            if (!pool.length) {
                if (!used.size) break;      // nothing left that isn't blocked
                used = new Set();           // every entry seen: start the table over
                reshuffled = true;
                continue;
            }
            picks.push(pool[Dice.rollDie(pool.length) - 1]);
        }
        if (noRepeat) {
            seen[key] = [...used, ...picks];
            save(SEEN_KEY, seen);
            refreshTileCounts();
        }
        const texts = await Promise.all(picks.map((i) => source.entry(category, sub, i)));
        return { texts, indices: picks, reshuffled };
    }

    function multiItem(category, sub, parts) {
        return { category, sub, multi: parts.length, parts, text: parts.map((p, i) => (i + 1) + '. ' + p.text).join('\n\n') };
    }

    // Update "N of M left" on visible tiles without re-rendering the view
    function refreshTileCounts() {
        for (const tile of els.content.querySelectorAll('.tile')) {
            const [category, sub] = tile.dataset.key.split('|');
            const info = allStructure.find((c) => c.name === category)?.subcategories.find((s) => s.name === sub);
            const label = tile.querySelector('.tile-count');
            if (info && label) label.textContent = (label.textContent.startsWith(category + ' · ') ? category + ' · ' : '') + tileCountText(category, info);
        }
    }

    function setNoRepeat(on) {
        noRepeat = on;
        save(NO_REPEAT_KEY, on);
        refreshTileCounts();
    }

    function startFresh() {
        seen = {};
        save(SEEN_KEY, seen);
        refreshTileCounts();
    }

    // ---------- Rolling ----------
    async function roll(category, sub, n = rollCount) {
        const seq = ++rollSeq;
        activeKey = keyOf(category, sub);
        markActiveTile();
        startRolling();
        try {
            const { texts, indices, reshuffled } = await rollEntries(category, sub, n);
            if (seq !== rollSeq) return;
            const item = texts.length > 1
                ? multiItem(category, sub, texts.map((text, i) => ({ label: 'Roll ' + (i + 1), category, sub, text, index: indices[i] })))
                : { category, sub, text: texts[0] };
            showResult(item, { animate: true });
            addToHistory(item);
            if (reshuffled) toast('You’ve seen every ' + sub + ' entry, so it starts over');
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
        if (item.multi) {
            return { type: 'result', result: { kind: 'multi', category: item.category, sub: item.sub, texts: item.parts.map((p) => p.text) } };
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
        } else if (r.kind === 'multi' && Array.isArray(r.texts) && r.texts.length >= 2 && r.texts.length <= ROLL_COUNTS[ROLL_COUNTS.length - 1]) {
            const category = text(r.category, 120), sub = text(r.sub, 200);
            const texts = r.texts.map((t) => text(t, 5000));
            if (category && sub && texts.every(Boolean)) {
                item = multiItem(category, sub, texts.map((t, i) => ({ label: 'Roll ' + (i + 1), category, sub, text: t, index: null })));
            }
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
        else if (current.multi) roll(current.category, current.sub, current.multi);
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
    let modalEdit = false;  // edit mode on/off
    let editingIndex = null; // entry being edited inline
    let lastDeleted = null;  // { category, sub, index, text } for Undo
    let undoTimer;
    const ed = {
        toggle: $('entries-edit'), panel: $('entries-edit-panel'), info: $('entries-info'),
        add: $('entries-add'), addText: $('entries-add-text'), error: $('entries-edit-error'),
        undo: $('entries-undo'), undoText: $('entries-undo-text'), undoBtn: $('entries-undo-btn'),
    };

    async function showEntries(category, sub, { edit = false } = {}) {
        modalTable = { category, sub, entries: [] };
        setEditMode(edit);
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
            if (modalEdit) { rows.push(renderEditableEntry(text, i, needle)); return; }
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

    // ----- Edit mode -----
    function setEditMode(on) {
        modalEdit = on;
        editingIndex = null;
        ed.toggle.setAttribute('aria-pressed', String(on));
        fill(ed.toggle, icon(on ? 'check-lg' : 'pencil'), ' ', el('span', { text: on ? 'Done' : 'Edit' }));
        ed.panel.hidden = !on;
        ed.error.textContent = '';
        hideUndo();
        modalEl.classList.toggle('is-editing', on);
        if (on) renderEditInfo();
    }
    ed.toggle.addEventListener('click', () => {
        if (!modalTable) return;
        setEditMode(!modalEdit);
        renderEntries();
        if (modalEdit) ed.addText.focus();
    });

    // The info panel explains what editing does for this kind of table
    function renderEditInfo() {
        const { category, sub } = modalTable;
        const status = editStatus(category, sub);
        const box = (iconName, title, ...body) => fill(ed.info,
            el('div', { class: 'edit-info-icon' }, icon(iconName)),
            el('div', { class: 'edit-info-body' }, el('strong', { text: title }), ...body));
        ed.info.className = 'edit-info is-' + status;
        if (status === 'builtin') {
            box('info-circle', 'This is a built-in table',
                el('p', { text: 'Your first change makes a personal copy of it, saved only in this browser. From then on you’ll see your version, while other users of the site still see the original table.' }),
                el('p', { text: 'While you have a copy, updates to the built-in table won’t reach you. You can reset to the original at any time, and you can export your tables from Customize as a backup.' }),
                el('p', { text: 'Built-in tables keep their name and category. To rename or move one, duplicate it as your own table.' }),
                infoActions(duplicateButton()));
        } else if (status === 'copy') {
            box('pencil-square', 'You’re editing your personal copy',
                el('p', { text: 'This copy of a built-in table is saved only in this browser. Other users of the site still see the original table, and updates to the built-in table won’t reach your copy.' }),
                infoActions(
                    el('button', { type: 'button', class: 'btn-outline-gold btn-sm-gold', onclick: resetToOriginal }, icon('arrow-counterclockwise'), ' Reset to original'),
                    duplicateButton()));
        } else {
            box('journal-bookmark', 'This table is yours',
                el('p', { text: 'It’s saved only in this browser. Export your tables from Customize to keep a backup or move them to another device.' }),
                infoActions(
                    el('button', {
                        type: 'button', class: 'btn-outline-gold btn-sm-gold',
                        onclick: () => showTableForm({
                            title: 'Rename or move this table', name: sub, category, submit: 'Save',
                            onSubmit: (newCat, newSub) => moveThisTable(newCat, newSub),
                        }),
                    }, icon('pencil-square'), ' Rename or move'),
                    el('button', { type: 'button', class: 'btn-outline-danger-ink btn-sm-gold', onclick: deleteThisTable }, icon('trash'), ' Delete table')));
        }
    }

    // Actions row + a holder for the inline name/category form
    function infoActions(...buttons) {
        return el('div', {}, el('div', { class: 'edit-info-actions' }, ...buttons), el('div', { class: 'edit-info-form', id: 'edit-info-form' }));
    }

    function duplicateButton() {
        const { category, sub } = modalTable;
        return el('button', {
            type: 'button', class: 'btn-outline-gold btn-sm-gold',
            title: 'Make a separate table of your own with these entries, which you can rename and move',
            onclick: () => showTableForm({
                title: 'Duplicate as my own table', name: sub + ' (mine)', category, submit: 'Duplicate',
                onSubmit: (newCat, newSub) => duplicateThisTable(newCat, newSub),
            }),
        }, icon('copy'), ' Duplicate as my own table');
    }

    // Small form: table name + category (existing or new)
    function showTableForm({ title, name, category, submit, onSubmit }) {
        const holder = $('edit-info-form');
        if (!holder) return;
        const nameInput = el('input', { type: 'text', class: 'be-input', maxlength: Edits.MAX_TABLE_NAME, 'aria-label': 'Table name', autocomplete: 'off' });
        nameInput.value = name;
        const NEW = '__new__';
        const select = el('select', { class: 'be-input', 'aria-label': 'Category' },
            ...allStructure.map((c) => { const o = el('option', { value: c.name, text: c.name }); o.selected = c.name === category; return o; }),
            el('option', { value: NEW, text: '+ New category…' }));
        const newCat = el('input', { type: 'text', class: 'be-input', maxlength: Edits.MAX_TABLE_NAME, placeholder: 'New category name', 'aria-label': 'New category name', autocomplete: 'off', hidden: true });
        select.addEventListener('change', () => { newCat.hidden = select.value !== NEW; if (!newCat.hidden) newCat.focus(); });
        const error = el('p', { class: 'dice-error', role: 'alert' });
        const form = el('form', {
            class: 'table-form',
            novalidate: true,
            onsubmit: async (e) => {
                e.preventDefault();
                error.textContent = '';
                const cat = select.value === NEW ? newCat.value : select.value;
                const msg = await onSubmit(cat, nameInput.value);
                if (msg) error.textContent = msg;
            },
            onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); fill(holder); } },
        },
            el('strong', { class: 'table-form-title', text: title }),
            el('div', { class: 'table-form-fields' },
                el('label', { class: 'be-field' }, el('span', { text: 'Name' }), nameInput),
                el('label', { class: 'be-field' }, el('span', { text: 'Category' }), select, newCat)),
            error,
            el('div', { class: 'table-form-actions' },
                el('button', { type: 'button', class: 'link-btn', onclick: () => fill(holder) }, 'Cancel'),
                el('button', { type: 'submit', class: 'btn-gold btn-sm-gold' }, icon('check-lg'), el('span', { text: submit }))));
        fill(holder, form);
        nameInput.focus();
        nameInput.select();
    }

    const tableNamesIn = (category) => allStructure.find((c) => c.name === category)?.subcategories.map((s) => s.name) || [];

    // Rename/move an own table. Returns an error message, or nothing on success.
    async function moveThisTable(newCat, newSub) {
        const { category, sub } = modalTable;
        let res;
        try { res = Edits.moveTable(custom, category, sub, newCat, newSub, tableNamesIn(String(newCat).trim())); }
        catch (err) { return err.message; }
        if (!res.changed) { fill($('edit-info-form')); return; }
        await remapTables([[category, sub, res.category, res.sub]]);
        if (!(await commitRecord(res.record))) return 'Could not save in this browser.';
        modalTable.category = res.category;
        modalTable.sub = res.sub;
        els.modalKicker.textContent = res.category;
        els.modalTitle.textContent = res.sub;
        if (view?.type === 'category') goToCategory(res.category);
        renderEditInfo();
        renderEntries();
        toast(res.category !== category ? 'Moved to ' + res.category + ' › ' + res.sub : 'Renamed to “' + res.sub + '”');
    }

    async function duplicateThisTable(newCat, newSub) {
        let res;
        try { res = Edits.createTableFrom(custom, newCat, newSub, modalTable.entries, tableNamesIn(String(newCat).trim())); }
        catch (err) { return err.message; }
        if (!(await commitRecord(res.record))) return 'Could not save in this browser.';
        goToCategory(res.category);
        toast('Created your own table “' + res.sub + '”');
        showEntries(res.category, res.sub, { edit: true });
    }

    // After a rename/move, keep everything that refers to a table by name pointing at it
    async function remapTables(pairs) {
        let hiddenChanged = false, seenChanged = false, buildsChanged = false;
        for (const [oldCat, oldSub, newCat, newSub] of pairs) {
            const from = keyOf(oldCat, oldSub), to = keyOf(newCat, newSub);
            if (hidden.has(from)) { hidden.delete(from); hidden.add(to); hiddenChanged = true; }
            if (seen[from]) { seen[to] = seen[from]; delete seen[from]; seenChanged = true; }
            if (activeKey === from) activeKey = to;
            builds = builds.map((b) => {
                if (!b.parts.some((p) => p.category === oldCat && p.sub === oldSub)) return b;
                buildsChanged = true;
                return { ...b, parts: b.parts.map((p) => (p.category === oldCat && p.sub === oldSub ? { ...p, category: newCat, sub: newSub } : p)) };
            });
        }
        if (hiddenChanged) save(HIDDEN_KEY, [...hidden]);
        if (seenChanged) save(SEEN_KEY, seen);
        if (buildsChanged) { try { await userBuilds.save(builds); } catch { /* the builds stay renamed in memory */ } }
    }

    // Save a new custom record (or remove it when nothing is left), then reload the data
    async function commitRecord(record) {
        try {
            if (record && !Edits.isEmptyRecord(record)) await customData.save(record);
            else await customData.clear();
        } catch {
            return false;
        }
        await loadSource();
        refresh();
        return true;
    }

    // Apply one edit to the open table: makes the personal copy first if needed
    async function editTable(op) {
        const { category, sub } = modalTable;
        ed.error.textContent = '';
        let next, extra;
        try {
            const { record, copied } = Edits.ensureEditable(custom, category, sub, modalTable.entries, isBuiltInTable(category, sub));
            const result = op(record);
            next = result.record || result;
            extra = { ...result, copied };
        } catch (err) {
            ed.error.textContent = err.message;
            return null;
        }
        if (!(await commitRecord(next))) { ed.error.textContent = 'Could not save in this browser.'; return null; }
        // Entry numbers changed, so "no repeats" starts this table over
        delete seen[keyOf(category, sub)];
        save(SEEN_KEY, seen);
        try { modalTable.entries = await source.entries(category, sub); } catch { modalTable.entries = []; }
        editingIndex = null;
        renderEditInfo();
        renderEntries();
        if (extra.copied) toast('Personal copy created. Other users still see the original');
        return extra;
    }

    ed.add.addEventListener('submit', async (e) => {
        e.preventDefault();
        const { category, sub } = modalTable;
        const done = await editTable((r) => Edits.addEntry(r, category, sub, ed.addText.value));
        if (done) {
            ed.addText.value = '';
            ed.addText.focus();
            els.modalList.lastElementChild?.scrollIntoView({ block: 'nearest' });
        }
    });
    ed.addText.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ed.add.requestSubmit(); }
    });

    function renderEditableEntry(text, i, needle) {
        const { category, sub } = modalTable;
        if (editingIndex === i) {
            const area = el('textarea', { class: 'be-input entry-edit-area', rows: Math.min(8, Math.max(2, Math.ceil(text.length / 70))), maxlength: Edits.MAX_ENTRY_LENGTH, 'aria-label': 'Edit entry ' + (i + 1) });
            area.value = text;
            setTimeout(() => { area.focus(); area.setSelectionRange(area.value.length, area.value.length); }, 0);
            const saveEdit = () => editTable((r) => Edits.updateEntry(r, category, sub, i, area.value));
            area.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit(); }
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editingIndex = null; renderEntries(); }
            });
            return el('li', { value: i + 1, class: 'is-editing' },
                el('div', { class: 'entry-edit' },
                    area,
                    el('div', { class: 'entry-edit-actions' },
                        el('button', { type: 'button', class: 'link-btn', onclick: () => { editingIndex = null; renderEntries(); } }, 'Cancel'),
                        el('button', { type: 'button', class: 'btn-gold btn-sm-gold', onclick: saveEdit }, icon('check-lg'), el('span', { text: 'Save' })))));
        }
        return el('li', { value: i + 1 },
            el('div', { class: 'entry-row' },
                el('span', { class: 'entry-text is-static' }, highlight(text, needle)),
                el('div', { class: 'entry-actions is-visible' },
                    el('button', {
                        type: 'button', class: 'icon-btn', title: 'Edit', 'aria-label': 'Edit entry ' + (i + 1),
                        onclick: () => { editingIndex = i; renderEntries(); },
                    }, icon('pencil')),
                    el('button', {
                        type: 'button', class: 'icon-btn', title: 'Delete', 'aria-label': 'Delete entry ' + (i + 1),
                        onclick: async () => {
                            const done = await editTable((r) => Edits.deleteEntry(r, category, sub, i));
                            if (done) showUndo({ category, sub, index: i, text: done.removed });
                        },
                    }, icon('trash')))));
    }

    function showUndo(deleted) {
        lastDeleted = deleted;
        ed.undoText.textContent = 'Entry ' + (deleted.index + 1) + ' deleted.';
        ed.undo.hidden = false;
        clearTimeout(undoTimer);
        undoTimer = setTimeout(hideUndo, 10000);
    }
    function hideUndo() {
        ed.undo.hidden = true;
        lastDeleted = null;
        clearTimeout(undoTimer);
    }
    ed.undoBtn.addEventListener('click', async () => {
        if (!lastDeleted || !modalTable || lastDeleted.category !== modalTable.category || lastDeleted.sub !== modalTable.sub) return;
        const { category, sub, index, text } = lastDeleted;
        hideUndo();
        await editTable((r) => Edits.restoreEntry(r, category, sub, index, text));
    });

    async function resetToOriginal() {
        const { category, sub } = modalTable;
        if (!window.confirm('Reset “' + sub + '” to the original? Your changes to this table will be lost.')) return;
        await editTable((r) => Edits.resetTable(r, category, sub));
        toast('“' + sub + '” is back to the original');
    }

    async function deleteThisTable() {
        const { category, sub } = modalTable;
        if (!window.confirm('Delete your table “' + sub + '” and all its entries? This can’t be undone.')) return;
        const next = Edits.deleteTable(custom, category, sub);
        if (!(await commitRecord(next))) { ed.error.textContent = 'Could not save in this browser.'; return; }
        delete seen[keyOf(category, sub)];
        save(SEEN_KEY, seen);
        modal.hide();
        toast('Deleted “' + sub + '”');
    }

    modalEl.addEventListener('hidden.bs.modal', () => { if (modalEdit) setEditMode(false); });
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
        source = await createSource(custom, serverStructure, offline.record);
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
        else if (next.type === 'characters') history_replace('#' + CHAR_HASH);
        else if (next.type === 'party') history_replace('#' + PARTY_HASH);
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
        if (offline.record && !offline.reachable) {
            parts.push(el('span', {}, icon('wifi-off'), ' Offline: using your saved tables (updated ' + new Date(offline.record.savedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ')'));
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
        renderBackupContents();
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
        renderTheme();
        renderOfflineSettings();
        renderRollingOptions();
        renderIcons();
        renderVisibility();
    }

    // ---------- Rolling options (no repeats) ----------
    const rollingUi = { radios: () => document.querySelectorAll('input[name="cz-repeat"]'), foot: $('cz-repeat-foot'), count: $('cz-seen-count'), fresh: $('cz-start-fresh') };

    function renderRollingOptions() {
        for (const r of rollingUi.radios()) r.checked = r.value === (noRepeat ? 'none' : 'allow');
        const seenTotal = Object.keys(seen).reduce((n, key) => {
            const [category, sub] = key.split('|');
            return n + seenIn(category, sub).length;
        }, 0);
        rollingUi.foot.hidden = !noRepeat;
        rollingUi.count.textContent = seenTotal ? plural(seenTotal, 'prompt') + ' seen so far' : 'Nothing seen yet';
        rollingUi.fresh.hidden = !seenTotal;
    }
    for (const radio of rollingUi.radios()) {
        radio.addEventListener('change', () => {
            if (!radio.checked) return;
            setNoRepeat(radio.value === 'none');
            renderRollingOptions();
            toast(noRepeat ? 'No repeats: each table goes through every entry first' : 'Repeats allowed again');
        });
    }
    rollingUi.fresh.addEventListener('click', () => {
        startFresh();
        renderRollingOptions();
        toast('Starting fresh: every entry is back in play');
    });

    // ---------- Theme picker (presets + custom colours; see theme.js) ----------
    const T = window.DndTheme;
    const themeUi = { presets: $('cz-theme-presets'), custom: $('cz-theme-custom') };
    let themeState = T.load();

    function setTheme(next) {
        themeState = next;
        T.save(themeState);
        T.apply(themeState);
    }

    function themeSwatch(colors) {
        return el('span', { class: 'theme-swatch', style: 'background:' + colors.bg, 'aria-hidden': 'true' },
            el('span', { class: 'theme-swatch-card', style: 'background:' + colors.surface + ';border-color:' + colors.accent },
                el('span', { class: 'theme-swatch-line', style: 'background:' + colors.text }),
                el('span', { class: 'theme-swatch-line is-short', style: 'background:' + colors.accent })),
            el('span', { class: 'theme-swatch-paper', style: 'background:' + colors.paper },
                el('span', { class: 'theme-swatch-line', style: 'background:' + colors.ink }),
                el('span', { class: 'theme-swatch-dot', style: 'background:' + colors.danger })));
    }

    function renderTheme() {
        const active = themeState.preset;
        const presetCards = Object.entries(T.PRESETS).map(([key, p]) => el('button', {
            type: 'button',
            class: 'theme-card',
            'aria-pressed': String(active === key),
            onclick: () => { setTheme({ ...themeState, preset: key }); renderTheme(); },
        }, themeSwatch(p.colors), el('span', { class: 'theme-name', text: p.name }), el('span', { class: 'theme-blurb', text: p.blurb })));

        const customColors = T.resolve({ ...themeState, preset: 'custom' });
        const customCard = el('button', {
            type: 'button',
            class: 'theme-card',
            'aria-pressed': String(active === 'custom'),
            onclick: () => {
                // First time: start from the theme you're on now
                const startFrom = T.PRESETS[active] ? active : 'tavern';
                const customState = themeState.custom?.colors ? themeState.custom : { base: startFrom, colors: { ...T.PRESETS[startFrom].colors } };
                setTheme({ preset: 'custom', custom: customState });
                renderTheme();
            },
        }, themeSwatch(customColors), el('span', { class: 'theme-name' }, icon('sliders'), ' Custom'), el('span', { class: 'theme-blurb', text: 'Your own colours' }));

        fill(themeUi.presets, ...presetCards, customCard);
        themeUi.custom.hidden = active !== 'custom';
        if (active === 'custom') renderThemeEditor();
    }

    function contrast(a, b) {
        const [l1, l2] = [T.luminance(a), T.luminance(b)].sort((x, y) => y - x);
        return (l1 + 0.05) / (l2 + 0.05);
    }

    function renderThemeEditor() {
        const colors = T.resolve(themeState);
        const warning = el('p', { class: 'dice-info theme-warning', 'aria-live': 'polite' });
        const checkContrast = () => {
            const c = T.resolve(themeState);
            const issues = [];
            if (contrast(c.text, c.bg) < 4.5 || contrast(c.text, c.surface) < 4.5) issues.push('Text may be hard to read on the background or cards.');
            if (contrast(c.ink, c.paper) < 4.5) issues.push('Paper text may be hard to read on the result paper.');
            warning.textContent = issues.join(' ');
        };
        let saveTimer;
        const rows = T.FIELDS.map((f) => {
            const hex = el('code', { class: 'theme-hex', text: colors[f.key] });
            const input = el('input', {
                type: 'color',
                value: colors[f.key],
                'aria-label': f.label + ' colour',
                oninput: (e) => {
                    const value = e.currentTarget.value;
                    hex.textContent = value;
                    themeState = { preset: 'custom', custom: { ...themeState.custom, colors: { ...T.resolve(themeState), [f.key]: value } } };
                    T.apply(themeState); // live preview
                    clearTimeout(saveTimer);
                    saveTimer = setTimeout(() => { T.save(themeState); renderThemeCardsOnly(); }, 250);
                    checkContrast();
                },
            });
            return el('label', { class: 'theme-field' }, input, el('span', { class: 'theme-field-text' }, el('span', { text: f.label }), hex));
        });
        const baseSelect = el('select', {
            class: 'be-input theme-base',
            'aria-label': 'Start from a preset',
            onchange: (e) => {
                const base = e.currentTarget.value;
                setTheme({ preset: 'custom', custom: { base, colors: { ...T.PRESETS[base].colors } } });
                renderTheme();
            },
        }, ...Object.entries(T.PRESETS).map(([key, p]) => {
            const o = el('option', { value: key, text: p.name });
            o.selected = key === (themeState.custom?.base || 'tavern');
            return o;
        }));
        fill(themeUi.custom,
            el('div', { class: 'theme-fields' }, ...rows),
            el('div', { class: 'theme-custom-foot' },
                el('label', { class: 'theme-reset' }, el('span', { text: 'Reset to' }), baseSelect),
                warning));
        checkContrast();
    }

    // Refresh just the preset/custom cards (keeps the colour inputs, so a picker stays open)
    function renderThemeCardsOnly() {
        const customCard = themeUi.presets.lastElementChild;
        const swatch = customCard?.querySelector('.theme-swatch');
        if (swatch) swatch.replaceWith(themeSwatch(T.resolve(themeState)));
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
        if (custom && !window.confirm('Loading this file replaces your current tables, including any edits and personal copies. Export them first if you want to keep them. Continue?')) return;
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

    // ---------- Offline copy & installable app ----------
    // The built-in tables are only saved after the user agrees: via the one-time offer card,
    // Customize › Offline & app, or the install dialog. Installing from the browser's own menu
    // can't be intercepted, so the offer appears right after (appinstalled) or on first launch.
    const OFFER_KEY = 'dnd.offlineOffer';         // 'dismissed' once the user says "Not now"
    const OFFER_APP_KEY = 'dnd.offlineOfferApp';  // same, for the installed app
    const offline = { record: null, reachable: true, retryTimer: null, saving: false };
    let deferredInstall = null; // beforeinstallprompt event (Chrome/Edge/Android)

    const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

    async function useBundle(bundle, record) {
        offline.record = record;
        serverStructure = record.structure;
        serverRecipes = record.combos;
        setBaseData(record.data);
        await loadSource();
        refresh();
    }

    // Download and save the tables (only ever called after the user agreed)
    async function saveOffline() {
        if (offline.saving) return false;
        offline.saving = true;
        renderOfflineSettings();
        try {
            const bundle = await api(['bundle']);
            const record = await offlineData.save(bundle);
            await useBundle(bundle, record);
            offline.reachable = true;
            hideOffer();
            toast('Tables saved. The generator now works offline');
            return true;
        } catch (err) {
            $('cz-offline-error').textContent = 'Couldn’t save the tables (' + (err.message || err) + '). Check your connection and try again.';
            toast('Couldn’t save the tables');
            return false;
        } finally {
            offline.saving = false;
            renderOfflineSettings();
        }
    }

    async function removeOffline() {
        await offlineData.clear();
        offline.record = null;
        setBaseData(null);
        try {
            const [structureNow, combosNow] = await Promise.all([api(['structure']), api(['combos']).catch(() => serverRecipes)]);
            serverStructure = structureNow;
            serverRecipes = combosNow;
        } catch { /* keep what we have; the server source will retry on use */ }
        await loadSource();
        refresh();
        toast('Saved tables removed. Prompts now come from the server');
    }

    // Ask the server (with a time limit) whether the saved tables are still current
    async function checkForUpdates({ announce = false } = {}) {
        if (!offline.record) return;
        clearTimeout(offline.retryTimer);
        let health;
        try {
            health = await fetchJson('/api/health', 10000);
        } catch {
            offline.reachable = false;
            renderBanner();
            renderOfflineSettings();
            offline.retryTimer = setTimeout(() => checkForUpdates(), 60000); // try again in a minute
            if (announce) toast('Can’t reach the server right now. Your saved tables still work');
            return;
        }
        offline.reachable = true;
        if (health.data_version && health.data_version !== offline.record.version) {
            try {
                const bundle = await api(['bundle']);
                await useBundle(bundle, await offlineData.save(bundle));
                toast('Your saved tables were updated');
            } catch { /* try again next time */ }
        } else if (announce) {
            toast('Your saved tables are up to date');
        }
        renderBanner();
        renderOfflineSettings();
    }
    window.addEventListener('online', () => checkForUpdates());
    window.addEventListener('offline', () => { if (offline.record) { offline.reachable = false; renderBanner(); renderOfflineSettings(); } });

    // ----- One-time offer card -----
    const offerEl = $('offline-offer');
    function hideOffer() { offerEl.hidden = true; fill(offerEl); }

    function maybeOfferOffline() {
        if (offline.record) return;
        const appMode = isStandalone();
        if (localStorage.getItem(appMode ? OFFER_APP_KEY : OFFER_KEY) === 'dismissed') return;
        showOffer(appMode ? 'app' : 'site');
    }

    function showOffer(kind) {
        if (offline.record) return;
        const title = kind === 'installed' ? 'App installed. Use it offline too?' : kind === 'app' ? 'Use the app offline?' : 'Use it offline?';
        const text = 'Save the built-in tables in this browser (about 2 MB) so the generator works without internet and opens instantly. Nothing is sent anywhere, and you can remove it any time in Customize.';
        fill(offerEl,
            el('div', { class: 'offline-offer-icon' }, icon('cloud-arrow-down')),
            el('div', { class: 'offline-offer-body' },
                el('strong', { text: title }),
                el('p', { text }),
                el('div', { class: 'offline-offer-actions' },
                    el('button', { type: 'button', class: 'btn-gold btn-sm-gold', onclick: () => saveOffline() }, icon('download'), ' Save tables (about 2 MB)'),
                    el('button', {
                        type: 'button', class: 'link-btn',
                        onclick: () => { try { localStorage.setItem(isStandalone() ? OFFER_APP_KEY : OFFER_KEY, 'dismissed'); } catch { /* ignore */ } hideOffer(); },
                    }, 'Not now'))));
        offerEl.hidden = false;
    }

    // ----- Customize › Offline & app -----
    function renderOfflineSettings() {
        const saved = !!offline.record;
        for (const r of document.querySelectorAll('input[name="cz-offline"]')) {
            r.checked = r.value === (saved ? 'saved' : 'online');
            r.disabled = offline.saving;
        }
        const foot = $('cz-offline-foot');
        foot.hidden = !saved && !offline.saving;
        $('cz-offline-status').textContent = offline.saving
            ? 'Saving the tables…'
            : saved
                ? plural(offline.record.prompts, 'prompt') + ' saved ' + shortDate(offline.record.savedAt) + (offline.reachable ? '' : ' · server not reachable, using the saved copy')
                : '';
        $('cz-offline-update').hidden = !saved || offline.saving;
        renderInstallOptions();
    }

    function renderInstallOptions() {
        const box = $('cz-install');
        if (isStandalone()) {
            fill(box, el('p', { class: 'cz-sub' }, icon('check-circle'), ' You’re using the installed app.'));
        } else if (deferredInstall) {
            fill(box, el('button', { type: 'button', class: 'btn-outline-gold btn-sm-gold', onclick: installApp }, icon('box-arrow-down'), ' Install the app'),
                el('p', { class: 'cz-sub install-hint', text: 'Opens in its own window, like any other app on this device.' }));
        } else if (isIOS()) {
            fill(box, el('p', { class: 'cz-sub' }, icon('phone'), ' To install on iPhone or iPad: tap ', icon('box-arrow-up'), ' Share, then “Add to Home Screen”.'));
        } else {
            fill(box, el('p', { class: 'cz-sub', text: 'To install, use your browser’s “Install app” option (Chrome and Edge show it in the address bar or menu).' }));
        }
    }

    for (const radio of document.querySelectorAll('input[name="cz-offline"]')) {
        radio.addEventListener('change', async () => {
            if (!radio.checked) return;
            $('cz-offline-error').textContent = '';
            if (radio.value === 'saved' && !offline.record) {
                await saveOffline();
            } else if (radio.value === 'online' && offline.record) {
                if (window.confirm('Remove the saved tables from this browser? The generator will need the internet again.')) await removeOffline();
                renderOfflineSettings();
            }
        });
    }
    $('cz-offline-update').addEventListener('click', () => checkForUpdates({ announce: true }));

    // ----- Installing -----
    const installModalEl = $('installModal');
    const installModal = new bootstrap.Modal(installModalEl);

    async function promptInstall() {
        if (!deferredInstall) return;
        const evt = deferredInstall;
        deferredInstall = null;
        evt.prompt();
        try { await evt.userChoice; } catch { /* ignore */ }
        renderInstallOptions();
    }

    // Our Install button: explain saving the tables before the browser's prompt
    function installApp() {
        if (offline.record) { promptInstall(); return; }
        installModal.show();
    }
    $('install-only').addEventListener('click', () => { installModal.hide(); promptInstall(); });
    $('install-and-save').addEventListener('click', async () => {
        installModal.hide();
        await promptInstall();      // the browser requires the prompt to follow the click directly
        await saveOffline();
    });

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault(); // we show our own Install button (in Customize) instead
        deferredInstall = e;
        renderInstallOptions();
    });
    // Installed from the browser's own menu: we couldn't ask first, so ask now
    window.addEventListener('appinstalled', () => {
        deferredInstall = null;
        renderInstallOptions();
        if (!offline.record) showOffer('installed');
    });

    // ---------- Backup file ----------
    // Everything this browser keeps, downloaded as one file and restored by the user on another
    // device. Nothing goes to the server; see backup.js for what's included.
    const bk = {
        contents: $('cz-backup-contents'), restore: $('cz-backup-restore'), from: $('cz-backup-from'),
        parts: $('cz-backup-parts'), file: $('cz-backup-file'), error: $('cz-backup-error'), apply: $('cz-backup-apply'),
    };
    let pendingBackup = null;

    const readLocal = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };

    function renderBackupContents() {
        const bits = [];
        if (custom && !Edits.isEmptyRecord(custom)) bits.push(plural(custom.tables, 'table') + ' of your own');
        if (builds.length) bits.push(plural(builds.length, 'Quick build'));
        if (rollList.length) bits.push(plural(rollList.length, 'saved roll'));
        if (characters.length) bits.push(plural(characters.length, 'character'));
        if (initState.combatants.length) bits.push('the initiative tracker');
        if (pins.length) bits.push(plural(pins.length, 'pin'));
        bk.contents.textContent = bits.length
            ? 'Includes ' + bits.join(', ') + ', plus your theme and settings.'
            : 'Includes your theme and settings. Tables, builds and rolls you make will be added too.';
    }

    async function exportBackup() {
        bk.error.textContent = '';
        const settings = {};
        for (const [name, key] of Object.entries(Backup.SETTINGS_KEYS)) settings[name] = readLocal(key);
        const backup = Backup.makeBackup({
            custom: await customData.load(),
            builds: await userBuilds.load(),
            rolls: await savedRolls.load(),
            characters: await characterData.load(),
            parties: await partiesData.load(),
            initiative: readLocal(Backup.INITIATIVE_KEY),
            history: readLocal(Backup.HISTORY_KEY),
            settings,
        });
        downloadJson(backup, Backup.backupFilename());
        toast('Backup downloaded');
    }

    function closeRestore() {
        pendingBackup = null;
        bk.restore.hidden = true;
        bk.file.value = '';
    }

    async function pickBackup(file) {
        closeRestore();
        bk.error.textContent = '';
        if (!file) return;
        if (file.size > MAX_FILE_BYTES) { bk.error.textContent = 'That file is too big to be a backup.'; return; }
        try {
            pendingBackup = Backup.parseBackup(await file.text());
        } catch (err) {
            bk.error.textContent = err instanceof ValidationError ? err.issues.join(' ') : 'Couldn’t read that file.';
            return;
        }
        const when = pendingBackup.exportedAt ? new Date(pendingBackup.exportedAt) : null;
        bk.from.textContent = 'Backup from ' + (when && !isNaN(when) ? when.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'an unknown date') + '. Choose what to restore:';
        fill(bk.parts, el('legend', { class: 'visually-hidden', text: 'What to restore' }),
            ...Backup.PARTS.filter((name) => pendingBackup.parts[name]).map((name) => {
                const part = pendingBackup.parts[name];
                const box = el('input', { type: 'checkbox', value: name });
                box.checked = true;
                box.addEventListener('change', updateApply);
                return el('label', { class: 'cz-mode' }, box, el('span', {}, el('strong', { text: part.title }), el('small', { text: part.detail })));
            }));
        updateApply();
        bk.restore.hidden = false;
        bk.restore.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function chosenParts() {
        return [...bk.parts.querySelectorAll('input:checked')].map((b) => b.value);
    }
    function updateApply() { bk.apply.disabled = !chosenParts().length; }

    async function applyBackup() {
        const chosen = chosenParts();
        if (!pendingBackup || !chosen.length) return;
        const { parts } = pendingBackup;
        const setLocal = (key, value) => localStorage.setItem(key, JSON.stringify(value));
        bk.apply.disabled = true;
        try {
            for (const name of chosen) {
                const { value } = parts[name];
                if (name === 'tables') {
                    if (Edits.isEmptyRecord(value)) await customData.clear(); else await customData.save(value);
                } else if (name === 'builds') {
                    await userBuilds.save(value);
                } else if (name === 'rolls') {
                    await savedRolls.save(value);
                } else if (name === 'characters') {
                    await characterData.save(value.characters);
                    await partiesData.save(value.parties);
                } else if (name === 'initiative') {
                    setLocal(Backup.INITIATIVE_KEY, value);
                } else if (name === 'history') {
                    setLocal(Backup.HISTORY_KEY, value);
                } else if (name === 'settings') {
                    for (const [key, v] of Object.entries(value)) setLocal(Backup.SETTINGS_KEYS[key], v);
                }
            }
        } catch {
            bk.error.textContent = 'Couldn’t save everything in this browser (it may be out of space or in private mode). Some parts may not have been restored.';
            bk.apply.disabled = false;
            return;
        }
        // Start again from the restored data, so every part of the page picks it up
        try { sessionStorage.setItem('dnd.restored', '1'); } catch { /* ignore */ }
        location.reload();
    }

    $('cz-backup-export').addEventListener('click', () => exportBackup().catch(() => { bk.error.textContent = 'Couldn’t create the backup in this browser.'; }));
    bk.file.addEventListener('change', () => pickBackup(bk.file.files[0]));
    $('cz-backup-cancel').addEventListener('click', closeRestore);
    bk.apply.addEventListener('click', applyBackup);
    try {
        if (sessionStorage.getItem('dnd.restored')) {
            sessionStorage.removeItem('dnd.restored');
            setTimeout(() => toast('Backup restored'), 600);
        }
    } catch { /* ignore */ }

    // ---------- Waking the server ----------
    // The free Render server sleeps when idle. The page may come from the service worker's saved
    // copy (sw.js) while the API is still starting, so: show a friendly screen if loading takes
    // more than a moment, and keep retrying until the server answers (up to 2 minutes).
    const WAKE_LIMIT_MS = 120000;
    const wake = { screen: $('wake-screen'), title: $('wake-title'), text: $('wake-text'), elapsed: $('wake-elapsed'), retry: $('wake-retry') };
    wake.retry.addEventListener('click', () => location.reload());

    async function whenServerReady(load) {
        const started = Date.now();
        const showTimer = setTimeout(() => { wake.screen.hidden = false; }, 800);
        const tick = setInterval(() => {
            const s = Math.round((Date.now() - started) / 1000);
            wake.elapsed.textContent = s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
        }, 1000);
        try {
            for (let attempt = 0; ; attempt++) {
                try {
                    return await load();
                } catch (err) {
                    if (Date.now() - started > WAKE_LIMIT_MS) throw err;
                    await new Promise((r) => setTimeout(r, Math.min(1500 + attempt * 1000, 5000)));
                }
            }
        } finally {
            clearTimeout(showTimer);
            clearInterval(tick);
            if (!wake.screen.hidden && wake.retry.hidden) {
                wake.screen.classList.add('is-done');
                setTimeout(() => { wake.screen.hidden = true; wake.screen.classList.remove('is-done'); }, 350);
            }
        }
    }

    function showWakeFailure() {
        wake.screen.hidden = false;
        wake.screen.classList.add('is-failed');
        wake.title.textContent = 'The tavern is still closed';
        wake.text.textContent = 'The server didn’t wake up in time. It may be restarting, or you may be offline.';
        wake.elapsed.textContent = '';
        wake.retry.hidden = false;
        wake.retry.focus();
    }

    // ---------- Init ----------
    const pendingShare = takeShareToken();
    renderPins();
    renderHistory();

    // With a saved copy, start instantly (no waiting for a sleeping server) and check for updates after
    async function loadTables() {
        offline.record = await offlineData.load();
        if (offline.record) {
            setBaseData(offline.record.data);
            return { structure: offline.record.structure, combos: offline.record.combos, fromSaved: true };
        }
        const [structureNow, combosNow] = await whenServerReady(() => Promise.all([api(['structure']), api(['combos']).catch(() => [])]));
        return { structure: structureNow, combos: combosNow, fromSaved: false };
    }

    loadTables()
        .then(async ({ structure: data, combos: comboList, fromSaved }) => {
            serverStructure = data;
            serverRecipes = comboList;
            setTimeout(() => (fromSaved ? checkForUpdates() : maybeOfferOffline()), 1200);
            builds = await userBuilds.load();
            rollList = await savedRolls.load();
            characters = await characterData.load();
            parties = Party.normalizeParties(await partiesData.load(), characters.map((c) => c.id));
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
            showWakeFailure();
        });

    window.addEventListener('hashchange', () => {
        const token = takeShareToken();
        if (token) { handleShareToken(token); return; }
        const next = viewFromHash();
        if (!next) return;
        if (next.type === 'combos') goToCombos();
        else if (next.type === 'dice') goToDice();
        else if (next.type === 'initiative') goToInitiative();
        else if (next.type === 'characters') goToCharacters();
        else if (next.type === 'party') goToParty();
        else goToCategory(next.name);
    });
}
