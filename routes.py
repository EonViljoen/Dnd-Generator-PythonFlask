from flask import jsonify, request
from flask_restful import Resource
from jsonReader import JsonReader

class All(Resource):
    def get(self):
        methods = ['GET']
        return jsonify(JsonReader.ReadFrom())

class RandomCategoryEntry(Resource):
    def get(self, category):
        methods = ['GET']
        arg = request.args.get('arg', default=None, type=str)
        if arg is not None:
            return jsonify(JsonReader.ReadFromRandom(category, arg))
        else:
            return jsonify(JsonReader.ReadFrom(category))

class CategorySpecific(Resource):
    def get(self, category):
        methods = ['GET']
        arg = request.args.get('arg', default=None, type=str)
        id = request.args.get('id', type=int)
        if arg is not None:
            if id is not None:
                return jsonify(JsonReader.ReadFromSpecific(category, arg, id))
            else:
                return jsonify(JsonReader.ReadFrom(category, arg))
        else:
            return jsonify(JsonReader.ReadFrom(category))

class Category(Resource):
    def get(self, category):
        methods = ['GET']
        arg = request.args.get('arg', default=None, type=str)
        if arg is not None:
            return jsonify(JsonReader.ReadFrom(category, arg))
        else:
            return jsonify(JsonReader.ReadFrom(category))

class CategoryHeadings(Resource):
    def get(self):
        methods = ['GET']
        return jsonify(JsonReader.GetHeadings())

class CategorySubHeadings(Resource):
    def get(self):
        methods = ['GET']
        category = request.args.get('category', default=None, type=str)
        if category is not None:
            return jsonify(JsonReader.GetSubHeadings(category))
        else:
            return jsonify(JsonReader.GetHeadings())

class EntryCount(Resource):
    def get(self):
        methods = ['GET']
        category = request.args.get('category', default=None, type=str)
        subcategory = request.args.get('subcategory', default=None, type=str)
        return jsonify(JsonReader.EntryCount(category, subcategory))
