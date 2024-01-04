import random
import json


class JsonReader():
    def __init__(self):
        global data
        file = open('./rpg_generator.json', encoding="utf8")
        data = json.load(file)

    def ReadFrom(section = None, innerSection = None):
        if (section is None):
            return data
        else:
            if (innerSection is None):
                return data[section]
            else:
                return data[section].get(innerSection)

    def ReadFromSpecific(section = None, innerSection = None, identifier = None):
        return data[section].get(innerSection)[identifier]

    def ReadFromRandom(section = None, innerSection = None):
        rand = random.randint(0, len(data[section].get(innerSection)) - 1)
        return data[section].get(innerSection)[rand]
    
    def GetHeadings():
        list = []
        for key in data.keys():
            list.append(key)
        return list
    
    def GetSubHeadings(section):
        list = []
        for key in data[section].keys():
            list.append(key)
        return list
    
    def EntryCount(section = None, innerSection = None):
        list = []
        if section is None:
            for key in data.keys():
                list.append(key)
                count = [len(list)] # Dumb way of doing this
            return count
        else:
            if innerSection is None:
                for key in data.keys():
                    list.append(key)
                    count = [len(list)] # Dumb way of doing this
                return count
            else:
                count = [len(data[section].get(innerSection))]
                return count