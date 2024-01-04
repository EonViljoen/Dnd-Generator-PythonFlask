import os
from flask import Flask, jsonify, render_template, request, send_from_directory
from flask_restful import Resource, Api
from flasgger import Swagger
from jsonReader import JsonReader
import Swagger_Structure

# Init

app = Flask(__name__,
            static_url_path='',
            static_folder='./static',
            template_folder='./templates')
api = Api(app) # Maybe I don't need api variable, can i remove the api.add_resource?
# Found out this has broken my routes setup via @app.route
swagger = Swagger(app)
JsonReader()

# Swagger UI

# api.add_resource(Swagger_Structure.Ping, '/ping')
# api.add_resource(Swagger_Structure.GetAllEntries, '/Resource/All')
# api.add_resource(Swagger_Structure.CategorySpecific, '/Resource/<string:category>')

# Routes

@app.route('/', methods=['GET'])
def Home():
    return render_template('index.html')

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(os.path.join(app.root_path, 'static'), 'favicon.ico', MimeTypes='images/favicon.ico')

@app.route('/api/All', methods=['GET'])
def All():
    return jsonify(JsonReader.ReadFrom())
    
@app.route('/api/r/<string:category>', methods=['GET'])
def RandomCategoryEntry(category):
    arg = request.args.get('arg', default=None, type=str)
    if arg is not None:
        return jsonify(JsonReader.ReadFromRandom(category, arg))
    else:
        return  jsonify(JsonReader.ReadFrom(category))
    
@app.route('/api/<string:category>', methods=['GET'])
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
    
@app.route('/api/<string:category>', methods=['GET'])
def Category(category):
    arg = request.args.get('arg', default=None, type=str)
    if arg is not None:
        return jsonify(JsonReader.ReadFrom(category, arg))
    else:
        return  jsonify(JsonReader.ReadFrom(category))

@app.route('/api/Headings', methods=['GET'])
def CategoryHeadings():
    return jsonify(JsonReader.GetHeadings())

@app.route('/api/SubHeadings', methods=['GET'])
def CategorySubHeadings():
    category = request.args.get('category', default=None, type=str)
    if category is not None:
        return jsonify(JsonReader.GetSubHeadings(category))
    else:
        return jsonify(JsonReader.GetHeadings())

@app.route('/api/EntryCount')
def EntryCount():
   category = request.args.get('category', default=None, type=str)
   subcategory = request.args.get('subcategory', default=None, type=str)
   return(JsonReader.EntryCount(category, subcategory)) 

# Driver
if __name__ == '__main__':
    app.run(debug=True)
