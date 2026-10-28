#!/usr/bin/python3
"""Transparent test-only launcher: retain every runtime process's real output."""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

real = os.environ['VIENTO_CANDIDATE_GODOT_BIN']
args = sys.argv[1:]
if any(arg in ('--version', '--editor', '--check-only') for arg in args):
    os.execv(real, [real, *args])
root = Path(os.environ['VIENTO_PROBE_INVOCATIONS'])
root.mkdir(parents=True, exist_ok=True)
name = f'{time.time_ns()}-{os.getpid()}'
started = time.monotonic()
child = subprocess.Popen([real, '--verbose', *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
def tee(pipe, destination, file):
    with file.open('wb') as output:
        while True:
            chunk = os.read(pipe.fileno(), 65536)
            if not chunk:
                break
            output.write(chunk)
            output.flush()
            try:
                destination.write(chunk)
                destination.flush()
            except BrokenPipeError:
                pass
threads = [threading.Thread(target=tee, args=(child.stdout, sys.stdout.buffer, root / f'{name}.stdout.log')),
           threading.Thread(target=tee, args=(child.stderr, sys.stderr.buffer, root / f'{name}.stderr.log'))]
for thread in threads:
    thread.start()
code = child.wait()
for thread in threads:
    thread.join()
(root / f'{name}.json').write_text(json.dumps({'executable': real, 'argv': ['--verbose', *args],
    'exitCode': code, 'durationMs': round((time.monotonic() - started) * 1000)}, indent=2) + '\n')
sys.exit(code if code >= 0 else 128 - code)
