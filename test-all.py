
import urllib.request, json, time

def test(method, url, data=None, headers=None):
    headers = headers or {}
    if data:
        data = json.dumps(data).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        r = urllib.request.urlopen(req, timeout=5)
        print(f"OK {method} {url}")
        print(f"  → {r.read().decode()}")
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code} {method} {url}")
        print(f"  → {e.read().decode()}")
    except Exception as e:
        print(f"ERR {method} {url}: {e}")

# Test 1: Session login
print("=== TEST 1: Session ===")
test("POST", "http://127.0.0.1:8080/api/session", {"data": {"code": "LOCAL-TEST-CODE"}})

# Test 2: Get today attendance
print("=== TEST 2: GET /api/attendance ===")
test("GET", "http://127.0.0.1:8080/api/attendance", headers={"x-team-code": "LOCAL-TEST-CODE"})

# Test 3: Get all attendance (export range)
print("=== TEST 3: GET /api/attendance?all=1 ===")
test("GET", "http://127.0.0.1:8080/api/attendance?all=1&from=2026-10-01&to=2026-12-31", headers={"x-team-code": "LOCAL-TEST-CODE"})

# Test 4: Recent records
print("=== TEST 4: GET /api/recent ===")
test("GET", "http://127.0.0.1:8080/api/recent?limit=5", headers={"x-team-code": "LOCAL-TEST-CODE"})

# Test 5: Wrong team code
print("=== TEST 5: Wrong code ===")
test("POST", "http://127.0.0.1:8080/api/session", {"data": {"code": "WRONG-CODE"}})

print("=== ALL TESTS DONE ===")
