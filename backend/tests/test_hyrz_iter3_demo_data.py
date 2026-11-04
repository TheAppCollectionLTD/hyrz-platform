# hyrz iteration 3: demo seed data (shifts, chats, admin threads, checkouts, payslips),
# clock-in fix, reactions/replies in direct + workchats, pay settings validation.
import os
import subprocess
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE_URL = line.split('=', 1)[1].strip().strip('"').rstrip('/')
API = f"{BASE_URL}/api"
SOCK = '/tmp/hyrz-mysql.sock'
ACC = {
    'worker': ('demo.worker@hyrz.local', 'HyrzDemoWorker!2026'),
    'employer': ('demo.employer@hyrz.local', 'HyrzDemoEmployer!2026'),
    'priya': ('priya.demo@hyrz.local', 'HyrzDemoWorker!2026'),
    'admin': ('SimsonH', 'Test-Only-Password-2026!'),
}
_tok = {}


def sql(q):
    return subprocess.run(['mariadb', f'--socket={SOCK}', 'hyrz_test', '--default-character-set=utf8mb4', '-N', '-e', q], capture_output=True, text=True, check=True).stdout


def h(k):
    if k not in _tok:
        r = requests.post(f"{API}/auth/login", json={'email': ACC[k][0], 'password': ACC[k][1]}, timeout=30)
        if r.status_code != 200:
            pytest.skip(f'login {k} failed {r.status_code} {r.text}')
        _tok[k] = r.json()['token']
    return {'Authorization': f'Bearer {_tok[k]}'}


def get(k, path):
    r = requests.get(f"{API}{path}", headers=h(k), timeout=30)
    assert r.status_code == 200, f'{path} {r.status_code} {r.text[:300]}'
    return r.json()


# --- Auth
def test_logins():
    for k in ACC:
        h(k)


# --- Worker shifts / applications
def test_worker_applications_seeded():
    d = get('worker', '/applications/mine')
    apps = d.get('applications', d if isinstance(d, list) else [])
    titles = {a.get('title') or a.get('shift_title') for a in apps}
    print(sorted(t for t in titles if t))
    for t in ['Cocktail Bar Host', 'Bartender – Friday Night', 'Festival Bar Crew – Riverside Fest', 'Retail Assistant – Pop-up Store']:
        assert t in titles, t


# --- Employer shifts/checkouts/invoices
def test_employer_shifts_and_checkouts():
    shifts = get('employer', '/shifts/mine')
    shifts = shifts.get('shifts', shifts)
    assert len(shifts) >= 15
    co = get('employer', '/checkouts/mine')
    co = co.get('checkouts', co)
    sub = [c for c in co if c['status'] == 'submitted' and 'Late Bar' in str(c.get('title') or c.get('shift_title'))]
    assert len(sub) == 2, [(c.get('title'), c['status']) for c in co][:5]
    inv = get('employer', '/invoices/mine')
    inv = inv.get('invoices', inv)
    assert len(inv) >= 12


# --- Direct chats
def test_conversations_lists():
    w = get('worker', '/conversations/mine')['conversations']
    sam = [c for c in w if c['participant_first_name'] == 'Sam']
    assert sam and sam[0]['unread_count'] == 2
    e = get('employer', '/conversations/mine')['conversations']
    names = {c['participant_first_name'] for c in e}
    assert {'Alex', 'Priya', 'Jamie', 'Leo'} <= names, names


def test_direct_messages_render_data():
    cid = [c for c in get('worker', '/conversations/mine')['conversations'] if c['participant_first_name'] == 'Sam'][0]['id']
    msgs = get('worker', f'/conversations/{cid}/messages')['messages']
    assert len(msgs) >= 11
    assert any(m['reply_to_message_id'] for m in msgs)
    assert any(m['reactions'] for m in msgs)
    assert any('giphy' in m['body'] for m in msgs)
    assert any('Shift reminder' in m['body'] for m in msgs)


