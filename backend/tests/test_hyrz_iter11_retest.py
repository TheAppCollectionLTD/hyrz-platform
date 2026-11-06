# Iteration 11 retest: workchat photo split from /mine (photo_version + /photo endpoint),
# PAYE apply without contract fields, contractor still needs contract, fee-tier credit,
# fee credits drop when credited-week invoices are cancelled, sign-up error messages (API side).
# Run: cd /app/backend && python -m pytest tests/test_hyrz_iter11_retest.py -n 0 -v
# NOTE: mutates demo data (application, invoice status temporarily, workchat photo) -> run `cd /app/server && npm run seed:demo` afterwards.
import base64
import json
import subprocess
import requests


def _base():
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            return line.split('=', 1)[1].strip().rstrip('/')


BASE = _base() + '/api'
CREDS = {
    'worker': ('demo.worker@hyrz.local', 'HyrzDemoWorker!2026'),
    'priya': ('priya.demo@hyrz.local', 'HyrzDemoWorker!2026'),
    'employer': ('demo.employer@hyrz.local', 'HyrzDemoEmployer!2026'),
}
_tok = {}
PNG = 'data:image/png;base64,' + base64.b64encode(bytes.fromhex(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f80f0000010101005d0bdd0a0000000049454e44ae426082')).decode()


def h(who):
    if who not in _tok:
        e, p = CREDS[who]
        r = requests.post(f'{BASE}/auth/login', json={'email': e, 'password': p})
        assert r.status_code == 200, r.text
        _tok[who] = r.json()['token']
    return {'Authorization': f'Bearer {_tok[who]}'}


def sql(q):
    out = subprocess.run(['mysql', '-uhyrz_app', '-phyrz_preview_pw', '-h127.0.0.1', 'hyrz_test', '-N', '-B', '-e', q],
                         capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    return [l.split('\t') for l in out.stdout.strip().splitlines() if l]


# ---------- FIX 3: workchat photo ----------
class TestWorkchatPhoto:
    def test_upload_and_mine_has_no_base64(self):
        r = requests.patch(f'{BASE}/workchats/72/profile', headers=h('employer'), json={'photo': PNG})
        assert r.status_code == 200, r.text
        for who in ('employer', 'worker'):
            m = requests.get(f'{BASE}/workchats/mine', headers=h(who))
            assert m.status_code == 200
            assert 'base64' not in m.text
            w = next(x for x in m.json()['workchats'] if x['id'] == 72)
            assert 'photo' not in w
            assert w['photo_version'] is not None
            others = [x for x in m.json()['workchats'] if x['id'] != 72]
            assert all(x['photo_version'] is None for x in others)

    def test_photo_endpoint_participant(self):
        for who in ('employer', 'worker'):
            r = requests.get(f'{BASE}/workchats/72/photo', headers=h(who))
            assert r.status_code == 200 and r.json()['photo'] == PNG

    def test_photo_endpoint_non_participant_404(self):
        # priya is not in workchat 73
        requests.patch(f'{BASE}/workchats/73/profile', headers=h('employer'), json={'photo': PNG})
        r = requests.get(f'{BASE}/workchats/73/photo', headers=h('priya'))
        assert r.status_code == 404

    def test_photo_version_changes_and_reset(self):
        v1 = next(x for x in requests.get(f'{BASE}/workchats/mine', headers=h('employer')).json()['workchats'] if x['id'] == 72)['photo_version']
        png2 = PNG[:-4] + 'AAAA' if not PNG.endswith('AAAA') else PNG
        requests.patch(f'{BASE}/workchats/72/profile', headers=h('employer'), json={'photo': png2})
        v2 = next(x for x in requests.get(f'{BASE}/workchats/mine', headers=h('employer')).json()['workchats'] if x['id'] == 72)['photo_version']
        assert v1 != v2
        for wid in (72, 73):
            r = requests.patch(f'{BASE}/workchats/{wid}/profile', headers=h('employer'), json={'photo': None})
            assert r.status_code == 200
        assert requests.get(f'{BASE}/workchats/72/photo', headers=h('employer')).json()['photo'] is None


# ---------- FIX 6: apply ----------
class TestApplyPayType:
    def test_contractor_needs_contract(self):
        r = requests.post(f'{BASE}/shifts/470/apply', headers=h('priya'), json={'confirmedRequirements': True})
        assert r.status_code == 400 and 'contract' in r.json()['error'].lower(), r.text

    def test_paye_apply_without_contract(self):
        sql("DELETE FROM applications WHERE shift_id=469 AND worker_id=6")
        r = requests.post(f'{BASE}/shifts/469/apply', headers=h('worker'), json={'confirmedRequirements': True})
        print(r.status_code, r.text[:300])
        assert r.status_code in (200, 201), r.text
        rows = sql("SELECT contract_snapshot FROM applications WHERE shift_id=469 AND worker_id=6")
        snap = json.loads(rows[0][0])
        assert snap['version'] == 'hyrz-paye-employment-v1'


# ---------- FIX 6: fee credits (invoice cancel = status 'void' in enum) ----------
class TestFeeCredits:
    def test_fee_tier_last_week_credit(self):
        r = requests.get(f'{BASE}/employer/fee-tier', headers=h('employer'))
        assert r.status_code == 200
        d = r.json()
        print(json.dumps(d['credits'][:3]), d['totalCredits'])
        assert d['credits'] and abs(d['credits'][0]['amount'] - 38.61) < 0.5

    def test_credit_removed_when_invoices_cancelled(self):
        d = requests.get(f'{BASE}/employer/fee-tier', headers=h('employer')).json()
        wk = d['credits'][0]['week_start']
        ids = sql(f"""SELECT i.id FROM invoices i JOIN checkouts c ON c.id=i.checkout_id JOIN businesses b ON b.id=i.business_id
                     WHERE b.owner_user_id=7 AND i.status NOT IN ('void','cancelled') AND COALESCE(c.counter_start,c.actual_start)>='{wk}'
                     AND COALESCE(c.counter_start,c.actual_start)<DATE_ADD('{wk}', INTERVAL 7 DAY)""")
        ids = [r[0] for r in ids]
        assert ids
        orig = sql(f"SELECT id,status FROM invoices WHERE id IN ({','.join(ids)})")
        try:
            sql(f"UPDATE invoices SET status='void' WHERE id IN ({','.join(ids)})")
            d2 = requests.get(f'{BASE}/employer/fee-tier', headers=h('employer')).json()
            assert all(c['week_start'] != wk for c in d2['credits']), d2['credits']
        finally:
            for i, s in orig:
                sql(f"UPDATE invoices SET status='{s}' WHERE id={i}")
            requests.get(f'{BASE}/employer/fee-tier', headers=h('employer'))
        d3 = requests.get(f'{BASE}/employer/fee-tier', headers=h('employer')).json()
        assert any(c['week_start'] == wk for c in d3['credits'])

    def test_calculate_pay_fee_rules(self):
        js = ("const {calculatePay}=require('/app/server/src/pricing');"
              "const a=calculatePay({hourlyPay:15,startsAt:'2026-01-01T10:00:00Z',endsAt:'2026-01-01T14:00:00Z'});"
              "const b=calculatePay({hourlyPay:30,startsAt:'2026-01-01T10:00:00Z',endsAt:'2026-01-01T14:00:00Z'});"
              "console.log(JSON.stringify([a.platformFee,b.platformFee]))")
        out = subprocess.run(['node', '-e', js], capture_output=True, text=True)
        assert json.loads(out.stdout) == [8, 12], out.stdout + out.stderr


def teardown_module(module):
    # remove the PAYE application this suite created on shift 469
    sql("DELETE FROM shift_confirmation_invites WHERE shift_id=469 AND worker_id=6")
    sql("DELETE FROM applications WHERE shift_id=469 AND worker_id=6")
    for wid in (72, 73):
        sql(f"UPDATE workchats SET photo=NULL WHERE id={wid}")
