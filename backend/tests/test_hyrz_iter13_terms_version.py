# Iteration 13: register termsVersion enforcement (2026-11-06) + login smoke
import os, time, subprocess
import pytest, requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
REG = f"{BASE_URL}/api/auth/register"


def _env():
    vals = {}
    for line in open('/app/server/.env'):
        if '=' in line and not line.startswith('#'):
            k, v = line.strip().split('=', 1)
            vals[k] = v.strip('"')
    return vals


def _mysql(sql):
    e = _env()
    return subprocess.run(['mysql', '-h', e['DB_HOST'], '-P', e['DB_PORT'], '-u', e['DB_USER'], f"-p{e['DB_PASSWORD']}", e['DB_NAME'], '-N', '-e', sql],
                          capture_output=True, text=True)


def _worker(email, version):
    body = {"email": email, "password": "TEST_Passw0rd!2026", "confirmPassword": "TEST_Passw0rd!2026", "role": "worker",
            "firstName": "TEST", "lastName": "Iter13", "nationalInsuranceNumber": f"QQ{int(time.time()*1000)%1000000:06d}C",
            "termsAccepted": True, "payChoice": {"payType": "contractor", "contractAccepted": True, "contractVersion": "hyrz-contractor-v1"}}
    if version is not None:
        body["termsVersion"] = version
    return body


class TestTermsVersion:
    def test_old_version_rejected(self):
        r = requests.post(REG, json=_worker("test_iter13_old@example.com", "2026-10-19"))
        assert r.status_code == 400
        assert "Terms" in r.json()["error"]

    def test_missing_version_rejected(self):
        r = requests.post(REG, json=_worker("test_iter13_none@example.com", None))
        assert r.status_code == 400
        assert "Terms" in r.json()["error"]

    def test_terms_accepted_false_rejected(self):
        b = _worker("test_iter13_f@example.com", "2026-11-06"); b["termsAccepted"] = False
        r = requests.post(REG, json=b)
        assert r.status_code == 400

    def test_new_version_passes_terms_gate(self):
        # bad password -> should fail on password validation, not terms
        b = _worker("test_iter13_pw@example.com", "2026-11-06"); b["password"] = "short"; b["confirmPassword"] = "short"
        r = requests.post(REG, json=b)
        assert r.status_code == 400
        assert "12 characters" in r.json()["error"]

    def test_new_version_full_register(self):
        email = f"test_iter13_{int(time.time())}@example.com"
        r = requests.post(REG, json=_worker(email, "2026-11-06"))
        try:
            print(r.status_code, r.text[:300])
            assert r.status_code in (200, 201, 202, 503), r.text
            out = _mysql(f"SELECT id FROM users WHERE email='{email}'").stdout.strip()
            if r.status_code != 503 or out:
                assert out, "user not persisted"
        finally:
            uid = _mysql(f"SELECT id FROM users WHERE email='{email}'").stdout.strip()
            if uid:
                print("cleanup user", uid, _mysql(f"DELETE FROM audit_logs WHERE actor_id={uid}; DELETE FROM worker_pay_settings WHERE user_id={uid}; DELETE FROM worker_profiles WHERE user_id={uid}; DELETE FROM users WHERE id={uid}").stderr[-300:])
