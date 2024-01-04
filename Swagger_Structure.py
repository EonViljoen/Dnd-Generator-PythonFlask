from flask import Flask, jsonify
from flask_restful import Api, Resource, reqparse
from jsonReader import JsonReader


class Ping(Resource):
    def get(self):
        """
        Ping API
        This endpoint returns a 200 response.
        ---
        responses:
            200:
                description: Success
                content:
                    application/json:
                        schema:
                            type: object
                            properties:
                                message:
                                    type: string
        """
        return jsonify({'message': 'Hello'})
    
class GetAllEntries(Resource):
    def get(self):
        """
        Retrieve all entries
        This endpoint all entries found in json file.
        ---
        responses:
            200:
                description: Success
                content:
                    application/json:
                        schema:
                            type: object
                            properties:
                                message:
                                    type: string
        """
        return jsonify(JsonReader.ReadFrom())
    
class RandomCategoryEntry(Resource):##
    def get(self):
        """
        Ping API
        This endpoint returns a 200 response.
        ---
        responses:
            200:
                description: Success
                content:
                    application/json:
                        schema:
                            type: object
                            properties:
                                message:
                                    type: string
        """
        return jsonify({'message': 'Hello'})
    
class CategorySpecific(Resource):
    def get(self):
        """
        Retrieve specific entry from category
        Retrieve a specific entry from category if Sub Category and Entry Id is not null, else return all Sub Category enties, or all entries in Main Category
        ---
        parameters:
            - name: Main Category
              in: query
              type: string
              required: true
              description: Main category of entries
            - name: Sub Category
              in: query
              type: string
              required: true
              description: Sub categories within main categories
            - name: Entry Id
              in: query
              type: string
              required: true
              description: Specific entry within sub category
        responses:
            200:
                description: Success
                content:
                    application/json:
                        schema:
                            type: object
                            properties:
                                message:
                                    type: string
        """

        parser = reqparse.RequestParser()
        parser.add_argument('Main Category', type=str, required=True)
        parser.add_argument('Sub Category', type=str, required=True)
        parser.add_argument('Entry Id', type=str, required=True)
        args = parser.parse_args()

        return jsonify(JsonReader.ReadFromSpecific(args['Main Category'], args['Sub Category'], args['Entry Id']))
    
class Category(Resource):##
    def get(self):
        """
        Ping API
        This endpoint returns a 200 response.
        ---
        responses:
            200:
                description: Success
                content:
                    application/json:
                        schema:
                            type: object
                            properties:
                                message:
                                    type: string
        """
        return jsonify({'message': 'Hello'})