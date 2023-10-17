from flask import Flask, jsonify, request
from jsonReader import JsonReader

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
