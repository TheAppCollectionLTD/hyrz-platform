# hyrz WhatsApp-style direct chat API tests: messages shape, replies, reactions, delete, typing, access control, shift chat shortcut data
import os
import time
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    with open('/app/frontend/.env') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                BASE_URL = line.split('=', 1)[1].strip().rstrip('/')
API = f"{BASE_URL}/api"
CONV = 1


def login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed {email}: {r.status_code}")
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}", "Content-Type": "application/json"})
    s.user = r.json()["user"]
    return s


@pytest.fixture(scope="module")
def worker():
    return login("test.worker@hyrz.local", "HyrzTestWorker!2026")


@pytest.fixture(scope="module")
def worker2():
    return login("test.worker2@hyrz.local", "HyrzTestWorker2!2026")


@pytest.fixture(scope="module")
def employer():
    return login("test.employer@hyrz.local", "HyrzTestEmployer!2026")


@pytest.fixture(scope="module")
def created(worker, employer):
    ids = []
    yield ids
    for mid, who in ids:
        (worker if who == "w" else employer).delete(f"{API}/conversations/{CONV}/messages/{mid}")


def msgs(s):
    r = s.get(f"{API}/conversations/{CONV}/messages")
    assert r.status_code == 200
    return r.json()


def find(s, mid):
    return [m for m in msgs(s)["messages"] if m["id"] == mid][0]


