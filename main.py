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
        return data[section].get(innerSection)[identifier]

    def ReadFromRandom(section = None, innerSection = None):
        rand = random.randint(0, len(data[section].get(innerSection)) - 1)
        return data[section].get(innerSection)[rand]

app = Flask(__name__)
JsonReader()

@app.route('/', methods=['GET'])
def Home():
    return jsonify(JsonReader.ReadFrom())
    
@app.route('/r/<string:category>', methods=['GET'])
def RandomCategoryEntry(category):
    arg = request.args.get('arg', default=None, type=str)
    if arg is not None:
        return jsonify(JsonReader.ReadFromRandom(category, arg))
    else:
        return  jsonify(JsonReader.ReadFrom(category))
    
@app.route('/<string:category>', methods=['GET'])
def CategorySpecific(category):
    arg = request.args.get('arg', default=None, type=str)
    id = request.args.get('id', type=int)
    if arg is not None:
        if id is not None:
            return jsonify(JsonReader.ReadFromSpecific(category, arg, id))
        else:
            return jsonify(JsonReader.ReadFrom(category, arg))
    else:
        return  jsonify(JsonReader.ReadFrom(category))
    
@app.route('/<string:category>', methods=['GET'])
def Category(category):
    arg = request.args.get('arg', default=None, type=str)
    if arg is not None:
        return jsonify(JsonReader.ReadFrom(category, arg))
    else:
        return  jsonify(JsonReader.ReadFrom(category))

if __name__ == '__main__':
    app.run(debug=True)
