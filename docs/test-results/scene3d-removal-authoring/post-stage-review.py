#!/usr/bin/env python3
"""One compact pre-apply review. Actual checkout and old evidence are read-only."""
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

out = Path(__file__).resolve().parent
stage = out.parents[2]
actual = Path('/home/chiharukiryu/cdev/viento-studio')
def load(path):
    return json.loads(path.read_text())
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def verify(root, values):
    for path, expected in values.items():
        target = root / path
        assert target.is_file() and not target.is_symlink(), path
        assert sha(target) == expected, path
    return len(values)
baseline = load(out / 'baseline.json')
old_source = load(out / 'source-baseline.json')
frozen = load(out / 'source-hashes-final.json')
old_files = load(out / 'checkout-files-baseline.json')
historical = load(out / 'historical-baseline.json')
authors = load(out / 'author-baseline.json')
tools = load(out / 'tool-baseline.json')
assert len(old_source) == 767 and len(frozen) == 777 and len(old_files) == 6386
assert verify(actual, old_source) == 767
assert verify(stage, frozen) == 777
assert verify(actual, historical) == verify(stage, historical) == 5242
assert verify(actual, authors) == verify(stage, authors) == 41
assert len(tools) == 4
for path, expected in tools.items():
    p = Path(path)
    st = p.stat()
    assert sha(p) == expected['sha256'], path
    assert {'bytes': st.st_size, 'dev': st.st_dev, 'ino': st.st_ino, 'nlink': st.st_nlink} == {key: expected[key] for key in ['bytes', 'dev', 'ino', 'nlink']}, path
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=actual, text=True).strip() == baseline['head']
assert (actual / 'VERSION').read_text().strip() == (stage / 'VERSION').read_text().strip() == baseline['version']
generated = ['desktop/resources', 'desktop/ui/i18n', 'desktop/.cache', 'src-tauri/binaries', 'mobile/dist']
assert all(not (actual / path).exists() for path in generated)
source_changes = {path: digest for path, digest in frozen.items() if old_source.get(path) != digest}
assert len(source_changes) == 42
documentation = ['docs/ARCHITECTURE.md', 'docs/ROADMAP.md', 'docs/STATUS.md', 'docs/SCENE3D.md', 'docs/STUDIO_MODULES.md']
atlas_paths = ['docs/function-atlas.json', 'docs/function-atlas.html', 'docs/function-atlas.mmd', 'docs/FUNCTION_ATLAS.md']
allowed = set(source_changes) | set(documentation) | set(atlas_paths)
changed, unexpected, deleted = [], [], []
for path, digest in old_files.items():
    p = stage / path
    if not p.is_file():
        deleted.append(path)
    elif sha(p) != digest:
        changed.append(path)
        if path not in allowed:
            unexpected.append(path)
assert not deleted and not unexpected, {'deleted': deleted, 'unexpected': unexpected}
def excluded(path):
    return path.startswith('node_modules/') or path.startswith('.git/') or path.startswith('dist/') or any(path == prefix or path.startswith(prefix + '/') for prefix in generated)
new_nonproof = []
for p in stage.rglob('*'):
    if not p.is_file():
        continue
    path = p.relative_to(stage).as_posix()
    if path in old_files or excluded(path) or path.startswith('docs/test-results/scene3d-removal-authoring/'):
        continue
    new_nonproof.append(path)
assert all(path in allowed for path in new_nonproof), new_nonproof
expected_implementation = sorted(set(source_changes) | set(documentation))
assert len(expected_implementation) == 47
for path in expected_implementation:
    assert path in changed or path in new_nonproof, path
    assert (stage / path).is_file() and not (stage / path).is_symlink()

old_atlas = load(out / 'atlas-baseline.json')
current = load(stage / 'docs/function-atlas.json')
prefix = {}
for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows']:
    assert current[key][:len(old_atlas[key])] == old_atlas[key], key
    prefix[key] = {'old': len(old_atlas[key]), 'new': len(current[key]), 'oldPrefixExact': True}
for key in ['legacyCoverage', 'priorities']:
    assert current[key] == old_atlas[key], key
for key, previous in old_atlas['axes'].items():
    if isinstance(previous, list):
        assert current['axes'][key][:len(previous)] == previous, key
    else:
        assert current['axes'][key] == previous, key
functions = current['axes']['function']
assert len(functions) == len(old_atlas['axes']['function']) + 1
assert any(x['id'] == 'scene.removal_authoring3d' for x in functions)
assert len(current['axes']['implementation']) == len(old_atlas['axes']['implementation']) + 5
snapshot_changes = []
for path, previous in old_atlas['sourceSnapshot'].items():
    assert path in current['sourceSnapshot'], path
    if current['sourceSnapshot'][path] != previous:
        snapshot_changes.append(path)
        assert path in allowed or path.startswith('docs/test-results/scene3d-removal-authoring/'), path

summary = load(out / 'results.json')
web = load(out / 'web-review.json')
independent = load(out / 'independent-review.json')
packaged = load(out / 'packaged-resources.json')
assert summary['ok'] is True and web['ok'] is True and independent['ok'] is True
assert independent['passed'] == 16 and independent['failed'] == 0
assert len(web['personallyViewedFinalScreenshots']) == 6
assert packaged['ok'] is True
report = {'format': 'viento-scene3d-removal-independent-post-stage-review', 'schemaVersion': 1,
 'observedAt': datetime.now(timezone.utc).isoformat(), 'ok': True, 'blockingFindings': [],
 'scope': 'Pre-apply stage and actual-read-only preservation review. Final source map, product/doc allowlist, old evidence and author/tool data, additive atlas prefixes and existing final test reports only; no new test/build/HTTP, actual write or future apply/packet dependency.',
 'frozenSource': {'path': 'docs/test-results/scene3d-removal-authoring/source-hashes-final.json', 'sha256': sha(out / 'source-hashes-final.json'), 'files': 777},
 'preservation': {'actualSources': 767, 'historicalEvidenceActualAndStage': 5242, 'authorFilesActualAndStage': 41,
                  'externalToolsByteAndIdentityStable': 4, 'head': baseline['head'], 'version': baseline['version'], 'actualGeneratedDirectoriesRemainAbsent': generated},
 'implementationAllowlist': {'files': 47, 'sourceAndTests': 42, 'documentation': 5, 'paths': expected_implementation,
                           'additionalAtlasPaths': atlas_paths, 'newEvidencePrefix': 'docs/test-results/scene3d-removal-authoring/',
                           'unexpectedChangedFiles': unexpected, 'deletedOriginalFiles': deleted, 'newNonProofPaths': sorted(new_nonproof)},
 'atlas': {'oldPrefixes': prefix, 'legacyCoverageAndPrioritiesExact': True, 'oneNewFunction': True, 'fiveNewImplementations': True,
           'sourceSnapshotChangesWithinScope': sorted(snapshot_changes)},
 'evidence': {name: sha(out / name) for name in ['results.json', 'web-review.json', 'independent-review.json', 'packaged-resources.json']}}
with (out / 'post-stage-review.json').open('x') as stream:
    json.dump(report, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
print(json.dumps({'ok': True, 'sourceFiles': 777, 'implementationFiles': 47, 'oldEvidence': 5242, 'authorFiles': 41, 'tools': 4}))
