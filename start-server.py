#!/usr/bin/env python3
import subprocess, sys, time, os, signal

script_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dev-server.py')
proc = subprocess.Popen(
    [sys.executable, script_path],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    start_new_session=True
)
print(f"PID: {proc.pid}")
# Wait for server to start
time.sleep(2)
# Test if it's running
try:
    import urllib.request
    r = urllib.request.urlopen('http://127.0.0.1:8080/', timeout=3)
    print(f"Server started! HTTP {r.status}")
    print(f"Output length: {len(r.read())} bytes")
except Exception as e:
    print(f"Server may not be running: {e}")
    stdout, stderr = proc.communicate(timeout=1)
    print("STDOUT:", stdout.decode())
    print("STDERR:", stderr.decode())
    sys.exit(1)
