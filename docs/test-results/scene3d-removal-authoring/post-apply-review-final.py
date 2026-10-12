#!/usr/bin/env python3
"""Read-only audit after root's separately approved reviewed-patch application.

This never applies or rolls back a patch, starts a server/build/test, or writes the
actual checkout. Its single output is an exclusive-create control receipt.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import os
import stat
import subprocess

CONTROL = Path(__file__).resolve().parent
BASE = CONTROL.parent
STAGE = BASE / 'project'
ACTUAL = Path('/home/chiharukiryu/cdev/viento-studio')
REL = Path('docs/test-results/scene3d-removal-authoring')
OUT = STAGE / REL

def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def load(path):
    return json.loads(Path(path).read_text())

def regular(root, relative):
    p = Path(relative)
    assert not p.is_absolute() and all(part not in ('.', '..') for part in p.parts), relative
    target = root / p
    assert target.resolve().is_relative_to(root.resolve()), relative
    for item in [root, *[q for q in reversed(target.parents) if root in q.parents], target]:
        assert not item.is_symlink(), str(item)
    assert stat.S_ISREG(target.lstat().st_mode), str(target)
    return target

def check_map(root, mapping):
    changed = [p for p, expected in mapping.items() if sha(regular(root, p)) != expected]
    assert not changed, changed
    return {'files': len(mapping), 'allByteShaMatch': True, 'changed': []}

def main():
    output = CONTROL / 'post-apply-review.json'
    assert not output.exists(), 'Completed receipt is immutable'
    packet_path = CONTROL / 'patch-ready.json'
    packet = load(packet_path)
    assert packet['ok'] and packet['deletions'] == []
    assert packet['actualRoot'] == str(ACTUAL) and packet['stageRoot'] == str(STAGE)
    receipt_path = ACTUAL / REL / 'actual-apply-receipt.json'
    receipt = load(receipt_path)
    assert receipt['ok'] and receipt['actualApplyPerformed'] is True
    assert receipt['manifestSha256'] == sha(packet_path) and receipt['packet'] == packet
    assert receipt['files'] == len(packet['files'])
    assert sha(CONTROL / 'apply-reviewed-patch.py') == packet['applier']['sha256']
    paths = [item['path'] for item in packet['files']]
    assert len(paths) == len(set(paths))
    assert set(paths) == set(packet['implementationPaths']) | set(packet['atlasPaths']) | set(packet['evidencePaths'])
    assert len(packet['implementationPaths']) == 47
    assert set(packet['atlasPaths']) == {'docs/function-atlas.json', 'docs/FUNCTION_ATLAS.md', 'docs/function-atlas.mmd', 'docs/function-atlas.html'}
    assert all(path.startswith(REL.as_posix() + '/') for path in packet['evidencePaths'])
    for item in packet['files']:
        actual = regular(ACTUAL, item['path']); staged = regular(STAGE, item['path'])
        assert sha(actual) == sha(staged) == item['afterSha256'], item['path']
        assert actual.stat().st_size == staged.stat().st_size == item['bytes'], item['path']
    sources = load(OUT / 'source-hashes-final.json')
    assert len(sources) == 777 and packet['finalSourceManifestSha256'] == sha(OUT / 'source-hashes-final.json')
    source_proof = check_map(ACTUAL, sources)
    original = load(CONTROL / 'baseline-files.json')
    unchanged = {path: digest for path, digest in original.items() if path not in paths}
    assert len(original) == 6386
    # Audit only the captured readable-byte baseline. Historical unrelated dist
    # handoff files were excluded at stage creation and confer no copy authority.
    # Approved patch paths above remain strictly regular with no symlink ancestor.
    changed = [path for path, expected in unchanged.items()
        if not (ACTUAL / path).is_file() or sha(ACTUAL / path) != expected]
    assert not changed, changed
    unrelated = {'files': len(unchanged), 'allReadableByteShaMatch': True, 'changed': [],
        'existingSymlinks': [path for path in unchanged if (ACTUAL / path).is_symlink()],
        'scope': 'Original readable-byte baseline only; no symlink inode claim or copy permission.'}
    # Backup proves the old dirty checkout was captured rather than regenerated.
    before = {item['path']: item['beforeSha256'] for item in packet['files'] if item['beforeSha256'] is not None}
    backup = check_map(CONTROL / 'apply-backup', before)
    preserved = {}
    for name, expected in [('historical-baseline.json', 5242), ('author-baseline.json', 41)]:
        values = load(OUT / name); assert len(values) == expected
        preserved[name] = {**check_map(ACTUAL, values), 'baselineSha256': sha(OUT / name)}
    tools = {}
    for path, expected in load(OUT / 'tool-baseline.json').items():
        p = Path(path); info = p.lstat(); assert stat.S_ISREG(info.st_mode)
        value = {'sha256': sha(p), 'bytes': info.st_size, 'dev': info.st_dev, 'ino': info.st_ino, 'nlink': info.st_nlink}
        assert value == expected, path
        tools[path] = value
    assert len(tools) == 4
    generated = ['desktop/resources', 'desktop/ui/i18n', 'desktop/.cache', 'src-tauri/binaries', 'mobile/dist']
    assert receipt['generatedDirectoriesAbsent'] == generated
    assert all(not (ACTUAL / path).exists() and not (ACTUAL / path).is_symlink() for path in generated)
    head = subprocess.check_output(['git', '-C', str(ACTUAL), 'rev-parse', 'HEAD'],
        env={**os.environ, 'GIT_OPTIONAL_LOCKS': '0'}, text=True).strip()
    assert head == '3a91e84a5cd543ebb4a6f416f727c544cf9ff083'
    assert (ACTUAL / 'VERSION').read_text().strip() == '0.0.10'
    atlas = load(ACTUAL / 'docs/function-atlas.json')
    assert atlas == load(STAGE / 'docs/function-atlas.json')
    old = load(OUT / 'atlas-baseline.json')
    prefix = {'axes.' + k: atlas['axes'][k][:len(v)] == v for k, v in old['axes'].items()}
    for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']:
        prefix[key] = atlas[key][:len(old[key])] == old[key]
    assert all(prefix.values())
    check_map(ACTUAL, atlas['sourceSnapshot'])
    assert str(REL / 'actual-apply-receipt.json') not in atlas['sourceSnapshot']
    stage_post = load(OUT / 'post-stage-review.json')
    assert stage_post['ok'] and not stage_post['blockingFindings']
    report = {'format': 'viento-scene3d-removal-post-apply-review', 'schemaVersion': 1,
        'observedAt': datetime.now(timezone.utc).isoformat(), 'ok': True, 'openFindings': [],
        'actualCheckoutApplied': True, 'actualRoot': str(ACTUAL),
        'packet': {'sha256': sha(packet_path), 'files': len(paths), 'implementation': 47, 'atlas': 4,
            'evidence': len(packet['evidencePaths']), 'allApprovedBytesMatchActualAndStage': True, 'deletions': []},
        'applicationReceipt': {'sha256': sha(receipt_path), 'manifestSha256': receipt['manifestSha256']},
        'finalSourceFreeze': {'manifestSha256': sha(OUT / 'source-hashes-final.json'), **source_proof},
        'originalUnrelatedFiles': unrelated, 'rollbackBackup': backup, 'preserved': preserved,
        'externalTools': {'files': 4, 'allByteShaSizeDevInoNlinkMatch': True, 'actual': tools},
        'generatedDirectoriesAbsent': generated, 'head': head, 'version': '0.0.10',
        'atlas': {'sha256': sha(ACTUAL / 'docs/function-atlas.json'), 'oldPrefixDeepExact': prefix,
            'sourceSnapshotAllActualHashesMatch': True, 'sourceSnapshotFiles': len(atlas['sourceSnapshot'])},
        'priorClosingReview': {'sha256': sha(OUT / 'post-stage-review.json'), 'copiedByteExact': True},
        'scope': 'Root-approved frozen file application independently rehashed. Tests ran in isolated stage, not at the actual checkout path. No test/build/HTTP execution, commit, push, release, installation, device acceptance, cleanup, or actual-checkout writes by this audit.'}
    with output.open('x') as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2); stream.write('\n')
    print(json.dumps({'ok': True, 'actualSourceFiles': 777, 'approvedFiles': len(paths),
        'historical': 5242, 'authors': 41, 'tools': 4, 'reportSha256': sha(output)}))

if __name__ == '__main__':
    main()