def test_direct_send_react_reply_both_sides():
    cid = [c for c in get('worker', '/conversations/mine')['conversations'] if c['participant_first_name'] == 'Sam'][0]['id']
    created = []
    try:
        r = requests.post(f"{API}/conversations/{cid}/messages", headers=h('worker'), json={'body': 'TEST_worker direct'}, timeout=30)
        assert r.status_code == 201; mid = r.json()['id']; created.append(mid)
        r = requests.post(f"{API}/conversations/{cid}/messages", headers=h('employer'), json={'body': 'TEST_employer reply', 'replyToMessageId': mid}, timeout=30)
        assert r.status_code == 201; rid = r.json()['id']; created.append(rid)
        r = requests.post(f"{API}/conversations/{cid}/messages/{mid}/reactions", headers=h('employer'), json={'emoji': '👍'}, timeout=30)
        assert r.status_code == 200 and r.json()['removed'] is False
        msgs = get('worker', f'/conversations/{cid}/messages')['messages']
        m = next(x for x in msgs if x['id'] == mid)
        assert m['reactions'][0]['emoji'] == '👍'
        rep = next(x for x in msgs if x['id'] == rid)
        assert rep['reply_to_message_id'] == mid and rep['reply_body'] == 'TEST_worker direct'
    finally:
        if created:
            ids = ','.join(map(str, created))
            sql(f"DELETE FROM direct_message_reactions WHERE message_id IN ({ids}); DELETE FROM employer_worker_messages WHERE id IN ({ids})")
        # restore seeded unread state + last_message_at (GET as worker marks messages read)
        sql(f"UPDATE employer_worker_messages SET read_at=NULL WHERE conversation_id={cid} AND (body LIKE 'Yes please, and wear black%' OR body LIKE 'Also - could you cover%'); "
            f"UPDATE employer_worker_conversations c SET last_message_at=(SELECT MAX(created_at) FROM employer_worker_messages m WHERE m.conversation_id=c.id) WHERE id={cid}")


# --- Workchats
def test_workchats_seeded():
    w = get('worker', '/workchats/mine')['workchats']
    names = {c['name']: c for c in w}
    for n in ['Riverside Fest Crew 🎪', 'Friday Bar Team', 'Autumn Beats Weekend']:
        assert n in names, names.keys()
    assert names['Autumn Beats Weekend']['status'] == 'past'
    e = get('employer', '/workchats/mine')['workchats']
    assert len(e) >= 3


def test_workchat_messages_pins_reactions_and_send():
    wc = [c for c in get('worker', '/workchats/mine')['workchats'] if c['name'] == 'Riverside Fest Crew 🎪'][0]['id']
    d = get('worker', f'/workchats/{wc}/messages')
    msgs = d['messages']
    assert sum(1 for m in msgs if m['pinned_at']) == 2
    assert any(m['reply_to_message_id'] for m in msgs)
    assert any(m['reactions'] for m in msgs)
    target = msgs[-2]['id']
    created = []
    try:
        r = requests.post(f"{API}/workchats/{wc}/messages/{target}/reactions", headers=h('worker'), json={'emoji': '🎉'}, timeout=30)
        assert r.status_code == 200
        m = next(x for x in get('worker', f'/workchats/{wc}/messages')['messages'] if x['id'] == target)
        assert any(x['emoji'] == '🎉' and x['reacted_by_me'] for x in m['reactions'])
        r = requests.post(f"{API}/workchats/{wc}/messages", headers=h('worker'), json={'body': 'TEST_wc reply', 'replyToMessageId': target}, timeout=30)
        assert r.status_code == 201; created.append(r.json()['id'])
        r = requests.post(f"{API}/workchats/{wc}/messages", headers=h('employer'), json={'body': 'TEST_wc employer'}, timeout=30)
        assert r.status_code == 201; created.append(r.json()['id'])
    finally:
        sql(f"DELETE FROM workchat_message_reactions WHERE message_id={target} AND emoji='🎉' AND user_id=(SELECT id FROM users WHERE email='demo.worker@hyrz.local')")
        if created:
            ids = ','.join(map(str, created))
            sql(f"DELETE FROM workchat_message_reads WHERE message_id IN ({ids}); DELETE FROM workchat_messages WHERE id IN ({ids})")
        sql(f"UPDATE workchats w SET last_message_at=(SELECT MAX(created_at) FROM workchat_messages m WHERE m.workchat_id=w.id) WHERE id={wc}; "
            f"UPDATE workchat_participants SET last_read_at=(SELECT DATE_SUB(MAX(created_at), INTERVAL 60 MINUTE) FROM workchat_messages WHERE workchat_id={wc}) WHERE workchat_id={wc} AND user_id=(SELECT id FROM users WHERE email='demo.worker@hyrz.local')")


