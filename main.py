import os
from flask import Flask, jsonify, render_template, request, send_from_directory
from flask_restful import Resource, Api
from flasgger import Swagger
from jsonReader import JsonReader
from swagger import Ping, GetAllEntries, CategorySpecific

# Init

app = Flask(__name__,
            static_url_path='',
            static_folder='./static',
            template_folder='./templates')
swagger = Swagger(app)
JsonReader()

# Swagger UI

# api.add_resource(Ping, '/ping')
# api.add_resource(GetAllEntries, '/Resource/All')
# api.add_resource(CategorySpecific, '/Resource/<string:category>')

# Routes

@app.route('/', methods=['GET'])
def Home():
    return render_template('index.html')

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(os.path.join(app.root_path, 'static'), 'favicon.ico', MimeTypes='images/favicon.ico')

@app.route('/Resource/All', methods=['GET'])
def All():
    return jsonify(JsonReader.ReadFrom())
    
@app.route('/Resource/r/<string:category>', methods=['GET'])
def RandomCategoryEntry(category):
    arg = request.args.get('arg', default=None, type=str)
    if arg is not None:
        return jsonify(JsonReader.ReadFromRandom(category, arg))
    else:
        return  jsonify(JsonReader.ReadFrom(category))
    
@app.route('/Resource/<string:category>', methods=['GET'])
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
    
@app.route('/Resource/<string:category>', methods=['GET'])
def Category(category):
    arg = request.args.get('arg', default=None, type=str)
    if arg is not None:
        return jsonify(JsonReader.ReadFrom(category, arg))
    else:
        return  jsonify(JsonReader.ReadFrom(category))
    
# Driver
if __name__ == '__main__':
    app.run(debug=True)
