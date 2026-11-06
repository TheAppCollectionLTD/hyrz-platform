# Iteration 10: worker pay type (contractor/PAYE) at sign-up & switching, PAYE apply snapshot,
# payslip pay dates, employer weekly bulk-rate credits, admin financial reports, workchats payload size.
# Run: cd /app/backend && python -m pytest tests/test_hyrz_iter10_paytype_bulkrate.py -n 0 -v
import datetime as dt
import json
import random
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
CREATED_EMAILS = []


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


def reg_body(pay_choice, email=None):
    email = email or f'TEST_iter10_{random.randint(10**6, 10**7)}@hyrz.local'.lower()
    b = {'email': email, 'password': 'TestPassword!2026', 'confirmPassword': 'TestPassword!2026', 'role': 'worker',
         'firstName': 'TEST', 'lastName': 'Iter10', 'termsAccepted': True, 'termsVersion': '2026-10-19',
         'nationalInsuranceNumber': f'QQ{random.randint(100000, 999999)}C', 'postcode': 'SW1A 1AA'}
    if pay_choice is not None:
        b['payChoice'] = pay_choice
    return b


# ---------- Sign-up pay choice ----------
class TestRegisterPayChoice:
    def test_missing_pay_choice(self):
        r = requests.post(f'{BASE}/auth/register', json=reg_body(None))
        assert r.status_code == 400 and 'contractor' in r.json()['error'].lower()

    def test_not_agreed(self):
        r = requests.post(f'{BASE}/auth/register', json=reg_body({'payType': 'paye', 'contractAccepted': False, 'contractVersion': 'hyrz-paye-employment-v1'}))
        assert r.status_code == 400 and 'contract' in r.json()['error'].lower()

    def test_wrong_version(self):
        r = requests.post(f'{BASE}/auth/register', json=reg_body({'payType': 'contractor', 'contractAccepted': True, 'contractVersion': 'hyrz-paye-employment-v1'}))
        assert r.status_code == 400

    def test_bad_tax_code(self):
        r = requests.post(f'{BASE}/auth/register', json=reg_body({'payType': 'paye', 'contractAccepted': True, 'contractVersion': 'hyrz-paye-employment-v1', 'taxCode': 'XYZ', 'niCategory': 'A'}))
        assert r.status_code == 400 and 'tax code' in r.json()['error'].lower()

    def test_paye_signup_stores_row(self):
        body = reg_body({'payType': 'paye', 'contractAccepted': True, 'contractVersion': 'hyrz-paye-employment-v1', 'taxCode': 'BR', 'niCategory': 'A'})
        r = requests.post(f'{BASE}/auth/register', json=body)
        CREATED_EMAILS.append(body['email'])
        print('register status', r.status_code, r.text[:200])
        rows = sql(f"SELECT p.pay_type,p.tax_code,p.ni_category,p.contract_version FROM worker_pay_settings p JOIN users u ON u.id=p.user_id WHERE u.email='{body['email']}'")
        assert rows == [['paye', 'BR', 'A', 'hyrz-paye-employment-v1']], rows

    def test_contractor_signup_stores_row(self):
        body = reg_body({'payType': 'contractor', 'contractAccepted': True, 'contractVersion': 'hyrz-contractor-v1'})
        requests.post(f'{BASE}/auth/register', json=body)
        CREATED_EMAILS.append(body['email'])
        rows = sql(f"SELECT p.pay_type,p.tax_code,p.contract_version FROM worker_pay_settings p JOIN users u ON u.id=p.user_id WHERE u.email='{body['email']}'")
        assert rows == [['contractor', 'NULL', 'hyrz-contractor-v1']], rows


