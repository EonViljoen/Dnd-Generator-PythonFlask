// Themes: presets plus a custom theme, saved in this browser.
// Loaded as a plain script in <head> so the theme is applied before the page paints (no flash).
// Exposes window.DndTheme for the theme picker in app.js.
(function () {
    'use strict';

    var KEY = 'dnd.theme';

    // Seven base colours per theme; style.css derives every other shade from these.
    var FIELDS = [
        { key: 'bg', cssVar: '--bg', label: 'Background' },
        { key: 'surface', cssVar: '--surface', label: 'Cards' },
        { key: 'text', cssVar: '--text', label: 'Text' },
        { key: 'accent', cssVar: '--gold', label: 'Accent' },
        { key: 'danger', cssVar: '--red', label: 'Highlight' },
        { key: 'paper', cssVar: '--parchment', label: 'Result paper' },
        { key: 'ink', cssVar: '--ink', label: 'Paper text' },
    ];

    var PRESETS = {
        tavern: { name: 'Tavern', blurb: 'Warm candlelight', colors: { bg: '#15110e', surface: '#1f1914', text: '#ece3d3', accent: '#d4a64a', danger: '#b8322a', paper: '#f1e5c8', ink: '#2a1f16' } },
        arcane: { name: 'Arcane', blurb: 'Violet spellfire', colors: { bg: '#110e1c', surface: '#1b172d', text: '#e7e2f6', accent: '#b48cff', danger: '#e0507a', paper: '#ece6fb', ink: '#251c3e' } },
        forest: { name: 'Forest', blurb: 'Moss and lantern', colors: { bg: '#0e140f', surface: '#172019', text: '#e1ead6', accent: '#9fcf6a', danger: '#d0683a', paper: '#ecefd9', ink: '#1e2a1b' } },
        frost: { name: 'Frost', blurb: 'Cold dungeon stone', colors: { bg: '#0d1217', surface: '#162029', text: '#e1e9f1', accent: '#6cb8e0', danger: '#d94a5c', paper: '#e8eef4', ink: '#16212c' } },
        parchment: { name: 'Parchment', blurb: 'Light and bright', colors: { bg: '#f2ebdd', surface: '#fbf7ee', text: '#2b2118', accent: '#9a6618', danger: '#a8322a', paper: '#efe1bf', ink: '#2b2118' } },
    };

    var HEX = /^#[0-9a-f]{6}$/i;

    function luminance(hex) {
        var n = parseInt(hex.slice(1), 16);
        var ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    }

    // Pick black-ish or white text for a fill colour, whichever contrasts more
    function onColor(hex) {
        var l = luminance(hex);
        return (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? '#1a140f' : '#ffffff';
    }

    // Stored theme: { preset: 'tavern' | ... | 'custom', custom: { base, colors } }
    // The custom colours are kept even while a preset is active, so switching back restores them.
    function resolve(theme) {
        theme = theme || {};
        var custom = theme.custom || {};
        var base = PRESETS[custom.base] ? custom.base : 'tavern';
        var preset = theme.preset === 'custom' ? null : (PRESETS[theme.preset] ? theme.preset : 'tavern');
        var colors = {};
        FIELDS.forEach(function (f) {
            if (preset) { colors[f.key] = PRESETS[preset].colors[f.key]; return; }
            var c = custom.colors ? custom.colors[f.key] : null;
            colors[f.key] = c && HEX.test(c) ? c.toLowerCase() : PRESETS[base].colors[f.key];
        });
        return colors;
    }

    function load() {
        try {
            var t = JSON.parse(localStorage.getItem(KEY));
            if (t && (PRESETS[t.preset] || t.preset === 'custom')) return t;
        } catch (e) { /* ignore */ }
        return { preset: 'tavern' };
    }

    function save(theme) {
        try { localStorage.setItem(KEY, JSON.stringify(theme)); } catch (e) { /* ignore */ }
    }

    function apply(theme) {
        var colors = resolve(theme);
        var root = document.documentElement;
        FIELDS.forEach(function (f) { root.style.setProperty(f.cssVar, colors[f.key]); });
        root.style.setProperty('--on-accent', onColor(colors.accent));
        root.style.setProperty('--on-danger', onColor(colors.danger));
        var light = luminance(colors.bg) > 0.4;
        root.dataset.mode = light ? 'light' : 'dark';
        root.dataset.theme = theme && theme.preset ? theme.preset : 'tavern';
        root.setAttribute('data-bs-theme', light ? 'light' : 'dark');
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', colors.bg);
        return colors;
    }

    window.DndTheme = { KEY: KEY, FIELDS: FIELDS, PRESETS: PRESETS, resolve: resolve, load: load, save: save, apply: apply, luminance: luminance };
    apply(load());
})();
