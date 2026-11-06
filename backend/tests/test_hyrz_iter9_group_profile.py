# Iteration 9: workchat group profile (photo/description), notifications, checkouts, regression chat send.
# Run: cd /app/backend && python -m pytest tests/test_hyrz_iter9_group_profile.py -n 0 -v
import base64
import requests


def _base():
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            return line.split('=', 1)[1].strip().rstrip('/')


BASE = _base() + '/api'
CREDS = {
    'worker': ('demo.worker@hyrz.local', 'HyrzDemoWorker!2026'),
    'employer': ('demo.employer@hyrz.local', 'HyrzDemoEmployer!2026'),
    'admin': ('test.owner@hyrz.local', 'Test-Only-Password-2026!'),
}
_tok = {}
PNG = 'data:image/png;base64,' + base64.b64encode(bytes.fromhex(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f80f00000101000518d84e0000000049454e44ae426082')).decode()


def h(who):
    if who not in _tok:
        e, p = CREDS[who]
        r = requests.post(f'{BASE}/auth/login', json={'email': e, 'password': p})
        assert r.status_code == 200, r.text
        _tok[who] = r.json()['token']
    return {'Authorization': f'Bearer {_tok[who]}'}


def riverside(who='employer'):
    r = requests.get(f'{BASE}/workchats/mine', headers=h(who))
    assert r.status_code == 200, r.text
    data = r.json()
    chats = data.get('workchats', data if isinstance(data, list) else [])
    c = [x for x in chats if 'Riverside' in x['name']]
    assert c, chats
    return c[0]


# Login all roles
class TestLogin:
    def test_login_all(self):
        for who in CREDS:
            assert h(who)


# Group profile PATCH
class TestGroupProfile:
    def test_seeded_description(self):
        c = riverside()
        assert (c.get('description') or '').startswith('Crew chat for Riverside Fest')

    def test_worker_forbidden(self):
        c = riverside('worker')
        r = requests.patch(f"{BASE}/workchats/{c['id']}/profile", headers=h('worker'), json={'description': 'TEST hack'})
        assert r.status_code == 403, r.text

    def test_invalid_photo(self):
        c = riverside()
        for bad in ['not-a-photo', 'data:image/gif;base64,AAAA', 123]:
            r = requests.patch(f"{BASE}/workchats/{c['id']}/profile", headers=h('employer'), json={'photo': bad})
            assert r.status_code == 400, (bad, r.text)

    def test_long_description(self):
        c = riverside()
        r = requests.patch(f"{BASE}/workchats/{c['id']}/profile", headers=h('employer'), json={'description': 'x' * 501})
        assert r.status_code == 400

    def test_empty_body(self):
        c = riverside()
        r = requests.patch(f"{BASE}/workchats/{c['id']}/profile", headers=h('employer'), json={})
        assert r.status_code == 400

    def test_update_and_persist_visible_to_worker(self):
        c = riverside()
        orig = c.get('description')
        r = requests.patch(f"{BASE}/workchats/{c['id']}/profile", headers=h('employer'),
                           json={'photo': PNG, 'description': 'TEST_desc iter9'})
        assert r.status_code == 200, r.text
        w = riverside('worker')
        assert w['photo'] == PNG and w['description'] == 'TEST_desc iter9'
        # restore
        r = requests.patch(f"{BASE}/workchats/{c['id']}/profile", headers=h('employer'),
                           json={'photo': None, 'description': orig})
        assert r.status_code == 200
        assert riverside()['photo'] is None

    def test_admin_role_blocked(self):
        c = riverside()
        r = requests.patch(f"{BASE}/workchats/{c['id']}/profile", headers=h('admin'), json={'description': 'x'})
        assert r.status_code in (403, 404)


# Notifications + checkouts data feeds
class TestFeeds:
    def test_notifications_seeded(self):
        for who in ('worker', 'employer'):
            r = requests.get(f'{BASE}/notifications/mine', headers=h(who))
            assert r.status_code == 200
            d = r.json()
            items = d.get('notifications', d if isinstance(d, list) else [])
            assert len(items) > 0, who

    def test_checkouts_mine(self):
        for who in ('worker', 'employer'):
            r = requests.get(f'{BASE}/checkouts/mine', headers=h(who))
            assert r.status_code == 200, r.text


# Regression: workchat send
class TestChatSend:
    def test_workchat_send(self):
        c = riverside('worker')
        r = requests.post(f"{BASE}/workchats/{c['id']}/messages", headers=h('worker'), json={'body': 'TEST_iter9 hello'})
        assert r.status_code in (200, 201), r.text


# Regression: workchat reaction + direct chat send
class TestReactAndDirect:
    def test_workchat_react(self):
        c = riverside('worker')
        r = requests.get(f"{BASE}/workchats/{c['id']}/messages", headers=h('worker'))
        assert r.status_code == 200
        msgs = r.json().get('messages', [])
        mid = [m for m in msgs if not m.get('deleted_at')][-1]['id']
        r = requests.post(f"{BASE}/workchats/{c['id']}/messages/{mid}/reactions", headers=h('worker'), json={'emoji': '👍'})
        assert r.status_code in (200, 201), r.text

    def test_direct_send(self):
        r = requests.get(f'{BASE}/conversations/mine', headers=h('worker'))
        assert r.status_code == 200
        convs = r.json().get('conversations', [])
        assert convs
        cid = convs[0]['id']
        r = requests.post(f'{BASE}/conversations/{cid}/messages', headers=h('worker'), json={'body': 'TEST_iter9 direct api'})
        assert r.status_code in (200, 201), r.text
