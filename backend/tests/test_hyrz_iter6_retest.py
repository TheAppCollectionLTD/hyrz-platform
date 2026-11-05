# Iteration 6 retest: counter-offer invoice/payslip, review status guard, worker cancel after start, admin company check.
# Run serially: cd /app/backend && python -m pytest tests/test_hyrz_iter6_retest.py -n 0 -v
# Destructive on demo data -> re-run seeder afterwards: cd /app/server && node scripts/seed-demo-data.js
import subprocess

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


def sql(q):
    return subprocess.run(['mariadb', '--socket=/tmp/hyrz-mysql.sock', 'hyrz_test', '-N', '-B', '-e', q],
                          capture_output=True, text=True).stdout.strip()


def h(who):
    if who not in _tok:
        e, p = CREDS[who]
        r = requests.post(f'{BASE}/auth/login', json={'email': e, 'password': p})
        assert r.status_code == 200, r.text
        _tok[who] = r.json()['token']
    return {'Authorization': f'Bearer {_tok[who]}'}


def late_bar_cid():
    return int(sql("SELECT c.id FROM checkouts c JOIN shifts s ON s.id=c.shift_id JOIN users u ON u.id=c.worker_id "
                   "WHERE s.title='Bartender – Late Bar' AND u.email='demo.worker@hyrz.local' ORDER BY c.id DESC LIMIT 1"))


# ---------- Counter-offer -> invoice + payslip ----------
class TestCounterOfferInvoice:
    def test_01_counter_offer(self):
        cid = late_bar_cid()
        assert sql(f'SELECT status FROM checkouts WHERE id={cid}') == 'submitted'
        r = requests.post(f'{BASE}/checkouts/{cid}/counter-offer', headers=h('employer'), json={
            'comment': 'TEST left at 22:00', 'actualStart': '2026-11-04T19:00', 'actualEnd': '2026-11-04T22:00', 'breakMinutes': 0})
        assert r.status_code == 201, r.text
        assert r.json()['counterGrossPay'] == 40.5

    def test_02_approve_invoice_uses_counter(self):
        cid = late_bar_cid()
        r = requests.patch(f'{BASE}/checkouts/{cid}/review', headers=h('employer'), json={'status': 'approved'})
        assert r.status_code == 200, r.text
        inv = [x for x in requests.get(f'{BASE}/invoices/mine', headers=h('employer')).json()['invoices'] if x['checkout_id'] == cid]
        assert len(inv) == 1
        i = inv[0]
        # 3h @ £13.50 = 40.50; fee £2/h (rate <= £20) = 6.00
        assert float(i['subtotal']) == 40.5, i
        assert float(i['platform_fee']) == 6.0, i
        assert float(i['total']) == 46.5, i

    def test_03_payslip_matches_counter(self):
        cid = late_bar_cid()
        slips = requests.get(f'{BASE}/worker/payslips', headers=h('worker')).json()['payslips']
        lines = [l for p in slips for l in p['lines'] if l['checkoutId'] == cid]
        assert len(lines) == 1 and lines[0]['gross'] == 40.5, lines

    def test_04_review_again_409(self):
        cid = late_bar_cid()
        for st in ['approved', 'rejected', 'disputed']:
            r = requests.patch(f'{BASE}/checkouts/{cid}/review', headers=h('employer'), json={'status': st})
            assert r.status_code == 409, (st, r.text)

    def test_05_admin_review_again_409(self):
        cid = late_bar_cid()
        r = requests.patch(f'{BASE}/checkouts/{cid}/review', headers=h('admin'), json={'status': 'rejected'})
        assert r.status_code == 409, r.text

    def test_06_review_rejected_then_409(self):
        cid = int(sql("SELECT id FROM checkouts WHERE status='approved' ORDER BY id LIMIT 1"))
        # Temporarily set to rejected to check the guard on rejected checkouts
        orig = sql(f'SELECT status FROM checkouts WHERE id={cid}')
        sql(f"UPDATE checkouts SET status='rejected' WHERE id={cid}")
        try:
            r = requests.patch(f'{BASE}/checkouts/{cid}/review', headers=h('admin'), json={'status': 'approved'})
            assert r.status_code == 409, r.text
        finally:
            sql(f"UPDATE checkouts SET status='{orig}' WHERE id={cid}")

    def test_07_counter_offer_on_approved_checkout(self):
        # Edge: counter-offer after approval should be refused (otherwise invoice and payslip drift)
        cid = late_bar_cid()
        r = requests.post(f'{BASE}/checkouts/{cid}/counter-offer', headers=h('employer'), json={
            'comment': 'TEST late counter', 'actualStart': '2026-11-04T19:00', 'actualEnd': '2026-11-04T20:00', 'breakMinutes': 0})
        assert r.status_code in (400, 409), f'counter-offer on approved checkout accepted: {r.status_code} {r.text}'


# ---------- Worker cancel after start ----------
class TestWorkerCancel:
    def test_cancel_started_shift_409(self):
        aid = int(sql("SELECT a.id FROM applications a JOIN shifts s ON s.id=a.shift_id JOIN users u ON u.id=a.worker_id "
                      "WHERE u.email='demo.worker@hyrz.local' AND a.status='approved' AND s.starts_at<UTC_TIMESTAMP() ORDER BY s.starts_at DESC LIMIT 1"))
        before = sql("SELECT COUNT(*) FROM worker_strikes w JOIN users u ON u.id=w.worker_id WHERE u.email='demo.worker@hyrz.local'")
        for body in [{}, {'confirmStrike': True}]:
            r = requests.post(f'{BASE}/applications/{aid}/cancel', headers=h('worker'), json=body)
            assert r.status_code == 409 and 'already started' in r.json()['error'], r.text
        assert sql(f'SELECT status FROM applications WHERE id={aid}') == 'approved'
        assert sql("SELECT COUNT(*) FROM worker_strikes w JOIN users u ON u.id=w.worker_id WHERE u.email='demo.worker@hyrz.local'") == before


# ---------- Admin verification queue ----------
class TestAdminQueue:
    def test_new_employer_company_check_reason(self):
        uid = sql("SELECT id FROM users WHERE email='new.employer@hyrz.local'")
        reason = sql(f"SELECT company_check_reason FROM businesses WHERE owner_user_id={uid}")
        assert reason and reason != 'NULL', reason
        r = requests.get(f'{BASE}/admin/verification-queue', headers=h('admin'))
        assert r.status_code == 200, r.text
        assert 'new.employer@hyrz.local' in r.text
