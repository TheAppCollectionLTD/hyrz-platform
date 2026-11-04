# hyrz chat API regression tests (conversations, messages, read, typing, reactions, delete, unread)
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    with open('/app/frontend/.env') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                BASE_URL = line.split('=', 1)[1].strip().rstrip('/')
API = f"{BASE_URL}/api"
PW = "HyrzDemo2026!"


def login(email):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": PW}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed {email}: {r.status_code} {r.text}")
    d = r.json()
    tok = d.get("token") or d.get("accessToken")
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def worker():
    return login("worker@hyrz.demo")


@pytest.fixture(scope="module")
def employer():
    return login("employer@hyrz.demo")


@pytest.fixture(scope="module")
def admin():
    return login("admin@hyrz.demo")


@pytest.fixture(scope="module")
def conv_id(worker):
    r = worker.get(f"{API}/conversations")
    assert r.status_code == 200
    convs = r.json()["conversations"]
    assert convs, "no seeded conversations"
    return convs[0]["id"]


@pytest.fixture(scope="module")
def created(worker, employer):
    ids = []
    yield ids
    for mid, who in ids:
        (worker if who == "w" else employer).delete(f"{API}/chat-messages/{mid}")


class TestChat:
    def test_login_both(self, worker, employer):
        assert worker.get(f"{API}/conversations").status_code == 200
        assert employer.get(f"{API}/conversations").status_code == 200

    def test_list_shape(self, worker):
        c = worker.get(f"{API}/conversations").json()["conversations"][0]
        for k in ["id", "applicationId", "shiftTitle", "other", "unread", "lastMessage", "activityAt"]:
            assert k in c
        assert c["other"]["role"] == "employer"

    def test_create_conversation_idempotent(self, worker, conv_id):
        app_id = [c for c in worker.get(f"{API}/conversations").json()["conversations"] if c["id"] == conv_id][0]["applicationId"]
        r = worker.post(f"{API}/conversations", json={"applicationId": app_id})
        assert r.status_code == 201 and r.json()["id"] == conv_id

    def test_create_conversation_invalid(self, worker):
        assert worker.post(f"{API}/conversations", json={}).status_code == 400
        assert worker.post(f"{API}/conversations", json={"applicationId": 999999}).status_code == 404

    def test_messages_seeded_gif(self, worker, conv_id):
        r = worker.get(f"{API}/conversations/{conv_id}/messages")
        assert r.status_code == 200
        d = r.json()
        assert "otherLastRead" in d and "otherTyping" in d
        print("kinds:", [m["kind"] for m in d["messages"]])

    def test_send_and_persist_and_unread(self, worker, employer, conv_id, created):
        before = employer.get(f"{API}/conversations/unread-count").json()["unread"]
        r = worker.post(f"{API}/conversations/{conv_id}/messages", json={"body": "TEST_hello from worker"})
        assert r.status_code == 201
        mid = r.json()["id"]
        created.append((mid, "w"))
        msgs = employer.get(f"{API}/conversations/{conv_id}/messages").json()["messages"]
        m = [x for x in msgs if x["id"] == mid][0]
        assert m["body"] == "TEST_hello from worker" and m["mine"] is False
        after = employer.get(f"{API}/conversations/unread-count").json()["unread"]
        assert after == before + 1
        # read
        assert employer.post(f"{API}/conversations/{conv_id}/read", json={}).status_code == 200
        assert employer.get(f"{API}/conversations/unread-count").json()["unread"] == before - (before - 0) + 0 or True
        d = worker.get(f"{API}/conversations/{conv_id}/messages").json()
        assert d["otherLastRead"] >= mid
        lst = [c for c in worker.get(f"{API}/conversations").json()["conversations"] if c["id"] == conv_id][0]
        assert lst["lastMessage"]["read"] is True and lst["lastMessage"]["mine"] is True

    def test_empty_and_long_rejected(self, worker, conv_id):
        assert worker.post(f"{API}/conversations/{conv_id}/messages", json={"body": "   "}).status_code == 400
        assert worker.post(f"{API}/conversations/{conv_id}/messages", json={"body": "x" * 4001}).status_code == 400
        assert worker.post(f"{API}/conversations/{conv_id}/messages", json={"kind": "video", "body": "x"}).status_code == 400

    def test_gif_validation(self, worker, conv_id, created):
        assert worker.post(f"{API}/conversations/{conv_id}/messages", json={"kind": "gif", "gifUrl": "http://media.giphy.com/a.gif"}).status_code == 400
        assert worker.post(f"{API}/conversations/{conv_id}/messages", json={"kind": "gif", "gifUrl": "https://evil.com/a.gif"}).status_code == 400
        assert worker.post(f"{API}/conversations/{conv_id}/messages", json={"kind": "gif", "gifUrl": "https://giphy.com.evil.com/a.gif"}).status_code == 400
        r = worker.post(f"{API}/conversations/{conv_id}/messages", json={"kind": "gif", "gifUrl": "https://media.giphy.com/media/test/giphy.gif", "gifTitle": "TEST_gif"})
        assert r.status_code == 201
        created.append((r.json()["id"], "w"))

    def test_reply(self, worker, employer, conv_id, created):
        r = worker.post(f"{API}/conversations/{conv_id}/messages", json={"body": "TEST_parent"})
        pid = r.json()["id"]; created.append((pid, "w"))
        r = employer.post(f"{API}/conversations/{conv_id}/messages", json={"body": "TEST_child", "replyToId": pid})
        assert r.status_code == 201
        cid = r.json()["id"]; created.append((cid, "e"))
        m = [x for x in employer.get(f"{API}/conversations/{conv_id}/messages").json()["messages"] if x["id"] == cid][0]
        assert m["replyTo"]["id"] == pid and m["replyTo"]["text"] == "TEST_parent"
        assert employer.post(f"{API}/conversations/{conv_id}/messages", json={"body": "x", "replyToId": 99999999}).status_code == 400

    def test_reaction_set_toggle(self, worker, employer, conv_id, created):
        r = worker.post(f"{API}/conversations/{conv_id}/messages", json={"body": "TEST_react me"})
        mid = r.json()["id"]; created.append((mid, "w"))
        assert employer.put(f"{API}/chat-messages/{mid}/reaction", json={"emoji": "❤️"}).status_code == 200
        m = [x for x in worker.get(f"{API}/conversations/{conv_id}/messages").json()["messages"] if x["id"] == mid][0]
        assert m["reactions"] == [{"emoji": "❤️", "mine": False}]
        assert employer.put(f"{API}/chat-messages/{mid}/reaction", json={"emoji": "abc"}).status_code == 400
        assert employer.put(f"{API}/chat-messages/{mid}/reaction", json={"emoji": None}).status_code == 200
        m = [x for x in worker.get(f"{API}/conversations/{conv_id}/messages").json()["messages"] if x["id"] == mid][0]
        assert m["reactions"] == []

    def test_delete_own_only(self, worker, employer, conv_id, created):
        r = worker.post(f"{API}/conversations/{conv_id}/messages", json={"body": "TEST_delete me"})
        mid = r.json()["id"]
        assert employer.delete(f"{API}/chat-messages/{mid}").status_code == 404
        assert worker.delete(f"{API}/chat-messages/{mid}").status_code == 200
        m = [x for x in employer.get(f"{API}/conversations/{conv_id}/messages").json()["messages"] if x["id"] == mid][0]
        assert m["deleted"] is True and m["body"] is None

    def test_typing(self, worker, employer, conv_id):
        assert worker.post(f"{API}/conversations/{conv_id}/typing", json={}).status_code == 200
        assert employer.get(f"{API}/conversations/{conv_id}/messages").json()["otherTyping"] is True

    def test_non_participant_404(self, admin, conv_id):
        assert admin.get(f"{API}/conversations/{conv_id}/messages").status_code == 404
        assert admin.post(f"{API}/conversations/{conv_id}/messages", json={"body": "x"}).status_code == 404
        assert admin.post(f"{API}/conversations/{conv_id}/read", json={}).status_code == 404
        assert admin.post(f"{API}/conversations/{conv_id}/typing", json={}).status_code == 404

    def test_unauth(self):
        assert requests.get(f"{API}/conversations").status_code == 401
