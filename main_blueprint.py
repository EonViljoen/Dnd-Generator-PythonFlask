from flask import Blueprint, render_template, current_app, send_from_directory


main_blueprint = Blueprint('main', __name__)

@main_blueprint.route('/', methods=['GET'])
def Home():
    return render_template('index.html')

@main_blueprint.route('/cards', methods=['GET'])
def Cards():
    return render_template('card.html')

@main_blueprint.route('/favicon.ico')
def favicon():
    return send_from_directory(current_app.static_folder, 'images/favicon.ico', mimetype='image/png')  # file is a PNG despite the .ico name