def test_past_workchat_read_only():
    wc = [c for c in get('worker', '/workchats/mine')['workchats'] if c['name'] == 'Autumn Beats Weekend'][0]['id']
    r = requests.post(f"{API}/workchats/{wc}/messages", headers=h('worker'), json={'body': 'TEST_past'}, timeout=30)
    assert r.status_code in (403, 404)


# --- Admin threads
def test_admin_threads():
    wm = get('worker', '/messages/mine')['messages']
    assert any(m['subject'] == 'Switching to hyrz PAYE' for m in wm)
    unread = [m for m in wm if m['subject'] == 'Switching to hyrz PAYE' and m['read_at'] is None and m['recipient_role'] == 'worker']
    assert len(unread) == 1
    em = get('employer', '/messages/mine')['messages']
    assert {m['subject'] for m in em} >= {'Late finish on Bartender – Late Bar', 'Welcome to hyrz 👋'}
    adm = get('admin', '/admin/inbox')
    assert 'Switching to hyrz PAYE' in str(adm)


# --- Payroll
def test_payslips():
    d = get('worker', '/worker/payslips')
    assert d['worker']['email'] == 'demo.worker@hyrz.local' and d['worker']['name']
    ps = d['payslips']
    print([(p['taxYear'], p['week'], p['payType'], p['gross'], p['incomeTax'], p['employeeNi'], p['net']) for p in ps])
    assert 4 <= len(ps) <= 7
    assert any(p['incomeTax'] > 0 and p['employeeNi'] > 0 for p in ps)
    for p in ps:
        assert p['payType'] == 'paye'
        assert abs(p['gross'] - p['incomeTax'] - p['employeeNi'] - p['net']) < 0.02
    s = get('worker', '/worker/pay-settings')['settings']
    assert s['payType'] == 'paye' and s['taxCode'] == '1257L' and s['niCategory'] == 'A'


@pytest.mark.parametrize('body,needle', [
    ({'payType': 'paye', 'taxCode': 'HELLO', 'niCategory': 'A', 'confirmed': True}, 'valid tax code'),
    ({'payType': 'paye', 'taxCode': 'S1257L', 'niCategory': 'A', 'confirmed': True}, 'Scottish'),
    ({'payType': 'paye', 'taxCode': '1257L', 'niCategory': 'A', 'confirmed': False}, 'confirm'),
    ({'payType': 'bogus'}, 'contractor or PAYE'),
])
def test_pay_settings_validation(body, needle):
    r = requests.put(f"{API}/worker/pay-settings", headers=h('worker'), json=body, timeout=30)
    assert r.status_code == 400 and needle in r.json()['error']


# --- Clock in (today's seeded shift)
def test_clock_in_today():
    shift = sql("SELECT s.id FROM shifts s JOIN businesses b ON b.id=s.business_id JOIN users u ON u.id=b.owner_user_id WHERE u.email='demo.employer@hyrz.local' AND s.title='Cocktail Bar Host' AND DATE(s.starts_at)=UTC_DATE() LIMIT 1").strip()
    assert shift
    wid = sql("SELECT id FROM users WHERE email='demo.worker@hyrz.local'").strip()
    pre = sql(f"SELECT id FROM checkouts WHERE shift_id={shift} AND worker_id={wid}").strip()
    if pre:
        pytest.skip(f'checkout already exists for today shift: {pre}')
    r = requests.post(f"{API}/checkouts/clock-in", headers=h('worker'), json={'shiftId': int(shift)}, timeout=30)
    print('clock-in', r.status_code, r.text)
    try:
        assert r.status_code in (200, 201), r.text
        cid = r.json()['checkoutId']
        assert sql(f"SELECT status FROM checkouts WHERE id={cid}").strip() == 'open'
        r2 = requests.post(f"{API}/checkouts/clock-in", headers=h('worker'), json={'shiftId': int(shift)}, timeout=30)
        assert r2.status_code == 409
    finally:
        sql(f"DELETE FROM checkouts WHERE shift_id={shift} AND worker_id={wid} AND status='open'")
