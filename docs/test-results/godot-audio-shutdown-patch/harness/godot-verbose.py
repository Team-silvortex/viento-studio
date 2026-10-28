#!/usr/bin/python3
"""Transparent test-only launcher: retain every runtime process's real output."""
import hashlib
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
pending = root / f'{name}.pending.json'
with pending.open('x') as output:
    json.dump({'executable': real, 'argv': ['--verbose', *args], 'captureComplete': False}, output)
# Create both streams before launching. A killed/spawn-failed wrapper leaves a
# pending record or an incomplete triple, which the harness must reject.
stdout_file = (root / f'{name}.stdout.log').open('xb')
stderr_file = (root / f'{name}.stderr.log').open('xb')
child = subprocess.Popen([real, '--verbose', *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
streams = {}
errors = []

def tee(kind, pipe, destination, file):
    receipt = {'bytes': 0, 'complete': False}
    hasher = hashlib.sha256()
    try:
        with file:
            while True:
                chunk = os.read(pipe.fileno(), 65536)
                if not chunk:
                    break
                file.write(chunk)
                file.flush()
                receipt['bytes'] += len(chunk)
                hasher.update(chunk)
                try:
                    destination.write(chunk)
                    destination.flush()
                except BrokenPipeError:
                    # Parent output limits can close forwarding; keep draining
                    # into the independent evidence file until native EOF.
                    pass
        receipt['complete'] = True
    except BaseException as error:
        errors.append(f'{kind}: {type(error).__name__}: {error}')
    finally:
        pipe.close()
        receipt['sha256'] = hasher.hexdigest()
        streams[kind] = receipt

threads = [threading.Thread(target=tee, args=('stdout', child.stdout, sys.stdout.buffer, stdout_file)),
           threading.Thread(target=tee, args=('stderr', child.stderr, sys.stderr.buffer, stderr_file))]
for thread in threads:
    thread.start()
code = child.wait()
for thread in threads:
    thread.join()
complete = not errors and len(streams) == 2 and all(row['complete'] for row in streams.values())
metadata = root / f'{name}.json'
temporary = root / f'{name}.json.tmp'
with temporary.open('x') as output:
    json.dump({'executable': real, 'argv': ['--verbose', *args], 'exitCode': code,
               'captureComplete': complete, 'captureErrors': errors, 'streams': streams,
               'durationMs': round((time.monotonic() - started) * 1000)}, output, indent=2)
    output.write('\n')
os.replace(temporary, metadata)
pending.unlink()
sys.exit((code if code >= 0 else 128 - code) if complete else 74)
