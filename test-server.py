#!/usr/bin/env python3
import subprocess, sys, time, signal, os

script_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dev-server.py')
proc = subprocess.Popen(
    [sys.executable, script_path],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    start_new_session=True
)
time.sleep(3)
stdout, stderr = proc.communicate(timeout=2)
print("STDOUT:", stdout.decode())
print("STDERR:", stderr.decode())
print("PID:", proc.pid)
print("RETURN:", proc.returncode)
