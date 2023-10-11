import random
from flask import Flask, jsonify, request
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

    def ReadFromSpecific(section = None, innerSection = None, identifier = None):
        return data[section].get(innerSection)[0]

    def ReadFromRandom(section = None, innerSection = None):
        rand = random.randint(0, len(data[section].get(innerSection)) - 1)
        print(rand)
        return data[section].get(innerSection)[rand]

# class Generator(Resource):
#     def get(self):
#         return data, 200

app = Flask(__name__)
# api = Api(app)
JsonReader()

@app.route('/', methods=['GET'])
def Home():
    return jsonify(JsonReader.ReadFrom())

@app.route('/<string:category>', methods=['GET'])
def Category(category):
    arg = request.args.get('arg', default=None, type=str)
    if arg is not None:
        return jsonify(JsonReader.ReadFrom(category, arg))
    else:
        return  jsonify(JsonReader.ReadFrom(category))

# api.add_resource(Generator, '/')

if __name__ == '__main__':
    app.run(debug=True)
    # print(json.dumps(JsonReader.ReadFrom("Encounter", "Aerial Encounters")))