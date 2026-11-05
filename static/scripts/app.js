// D&D Prompt Helper – cards page
(() => {
    'use strict';

    const HISTORY_KEY = 'dnd.history';
    const PINS_KEY = 'dnd.pins';
    const HISTORY_LIMIT = 10;
    const MIN_TEXT_SEARCH = 3;

    const CATEGORY_META = {
        Dungeon:   { icon: 'bricks',        blurb: 'Puzzles, traps, riddles and hidden doors for when the party heads underground.' },
        Encounter: { icon: 'shield-shaded', blurb: 'Things the party runs into on the road, sorted by terrain.' },
        Items:     { icon: 'gem',           blurb: 'Trinkets, treasures, potions and pocket contents — useful or otherwise.' },
        Misc:      { icon: 'stars',         blurb: 'Curses, diseases, plot twists, boons and other improvised flair.' },
        NPCs:      { icon: 'people',        blurb: '“Who’s that?” Shopkeepers, villains, familiars and their secrets.' },
        Quests:    { icon: 'map',           blurb: 'Hooks, side quests and travel events for when the party goes off-script.' },
        Town:      { icon: 'house-door',    blurb: 'Taverns, laws, festivals and factions to make a settlement feel lived-in.' },
    };
    const metaFor = (name) => CATEGORY_META[name] || { icon: 'dice-5', blurb: '' };

    const $ = (id) => document.getElementById(id);
    const els = {
        nav: $('cat-nav-list'),
        content: $('content'),
        search: $('search-input'),
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

    let structure = [];
    let view = null;          // { type: 'category', name } | { type: 'search', q }
    let lastCategory = null;
    let current = null;       // { category, sub, text }
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

    // ---------- API ----------
    function api(path, params) {
        const qs = params ? '?' + new URLSearchParams(params) : '';
        return fetch('/api/' + path.map(encodeURIComponent).join('/') + qs).then((res) => {
            if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
            return res.json();
        });
    }

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
    function renderNav() {
        els.nav.replaceChildren(...structure.map((cat) => {
            const total = cat.subcategories.reduce((n, s) => n + s.count, 0);
            const isCurrent = view && view.type === 'category' && view.name === cat.name;
            return el('li', {},
                el('button', {
                    type: 'button',
                    class: 'cat-btn',
                    'aria-current': isCurrent ? 'true' : 'false',
                    title: plural(total, 'prompt'),
                    onclick: () => goToCategory(cat.name),
                },
                    icon(metaFor(cat.name).icon),
                    el('span', { text: cat.name }),
                    el('span', { class: 'cat-count', text: cat.subcategories.length })));
        }));
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

    function categoryFromHash() {
        const name = decodeURIComponent(location.hash.slice(1));
        return structure.some((c) => c.name === name) ? name : null;
    }

    function setView(next) {
        view = next;
        if (view.type === 'category') lastCategory = view.name;
        renderNav();
        renderContent();
    }

    // ---------- Content ----------
    function renderContent() {
        if (view.type === 'category') renderCategory(view.name);
        else renderSearch(view.q);
    }

    function renderCategory(name) {
        const cat = structure.find((c) => c.name === name);
        const total = cat.subcategories.reduce((n, s) => n + s.count, 0);
        els.content.replaceChildren(
            el('div', { class: 'content-head' },
                el('div', { class: 'content-kicker', text: plural(cat.subcategories.length, 'table') + ' · ' + plural(total, 'prompt') }),
                el('h1', { class: 'content-title', text: cat.name }),
                el('p', { class: 'content-blurb', text: metaFor(cat.name).blurb })),
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
        for (const tile of els.content.querySelectorAll('.tile')) {
            tile.classList.toggle('active', tile.dataset.key === activeKey);
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
        api(['search'], { q: needle, limit: 50 })
            .then(({ total, results }) => {
                if (seq !== searchSeq) return;
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
        els.panel.classList.add('loading');
        restartAnimation('rolling');
        expandPanel();
        try {
            const text = await api(['r', category], { arg: sub });
            if (seq !== rollSeq) return;
            const item = { category, sub, text };
            showResult(item, { animate: true });
            history = [item, ...history.filter((h) => !sameItem(h, item))].slice(0, HISTORY_LIMIT);
            save(HISTORY_KEY, history);
            renderHistory();
        } catch (err) {
            if (seq !== rollSeq) return;
            els.crumb.textContent = category + ' › ' + sub;
            els.text.textContent = 'The dice rolled off the table (' + err.message + '). Try again.';
            els.text.className = 'result-text is-error';
        } finally {
            if (seq === rollSeq) els.panel.classList.remove('loading');
        }
    }

    function restartAnimation(cls) {
        els.panel.classList.remove(cls);
        void els.panel.offsetWidth; // reflow so the animation can replay
        els.panel.classList.add(cls);
    }

    function showResult(item, { animate = false } = {}) {
        current = item;
        els.crumb.textContent = crumbOf(item);
        els.text.textContent = item.text;
        els.text.className = 'result-text';
        if (animate) restartAnimation('revealed');
        els.reroll.disabled = els.copy.disabled = els.pin.disabled = false;
        updatePinButton();
    }

    // ---------- Result actions ----------
    els.reroll.addEventListener('click', () => {
        if (current) roll(current.category, current.sub);
    });

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
        if (e.target.closest('input, textarea, select, [contenteditable]')) return;
        if (document.querySelector('.modal.show')) return;
        if (e.key === '/') {
            e.preventDefault();
            els.search.focus();
        } else if (e.key.toLowerCase() === 'r' && current) {
            e.preventDefault();
            roll(current.category, current.sub);
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
            const entries = await api([category], { arg: sub });
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

    // ---------- Init ----------
    renderPins();
    renderHistory();
    api(['structure'])
        .then((data) => {
            structure = data;
            setView({ type: 'category', name: categoryFromHash() || structure[0].name });
        })
        .catch((err) => {
            els.content.replaceChildren(el('div', { class: 'empty-state', text: 'Could not load categories (' + err.message + '). Refresh to try again.' }));
        });

    window.addEventListener('hashchange', () => {
        const name = categoryFromHash();
        if (name) goToCategory(name);
    });
})();
