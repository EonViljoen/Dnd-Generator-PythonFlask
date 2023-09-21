from flask import Flask
from flask_restful import Resource, Api
import json


app = Flask(__name__)
api = Api(app)

file = open('./rpg_generator.json', encoding="utf8")
data = json.load(file)

class Generator(Resource):
    def get(self):
        return data, 200

api.add_resource(Generator, '/Generator')

if __name__ == '__main__':
    app.run()