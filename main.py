from flask import Flask
from flask_restful import Resource, Api
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

# class Generator(Resource):
#     def get(self):
#         return data, 200

# app = Flask(__name__)
# api = Api(app)

JsonReader()


# api.add_resource(Generator, '/')

if __name__ == '__main__':
    # app.run()
    print(json.dumps(JsonReader.ReadFrom("Dungeon", "Deadly Traps")))