# ---------- Pay settings switching ----------
class TestPaySettings:
    def test_demo_worker_is_paye(self):
        r = requests.get(f'{BASE}/worker/pay-settings', headers=h('worker'))
        assert r.status_code == 200
        d = r.json()
        assert d['settings']['payType'] == 'paye', d
        assert d['contractVersions'] == {'contractor': 'hyrz-contractor-v1', 'paye': 'hyrz-paye-employment-v1'}

    def test_put_requires_contract(self):
        r = requests.put(f'{BASE}/worker/pay-settings', headers=h('worker'), json={'payType': 'contractor'})
        assert r.status_code == 400
        r = requests.put(f'{BASE}/worker/pay-settings', headers=h('worker'), json={'payType': 'contractor', 'contractAccepted': True, 'contractVersion': 'wrong'})
        assert r.status_code == 400

    def test_employer_cannot_put(self):
        r = requests.put(f'{BASE}/worker/pay-settings', headers=h('employer'), json={'payType': 'paye', 'contractAccepted': True, 'contractVersion': 'hyrz-paye-employment-v1'})
        assert r.status_code == 403

    def test_switch_contractor_and_back_immediate(self):
        orig = requests.get(f'{BASE}/worker/pay-settings', headers=h('worker')).json()['settings']
        try:
            r = requests.put(f'{BASE}/worker/pay-settings', headers=h('worker'), json={'payType': 'contractor', 'contractAccepted': True, 'contractVersion': 'hyrz-contractor-v1'})
            assert r.status_code == 200 and r.json()['settings']['payType'] == 'contractor'
            assert requests.get(f'{BASE}/worker/pay-settings', headers=h('worker')).json()['settings']['payType'] == 'contractor'
        finally:
            r = requests.put(f'{BASE}/worker/pay-settings', headers=h('worker'), json={'payType': 'paye', 'contractAccepted': True, 'contractVersion': 'hyrz-paye-employment-v1', 'taxCode': orig.get('taxCode') or '1257L', 'niCategory': orig.get('niCategory') or 'A'})
            assert r.status_code == 200 and r.json()['settings']['payType'] == 'paye'


# ---------- Payslips pay date ----------
class TestPayslips:
    def test_paye_pay_date_friday_after_week(self):
        r = requests.get(f'{BASE}/worker/payslips', headers=h('worker'))
        assert r.status_code == 200
        slips = r.json()['payslips']
        assert slips
        for s in slips:
            if s['payType'] == 'paye':
                pd = dt.date.fromisoformat(s['payDate'])
                end = dt.date.fromisoformat(s['end'])
                assert pd.weekday() == 4, s
                assert 1 <= (pd - end).days <= 7, s
                assert abs(s['net'] - (s['gross'] - s['incomeTax'] - s['employeeNi'])) < 0.02
            else:
                assert s['payDate'] is None


# ---------- Bulk rate ----------
class TestFeeTier:
    def test_fee_tier_structure_and_math(self):
        r = requests.get(f'{BASE}/employer/fee-tier', headers=h('employer'))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d['rules']['standardHourly'] == 2 and d['rules']['bulkHourly'] == 1.5
        cw = d['currentWeek']
        for k in ('workers', 'hours', 'qualifies', 'estimatedCredit', 'start', 'end'):
            assert k in cw
        assert dt.date.fromisoformat(cw['start']).weekday() == 0
        print('credits', d['credits'])
        assert d['credits'], 'expected demo credit last week'
        c = d['credits'][0]
        ws = c['week_start']
        we = (dt.date.fromisoformat(ws) + dt.timedelta(days=7)).isoformat()
        rows = sql(f"""SELECT s.hourly_pay,i.platform_fee,
          GREATEST(0,TIMESTAMPDIFF(MINUTE,COALESCE(c.counter_start,c.actual_start),COALESCE(c.counter_end,c.actual_end))-COALESCE(c.counter_break_minutes,c.break_minutes,0))/60,c.worker_id
          FROM invoices i JOIN checkouts c ON c.id=i.checkout_id JOIN shifts s ON s.id=c.shift_id JOIN businesses b ON b.id=i.business_id
          JOIN users u ON u.id=b.owner_user_id WHERE u.email='demo.employer@hyrz.local' AND i.status<>'cancelled'
          AND COALESCE(c.counter_start,c.actual_start)>='{ws}' AND COALESCE(c.counter_start,c.actual_start)<'{we}'""")
        expected = round(sum(max(0, float(f) - round(1.5 * float(hr), 2)) for rate, f, hr, _ in rows if float(rate) <= 20), 2)
        workers = len({w for *_, w in rows})
        print('expected', expected, 'workers', workers, 'rows', rows)
        assert workers >= 5
        assert abs(c['amount'] - expected) < 0.011, (c, expected)
        assert abs(d['totalCredits'] - sum(x['amount'] for x in d['credits'])) < 0.02

    def test_fee_tier_worker_forbidden(self):
        assert requests.get(f'{BASE}/employer/fee-tier', headers=h('worker')).status_code == 403

    def test_admin_financial_reports(self):
        r = requests.get(f'{BASE}/admin/financial-reports', headers=h('admin'))
        assert r.status_code == 200, r.text
        d = r.json()
        inv = d['invoices']
        assert 'bulkRateCredits' in inv and 'netRevenue' in inv
        assert 'feeCredits' in d
        assert abs(inv['netRevenue'] - (float(inv['invoicedRevenue']) - inv['bulkRateCredits'])) < 0.02
        assert inv['bulkRateCredits'] > 0


