"""Pages and API routes. Run with: pytest"""
import pytest


@pytest.mark.parametrize('path', ['/', '/cards'])
def test_pages_render(client, path):
    res = client.get(path)
    assert res.status_code == 200
    assert res.mimetype == 'text/html'
    assert b'D&amp;D Prompt Helper' in res.data or b'D&D Prompt Helper' in res.data


@pytest.mark.parametrize('path', [
    '/favicon.ico', '/sw.js', '/styles/style.css', '/scripts/app.js', '/scripts/theme.js', '/images/favicon.svg',
])
def test_static_files(client, path):
    with client.get(path) as res:  # close the file response
        assert res.status_code == 200


def test_health(client, data):
    res = client.get('/api/health')
    assert res.status_code == 200
    body = res.get_json()
    assert body['status'] == 'ok'
    assert body['categories'] == len(data)
    assert body['tables'] == sum(len(subs) for subs in data.values())
    assert body['prompts'] == sum(len(entries) for subs in data.values() for entries in subs.values())
    assert body['python'].count('.') == 2  # e.g. "3.12.4": shows which Python the server runs
    assert len(body['data_version']) == 12


def test_bundle_for_offline_use(client, data):
    bundle = client.get('/api/bundle').get_json()
    assert bundle['version'] == client.get('/api/health').get_json()['data_version']
    assert bundle['data'] == data
    assert [c['name'] for c in bundle['structure']] == list(data)
    assert {c['id'] for c in bundle['combos']} >= {'npc', 'tavern'}


@pytest.mark.parametrize('path', ['/manifest.webmanifest', '/images/icon-192.png', '/images/icon-512.png', '/images/icon-maskable-512.png'])
def test_installable_app_files(client, path):
    with client.get(path) as res:
        assert res.status_code == 200
    if path.endswith('.webmanifest'):
        with client.get(path) as res:
            assert res.mimetype == 'application/manifest+json'
            manifest = res.get_json(force=True)
            assert manifest['start_url'] == '/cards' and manifest['display'] == 'standalone'
            assert {i['sizes'] for i in manifest['icons']} >= {'192x192', '512x512'}


def test_health_reports_render_commit(client, monkeypatch):
    monkeypatch.setenv('RENDER_GIT_COMMIT', '81a614f0123456789abcdef')
    assert client.get('/api/health').get_json()['commit'] == '81a614f'


def test_structure_matches_data(client, data):
    structure = client.get('/api/structure').get_json()
    assert [c['name'] for c in structure] == list(data)
    for cat in structure:
        assert cat['icon'] and cat['blurb']
        assert [s['name'] for s in cat['subcategories']] == list(data[cat['name']])
        assert cat['total'] == sum(s['count'] for s in cat['subcategories'])


def test_getall_keeps_file_order(client, data):
    assert list(client.get('/api/getall').get_json()) == list(data)


def test_random_entry(client, data):
    body = client.get('/api/random').get_json()
    assert body['text'] in data[body['category']][body['sub']]
    town = client.get('/api/random?category=Town').get_json()
    assert town['category'] == 'Town'


def test_roll_one_table(client, data):
    text = client.get('/api/r/Town?arg=Rumors').get_json()
    assert text in data['Town']['Rumors']


def test_entries_and_single_entry(client, data):
    assert client.get('/api/Town?arg=Rumors').get_json() == data['Town']['Rumors']
    assert client.get('/api/Town?arg=Rumors&id=0').get_json() == data['Town']['Rumors'][0]


def test_search(client):
    body = client.get('/api/search?q=dragon').get_json()
    assert body['total'] >= len(body['results']) > 0
    assert len(body['results']) <= 50
    assert all('dragon' in r['text'].lower() for r in body['results'])
    assert len(client.get('/api/search?q=the&limit=1000').get_json()['results']) == 200  # capped
    assert client.get('/api/search?q=').get_json() == {'total': 0, 'results': []}


def test_combos(client, data):
    combos = client.get('/api/combos').get_json()
    assert {c['id'] for c in combos} >= {'npc', 'tavern', 'town', 'villain', 'side-quest'}
    rolled = client.get('/api/combos/npc').get_json()
    for part in rolled['parts']:
        assert part['text'] in data[part['category']][part['sub']]


@pytest.mark.parametrize('path', [
    '/api/Headings', '/api/SubHeadings?category=Town', '/api/EntryCount?category=Town&subcategory=Rumors',
])
def test_legacy_endpoints(client, path):
    assert client.get(path).status_code == 200


@pytest.mark.parametrize('path', [
    '/api/r/Nope?arg=Rumors', '/api/r/Town?arg=Nope', '/api/Nope', '/api/Town?arg=Nope',
    '/api/Town?arg=Rumors&id=99999', '/api/random?category=Nope', '/api/combos/nope', '/api/SubHeadings?category=Nope',
])
def test_unknown_names_are_404(client, path):
    assert client.get(path).status_code == 404
