import os
from flask import Blueprint, render_template, send_from_directory, redirect, url_for


main_blueprint = Blueprint('main', __name__)

@main_blueprint.route('/', methods=['GET'])
def Home():
    return render_template('index.html')

@main_blueprint.route('/cards', methods=['GET'])
def Cards():
    return render_template('card.html')

@main_blueprint.route('/favicon.ico')
def favicon():
    return send_from_directory(os.path.join(app.root_path, 'static'), 'favicon.ico', MimeTypes='images/favicon.ico')