class TestDirectChat:
    # messages shape
    def test_messages_shape(self, worker):
        d = msgs(worker)
        assert "otherTyping" in d and isinstance(d["messages"], list) and d["messages"]
        m = d["messages"][0]
        for k in ["reactions", "reply_to_message_id", "reply_body", "deleted_at", "read_at", "sender_id"]:
            assert k in m, k

    # send + read ticks
    def test_send_and_read(self, worker, employer, created):
        r = worker.post(f"{API}/conversations/{CONV}/messages", json={"body": "TEST_hello"})
        assert r.status_code == 201
        mid = r.json()["id"]; created.append((mid, "w"))
        assert find(worker, mid)["read_at"] is None
        e = find(employer, mid)
        assert e["body"] == "TEST_hello"
        assert find(worker, mid)["read_at"] is not None

    def test_validation(self, worker):
        assert worker.post(f"{API}/conversations/{CONV}/messages", json={"body": "  "}).status_code == 400
        assert worker.post(f"{API}/conversations/{CONV}/messages", json={"body": "x" * 5001}).status_code == 400
        assert worker.post(f"{API}/conversations/{CONV}/messages", json={"body": "x", "replyToMessageId": 99999999}).status_code == 400

    # reply
    def test_reply(self, worker, employer, created):
        pid = worker.post(f"{API}/conversations/{CONV}/messages", json={"body": "TEST_parent"}).json()["id"]
        created.append((pid, "w"))
        r = employer.post(f"{API}/conversations/{CONV}/messages", json={"body": "TEST_child", "replyToMessageId": pid})
        assert r.status_code == 201
        cid = r.json()["id"]; created.append((cid, "e"))
        m = find(worker, cid)
        assert int(m["reply_to_message_id"]) == pid and m["reply_body"] == "TEST_parent"
        assert m["reply_sender_first_name"] == "Taylor"

    # reactions toggle
    def test_reactions(self, worker, employer, created):
        mid = worker.post(f"{API}/conversations/{CONV}/messages", json={"body": "TEST_react"}).json()["id"]
        created.append((mid, "w"))
        r = employer.post(f"{API}/conversations/{CONV}/messages/{mid}/reactions", json={"emoji": "❤️"})
        assert r.status_code == 200 and r.json()["removed"] is False
        m = find(worker, mid)
        assert m["reactions"] == [{"emoji": "❤️", "count": 1, "reacted_by_me": False}]
        assert find(employer, mid)["reactions"][0]["reacted_by_me"] is True
        # replace with another emoji (one reaction per user)
        employer.post(f"{API}/conversations/{CONV}/messages/{mid}/reactions", json={"emoji": "🔥"})
        assert [x["emoji"] for x in find(worker, mid)["reactions"]] == ["🔥"]
        # worker adds 🔥 -> count 2
        worker.post(f"{API}/conversations/{CONV}/messages/{mid}/reactions", json={"emoji": "🔥"})
        assert find(worker, mid)["reactions"][0]["count"] == 2
        # toggle off
        r = employer.post(f"{API}/conversations/{CONV}/messages/{mid}/reactions", json={"emoji": "🔥"})
        assert r.json()["removed"] is True
        assert find(worker, mid)["reactions"][0]["count"] == 1
        assert employer.post(f"{API}/conversations/{CONV}/messages/{mid}/reactions", json={"emoji": "abc"}).status_code == 400
        assert employer.post(f"{API}/conversations/{CONV}/messages/99999999/reactions", json={"emoji": "👍"}).status_code == 404

    def test_all_allowed_reactions(self, worker, created):
        mid = worker.post(f"{API}/conversations/{CONV}/messages", json={"body": "TEST_allreact"}).json()["id"]
        created.append((mid, "w"))
        for e in ['👍', '❤️', '😂', '😮', '😢', '🙏', '👏', '🎉', '🔥', '👎']:
            r = worker.post(f"{API}/conversations/{CONV}/messages/{mid}/reactions", json={"emoji": e})
            assert r.status_code == 200, (e, r.text)
            assert find(worker, mid)["reactions"][0]["emoji"] == e

    # delete own only
    def test_delete(self, worker, employer):
        mid = worker.post(f"{API}/conversations/{CONV}/messages", json={"body": "TEST_del"}).json()["id"]
        assert employer.delete(f"{API}/conversations/{CONV}/messages/{mid}").status_code == 403
        r = worker.delete(f"{API}/conversations/{CONV}/messages/{mid}")
        assert r.status_code == 200 and r.json()["deleted"] is True
        m = find(employer, mid)
        assert m["deleted_at"] is not None
        assert employer.post(f"{API}/conversations/{CONV}/messages/{mid}/reactions", json={"emoji": "👍"}).status_code == 404

    # typing
    def test_typing(self, worker, employer):
        assert employer.post(f"{API}/conversations/{CONV}/typing", json={"typing": True}).status_code == 200
        assert msgs(worker)["otherTyping"] is True
        assert msgs(employer)["otherTyping"] is False
        employer.post(f"{API}/conversations/{CONV}/typing", json={"typing": False})
        assert msgs(worker)["otherTyping"] is False

    # access control
    def test_non_participant(self, worker2):
        assert worker2.get(f"{API}/conversations/{CONV}/messages").status_code == 404
        assert worker2.post(f"{API}/conversations/{CONV}/messages", json={"body": "x"}).status_code == 404
        assert worker2.post(f"{API}/conversations/{CONV}/typing", json={"typing": True}).status_code == 404
        assert worker2.post(f"{API}/conversations/{CONV}/messages/1/reactions", json={"emoji": "👍"}).status_code == 404
        assert worker2.delete(f"{API}/conversations/{CONV}/messages/1").status_code == 404

    def test_unauth(self):
        assert requests.get(f"{API}/conversations/{CONV}/messages").status_code == 401

    # shift chat shortcut data
    def test_applications_employer_user_id(self, worker):
        r = worker.get(f"{API}/applications/mine")
        assert r.status_code == 200
        d = r.json()
        apps = d if isinstance(d, list) else (d.get("applications") or d.get("items") or [])
        assert apps
        print([(a.get("id"), a.get("status"), a.get("title") or a.get("shift_title"), a.get("employer_user_id")) for a in apps])
        assert all("employer_user_id" in a for a in apps)

    def test_conversation_list(self, worker):
        r = worker.get(f"{API}/conversations/mine")
        assert r.status_code == 200
        c = [x for x in r.json()["conversations"] if int(x["id"]) == CONV][0]
        assert c["participant_first_name"] == "Jordan"
