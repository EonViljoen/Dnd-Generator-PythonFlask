from flask import Flask
from flask_restful import Api
# from flasgger import Swagger
from jsonReader import JsonReader
# import Swagger_Structure
from api_blueprint import api_blueprint as api_bp
from main_blueprint import main_blueprint as main_bp

# Init

app = Flask(__name__,
            static_url_path='',
            static_folder='./static',
            template_folder='./templates')
api = Api(app)
# swagger = Swagger(app)
JsonReader()

# Swagger UI

# api.add_resource(Swagger_Structure.Ping, '/ping')
# api.add_resource(Swagger_Structure.GetAllEntries, '/Resource/All')
# api.add_resource(Swagger_Structure.CategorySpecific, '/Resource/<string:category>')

# Routes
app.register_blueprint(api_bp, url_prefix='/api')
app.register_blueprint(main_bp)


# Driver
if __name__ == '__main__':
    app.run(debug=True)
