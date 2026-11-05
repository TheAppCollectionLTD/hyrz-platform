# Iteration 5: verification gate (email/ID/RTW/company), payments & fees maths, payroll, admin finance.
# Run serially: pytest /app/backend/tests/test_hyrz_iter5_verification_payments.py -n 0 -v
# Destructive on demo data -> re-run seeder afterwards: cd /app/server && node scripts/seed-demo-data.js
import os
import subprocess
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests

def _base():
    url = os.environ.get('REACT_APP_BACKEND_URL')
    if not url:
        for line in open('/app/frontend/.env'):
            if line.startswith('REACT_APP_BACKEND_URL='):
                url = line.split('=', 1)[1].strip()
    return url.rstrip('/')

BASE = _base() + '/api'
CREDS = {
    'worker': ('demo.worker@hyrz.local', 'HyrzDemoWorker!2026'),
    'employer': ('demo.employer@hyrz.local', 'HyrzDemoEmployer!2026'),
    'new_worker': ('new.worker@hyrz.local', 'HyrzNewUser!2026'),
    'new_employer': ('new.employer@hyrz.local', 'HyrzNewUser!2026'),
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

def fee(rate, hours):
    return round((2 if rate <= 20 else rate * 0.10) * hours + 1e-9, 2)

def shift_id(title, when_prefix):
    return int(sql(f"SELECT id FROM shifts WHERE title='{title}' AND starts_at LIKE '{when_prefix}%' ORDER BY id DESC LIMIT 1"))


# ---------- Verification gate ----------
class TestVerificationGate:
    def test_unverified_worker_cannot_apply(self):
        sid = int(sql("SELECT id FROM shifts WHERE status='open' ORDER BY id DESC LIMIT 1"))
        r = requests.post(f'{BASE}/shifts/{sid}/apply', headers=h('new_worker'), json={'contractAccepted': True})
        assert r.status_code == 403 and r.json().get('code') == 'VERIFICATION_REQUIRED', r.text

    def test_unverified_employer_cannot_post_shift(self):
        r = requests.post(f'{BASE}/shifts', headers=h('new_employer'), json={'title': 'Bartender'})
        assert r.status_code == 403 and r.json().get('code') == 'VERIFICATION_REQUIRED', r.text

    def test_identity_session_503_and_status_not_started(self):
        r = requests.post(f'{BASE}/verification/identity/session', headers=h('new_worker'))
        assert r.status_code == 503 and 'not switched on' in r.json()['error']
        s = requests.get(f'{BASE}/verification/identity/status', headers=h('new_worker'))
        assert s.status_code == 200 and s.json()['status'] == 'not_started' and s.json()['configured'] is False

    def test_webhook_not_configured(self):
        r = requests.post(f'{BASE}/stripe/identity-webhook', data='{}', headers={'Content-Type': 'application/json'})
        assert r.status_code == 503 and 'not configured' in r.text

    def test_rtw_invalid_then_valid(self):
        bad = requests.post(f'{BASE}/verification/right-to-work', headers=h('new_worker'), json={'shareCode': 'ABC', 'dateOfBirth': '1995-04-12'})
        assert bad.status_code == 400
        bad_dob = requests.post(f'{BASE}/verification/right-to-work', headers=h('new_worker'), json={'shareCode': 'W12 345 67A', 'dateOfBirth': '2020-01-01'})
        assert bad_dob.status_code == 400
        ok = requests.post(f'{BASE}/verification/right-to-work', headers=h('new_worker'), json={'shareCode': 'W12 345 67A', 'dateOfBirth': '1995-04-12'})
        assert ok.status_code == 200 and ok.json()['status'] == 'pending'
        d = requests.get(f'{BASE}/verification/details', headers=h('new_worker')).json()
        assert d['rightToWork']['shareCodeSubmitted'] is True
        assert sql("SELECT right_to_work_status FROM worker_profiles wp JOIN users u ON u.id=wp.user_id WHERE u.email='new.worker@hyrz.local'") == 'pending'

    def test_employer_cannot_submit_rtw(self):
        r = requests.post(f'{BASE}/verification/right-to-work', headers=h('new_employer'), json={'shareCode': 'W1234567A', 'dateOfBirth': '1990-01-01'})
        assert r.status_code == 403

    def test_admin_queue_shows_evidence(self):
        r = requests.get(f'{BASE}/admin/verification-queue', headers=h('admin'))
        assert r.status_code == 200
        acc = {a['email']: a for a in r.json()['accounts']}
        assert acc['new.worker@hyrz.local']['rtwShareCode'] == 'W1234567A'
        assert acc['new.employer@hyrz.local']['companyCheckReason']
        uid = acc['new.worker@hyrz.local']['userId']
        ev = requests.get(f'{BASE}/admin/verification/{uid}/evidence', headers=h('admin')).json()
        assert ev['rightToWork']['checkUrl'].startswith('https://www.gov.uk/')

    def test_register_unverified_email_then_login_refused(self):
        email = f'test_iter5_{int(time.time())}@example.com'
        r = requests.post(f'{BASE}/auth/register', json={
            'email': email, 'password': 'TestPassword!2026', 'confirmPassword': 'TestPassword!2026', 'role': 'worker',
            'firstName': 'TEST', 'lastName': 'Iter5', 'nationalInsuranceNumber': 'QQ123456C',
            'termsAccepted': True, 'termsVersion': '2026-10-19'})
        assert r.status_code == 503 and 'verification email could not be sent' in r.json()['error']
        lg = requests.post(f'{BASE}/auth/login', json={'email': email, 'password': 'TestPassword!2026'})
        assert lg.status_code == 403 and lg.json()['code'] == 'EMAIL_NOT_VERIFIED'
        uid = sql(f"SELECT id FROM users WHERE email='{email}'")
        if uid:
            requests.delete(f'{BASE}/admin/users/{uid}', headers=h('admin'), json={'reason': 'TEST cleanup iter5'})
            sql(f"DELETE FROM worker_profiles WHERE user_id={int(uid)}; DELETE FROM users WHERE id={int(uid)} AND email='{email}'")

    def test_admin_approval_unlocks(self):
        acc = {a['email']: a for a in requests.get(f'{BASE}/admin/verification-queue', headers=h('admin')).json()['accounts']}
        w, e = acc['new.worker@hyrz.local']['userId'], acc['new.employer@hyrz.local']['userId']
        for role, uid, check in [('worker', w, 'identity'), ('worker', w, 'right_to_work'), ('employer', e, 'identity'), ('employer', e, 'company')]:
            r = requests.patch(f'{BASE}/admin/verification/{role}/{uid}', headers=h('admin'), json={'check': check, 'status': 'verified', 'reason': 'TEST approve'})
            assert r.status_code == 200, r.text
        sid = int(sql("SELECT id FROM shifts WHERE status='open' ORDER BY id DESC LIMIT 1"))
        ap = requests.post(f'{BASE}/shifts/{sid}/apply', headers=h('new_worker'), json={})
        assert ap.json().get('code') != 'VERIFICATION_REQUIRED' and ap.status_code == 400
        ps = requests.post(f'{BASE}/shifts', headers=h('new_employer'), json={'title': 'x'})
        assert ps.json().get('code') != 'VERIFICATION_REQUIRED' and ps.status_code == 400


# ---------- Payments & fees ----------
class TestPaymentsFees:
    def test_fee_rule_on_all_approved_checkouts(self):
        rows = sql("SELECT c.id,s.hourly_pay,TIMESTAMPDIFF(MINUTE,c.actual_start,c.actual_end)-c.break_minutes,c.gross_pay,c.platform_fee FROM checkouts c JOIN shifts s ON s.id=c.shift_id")
        bad = []
        for line in rows.splitlines():
            cid, rate, mins, gross, pf = line.split('\t')
            hrs = int(mins) / 60
            if abs(round(float(rate) * hrs + 1e-9, 2) - float(gross)) > 0.011 or abs(fee(float(rate), hrs) - float(pf)) > 0.011:
                bad.append((cid, rate, hrs, gross, pf, fee(float(rate), hrs)))
        assert not bad, f'fee/gross mismatches: {bad}'

    def test_invoice_totals_equal_gross_plus_fee(self):
        inv = requests.get(f'{BASE}/invoices/mine', headers=h('employer')).json()['invoices']
        assert inv
        for i in inv:
            assert abs(float(i['subtotal']) + float(i['platform_fee']) - float(i['total'])) < 0.011

    def test_checkout_approval_creates_issued_invoice(self):
        cid = int(sql("SELECT c.id FROM checkouts c JOIN shifts s ON s.id=c.shift_id WHERE s.title='Bartender – Late Bar' AND c.status='submitted' ORDER BY c.id LIMIT 1"))
        r = requests.patch(f'{BASE}/checkouts/{cid}/review', headers=h('employer'), json={'status': 'approved'})
        assert r.status_code == 200
        inv = [i for i in requests.get(f'{BASE}/invoices/mine', headers=h('employer')).json()['invoices'] if i['checkout_id'] == cid]
        assert len(inv) == 1
        i = inv[0]
        assert i['status'] == 'issued' and float(i['subtotal']) == 54.0 and float(i['platform_fee']) == 8.0 and float(i['total']) == 62.0
        due = (datetime.now(timezone.utc) + timedelta(days=14)).strftime('%Y-%m-%d')
        assert str(i['due_at'])[:10] == due

    def test_counter_offer(self):
        cid = int(sql("SELECT c.id FROM checkouts c JOIN shifts s ON s.id=c.shift_id WHERE s.title='Bartender – Late Bar' AND c.status='submitted' ORDER BY c.id LIMIT 1"))
        bad = requests.post(f'{BASE}/checkouts/{cid}/counter-offer', headers=h('employer'), json={'comment': 'x'})
        assert bad.status_code == 400
        r = requests.post(f'{BASE}/checkouts/{cid}/counter-offer', headers=h('employer'), json={
            'comment': 'TEST left at 22:00', 'actualStart': '2026-11-04T19:00', 'actualEnd': '2026-11-04T22:00', 'breakMinutes': 0})
        assert r.status_code == 201 and r.json()['status'] == 'disputed' and r.json()['counterGrossPay'] == 40.5
        TestPaymentsFees.counter_cid = cid

    def test_invoice_after_counter_offer_uses_counter_amount(self):
        cid = TestPaymentsFees.counter_cid
        r = requests.patch(f'{BASE}/checkouts/{cid}/review', headers=h('employer'), json={'status': 'approved'})
        assert r.status_code == 200
        i = [x for x in requests.get(f'{BASE}/invoices/mine', headers=h('employer')).json()['invoices'] if x['checkout_id'] == cid][0]
        # worker payslip pays counter_gross_pay (40.50) -> invoice should bill the same
        assert float(i['subtotal']) == 40.5, f"invoice subtotal {i['subtotal']} but counter gross 40.50 (fee {i['platform_fee']})"

    def test_employer_cancel_shift_within_24h_fee_preview(self):
        sid = shift_id('Cocktail Bar Host', datetime.now(timezone.utc).strftime('%Y-%m-%d'))
        r = requests.delete(f'{BASE}/shifts/{sid}', headers=h('employer'), json={})
        assert r.status_code == 409, r.text
        d = r.json()
        assert d['approvedWorkers'] == 1 and d['feePerWorker'] == 32.66 and d['totalFee'] == 32.66

    def test_employer_remove_worker_within_24h(self):
        sid = shift_id('Cocktail Bar Host', datetime.now(timezone.utc).strftime('%Y-%m-%d'))
        aid = int(sql(f"SELECT id FROM applications WHERE shift_id={sid} AND status='approved' LIMIT 1"))
        r = requests.delete(f'{BASE}/applications/{aid}', headers=h('employer'), json={})
        assert r.status_code == 409 and r.json()['fee'] == 32.66
        r2 = requests.delete(f'{BASE}/applications/{aid}', headers=h('employer'), json={'confirmCancellationFee': True})
        assert r2.status_code == 200 and r2.json()['fee'] == 32.66
        assert sql(f'SELECT status,cancellation_fee FROM applications WHERE id={aid}') == 'withdrawn\t32.66'
        sql(f"UPDATE applications SET status='approved',cancellation_fee=0 WHERE id={aid}")  # restore for next test

    def test_worker_cancel_within_24h_strike(self):
        sid = shift_id('Cocktail Bar Host', datetime.now(timezone.utc).strftime('%Y-%m-%d'))
        aid = int(sql(f"SELECT id FROM applications WHERE shift_id={sid} AND status='approved' LIMIT 1"))
        before = int(sql("SELECT COUNT(*) FROM worker_strikes w JOIN users u ON u.id=w.worker_id WHERE u.email='demo.worker@hyrz.local'") or 0)
        r = requests.post(f'{BASE}/applications/{aid}/cancel', headers=h('worker'), json={})
        assert r.status_code == 409 and r.json()['strike'] is True
        r2 = requests.post(f'{BASE}/applications/{aid}/cancel', headers=h('worker'), json={'confirmStrike': True})
        assert r2.status_code == 200 and r2.json()['strike'] is True
        after = int(sql("SELECT COUNT(*) FROM worker_strikes w JOIN users u ON u.id=w.worker_id WHERE u.email='demo.worker@hyrz.local'"))
        assert after == before + 1

    def test_employer_cancel_shift_over_24h_no_fee(self):
        sid = shift_id('Bartender – Friday Night', '')
        r = requests.delete(f'{BASE}/shifts/{sid}', headers=h('employer'), json={})
        assert r.status_code == 200 and r.json()['feePerWorker'] == 0 and r.json()['totalFee'] == 0

    def test_no_show_only_after_end(self):
        future = int(sql("SELECT a.id FROM applications a JOIN shifts s ON s.id=a.shift_id JOIN users u ON u.id=a.worker_id WHERE u.email='demo.worker@hyrz.local' AND a.status='approved' AND s.ends_at>UTC_TIMESTAMP() LIMIT 1"))
        r = requests.post(f'{BASE}/applications/{future}/no-show', headers=h('employer'))
        assert r.status_code == 409 and 'after the scheduled shift has ended' in r.json()['error']
        past = int(sql("SELECT a.id FROM applications a JOIN shifts s ON s.id=a.shift_id JOIN users u ON u.id=a.worker_id WHERE u.email='demo.worker@hyrz.local' AND a.status='approved' AND s.title='Bartender – Late Bar' LIMIT 1"))
        r2 = requests.post(f'{BASE}/applications/{past}/no-show', headers=h('employer'))
        assert r2.status_code == 200 and r2.json()['strikeApplied'] is True

    def test_payment_preferences_validation(self):
        g = requests.get(f'{BASE}/employer/payment-preferences', headers=h('employer'))
        assert g.status_code == 200 and 'autoPayCadence' in g.json()['preferences']
        base = {'autoTopUpEnabled': True, 'topUpThreshold': 50, 'topUpAmount': 200, 'autoPayEnabled': True, 'autoPayCadence': '3_days'}
        for bad in [{'topUpThreshold': 0.5}, {'topUpThreshold': 1000001}, {'topUpAmount': 0}, {'topUpAmount': 'abc'}, {'autoPayCadence': '30_days'}]:
            r = requests.put(f'{BASE}/employer/payment-preferences', headers=h('employer'), json={**base, **bad})
            assert r.status_code == 400, bad
        ok = requests.put(f'{BASE}/employer/payment-preferences', headers=h('employer'), json=base)
        assert ok.status_code == 200 and ok.json()['preferences']['autoPayCadence'] == '3_days' and ok.json()['preferences']['topUpAmount'] == '200.00'
        assert requests.get(f'{BASE}/employer/payment-preferences', headers=h('employer')).json()['preferences']['autoTopUpEnabled'] is True


# ---------- Admin finance & payroll ----------
class TestAdminFinancePayroll:
    def test_admin_invoices_status_and_reminder(self):
        r = requests.get(f'{BASE}/admin/invoices', headers=h('admin'))
        assert r.status_code == 200 and r.json()['invoices']
        issued = [i for i in r.json()['invoices'] if i['status'] in ('issued', 'overdue')][0]
        rem = requests.post(f'{BASE}/admin/invoices/{issued["id"]}/send-reminder', headers=h('admin'))
        assert rem.status_code == 503 and 'error' in rem.json()
        bad = requests.patch(f'{BASE}/admin/invoices/{issued["id"]}/status', headers=h('admin'), json={'status': 'bogus'})
        assert bad.status_code == 400
        p = requests.patch(f'{BASE}/admin/invoices/{issued["id"]}/status', headers=h('admin'), json={'status': 'paid'})
        assert p.status_code == 200
        v = requests.patch(f'{BASE}/admin/invoices/{issued["id"]}/status', headers=h('admin'), json={'status': 'void'})
        assert v.status_code == 400
        rem2 = requests.post(f'{BASE}/admin/invoices/{issued["id"]}/send-reminder', headers=h('admin'))
        assert rem2.status_code == 400

    def test_financial_reports(self):
        r = requests.get(f'{BASE}/admin/financial-reports', headers=h('admin'))
        assert r.status_code == 200
        inv = r.json()['invoices']
        assert float(inv['invoicedRevenue']) == float(sql('SELECT SUM(platform_fee) FROM invoices'))

    def test_payroll_summary(self):
        r = requests.get(f'{BASE}/admin/payroll-summary', headers=h('admin'))
        assert r.status_code == 200 and 'totals' in r.json() and r.json()['payslips']

    def test_pay_settings_validation(self):
        for body in [{'payType': 'x'}, {'payType': 'paye', 'taxCode': 'ZZZ', 'niCategory': 'A', 'confirmed': True},
                     {'payType': 'paye', 'taxCode': 'S1257L', 'niCategory': 'A', 'confirmed': True},
                     {'payType': 'paye', 'taxCode': '1257L', 'niCategory': 'Z', 'confirmed': True},
                     {'payType': 'paye', 'taxCode': '1257L', 'niCategory': 'A'}]:
            r = requests.put(f'{BASE}/worker/pay-settings', headers=h('worker'), json=body)
            assert r.status_code == 400, body

    def test_contractor_payslips_gross_only(self):
        # Settings are effective-dated: historic payslips keep the setting in force at the time; check new setting saved
        # and that any contractor payslip (other workers e.g. priya) has net == gross, no deductions.
        r = requests.put(f'{BASE}/worker/pay-settings', headers=h('worker'), json={'payType': 'contractor'})
        assert r.status_code == 200 and r.json()['settings']['payType'] == 'contractor'
        assert requests.get(f'{BASE}/worker/pay-settings', headers=h('worker')).json()['settings']['payType'] == 'contractor'
        summ = requests.get(f'{BASE}/admin/payroll-summary', headers=h('admin')).json()['payslips']
        contractors = [p for p in summ if p['payType'] == 'contractor']
        assert contractors
        for p in contractors:
            assert p['net'] == p['gross'] and p['incomeTax'] == 0 and p['employeeNi'] == 0

    def test_paye_payslip_maths(self):
        # Existing historic checkouts keep their old (contractor) setting; force PAYE from the beginning.
        r = requests.put(f'{BASE}/worker/pay-settings', headers=h('worker'), json={'payType': 'paye', 'taxCode': '1257L', 'niCategory': 'A', 'confirmed': True})
        assert r.status_code == 200 and r.json()['settings']['taxCode'] == '1257L'
        sql("UPDATE worker_pay_settings s JOIN users u ON u.id=s.user_id SET s.effective_from='2026-01-01' WHERE u.email='demo.worker@hyrz.local' AND s.pay_type='paye'")
        d = requests.get(f'{BASE}/worker/payslips', headers=h('worker')).json()
        paye = [p for p in d['payslips'] if p['payType'] == 'paye']
        assert paye
        for p in paye:
            g = p['gross']
            taxable = max(0, g - 12579 / 52)
            exp_tax = round(min(taxable, 37700 / 52) * 0.2 + max(0, taxable - 37700 / 52) * 0.4, 2)
            exp_ni = round(max(0, min(g, 967) - 242) * 0.08 + max(0, g - 967) * 0.02, 2)
            assert abs(p['incomeTax'] - exp_tax) < 0.011 and abs(p['employeeNi'] - exp_ni) < 0.011
            assert abs(p['net'] - round(g - exp_tax - exp_ni, 2)) < 0.011
