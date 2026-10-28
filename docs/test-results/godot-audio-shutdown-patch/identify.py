#!/usr/bin/env python3
from pathlib import Path
import datetime
import hashlib
import json
import platform
import subprocess

root = Path('/home/chiharukiryu/.cache/io.viento.studio/toolchains/.build/godot-audio-shutdown')
binary = root / 'godot-ed1daf0bf001b61586d9930840f2f1394092c079/bin/godot.linuxbsd.editor.x86_64.llvm'
record = json.loads((root / 'build-result.json').read_text())
assert record['exitCode'] == 0
version = subprocess.run([str(binary), '--version'], check=True, capture_output=True, text=True, timeout=15).stdout.strip()
assert version == '4.7.2.stable.viento_audiofix1_ed1daf0bf', version
with binary.open('rb') as file:
    digest = hashlib.file_digest(file, 'sha256').hexdigest()
libraries = subprocess.run(['ldd', str(binary)], check=True, capture_output=True, text=True, timeout=15).stdout
assert 'not found' not in libraries
compiler = subprocess.run(['/usr/bin/clang++', '--version'], check=True, capture_output=True, text=True).stdout
linker = subprocess.run(['/usr/bin/ld.lld', '--version'], check=True, capture_output=True, text=True).stdout
record = {'identifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'path':str(binary),'version':version,'sha256':digest,'bytes':binary.stat().st_size,
          'platform':platform.platform(),'compiler':compiler,'linker':linker,
          'libraries':libraries,'postBuildStripping':False}
Path('/tmp/viento-godot-audio-patch/candidate-identity.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({key: record[key] for key in ('path','version','sha256','bytes')}))
