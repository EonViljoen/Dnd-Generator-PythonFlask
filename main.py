from mimetypes import MimeTypes
import os
from flask import Flask, jsonify, render_template, request, send_from_directory
from jsonReader import JsonReader

app = Flask(__name__,
            static_url_path='',
            static_folder='./static',
            template_folder='./templates')
JsonReader()

@app.route('/', methods=['GET'])
def Home():
    return render_template('index.html')

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(os.path.join(app.root_path, 'static'), 'favicon.ico', MimeTypes='images/favicon.ico')

@app.route('/All', methods=['GET'])
def All():
    return jsonify(JsonReader.ReadFrom())
    
@app.route('/r/<string:category>', methods=['GET'])
def RandomCategoryEntry(category):
    arg = request.args.get('arg', default=None, type=str)
    if arg is not None:
        return jsonify(JsonReader.ReadFromRandom(category, arg))
    else:
        return  jsonify(JsonReader.ReadFrom(category))
    
@app.route('/<string:category>', methods=['GET'])
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
    
@app.route('/<string:category>', methods=['GET'])
def Category(category):
    arg = request.args.get('arg', default=None, type=str)
    if arg is not None:
        return jsonify(JsonReader.ReadFrom(category, arg))
    else:
        return  jsonify(JsonReader.ReadFrom(category))
    
if __name__ == '__main__':
    app.run(debug=True)