# ---------- Workchats payload (iter 9 retest) ----------
class TestWorkchatsPayload:
    def test_no_base64_in_mine(self):
        for who in ('worker', 'employer'):
            r = requests.get(f'{BASE}/workchats/mine', headers=h(who))
            assert r.status_code == 200
            print(who, 'payload bytes', len(r.content))
            assert 'base64,' not in r.text, f'{who} payload contains base64'


# ---------- PAYE apply snapshot ----------
class TestPayeApply:
    def test_apply_as_paye_snapshot(self):
        r = requests.get(f'{BASE}/shifts', headers=h('worker'))
        assert r.status_code == 200
        data = r.json()
        shifts = data.get('shifts', data if isinstance(data, list) else [])
        apps = requests.get(f'{BASE}/applications/mine', headers=h('worker')).json()
        apps = apps.get('applications', apps if isinstance(apps, list) else [])
        applied = {a.get('shift_id') for a in apps if a.get('status') in ('pending', 'approved')}
        now = dt.datetime.utcnow()
        cand = [s for s in shifts if s['id'] not in applied and not s.get('private_only')
                and dt.datetime.fromisoformat(str(s['starts_at']).replace('Z', '').replace(' ', 'T')[:19]) > now + dt.timedelta(days=3)
                and not (s.get('requirements') not in (None, '', '[]', []))]
        if not cand:
            cand = [s for s in shifts if s['id'] not in applied and dt.datetime.fromisoformat(str(s['starts_at']).replace('Z', '').replace(' ', 'T')[:19]) > now + dt.timedelta(days=3)]
        assert cand, 'no open shift to apply'
        s = cand[0]
        snap = json.dumps({'version': 'hyrz-shift-contract-v1'})
        r = requests.post(f"{BASE}/shifts/{s['id']}/apply", headers=h('worker'), json={'contractAccepted': True, 'contractSnapshot': snap, 'confirmedRequirements': True, 'confirmedPreferences': []})
        print('apply', r.status_code, r.text[:200])
        assert r.status_code in (200, 201), r.text
        row = sql(f"SELECT a.id,a.contract_snapshot FROM applications a JOIN users u ON u.id=a.worker_id WHERE u.email='demo.worker@hyrz.local' AND a.shift_id={s['id']}")
        app_id, snapshot = row[0]
        try:
            assert json.loads(snapshot)['version'] == 'hyrz-paye-employment-v1'
        finally:
            c = requests.post(f'{BASE}/applications/{app_id}/cancel', headers=h('worker'), json={'confirmStrike': False})
            print('cancel', c.status_code, c.text[:200])


def teardown_module(module):
    for e in CREATED_EMAILS:
        ids = sql(f"SELECT id FROM users WHERE email='{e}'")
        for (uid,) in ids:
            sql(f'DELETE FROM worker_pay_settings WHERE user_id={uid}')
            subprocess.run(['mysql', '-uhyrz_app', '-phyrz_preview_pw', '-h127.0.0.1', 'hyrz_test', '-e', f'DELETE FROM users WHERE id={uid}'], capture_output=True)
