import os
import sys

import pytest

# Make the app's modules importable when running `pytest` from the project root
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


@pytest.fixture(scope='session')
def app():
    from main import app as flask_app
    flask_app.config.update(TESTING=True)
    return flask_app


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture(scope='session')
def data():
    import json
    with open(os.path.join(ROOT, 'rpg_generator.json'), encoding='utf8') as f:
        return json.load(f)
