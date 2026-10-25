import urllib.request
import json

data = json.dumps({"data": {"code": "LOCAL-TEST-CODE"}}).encode()
req = urllib.request.Request("http://127.0.0.1:8080/api/session", data=data, headers={"Content-Type": "application/json"})
try:
    r = urllib.request.urlopen(req, timeout=5)
    print(r.read().decode())
except Exception as e:
    print(f"ERROR: {e}")
