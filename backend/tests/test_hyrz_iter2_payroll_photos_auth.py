# hyrz iteration 2: sign-in (rate limit/trust proxy), payroll (pay settings, payslips, admin summary),
# chat photos, shift reminders. Runs against the public preview URL.
import os
import subprocess
import base64
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE_URL = line.split('=', 1)[1].strip().strip('"').rstrip('/')
API = f"{BASE_URL}/api"
SOCK = '/tmp/hyrz-mysql.sock'

ACCOUNTS = {
    'worker': ('test.worker@hyrz.local', 'HyrzTestWorker!2026', 'worker'),
    'worker2': ('test.worker2@hyrz.local', 'HyrzTestWorker2!2026', 'worker'),
    'employer': ('test.employer@hyrz.local', 'HyrzTestEmployer!2026', 'employer'),
    'employer2': ('test.employer2@hyrz.local', 'HyrzTestEmployer2!2026', 'employer'),
    'admin': ('test.owner@hyrz.local', 'Test-Only-Password-2026!', 'admin'),
}

# 1x1 PNG
PNG = 'data:image/png;base64,' + base64.b64encode(bytes.fromhex(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000201a5f6455f0000000049454e44ae426082')).decode()


def sql(q):
    return subprocess.run(['mariadb', f'--socket={SOCK}', 'hyrz_test', '-N', '-e', q], capture_output=True, text=True, check=True).stdout


def login(key):
    email, pw, _ = ACCOUNTS[key]
    return requests.post(f"{API}/auth/login", json={'email': email, 'password': pw}, timeout=30)


_tokens = {}


def hdr(key):
    if key not in _tokens:
        r = login(key)
        if r.status_code != 200:
            pytest.skip(f'login failed for {key}: {r.status_code} {r.text}')
        _tokens[key] = r.json()['token']
    return {'Authorization': f'Bearer {_tokens[key]}'}


# ---------- Auth / sign-in bug ----------
class TestSignIn:
    @pytest.mark.parametrize('key', list(ACCOUNTS))
    def test_each_account_signs_in(self, key):
        r = login(key)
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d['token'], str) and d['token']
        assert d['user']['email'] == ACCOUNTS[key][0]
        assert d['user']['role'] == ACCOUNTS[key][2]

    def test_many_logins_do_not_lock_out(self):
        codes = [requests.post(f"{API}/auth/login", json={'email': 'TEST_nobody@hyrz.local', 'password': 'x'}, timeout=30).status_code for _ in range(35)]
        assert 429 not in codes, codes
        r = login('employer2')
        assert r.status_code == 200, r.text

    def test_wrong_password_401(self):
        r = requests.post(f"{API}/auth/login", json={'email': ACCOUNTS['worker'][0], 'password': 'wrong'}, timeout=30)
        assert r.status_code == 401


# ---------- Payroll ----------
class TestPayroll:
    def test_get_pay_settings_worker(self):
        r = requests.get(f"{API}/worker/pay-settings", headers=hdr('worker'))
        assert r.status_code == 200
        s = r.json()['settings']
        assert s['payType'] == 'paye' and s['taxCode'] == '1257L' and s['niCategory'] == 'A'
        assert r.json()['taxYear'] == '2026/27'

    def test_pay_settings_employer_forbidden(self):
        r = requests.get(f"{API}/worker/pay-settings", headers=hdr('employer'))
        assert r.status_code == 403

    @pytest.mark.parametrize('body,needle', [
        ({'payType': 'paye', 'taxCode': 'HELLO', 'niCategory': 'A', 'confirmed': True}, 'valid tax code'),
        ({'payType': 'paye', 'taxCode': 'S1257L', 'niCategory': 'A', 'confirmed': True}, 'Scottish'),
        ({'payType': 'paye', 'taxCode': '1257L', 'niCategory': 'Z', 'confirmed': True}, 'National Insurance'),
        ({'payType': 'paye', 'taxCode': '1257L', 'niCategory': 'A'}, 'confirm'),
        ({'payType': 'freelance'}, 'contractor or PAYE'),
    ])
    def test_pay_settings_validation(self, body, needle):
        r = requests.put(f"{API}/worker/pay-settings", json=body, headers=hdr('worker'))
        assert r.status_code == 400
        assert needle.lower() in r.json()['error'].lower()

    def test_payslips_contractor_week(self):
        r = requests.get(f"{API}/worker/payslips", headers=hdr('worker'))
        assert r.status_code == 200
        ps = r.json()['payslips']
        assert len(ps) == 1
        p = ps[0]
        assert p['payType'] == 'contractor' and p['week'] == 31
        assert p['gross'] == 213.75 and p['net'] == 213.75 and p['incomeTax'] == 0

    def test_admin_payroll_summary(self):
        r = requests.get(f"{API}/admin/payroll-summary", headers=hdr('admin'))
        assert r.status_code == 200
        d = r.json()
        assert 'totals' in d and d['totals']['gross'] >= 213.75
        assert requests.get(f"{API}/admin/payroll-summary", headers=hdr('worker')).status_code == 403

    def test_paye_deductions_end_to_end(self):
        # Insert an approved £500 checkout dated after the PAYE switch, verify, then delete it by id.
        sql("INSERT INTO checkouts(shift_id,worker_id,actual_start,actual_end,break_minutes,status,gross_pay,platform_fee,worker_comment) "
            "VALUES(3,1,UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR),0,'approved',500.00,0,'TEST_iter2')")
        cid = int(sql("SELECT MAX(id) FROM checkouts WHERE worker_comment='TEST_iter2'").strip())
        try:
            ps = requests.get(f"{API}/worker/payslips", headers=hdr('worker')).json()['payslips']
            paye = [p for p in ps if p['payType'] == 'paye']
            assert len(paye) == 1, ps
            p = paye[0]
            assert p['gross'] == 500 and p['incomeTax'] == 51.62 and p['employeeNi'] == 20.64
            assert p['employerNi'] == 60.6 and p['net'] == 427.74
            assert any(x['payType'] == 'contractor' and x['gross'] == 213.75 for x in ps)
        finally:
            sql(f"DELETE FROM checkouts WHERE id={cid}")


# ---------- Chat photos ----------
class TestChatPhotos:
    created = []

    @classmethod
    def teardown_class(cls):
        for mid in cls.created:
            sql(f"DELETE FROM direct_message_reactions WHERE message_id={int(mid)}; DELETE FROM employer_worker_messages WHERE id={int(mid)}")

    def test_send_photo_and_fetch(self):
        r = requests.post(f"{API}/conversations/1/messages", json={'image': PNG, 'body': 'TEST_photo'}, headers=hdr('worker'))
        assert r.status_code in (200, 201), r.text
        msgs = requests.get(f"{API}/conversations/1/messages", headers=hdr('employer')).json()
        msgs = msgs.get('messages', msgs)
        mine = [m for m in msgs if m.get('body') == 'TEST_photo']
        assert mine and mine[-1]['has_image'] in (1, True)
        mid = mine[-1]['id']
        self.created.append(mid)
        img = requests.get(f"{API}/conversations/1/messages/{mid}/image", headers=hdr('employer'))
        assert img.status_code == 200 and img.json()['image'] == PNG
        # non-participant
        assert requests.get(f"{API}/conversations/1/messages/{mid}/image", headers=hdr('worker2')).status_code == 404

    def test_photo_only_body_default(self):
        r = requests.post(f"{API}/conversations/1/messages", json={'image': PNG}, headers=hdr('worker'))
        assert r.status_code in (200, 201), r.text
        msgs = requests.get(f"{API}/conversations/1/messages", headers=hdr('worker')).json()
        msgs = msgs.get('messages', msgs)
        last = msgs[-1]
        self.created.append(last['id'])
        assert last['body'] == '📷 Photo' and last['has_image'] in (1, True)

    @pytest.mark.parametrize('image', ['data:image/gif;base64,R0lGOD', 'https://evil.example/x.png', 'data:image/png;base64,***'])
    def test_invalid_photo_400(self, image):
        r = requests.post(f"{API}/conversations/1/messages", json={'image': image}, headers=hdr('worker'))
        assert r.status_code == 400

    def test_non_participant_post_404(self):
        r = requests.post(f"{API}/conversations/1/messages", json={'image': PNG}, headers=hdr('worker2'))
        assert r.status_code == 404


# ---------- Shift reminders ----------
class TestShiftReminders:
    def test_reminder_present_in_conversation_1(self):
        msgs = requests.get(f"{API}/conversations/1/messages", headers=hdr('worker')).json()
        msgs = msgs.get('messages', msgs)
        rem = [m for m in msgs if m['body'].startswith('⏰ Shift reminder')]
        assert len(rem) == 1, [m['body'][:40] for m in rem]
        assert 'Festival Bar Crew' in rem[0]['body'] and 'Victoria Park' in rem[0]['body'] and 'tomorrow' in rem[0]['body']

    def test_force_run_no_duplicates(self):
        r = requests.post(f"{API}/admin/shift-reminders/run", json={'force': True}, headers=hdr('admin'))
        assert r.status_code == 200 and r.json()['sent'] == 0

    def test_run_requires_admin(self):
        r = requests.post(f"{API}/admin/shift-reminders/run", json={'force': True}, headers=hdr('worker'))
        assert r.status_code == 403
