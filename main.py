import mimetypes

from flask import Flask
from jsonReader import JsonReader
from api_blueprint import api_blueprint as api_bp
from main_blueprint import main_blueprint as main_bp

# Init

# Installable app manifest (not in every Python's mimetypes table)
mimetypes.add_type('application/manifest+json', '.webmanifest')

app = Flask(__name__,
            static_url_path='',
            static_folder='./static',
            template_folder='./templates')
# Keep JSON keys in file order so /api/getall matches the site (and works as an upload template)
app.json.sort_keys = False
JsonReader()

# Routes
app.register_blueprint(api_bp, url_prefix='/api')
app.register_blueprint(main_bp)


# Driver
if __name__ == '__main__':
    app.run(debug=True)
