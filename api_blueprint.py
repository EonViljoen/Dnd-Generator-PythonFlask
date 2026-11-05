from flask import Blueprint
from flask_restful import Api
from routes import GetAll, Structure, Search, RandomAny, Combos, ComboRoll, RandomCategoryEntry, CategorySpecific, CategoryHeadings, CategorySubHeadings, EntryCount


api_blueprint = Blueprint('api', __name__)
api = Api(api_blueprint)

api.add_resource(GetAll, '/getall')
api.add_resource(Structure, '/structure')
api.add_resource(Search, '/search')
api.add_resource(RandomAny, '/random')
api.add_resource(Combos, '/combos')
api.add_resource(ComboRoll, '/combos/<string:combo_id>')
api.add_resource(RandomCategoryEntry, '/r/<string:category>')
api.add_resource(CategoryHeadings, '/Headings')
api.add_resource(CategorySubHeadings, '/SubHeadings')
api.add_resource(EntryCount, '/EntryCount')
api.add_resource(CategorySpecific, '/<string:category>')
