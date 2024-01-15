from flask import Blueprint
from flask_restful import Api
from routes import GetAll, RandomCategoryEntry, CategorySpecific, Category, CategoryHeadings, CategorySubHeadings, EntryCount


api_blueprint = Blueprint('api', __name__)
api = Api(api_blueprint)

api.add_resource(GetAll,'/getall')
api.add_resource(RandomCategoryEntry, '/r/<string:category>')
api.add_resource(CategorySpecific, '/<string:category>')
api.add_resource(Category, '/<string:category>')
api.add_resource(CategoryHeadings, '/Headings')
api.add_resource(CategorySubHeadings, '/SubHeadings')
api.add_resource(EntryCount, '/EntryCount')