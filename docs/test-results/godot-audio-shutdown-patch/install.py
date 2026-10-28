#!/usr/bin/env python3
"""Install only the exact validated candidate and atomically switch the local default."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import shutil
import subprocess

ROOT = Path('/home/chiharukiryu/.cache/io.viento.studio/toolchains/.build/godot-audio-shutdown')
SOURCE = ROOT / 'godot-ed1daf0bf001b61586d9930840f2f1394092c079'
SCRATCH = Path('/tmp/viento-godot-audio-patch')
PROBES = Path('/tmp/viento-godot-audio-patch-probe')
REPO = Path('/home/chiharukiryu/cdev/viento-studio')
DEST = Path('/home/chiharukiryu/.cache/io.viento.studio/toolchains/godot/4.7.2-viento-audiofix1/linux-x86_64')
NAME = 'Godot_v4.7.2-viento-audiofix1_linux.x86_64'
LAUNCHER = Path('/home/chiharukiryu/.local/bin/viento-studio')
OLD = Path('/home/chiharukiryu/.cache/io.viento.studio/toolchains/godot/4.7.2-stable/linux-x86_64/Godot_v4.7.2-stable_linux.x86_64')

def sha(path):
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()

standalone = json.loads((PROBES / 'runs/candidate-standalone/summary.json').read_text())
projects = json.loads((PROBES / 'runs/candidate-projects/summary.json').read_text())
assert standalone['passed'] and projects['passed'], 'Both validation stages must pass first.'
assert len(standalone['cases']) == 42 and len(projects['cases']) == 4
assert standalone['tool'] == projects['tool'], 'Validated tool identities differ.'
assert standalone['sourceHashes'] == projects['sourceHashes'], 'Validation sources differ.'
for report in (standalone, projects):
    assert report['sourcesUnchanged'] and report['toolUnchanged']
    assert report['sourceHashes'] == report['sourceHashesAfter']
for path, expected in standalone['sourceHashes'].items():
    assert sha(path) == expected, 'Source changed after validation: ' + path
candidate = Path(standalone['tool']['path'])
assert candidate.resolve() == (SOURCE / 'bin/godot.linuxbsd.editor.x86_64.llvm').resolve()
assert sha(candidate) == standalone['tool']['sha256'], 'Candidate changed after validation.'
build = json.loads((ROOT / 'build-result.json').read_text())
assert build['exitCode'] == 0 and Path(build['source']) == SOURCE
patch_manifest = json.loads((REPO / 'scripts/patches/godot-audio-shutdown.json').read_text())
assert sha(REPO / 'scripts/patches/godot-audio-shutdown.patch') == patch_manifest['patch']['sha256']
before = (SCRATCH / 'launcher-before.sh').read_bytes()
assert not LAUNCHER.is_symlink() and LAUNCHER.read_bytes() == before, 'Launcher changed during work.'
assert sha(OLD) == '8d106cbe6144c2dc7e881d61d2429c1a8a76e6b22ef48bd5e48dcf934953f71e'
assert not DEST.exists(), 'Never overwrite a previously installed toolchain.'
after = before.replace(str(OLD).encode(), str(DEST / NAME).encode())
assert before.count(str(OLD).encode()) == 2
check = SCRATCH / 'launcher-after.sh'
check.write_bytes(after)
subprocess.run(['sh', '-n', str(check)], check=True)
stage = DEST.parent / (DEST.name + '.installing-' + str(os.getpid()))
stage.mkdir(parents=True, exist_ok=False)
shutil.copy2(candidate, stage / NAME)
assert sha(stage / NAME) == standalone['tool']['sha256']
os.chmod(stage / NAME, 0o755)
for filename in ('LICENSE.txt', 'COPYRIGHT.txt', 'AUTHORS.md'):
    shutil.copy2(SOURCE / filename, stage / filename)
accesskit_licenses = stage / 'licenses/accesskit'
accesskit_licenses.mkdir(parents=True)
for filename in ('LICENSE.chromium', 'LICENSE-MIT', 'LICENSE-APACHE'):
    shutil.copy2(SOURCE / 'bin/build_deps/accesskit' / filename, accesskit_licenses / filename)
shutil.copy2(ROOT / 'accesskit-origin.json', stage / 'accesskit-origin.json')
for filename in ('godot-audio-shutdown.patch', 'godot-audio-shutdown.json'):
    shutil.copy2(REPO / 'scripts/patches' / filename, stage / filename)
shutil.copy2(SCRATCH / 'launcher-before.sh', stage / 'viento-studio-launcher-before.sh')
record = {
    'installedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'binary': {**standalone['tool'], 'path': str(DEST / NAME), 'bytes': candidate.stat().st_size},
    'originalBinary': {'path': str(OLD), 'sha256': sha(OLD)},
    'build': build,
    'launcher': {'path': str(LAUNCHER), 'beforeSha256': hashlib.sha256(before).hexdigest(),
                 'afterSha256': hashlib.sha256(after).hexdigest()},
    'standaloneGroups': len(standalone['cases']), 'projectGroups': len(projects['cases']),
    'candidateInstalled': True, 'defaultSelected': False, 'appRestarted': False,
}
(stage / 'installation.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
stage.rename(DEST)
version = subprocess.run([str(DEST / NAME), '--version'], check=True, capture_output=True, text=True).stdout.strip()
assert version == standalone['tool']['version']
assert LAUNCHER.read_bytes() == before, 'Concurrent launcher update: installed candidate, no switch.'
temporary = LAUNCHER.with_name(LAUNCHER.name + '.audiofix-' + str(os.getpid()))
with temporary.open('xb') as handle:
    handle.write(after)
    handle.flush()
    os.fsync(handle.fileno())
os.chmod(temporary, LAUNCHER.stat().st_mode & 0o777)
os.replace(temporary, LAUNCHER)
assert LAUNCHER.read_bytes() == after
assert sha(DEST / NAME) == standalone['tool']['sha256']
record['defaultSelected'] = True
record['defaultSelectedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
(DEST / 'installation.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
(SCRATCH / 'installation.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(record, ensure_ascii=False, indent=2))
