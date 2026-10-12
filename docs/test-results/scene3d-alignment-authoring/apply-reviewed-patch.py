#!/usr/bin/env python3
"""Apply only a frozen, tested file allowlist; never copy caches, git, or user data."""
import argparse, datetime, hashlib, json, os, stat, subprocess, tempfile
from pathlib import Path
BASE = Path('/tmp/viento-scene3d-alignment-fayrkhch')
CONTROL = BASE / 'control'
STAGE = BASE / 'project'
ACTUAL = Path('/home/chiharukiryu/cdev/viento-studio')
OUT = Path('docs/test-results/scene3d-alignment-authoring')
GENERATED = ['desktop/resources', 'desktop/ui/i18n', 'desktop/.cache', 'src-tauri/binaries', 'mobile/dist']
def digest(data): return hashlib.sha256(data).hexdigest()
def read_json(path): return json.loads(path.read_text())
def sha(path): return digest(path.read_bytes())
def safe(root, relative):
    p = Path(relative)
    assert not p.is_absolute() and all(x not in ('', '.', '..') for x in p.parts), relative
    assert '.git' not in p.parts and 'node_modules' not in p.parts and '__pycache__' not in p.parts, relative
    target = root / p
    for ancestor in [root] + list(reversed(target.parents)) + [target]:
        if ancestor == root or root in ancestor.parents:
            assert not ancestor.is_symlink(), f'symlink: {ancestor}'
    assert target.resolve().is_relative_to(root.resolve()), relative
    return target

def check_map(root, mapping):
    for rel, expected in mapping.items():
        assert sha(safe(root, rel)) == expected, f'fingerprint changed: {root}/{rel}'

def preservation():
    for name in ['historical-baseline.json', 'author-baseline.json']:
        check_map(ACTUAL, read_json(STAGE / OUT / name))
    for path, expected in read_json(STAGE / OUT / 'tool-baseline.json').items():
        p = Path(path); s = p.stat()
        assert sha(p) == expected['sha256'] and s.st_size == expected['bytes'], path
        for key in ['dev', 'ino', 'nlink']:
            assert getattr(s, 'st_' + key) == expected[key], path
    assert ACTUAL.joinpath('VERSION').read_text().strip() == '0.0.10'
    head = subprocess.check_output(['git', '-C', str(ACTUAL), 'rev-parse', 'HEAD'], env={**os.environ, 'GIT_OPTIONAL_LOCKS': '0'}, text=True).strip()
    assert head == '3a91e84a5cd543ebb4a6f416f727c544cf9ff083'
    assert all(not (ACTUAL / rel).exists() and not (ACTUAL / rel).is_symlink() for rel in GENERATED)

def write_atomic(path, data, mode):
    safe(ACTUAL, str(path.relative_to(ACTUAL)))
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.viento-reviewed-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)

parser = argparse.ArgumentParser()
parser.add_argument('--manifest-sha', required=True)
parser.add_argument('--dry-run', action='store_true')
args = parser.parse_args()
packet_bytes = (CONTROL / 'patch-ready.json').read_bytes()
assert digest(packet_bytes) == args.manifest_sha, 'manifest changed since review'
packet = json.loads(packet_bytes)
assert str(Path(__file__).resolve()) == packet['applier']['path']
assert sha(Path(__file__)) == packet['applier']['sha256'], 'applier changed since review'
assert packet['actualRoot'] == str(ACTUAL) and packet['stageRoot'] == str(STAGE)
assert packet['ok'] is True and packet['deletions'] == []
paths = [item['path'] for item in packet['files']]
assert len(set(paths)) == len(paths)
assert set(packet['implementationPaths']) <= set(paths)
assert set(paths) == set(packet['implementationPaths']) | set(packet['atlasPaths']) | set(packet['evidencePaths'])
assert all(rel.startswith(str(OUT) + '/') for rel in packet['evidencePaths'])
assert set(packet['atlasPaths']) == {'docs/function-atlas.json', 'docs/FUNCTION_ATLAS.md', 'docs/function-atlas.mmd', 'docs/function-atlas.html'}
assert not any(any(rel == g or rel.startswith(g + '/') for g in GENERATED) for rel in paths)
check_map(ACTUAL, read_json(STAGE / OUT / 'source-baseline.json'))
check_map(STAGE, read_json(STAGE / OUT / 'source-hashes-browser-final.json'))
preservation()
receipt_rel = OUT / 'actual-apply-receipt.json'
receipt_path = safe(ACTUAL, str(receipt_rel))
assert not receipt_path.exists(), 'receipt already exists'
for item in packet['files']:
    source = safe(STAGE, item['path']); target = safe(ACTUAL, item['path'])
    assert source.is_file() and sha(source) == item['afterSha256'] and source.stat().st_size == item['bytes'], item['path']
    if item['beforeSha256'] is None:
        assert not target.exists(), f'new target already exists: {target}'
    else:
        assert target.is_file() and sha(target) == item['beforeSha256'], f'actual target changed: {target}'
