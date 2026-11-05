// D&D Prompt Helper – cards page
(() => {
    'use strict';

    const HISTORY_KEY = 'dnd.history';
    const PINS_KEY = 'dnd.pins';
    const HISTORY_LIMIT = 10;

    const $ = (id) => document.getElementById(id);
    const els = {
        categories: $('categories'),
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
        modalTitle: $('entriesModalLabel'),
        modalList: $('entriesList'),
    };

    // Current result: { category, sub, text } or null
    let current = null;
    let rollSeq = 0;          // ignore stale responses when rolling quickly
    let activeButton = null;

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
    const api = (path, params) => {
        const qs = params ? '?' + new URLSearchParams(params) : '';
        return fetch('/api/' + path.map(encodeURIComponent).join('/') + qs).then((res) => {
            if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
            return res.json();
        });
    };

    // ---------- DOM helpers ----------
    function el(tag, attrs = {}, ...children) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'class') node.className = v;
            else if (k === 'text') node.textContent = v;
            else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
            else node.setAttribute(k, v);
        }
        for (const c of children) if (c) node.append(c);
        return node;
    }
    const icon = (name) => el('i', { class: 'bi bi-' + name, 'aria-hidden': 'true' });
    const crumbOf = (item) => item.category + ' › ' + item.sub;
    const sameItem = (a, b) => a && b && a.category === b.category && a.sub === b.sub && a.text === b.text;

    // ---------- Categories ----------
    function renderCategories(structure) {
        els.categories.replaceChildren(
            ...structure.map((cat) => {
                const total = cat.subcategories.reduce((n, s) => n + s.count, 0);
                const body = el('div', { class: 'card-body py-2' },
                    ...cat.subcategories.map((sub) => renderSubRow(cat.name, sub)));
                return el('section', { class: 'card category-card shadow-sm' },
                    el('div', { class: 'card-header' },
                        el('span', { text: cat.name }),
                        el('span', { class: 'badge text-bg-light fw-normal', text: total + ' prompts' })),
                    body);
            })
        );
    }

    function renderSubRow(category, sub) {
        const rollBtn = el('button', {
            type: 'button',
            class: 'btn btn-outline-dark btn-sm btn-roll',
            title: 'Roll a random ' + sub.name + ' prompt',
            onclick: (e) => roll(category, sub.name, e.currentTarget),
        }, el('span', { text: sub.name }), el('span', { class: 'count', text: sub.count }));

        const listBtn = el('button', {
            type: 'button',
            class: 'btn btn-outline-secondary btn-sm',
            title: 'Browse all ' + sub.name,
            'aria-label': 'Browse all ' + sub.name,
            onclick: () => showEntries(category, sub.name),
        }, icon('list-ul'));

        return el('div', { class: 'sub-row' }, rollBtn, listBtn);
    }

    // ---------- Rolling ----------
    async function roll(category, sub, button) {
        const seq = ++rollSeq;
        if (button) setActiveButton(button);
        els.panel.classList.add('loading');
        expandPanel();
        try {
            const text = await api(['r', category], { arg: sub });
            if (seq !== rollSeq) return;
            showResult({ category, sub, text });
            history = [{ category, sub, text }, ...history.filter((h) => !sameItem(h, { category, sub, text }))]
                .slice(0, HISTORY_LIMIT);
            save(HISTORY_KEY, history);
            renderHistory();
        } catch (err) {
            if (seq !== rollSeq) return;
            els.crumb.textContent = category + ' › ' + sub;
            els.text.textContent = 'Could not roll a prompt (' + err.message + '). Try again.';
            els.text.classList.add('text-danger');
        } finally {
            if (seq === rollSeq) els.panel.classList.remove('loading');
        }
    }

    function setActiveButton(button) {
        if (activeButton) activeButton.classList.remove('active');
        activeButton = button;
        button.classList.add('active');
    }

    function showResult(item) {
        current = item;
        els.crumb.textContent = crumbOf(item);
        els.text.textContent = item.text;
        els.text.classList.remove('text-muted', 'text-danger');
        els.reroll.disabled = els.copy.disabled = els.pin.disabled = false;
        updatePinButton();
    }

    // ---------- Result actions ----------
    els.reroll.addEventListener('click', () => {
        if (current) roll(current.category, current.sub);
    });

    els.copy.addEventListener('click', async () => {
        if (!current) return;
        const label = els.copy.querySelector('span');
        try {
            await copyText(current.text);
            label.textContent = 'Copied!';
        } catch {
            label.textContent = 'Copy failed';
        }
        setTimeout(() => { label.textContent = 'Copy'; }, 1500);
    });

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

    els.pin.addEventListener('click', () => {
        if (!current) return;
        if (isPinned(current)) {
            pins = pins.filter((p) => !sameItem(p, current));
        } else {
            pins = [{ ...current }, ...pins];
        }
        save(PINS_KEY, pins);
        renderPins();
        updatePinButton();
    });

    const isPinned = (item) => pins.some((p) => sameItem(p, item));

    function updatePinButton() {
        const pinned = current && isPinned(current);
        els.pin.querySelector('span').textContent = pinned ? 'Pinned' : 'Pin';
        els.pin.querySelector('i').className = 'bi ' + (pinned ? 'bi-pin-angle-fill' : 'bi-pin-angle');
        els.pin.classList.toggle('btn-warning', !!pinned);
        els.pin.classList.toggle('btn-outline-secondary', !pinned);
    }

    // Keyboard: R = roll again (ignored while typing or with a modal open)
    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() !== 'r' || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.target.closest('input, textarea, select, [contenteditable]')) return;
        if (document.querySelector('.modal.show')) return;
        if (current) { e.preventDefault(); roll(current.category, current.sub); }
    });

    // ---------- Mobile collapse ----------
    function setCollapsed(collapsed) {
        els.panel.classList.toggle('collapsed', collapsed);
        document.body.classList.toggle('result-collapsed', collapsed);
        els.collapse.setAttribute('aria-expanded', String(!collapsed));
    }
    const expandPanel = () => setCollapsed(false);
    els.collapse.addEventListener('click', () => setCollapsed(!els.panel.classList.contains('collapsed')));

    // ---------- Pinned & history lists ----------
    function renderSideItem(item, actionIcon, actionLabel, onAction) {
        return el('li', { class: 'side-item' },
            el('div', {
                class: 'side-item-body',
                title: 'Show this prompt',
                onclick: () => { showResult(item); expandPanel(); },
            },
                el('span', { class: 'side-item-crumb', text: crumbOf(item) }),
                el('span', { class: 'side-item-text', text: item.text })),
            el('button', {
                type: 'button',
                class: 'btn btn-link btn-sm text-secondary',
                title: actionLabel,
                'aria-label': actionLabel,
                onclick: onAction,
            }, icon(actionIcon)));
    }

    function renderPins() {
        els.pinnedList.replaceChildren(...pins.map((p) =>
            renderSideItem(p, 'x-lg', 'Unpin', () => {
                pins = pins.filter((x) => !sameItem(x, p));
                save(PINS_KEY, pins);
                renderPins();
                updatePinButton();
            })));
        els.pinnedEmpty.hidden = pins.length > 0;
    }

    function renderHistory() {
        els.historyList.replaceChildren(...history.map((h) =>
            renderSideItem(h, isPinned(h) ? 'pin-angle-fill' : 'pin-angle', 'Pin', () => {
                if (!isPinned(h)) {
                    pins = [{ ...h }, ...pins];
                    save(PINS_KEY, pins);
                    renderPins();
                    renderHistory();
                    updatePinButton();
                }
            })));
        els.historyEmpty.hidden = history.length > 0;
        els.clearHistory.hidden = history.length === 0;
    }

    els.clearHistory.addEventListener('click', () => {
        history = [];
        save(HISTORY_KEY, history);
        renderHistory();
    });

    // ---------- Entries modal ----------
    const modal = new bootstrap.Modal('#entriesModal');

    async function showEntries(category, sub) {
        els.modalTitle.textContent = category + ' › ' + sub;
        els.modalList.replaceChildren(el('li', { class: 'text-muted', text: 'Loading…' }));
        modal.show();
        try {
            const entries = await api([category], { arg: sub });
            els.modalList.replaceChildren(...entries.map((text) => el('li', { text })));
        } catch (err) {
            els.modalList.replaceChildren(el('li', { class: 'text-danger', text: 'Could not load entries (' + err.message + ').' }));
        }
    }

    // ---------- Init ----------
    renderPins();
    renderHistory();
    api(['structure'])
        .then(renderCategories)
        .catch((err) => {
            els.categories.replaceChildren(el('div', { class: 'alert alert-danger', text: 'Could not load categories (' + err.message + '). Refresh to try again.' }));
        });
})();
