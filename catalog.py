"""Presentation metadata for categories and the "Quick build" combo generators.

Kept separate from rpg_generator.json so the prompt data stays a plain
{category: {table: [entries]}} file.
"""

DEFAULT_META = {'icon': 'dice-5', 'blurb': ''}

CATEGORY_META = {
    'Dungeon':   {'icon': 'bricks',        'blurb': 'Puzzles, traps, riddles and hidden doors for when the party heads underground.'},
    'Encounter': {'icon': 'shield-shaded', 'blurb': 'Things the party runs into on the road, sorted by terrain.'},
    'Items':     {'icon': 'gem',           'blurb': 'Trinkets, treasures, potions and pocket contents, useful or otherwise.'},
    'Misc':      {'icon': 'stars',         'blurb': 'Curses, diseases, plot twists, boons and other improvised flair.'},
    'NPCs':      {'icon': 'people',        'blurb': '“Who’s that?” Shopkeepers, villains, familiars and their secrets.'},
    'Quests':    {'icon': 'map',           'blurb': 'Hooks, side quests and travel events for when the party goes off-script.'},
    'Town':      {'icon': 'house-door',    'blurb': 'Taverns, laws, festivals and factions to make a settlement feel lived-in.'},
}

# Each part is (label, category, table). Tables must exist in rpg_generator.json;
# JsonReader validates this at startup and drops (with a warning) any that don't.
COMBOS = [
    {
        'id': 'npc',
        'title': 'Quick NPC',
        'icon': 'person-badge',
        'blurb': 'A job, a personality, something to hide and something in their pockets.',
        'parts': [
            ('Occupation', 'NPCs', 'Occupations'),
            ('Personality', 'NPCs', 'Personality Traits'),
            ('Secret', 'NPCs', 'Exploitable Secrets about an NPC'),
            ('In their pockets', 'Items', "Items in an NPC's Pockets"),
        ],
    },
    {
        'id': 'tavern',
        'title': 'Quick Tavern',
        'icon': 'cup-straw',
        'blurb': 'Somewhere to rest, something to drink and someone worth talking to.',
        'parts': [
            ('Name', 'Town', 'Tavern Names'),
            ('House drink', 'Town', 'Signature Tavern Drinks'),
            ('Patron', 'Town', 'Inn Patrons'),
            ('Rumor', 'Town', 'Rumors'),
            ('Tonight', 'Encounter', 'Tavern Encounter'),
        ],
    },
    {
        'id': 'town',
        'title': 'Quick Town',
        'icon': 'buildings',
        'blurb': 'A name, a strange law, who really runs things and what’s on this week.',
        'parts': [
            ('Name', 'Town', 'Fantasy Town Names'),
            ('Local law', 'Town', 'Unusual or Uncommon Laws'),
            ('Faction', 'Town', 'Factions'),
            ('Festival', 'Town', 'Festivals/Holidays'),
            ('Notable stall', 'Town', 'Market Stalls'),
        ],
    },
    {
        'id': 'villain',
        'title': 'Quick Villain',
        'icon': 'emoji-angry',
        'blurb': 'A memorable big bad: a trait, a show of power and a fight to remember.',
        'parts': [
            ('Trait', 'NPCs', 'Villain Traits'),
            ('Show of power', 'NPCs', 'Ways to show how terrifyingly powerful your BBEG is'),
            ('Boss mechanic', 'Misc', 'Interesting Boss Mechanics'),
            ('Last words', 'NPCs', 'Enemy Last Words'),
        ],
    },
    {
        'id': 'side-quest',
        'title': 'Quick Side Quest',
        'icon': 'signpost-split',
        'blurb': 'A hook, a snag along the way, a twist and something to show for it.',
        'parts': [
            ('Hook', 'Quests', 'Side Quest Hooks'),
            ('Complication', 'Quests', 'Travel Complications'),
            ('Twist', 'Misc', 'Low/Non-Magical Plot Twists'),
            ('Reward', 'Items', 'Interesting Trinkets and Minor Magic Items'),
        ],
    },
]


def category_meta(name):
    return CATEGORY_META.get(name, DEFAULT_META)
