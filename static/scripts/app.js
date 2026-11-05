// D&D Prompt Helper – cards page (ES module)
import {
    api, customData, createSource, parseCustomJson, ValidationError, downloadJson, MAX_FILE_BYTES,
} from './data.js';

{
    const HISTORY_KEY = 'dnd.history';
    const HIDDEN_KEY = 'dnd.hidden';
    const PINS_KEY = 'dnd.pins';
    const HISTORY_LIMIT = 10;
    const MIN_TEXT_SEARCH = 3;

    const QUICK_HASH = 'quick-builds';
    const QUICK_LABEL = 'Quick build';


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
    let recipes = [];         // quick build recipes from the server
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
        if (combos.length) {
            items.push(el('li', { class: 'cat-nav-sep', 'aria-hidden': 'true' }));
            items.push(navButton({
                iconName: 'lightning-charge',
                label: 'Quick builds',
                count: combos.length,
                title: 'Roll several tables at once',
                current: view && view.type === 'combos',
                onclick: goToCombos,
                extraClass: 'cat-btn-quick',
            }));
        }
        els.nav.replaceChildren(...items);
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

    // View named by the URL hash, or null if it doesn't match anything
    function viewFromHash() {
        const name = decodeURIComponent(location.hash.slice(1));
        if (name === QUICK_HASH && combos.length) return { type: 'combos' };
        return structure.some((c) => c.name === name) ? { type: 'category', name } : null;
    }

    function setView(next) {
        view = next;
        if (view.type === 'category') lastCategory = view.name;
        renderNav();
        renderContent();
    }

    // First thing worth showing: the hash, the current view if still valid, else the first category
    function fallbackView() {
        const stillValid = view && (
            (view.type === 'category' && structure.some((c) => c.name === view.name)) ||
            (view.type === 'combos' && combos.length) ||
            view.type === 'search');
        if (stillValid) return view;
        if (structure.length) return { type: 'category', name: structure[0].name };
        if (combos.length) return { type: 'combos' };
        return { type: 'empty' };
    }

    // ---------- Content ----------
    function renderContent() {
        if (view.type === 'category') renderCategory(view.name);
        else if (view.type === 'combos') renderCombos();
        else if (view.type === 'search') renderSearch(view.q);
        else renderEmpty();
    }

    function renderEmpty() {
        els.content.replaceChildren(
            el('div', { class: 'empty-state empty-state-lg' },
                icon('eye-slash'),
                el('p', { text: 'Every table is hidden.' }),
                el('button', { type: 'button', class: 'btn-gold', onclick: openCustomize },
                    icon('sliders'), el('span', { text: 'Choose tables to show' }))));
    }

    function renderCategory(name) {
        const cat = structure.find((c) => c.name === name);
        els.content.replaceChildren(
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
    function renderCombos() {
        els.content.replaceChildren(
            el('div', { class: 'content-head' },
                el('div', { class: 'content-kicker', text: plural(combos.length, 'generator') }),
                el('h1', { class: 'content-title', text: 'Quick builds' }),
                el('p', { class: 'content-blurb', text: 'Roll several tables at once for a ready-to-use NPC, tavern, town and more. Reroll any single line you don’t like.' })),
            el('div', { class: 'combo-grid' }, ...combos.map(renderComboCard)));
    }

    function renderComboCard(combo) {
        return el('article', { class: 'combo-card' + (activeKey === 'combo|' + combo.id ? ' active' : ''), 'data-key': 'combo|' + combo.id },
            el('div', { class: 'combo-head' },
                el('span', { class: 'combo-icon' }, icon(combo.icon)),
                el('h2', { class: 'combo-title', text: combo.title })),
            el('p', { class: 'combo-blurb', text: combo.blurb }),
            el('ul', { class: 'combo-parts' }, ...combo.parts.map((p) =>
                el('li', { title: p.category + ' › ' + p.sub, text: p.label }))),
            el('button', {
                type: 'button',
                class: 'btn-gold',
                onclick: () => rollCombo(combo.id),
            }, icon('dice-5'), el('span', { text: 'Roll ' + combo.title.replace(/^Quick /, '') })));
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
            if (!combo) throw new Error('not available');
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
        els.content.replaceChildren(
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
            promptSection.replaceChildren(el('p', { class: 'side-list-empty', text: 'Type at least ' + MIN_TEXT_SEARCH + ' letters to search inside prompts.' }));
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
                    promptSection.replaceChildren(el('p', { class: 'empty-state', text: 'No prompts contain “' + needle + '”.' }));
                    return;
                }
                promptSection.replaceChildren(
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
                promptSection.replaceChildren(el('p', { class: 'empty-state', text: 'Search failed (' + err.message + ').' }));
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
        if (item.parts) {
            els.text.replaceChildren(el('dl', { class: 'result-parts' }, ...item.parts.map((p, i) =>
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
                    el('dd', { text: p.text })))));
        } else {
            els.text.textContent = item.text;
        }
        if (animate) restartAnimation('revealed');
        els.reroll.disabled = els.copy.disabled = els.pin.disabled = false;
        updatePinButton();
    }

    // ---------- Result actions ----------
    const rollAgain = () => {
        if (!current) return;
        if (current.comboId) rollCombo(current.comboId);
        else roll(current.category, current.sub);
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
        els.pinnedList.replaceChildren(...pins.map((p) =>
            renderSideItem(p, { icon: 'x-lg', label: 'Unpin', run: () => togglePin(p) })));
        els.pinnedEmpty.hidden = pins.length > 0;
    }

    function renderHistory() {
        els.historyList.replaceChildren(...history.map((h) => {
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
        els.modalList.replaceChildren(el('li', { class: 'text-body-secondary', text: 'Loading…' }));
        modal.show();
        try {
            const entries = await source.entries(category, sub);
            if (!modalTable || modalTable.category !== category || modalTable.sub !== sub) return;
            modalTable.entries = entries;
            renderEntries();
        } catch (err) {
            els.modalList.replaceChildren(el('li', { class: 'text-danger', text: 'Could not load entries (' + err.message + ').' }));
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
                                btn.replaceChildren(icon(on ? 'pin-angle-fill' : 'pin-angle'));
                            },
                        }, icon(pinned ? 'pin-angle-fill' : 'pin-angle'))))));
        });
        els.modalList.replaceChildren(...(rows.length ? rows : [el('li', { class: 'text-body-secondary', text: 'No entries match.' })]));
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
        combos = recipes
            .map((r) => ({ ...r, parts: r.parts.filter((p) => available.has(keyOf(p.category, p.sub))) }))
            .filter((r) => r.parts.length >= 2); // one line isn't much of a "build"
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
        if (!parts.length) { els.banner.replaceChildren(); return; }
        els.banner.replaceChildren(
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
            cz.status.replaceChildren(
                el('div', { class: 'cz-status-card is-custom' },
                    icon('check-circle-fill'),
                    el('div', {},
                        el('strong', { text: custom.name || 'Your file' }),
                        el('small', { text: plural(custom.tables, 'table') + ' · ' + plural(custom.prompts, 'prompt') + (when ? ' · loaded ' + when : '') }))));
        } else {
            cz.status.replaceChildren(
                el('div', { class: 'cz-status-card' },
                    icon('info-circle'),
                    el('div', {},
                        el('strong', { text: 'Using the built-in tables' }),
                        el('small', { text: 'Load a JSON file to add your own tables or replace them entirely.' }))));
        }
        const mode = custom ? custom.mode : pendingMode;
        for (const radio of cz.modes()) radio.checked = radio.value === mode;
        cz.exportBtn.hidden = cz.resetBtn.hidden = !custom;
        renderVisibility();
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
        cz.messages.replaceChildren(
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
        cz.messages.replaceChildren();
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
        const ok = await applyCustom({
            mode: pendingMode,
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
        cz.messages.replaceChildren();
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
        cz.visList.replaceChildren(...(groups.length ? groups : [el('p', { class: 'side-list-empty', text: 'No tables match.' })]));
    }

    cz.visFilter.addEventListener('input', renderVisibility);
    const allKeys = () => allStructure.flatMap((c) => c.subcategories.map((s) => keyOf(c.name, s.name)));
    cz.showAll.addEventListener('click', () => setHidden(allKeys(), false));
    cz.hideAll.addEventListener('click', () => setHidden(allKeys(), true));

    // ---------- Init ----------
    renderPins();
    renderHistory();
    Promise.all([api(['structure']), api(['combos']).catch(() => [])])
        .then(async ([data, comboList]) => {
            serverStructure = data;
            recipes = comboList;
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
        })
        .catch((err) => {
            els.content.replaceChildren(el('div', { class: 'empty-state', text: 'Could not load categories (' + err.message + '). Refresh to try again.' }));
        });

    window.addEventListener('hashchange', () => {
        const next = viewFromHash();
        if (!next) return;
        if (next.type === 'combos') goToCombos();
        else goToCategory(next.name);
    });
}
