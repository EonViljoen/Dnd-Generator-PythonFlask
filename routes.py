import os

from flask import jsonify, request, abort
from flask_restful import Resource
from jsonReader import JsonReader


def _lookup(fn, *args):
    """Run a JsonReader lookup, turning bad names/indices into a 404."""
    try:
        return jsonify(fn(*args))
    except (KeyError, IndexError):
        abort(404)


class GetAll(Resource):
    def get(self):
        return jsonify(JsonReader.ReadFrom())


class Health(Resource):
    """Cheap liveness check for Render and uptime monitors."""
    def get(self):
        commit = os.environ.get('RENDER_GIT_COMMIT') or None
        return jsonify({
            'status': 'ok',
            **JsonReader.Stats(),
            'commit': commit[:7] if commit else None,
        })


class Structure(Resource):
    def get(self):
        return jsonify(JsonReader.GetStructure())


class Search(Resource):
    def get(self):
        query = request.args.get('q', default='', type=str)
        limit = min(request.args.get('limit', default=50, type=int), 200)
        return jsonify(JsonReader.Search(query, limit))


class RandomAny(Resource):
    def get(self):
        category = request.args.get('category', default=None, type=str)
        return _lookup(JsonReader.RandomAny, category)


class Combos(Resource):
    def get(self):
        return jsonify(JsonReader.GetCombos())


class ComboRoll(Resource):
    def get(self, combo_id):
        return _lookup(JsonReader.RollCombo, combo_id)


class RandomCategoryEntry(Resource):
    def get(self, category):
        arg = request.args.get('arg', default=None, type=str)
        if arg is not None:
            return _lookup(JsonReader.ReadFromRandom, category, arg)
        return _lookup(JsonReader.ReadFrom, category)


class CategorySpecific(Resource):
    def get(self, category):
        arg = request.args.get('arg', default=None, type=str)
        id = request.args.get('id', type=int)
        if arg is not None:
            if id is not None:
                return _lookup(JsonReader.ReadFromSpecific, category, arg, id)
            return _lookup(JsonReader.ReadFrom, category, arg)
        return _lookup(JsonReader.ReadFrom, category)


class CategoryHeadings(Resource):
    def get(self):
        return jsonify(JsonReader.GetHeadings())


class CategorySubHeadings(Resource):
    def get(self):
        category = request.args.get('category', default=None, type=str)
        if category is not None:
            return _lookup(JsonReader.GetSubHeadings, category)
        return jsonify(JsonReader.GetHeadings())


class EntryCount(Resource):
    def get(self):
        category = request.args.get('category', default=None, type=str)
        subcategory = request.args.get('subcategory', default=None, type=str)
        return _lookup(JsonReader.EntryCount, category, subcategory)
