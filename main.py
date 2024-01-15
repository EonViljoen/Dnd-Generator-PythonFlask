import os
from flask import Flask, jsonify, render_template, request, send_from_directory
from flask_restful import Resource, Api
from flasgger import Swagger
from jsonReader import JsonReader
import Swagger_Structure
import routes

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

api.add_resource(routes.All,'/api/getall')
api.add_resource(routes.RandomCategoryEntry, '/api/r/<string:category>')
api.add_resource(routes.CategorySpecific, '/api/<string:category>')
api.add_resource(routes.Category, '/api/<string:category>')
api.add_resource(routes.CategoryHeadings, '/api/Headings')
api.add_resource(routes.CategorySubHeadings, '/api/SubHeadings')
api.add_resource(routes.EntryCount, '/api/EntryCount')

# Driver
if __name__ == '__main__':
    app.run(debug=True)
