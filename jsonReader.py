import hashlib
import json
import logging
import os
import random

from catalog import COMBOS, category_meta

log = logging.getLogger(__name__)

DATA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'rpg_generator.json')


class JsonReader():
    """Loads the prompt data once and exposes read helpers.

    Lookups raise KeyError for unknown categories/sub-categories so the
    API layer can turn them into 404s.
    """
    data = {}
    combos = []
    version = None  # short hash of the data file; changes only when the prompts change

    def __init__(self):
        with open(DATA_PATH, 'rb') as file:
            raw = file.read()
        JsonReader.data = json.loads(raw.decode('utf8'))
        JsonReader.version = hashlib.sha256(raw).hexdigest()[:12]
        JsonReader.combos = JsonReader._valid_combos()

    @staticmethod
    def _valid_combos():
        """Drop combo parts whose table no longer exists, so a data edit can't 500 the page."""
        valid = []
        for combo in COMBOS:
            parts = []
            for label, category, sub in combo['parts']:
                if sub in JsonReader.data.get(category, {}):
                    parts.append((label, category, sub))
                else:
                    log.warning('Combo %r: table %s > %s not found, skipping', combo['id'], category, sub)
            if parts:
                valid.append({**combo, 'parts': parts})
        return valid

    @staticmethod
    def _entries(section, innerSection):
        return JsonReader.data[section][innerSection]

    @staticmethod
    def ReadFrom(section=None, innerSection=None):
        if section is None:
            return JsonReader.data
        if innerSection is None:
            return JsonReader.data[section]
        return JsonReader._entries(section, innerSection)

    @staticmethod
    def ReadFromSpecific(section, innerSection, identifier):
        return JsonReader._entries(section, innerSection)[identifier]

    @staticmethod
    def ReadFromRandom(section, innerSection):
        return random.choice(JsonReader._entries(section, innerSection))

    @staticmethod
    def GetHeadings():
        return list(JsonReader.data.keys())

    @staticmethod
    def GetSubHeadings(section):
        return list(JsonReader.data[section].keys())

    @staticmethod
    def GetStructure():
        """Categories -> [{name, count}] without the entry text, for the UI."""
        return [
            {
                'name': section,
                **category_meta(section),
                'total': sum(len(entries) for entries in subsections.values()),
                'subcategories': [
                    {'name': name, 'count': len(entries)}
                    for name, entries in subsections.items()
                ],
            }
            for section, subsections in JsonReader.data.items()
        ]

    @staticmethod
    def Bundle():
        """Everything the browser needs to work offline, in one download."""
        return {
            'version': JsonReader.version,
            'structure': JsonReader.GetStructure(),
            'combos': JsonReader.GetCombos(),
            'data': JsonReader.data,
        }

    @staticmethod
    def Stats():
        tables = [entries for subsections in JsonReader.data.values() for entries in subsections.values()]
        return {
            'categories': len(JsonReader.data),
            'tables': len(tables),
            'prompts': sum(len(entries) for entries in tables),
        }

    @staticmethod
    def RandomAny(section=None):
        """A random entry from a random table (uniform over tables), optionally within one category."""
        sections = [section] if section is not None else list(JsonReader.data)
        tables = [(s, sub) for s in sections for sub in JsonReader.data[s]]
        category, sub = random.choice(tables)
        return {'category': category, 'sub': sub, 'text': JsonReader.ReadFromRandom(category, sub)}

    @staticmethod
    def GetCombos():
        return [
            {
                'id': c['id'], 'title': c['title'], 'icon': c['icon'], 'blurb': c['blurb'],
                'parts': [{'label': l, 'category': cat, 'sub': sub} for l, cat, sub in c['parts']],
            }
            for c in JsonReader.combos
        ]

    @staticmethod
    def RollCombo(combo_id):
        combo = next((c for c in JsonReader.combos if c['id'] == combo_id), None)
        if combo is None:
            raise KeyError(combo_id)
        return {
            'id': combo['id'],
            'title': combo['title'],
            'parts': [
                {'label': l, 'category': cat, 'sub': sub, 'text': JsonReader.ReadFromRandom(cat, sub)}
                for l, cat, sub in combo['parts']
            ],
        }

    @staticmethod
    def Search(query, limit=50):
        """Case-insensitive substring search over every entry.

        Returns {'total': n, 'results': [{category, sub, index, text}, ...]}
        with at most `limit` results.
        """
        needle = query.strip().lower()
        results = []
        total = 0
        if not needle:
            return {'total': 0, 'results': results}
        for section, subsections in JsonReader.data.items():
            for sub, entries in subsections.items():
                for index, text in enumerate(entries):
                    if needle in text.lower():
                        total += 1
                        if len(results) < limit:
                            results.append({'category': section, 'sub': sub, 'index': index, 'text': text})
        return {'total': total, 'results': results}

    @staticmethod
    def EntryCount(section=None, innerSection=None):
        # Kept for backwards compatibility: returns a one-item list.
        if section is None or innerSection is None:
            return [len(JsonReader.data)]
        return [len(JsonReader._entries(section, innerSection))]