if args.dry_run:
    print(json.dumps({'ok': True, 'phase': 'read-only-preflight', 'files': len(paths), 'bytes': sum(x['bytes'] for x in packet['files']), 'actualApplyPerformed': False, 'manifestSha256': args.manifest_sha}))
    raise SystemExit(0)
backup = CONTROL / 'apply-backup'
backup.mkdir(exist_ok=False)
for item in packet['files']:
    if item['beforeSha256'] is not None:
        original = safe(ACTUAL, item['path']); destination = backup / item['path']
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(original.read_bytes()); os.chmod(destination, stat.S_IMODE(original.stat().st_mode))
written = []
created_directories = set()
try:
    for item in packet['files']:
        target = safe(ACTUAL, item['path'])
        parent = target.parent
        while parent != ACTUAL and not parent.exists():
            created_directories.add(parent); parent = parent.parent
        mode = stat.S_IMODE(target.stat().st_mode) if target.exists() else item['mode']
        write_atomic(target, safe(STAGE, item['path']).read_bytes(), mode)
        written.append(item)
    for item in packet['files']: assert sha(safe(ACTUAL, item['path'])) == item['afterSha256'], item['path']
    check_map(ACTUAL, read_json(STAGE / OUT / 'source-hashes-browser-final.json'))
    preservation()
    receipt = {
        'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'ok': True,
        'phase': 'validated-stage-applied-to-actual-checkout', 'actualApplyPerformed': True,
        'actualRoot': str(ACTUAL), 'stageRoot': str(STAGE), 'manifestSha256': args.manifest_sha,
        'files': len(paths), 'bytes': sum(x['bytes'] for x in packet['files']), 'deletions': [],
        'sourceFiles': 747, 'historicalFilesUnchanged': 4714, 'authorFilesUnchanged': 41, 'externalToolsUnchanged': 4,
        'head': '3a91e84a5cd543ebb4a6f416f727c544cf9ff083', 'version': '0.0.10',
        'generatedDirectoriesAbsent': GENERATED,
        'validationScope': 'Tests executed in isolated stage; actual product/test bytes verified equal to the final frozen stage. No claim of executing the full suite at the actual path.',
        'packet': packet,
    }
    data = (json.dumps(receipt, ensure_ascii=False, indent=2) + '\n').encode()
    write_atomic(receipt_path, data, 0o644)
except BaseException:
    for item in reversed(written):
        target = safe(ACTUAL, item['path'])
        if item['beforeSha256'] is None: target.unlink(missing_ok=True)
        else:
            original = backup / item['path']
            write_atomic(target, original.read_bytes(), stat.S_IMODE(original.stat().st_mode))
    for directory in sorted(created_directories, key=lambda x:len(x.parts), reverse=True):
        try: directory.rmdir()
        except OSError: pass
    (CONTROL / 'apply-failed.json').write_text(json.dumps({'ok':False,'rollbackPerformed':True,'writtenBeforeRollback':len(written)}))
    raise

# Actual application is committed once its durable receipt exists.
# Later control-copy or stdout errors must never roll back an already recorded success.
(CONTROL / 'actual-apply-receipt.json').write_bytes(data)
print(json.dumps({k:v for k,v in receipt.items() if k != 'packet'}, ensure_ascii=False))
