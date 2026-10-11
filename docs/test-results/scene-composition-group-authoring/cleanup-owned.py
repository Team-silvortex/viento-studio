"""Remove only generated paths proven absent at the beginning of this slice."""
from pathlib import Path
import hashlib
import json
import os
import re
import shutil
from datetime import datetime, timezone

root = Path.cwd().resolve()
out = root / 'docs/test-results/scene-composition-group-authoring'
initial = json.loads((out / 'generated-paths-initial.json').read_text())
expected = ['desktop/resources', 'desktop/ui/i18n', 'desktop/.cache', 'src-tauri/binaries', 'mobile/dist']
assert list(initial) == expected
assert all(item == {'exists': False} for item in initial.values())
assert not (out / 'cleanup.json').exists(), 'Cleanup must not be repeated over later generated data'
log = (out / 'app-check.log').read_text()
summary = re.search(r'tests (\d+)\s+ℹ suites 0\s+ℹ pass (\d+)\s+ℹ fail 0\s+ℹ cancelled 0\s+ℹ skipped 0\s+ℹ todo 0', log)
assert summary and int(summary[1]) == int(summary[2]) == 2816
assert json.loads((out / 'packaged-resources.json').read_text())['ok'] is True
assert json.loads((out / 'review.json').read_text())['ok'] is True

def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

helpers = json.loads((out / 'native-helpers.json').read_text())['binaries']
for item in helpers:
    path = Path(item['path'])
    assert path.is_relative_to(root / 'desktop/.cache')
    assert path.stat().st_size == item['bytes'] and sha(path) == item['sha256']
node = json.loads((out / 'fixed-node.json').read_text())
assert sha(Path(node['node'])) == node['nodeSHA256']

owned = [root / name for name in expected]
for directory in owned:
    assert directory.is_dir() and not directory.is_symlink()
for proc in Path('/proc').iterdir():
    if not proc.name.isdecimal():
        continue
    try:
        executable = (proc / 'exe').resolve(strict=True)
    except (FileNotFoundError, PermissionError, ProcessLookupError):
        continue
    assert not any(executable.is_relative_to(path) for path in owned), f'Generated executable still active: {proc.name}'

entries = []
seen = set()
for name, directory in zip(expected, owned):
    logical = allocated = files = 0
    for parent, dirs, names in os.walk(directory, followlinks=False):
        for child in names:
            path = Path(parent) / child
            stat = path.lstat()
            logical += stat.st_size
            files += 1
            key = (stat.st_dev, stat.st_ino)
            if key not in seen:
                seen.add(key)
                allocated += stat.st_blocks * 512
    entries.append({'path': name, 'files': files, 'logicalBytes': logical, 'allocatedFileBytes': allocated})
for directory in owned:
    shutil.rmtree(directory)
assert not any(path.exists() or path.is_symlink() for path in owned)
report = {
    'createdAt': datetime.now(timezone.utc).isoformat(), 'ok': True,
    'scope': 'Only the five generated paths absent in the initial baseline. Full suite and prepared/browser proofs completed before removal.',
    'removed': entries, 'allocatedFileBytesRemoved': sum(item['allocatedFileBytes'] for item in entries),
    'logicalBytesRemoved': sum(item['logicalBytes'] for item in entries),
    'helpersVerifiedBeforeRemoval': helpers,
    'retained': ['tested engine/studio-core.wasm and build metadata', 'authors and example assets', 'historical and new evidence', 'dependencies', 'external trusted tools', 'installed applications and preferences'],
    'directoriesRemainAbsent': True,
}
(out / 'cleanup.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: report[key] for key in ['ok', 'allocatedFileBytesRemoved', 'logicalBytesRemoved']}))
