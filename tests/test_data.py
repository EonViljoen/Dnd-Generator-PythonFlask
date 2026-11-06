"""Checks on rpg_generator.json and catalog.py, so hand edits can't break the site. Run with: pytest"""
import re

from catalog import CATEGORY_META, COMBOS

MAX_ENTRY_LENGTH = 5000   # matches the in-browser editor's limit (static/scripts/edits.js)
MAX_NAME_LENGTH = 120


def all_entries(data):
    for category, subs in data.items():
        for table, entries in subs.items():
            for i, entry in enumerate(entries):
                yield f'{category} › {table} #{i + 1}', entry


def test_shape(data):
    assert isinstance(data, dict) and data
    for category, subs in data.items():
        assert isinstance(subs, dict) and subs, f'{category} has no tables'
        for table, entries in subs.items():
            assert isinstance(entries, list) and entries, f'{category} › {table} has no entries'


def test_entries_are_non_empty_text(data):
    bad = [where for where, e in all_entries(data) if not isinstance(e, str) or not e.strip()]
    assert not bad, f'empty or non-text entries: {bad[:10]}'


def test_entries_have_no_stray_spaces(data):
    bad = [where for where, e in all_entries(data) if e != e.strip()]
    assert not bad, f'entries with leading or trailing spaces: {bad[:10]}'


def test_no_duplicate_entries(data):
    bad = [f'{category} › {table}: {e[:60]}' for category, subs in data.items() for table, entries in subs.items()
           for i, e in enumerate(entries) if e in entries[:i]]
    assert not bad, 'entries listed twice in the same table:\n' + '\n'.join(bad[:10])


def test_entries_within_editor_limit(data):
    long = [where for where, e in all_entries(data) if len(e) > MAX_ENTRY_LENGTH]
    assert not long, f'entries longer than {MAX_ENTRY_LENGTH} characters: {long[:10]}'


def test_names(data):
    for category, subs in data.items():
        for name in [category, *subs]:
            assert name == name.strip() and name, f'name with stray spaces: {name!r}'
            assert len(name) <= MAX_NAME_LENGTH, f'name too long: {name!r}'
            assert '|' not in name, f'"|" is reserved in names: {name!r}'  # app joins "category|table"


def test_no_encoding_glitches(data):
    # Characters lost to "?" in an old conversion, e.g. "it?s", "doppelg?nger"
    glitch = re.compile(r'\w\?\w')
    bad = [f'{where}: …{e[max(0, m.start() - 15):m.end() + 15]}…'
           for where, e in all_entries(data) for m in [glitch.search(e)] if m]
    assert not bad, 'possible encoding glitches:\n' + '\n'.join(bad[:10])


def test_no_split_entries(data):
    # One item split across two entries, like the old "Artifacts of Great Power" + "Destroyed by:" pairs
    bad = [where for where, e in all_entries(data) if re.match(r'^\s*Destroyed by:', e)]
    assert not bad, f'entries that look like the second half of another: {bad[:10]}'


def test_catalog_categories_exist(data):
    missing = set(CATEGORY_META) - set(data)
    assert not missing, f'catalog.py has icons/blurbs for missing categories: {missing}'


def test_quick_builds_use_real_tables(data):
    ids = [c['id'] for c in COMBOS]
    assert len(ids) == len(set(ids)), 'duplicate Quick build ids'
    for combo in COMBOS:
        for label, category, table in combo['parts']:
            assert table in data.get(category, {}), f'Quick build {combo["id"]!r} line {label!r}: {category} › {table} not found'
