import json
import os
import random

DATA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'rpg_generator.json')


class JsonReader():
    """Loads the prompt data once and exposes read helpers.

    Lookups raise KeyError for unknown categories/sub-categories so the
    API layer can turn them into 404s.
    """
    data = {}

    def __init__(self):
        with open(DATA_PATH, encoding='utf8') as file:
            JsonReader.data = json.load(file)

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
                'subcategories': [
                    {'name': name, 'count': len(entries)}
                    for name, entries in subsections.items()
                ],
            }
            for section, subsections in JsonReader.data.items()
        ]

    @staticmethod
    def EntryCount(section=None, innerSection=None):
        # Kept for backwards compatibility: returns a one-item list.
        if section is None or innerSection is None:
            return [len(JsonReader.data)]
        return [len(JsonReader._entries(section, innerSection))]
