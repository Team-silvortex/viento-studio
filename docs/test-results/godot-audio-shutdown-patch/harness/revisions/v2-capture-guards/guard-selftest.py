#!/usr/bin/env python3
"""No-Godot fault injection for harness capture/exit assertions."""
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('probe_run', HERE / 'run.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
root = HERE / 'selftests' / datetime.datetime.now(datetime.timezone.utc).strftime('capture-guards-%Y%m%dT%H%M%SZ')
root.mkdir(parents=True, exist_ok=False)
rows = []

def check(name, action):
    action()
    rows.append({'case': name, 'passed': True})

def accept(directory):
    assert len(probe.validate_project_invocations(directory)) == 1

def reject(directory):
    try:
        probe.validate_project_invocations(directory)
    except AssertionError:
        return
    raise AssertionError(f'Invalid capture was accepted: {directory}')

def fixture(name, code=0, stdout=b'normal output\n', stderr=b''):
    directory = root / name
    directory.mkdir()
    receipt = {}
    for kind, value in [('stdout', stdout), ('stderr', stderr)]:
        (directory / f'1234-5678.{kind}.log').write_bytes(value)
        receipt[kind] = {'complete': True, 'bytes': len(value), 'sha256': hashlib.sha256(value).hexdigest()}
    (directory / '1234-5678.json').write_text(json.dumps({'exitCode': code, 'captureComplete': True, 'captureErrors': [], 'streams': receipt}))
    return directory

for code in (0, 1):
    directory = fixture(f'allowed-{code}', code)
    check(f'controlled exit {code}', lambda directory=directory: accept(directory))
for index, code in enumerate((-11, -15, 139, 134, 2, 23, None, True)):
    directory = fixture(f'bad-exit-{index}', code)
    check(f'reject exit {code!r}', lambda directory=directory: reject(directory))
for suffix in ('.stdout.log', '.stderr.log', '.json'):
    directory = fixture('missing-' + suffix.lstrip('.'))
    (directory / f'1234-5678{suffix}').unlink()
    check(f'reject missing {suffix}', lambda directory=directory: reject(directory))
for suffix in ('.pending.json', '.json.tmp', '.stdout.log', '.stderr.log'):
    directory = fixture('orphan-' + suffix.lstrip('.'))
    (directory / f'9999-9999{suffix}').write_text('')
    check(f'reject orphan {suffix}', lambda directory=directory: reject(directory))
directory = fixture('truncated-stream')
(directory / '1234-5678.stdout.log').write_bytes(b'normal')
check('reject truncated stream', lambda: reject(directory))
directory = fixture('same-size-corruption')
(directory / '1234-5678.stdout.log').write_bytes(b'Normal output\n')
check('reject same-size stream corruption', lambda: reject(directory))
for key, value in [('captureComplete', False), ('captureErrors', ['stdout: OSError'])]:
    directory = fixture('bad-' + key)
    metadata = directory / '1234-5678.json'
    data = json.loads(metadata.read_text()); data[key] = value; metadata.write_text(json.dumps(data))
    check(f'reject {key}', lambda directory=directory: reject(directory))
directory = fixture('crash-report', 1, stderr=b'handle_crash: Program crashed with signal 11\n')
check('reject crash report despite allowed exit', lambda: reject(directory))
directory = fixture('leak-report', 0, stderr=b'WARNING: 2 ObjectDB instances were leaked at exit\n')
check('reject leak despite allowed exit', lambda: reject(directory))

fake = root / 'fake-native.py'
fake.write_text('#!/usr/bin/python3\nimport os, signal, sys\nprint("controlled output", flush=True)\nprint("controlled diagnostic", file=sys.stderr, flush=True)\nmode = os.environ.get("FAKE_EXIT", "0")\nif mode == "signal": os.kill(os.getpid(), signal.SIGTERM)\nsys.exit(int(mode))\n')
fake.chmod(0o755)
for mode in ('0', '1', 'signal'):
    directory = root / f'wrapper-{mode}'; directory.mkdir()
    result = subprocess.run([str(HERE / 'godot-verbose.py')], env={**os.environ, 'VIENTO_CANDIDATE_GODOT_BIN': str(fake), 'VIENTO_PROBE_INVOCATIONS': str(directory), 'FAKE_EXIT': mode}, capture_output=True, timeout=5)
    if mode == 'signal':
        assert result.returncode == 143, result
        check('real wrapper preserves raw child signal', lambda directory=directory: reject(directory))
    else:
        assert result.returncode == int(mode), result
        check(f'real wrapper captures exit {mode}', lambda directory=directory: accept(directory))

injection = root / 'fault-injection'; injection.mkdir()
(injection / 'sitecustomize.py').write_text('import os, threading\n_original_read = os.read\ndef faulty_read(fd, n):\n    if threading.current_thread().name != "MainThread": raise OSError("injected tee read failure")\n    return _original_read(fd, n)\nos.read = faulty_read\n')
directory = root / 'wrapper-tee-error'; directory.mkdir()
result = subprocess.run([str(HERE / 'godot-verbose.py')], env={**os.environ, 'VIENTO_CANDIDATE_GODOT_BIN': str(fake), 'VIENTO_PROBE_INVOCATIONS': str(directory), 'FAKE_EXIT': '0', 'PYTHONPATH': str(injection)}, capture_output=True, timeout=5)
assert result.returncode == 74, result
metadata = json.loads(next(directory.glob('*.json')).read_text())
assert metadata['captureComplete'] is False and len(metadata['captureErrors']) == 2, metadata
check('tee failures fail wrapper and scanner', lambda: reject(directory))

# A new-session descendant deliberately retains output pipes after its parent
# is killed. Only this test-created PID is cleaned up after checking bounded drain.
pid_file = root / 'detached-child.pid'
spawn = root / 'spawn-detached.py'
spawn.write_text('import pathlib, subprocess, sys, time\nchild = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"], start_new_session=True)\npathlib.Path(sys.argv[1]).write_text(str(child.pid))\nprint("before timeout", flush=True)\ntime.sleep(30)\n')
started = time.monotonic()
try:
    result, stdout, stderr = probe.capture([sys.executable, str(spawn), str(pid_file)], root, dict(os.environ), root / 'bounded-drain', 0.2)
    elapsed = time.monotonic() - started
    assert result['timedOut'] and not result['captureComplete'] and elapsed < 5, (result, elapsed)
    assert 'before timeout' in stdout, stdout
    rows.append({'case': 'detached pipe holder cannot hang capture', 'passed': True, 'durationMs': round(elapsed * 1000)})
finally:
    if pid_file.exists():
        try: os.kill(int(pid_file.read_text()), signal.SIGTERM)
        except ProcessLookupError: pass

summary = {'nativeGodotRuns': 0, 'passed': True, 'cases': rows, 'sourceHashes': {name: probe.digest(HERE/name) for name in ['run.py','godot-verbose.py','guard-selftest.py']}}
(root / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({'passed': len(rows), 'nativeGodotRuns': 0, 'evidence': str(root)}, indent=2))
