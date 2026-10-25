
import subprocess, time, sys, os, urllib.request, json

script_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dev-server.py")
proc = subprocess.Popen([sys.executable, script_path], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

# Wait for server
time.sleep(2)

# Test
data = json.dumps({"data": {"code": "LOCAL-TEST-CODE"}}).encode()
req = urllib.request.Request("http://127.0.0.1:8080/api/session", data=data, headers={"Content-Type": "application/json"})
try:
    r = urllib.request.urlopen(req, timeout=5)
    print("RESULT:", r.read().decode())
except Exception as e:
    print("ERROR:", e)

# Kill server
proc.terminate()
proc.wait()

# Read stdout
out, _ = proc.communicate()
print("SERVER STDOUT:", out.decode())
