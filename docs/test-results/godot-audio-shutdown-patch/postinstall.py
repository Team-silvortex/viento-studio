#!/usr/bin/env python3
from pathlib import Path
import datetime
import hashlib
import json
import os
import subprocess

ROOT = Path('/tmp/viento-godot-audio-patch')
PROBES = Path('/tmp/viento-godot-audio-patch-probe/probes')
installation = json.loads((ROOT / 'installation.json').read_text())
tool = Path(installation['binary']['path'])
launcher = Path(installation['launcher']['path'])
assert installation['candidateInstalled'] and installation['defaultSelected']
with tool.open('rb') as handle:
    digest = hashlib.file_digest(handle, 'sha256').hexdigest()
assert digest == installation['binary']['sha256']
current = launcher.read_bytes()
assert hashlib.sha256(current).hexdigest() == installation['launcher']['afterSha256']
assert current == (ROOT / 'launcher-after.sh').read_bytes()
text = current.decode()
old_exec = 'exec /home/chiharukiryu/.local/opt/viento-studio/Viento-Studio.AppImage "$@"'
assert text.count(old_exec) == 1
simulation = text.replace(old_exec, 'printf "%s" "${VIENTO_GODOT_BIN-unset}"')
env = dict(os.environ)
env.pop('VIENTO_GODOT_BIN', None)
selected = subprocess.run(['sh', '-c', simulation], env=env, check=True, capture_output=True, text=True).stdout
assert selected == str(tool)
explicit = subprocess.run(['sh', '-c', simulation], env={**env,'VIENTO_GODOT_BIN':'/explicit/caller/Godot'}, check=True, capture_output=True, text=True).stdout
assert explicit == '/explicit/caller/Godot'
empty = subprocess.run(['sh', '-c', simulation], env={**env,'VIENTO_GODOT_BIN':''}, check=True, capture_output=True, text=True).stdout
assert empty == ''
for variable, suffix in (('XDG_CONFIG_HOME','config'), ('XDG_CACHE_HOME','cache'), ('XDG_DATA_HOME','data')):
    env[variable] = str(ROOT / 'postinstall-host' / suffix)
command = [str(tool), '--headless', '--verbose', '--path', str(PROBES), '--script', str(PROBES / 'shutdown-edges.gd'), '--', 'immediate-multiple-quit']
result = subprocess.run(command, env=env, capture_output=True, timeout=30)
(ROOT / 'postinstall.stdout.log').write_bytes(result.stdout)
(ROOT / 'postinstall.stderr.log').write_bytes(result.stderr)
text = (result.stdout + result.stderr).decode(errors='replace')
assert result.returncode == 0
assert not any(value in text for value in ('ObjectDB instances leaked','Leaked instance:','Orphan StringName:','still in use at exit','SCRIPT ERROR:','ERROR:'))
frames = [json.loads(line.split(':',1)[1]) for line in text.splitlines() if line.startswith('AUDIO_SHUTDOWN_EDGE:')]
assert len(frames) == 1 and frames[0]['mode'] == 'immediate-multiple-quit'
assert frames[0]['playerCount'] == 8 and frames[0]['extraPlaybacks'] == 7 and frames[0]['extraStreams'] == 7
record = {'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'tool':installation['binary'],
          'exitCode':result.returncode, 'observation':frames[0], 'leakFree':True,
          'launcherDefault':selected,'explicitValuePreserved':True,'explicitEmptyValuePreserved':True,
          'launcherCheck':'Executed only a temporary in-memory copy with final AppImage exec replaced by printf.',
          'appRestarted':False,'passed':True}
(ROOT / 'postinstall.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(record,ensure_ascii=False,indent=2))
