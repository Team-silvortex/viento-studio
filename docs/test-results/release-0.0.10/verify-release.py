"""Read-only release preservation/navigation check; writes only new release evidence."""
from pathlib import Path
import datetime
import hashlib
import importlib.util
import json
import os
import subprocess

EVIDENCE = Path(__file__).resolve().parent
ROOT = EVIDENCE.parents[2]
PREVIOUS = ROOT / 'docs/test-results/scene3d-primitives'
EXPECTED_DELTA = {
    'VERSION', 'package.json', 'package-lock.json', 'src-tauri/tauri.conf.json',
    'src-tauri/tauri.android.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock',
    'web/index.html', 'desktop/ui/index.html', 'engine/README.md',
    'desktop/package-source.py', 'scripts/tests/source-archive.test.mjs',
    'scripts/tests/studio-core-composition-groups-patch.test.mjs',
}


def sha(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def verify_map(mapping):
    drift = []
    for name, expected in mapping.items():
        file = ROOT / name
        actual = sha(file) if file.is_file() and not file.is_symlink() else None
        if actual != expected:
            drift.append({'path': name, 'expected': expected, 'actual': actual})
    return {'files': len(mapping), 'allMatch': not drift, 'drift': drift}


old_sources = json.loads((PREVIOUS / 'source-hashes.json').read_text())
current = {name: sha(ROOT / name) for name in old_sources}
delta = {name: {'before': old_sources[name], 'after': value}
         for name, value in current.items() if old_sources[name] != value}
assert set(delta) == EXPECTED_DELTA, sorted(delta)
assert (ROOT / 'VERSION').read_text().strip() == '0.0.10'
(EVIDENCE / 'source-hashes.json').write_text(json.dumps(current, indent=2) + '\n')
(EVIDENCE / 'source-delta.json').write_text(json.dumps(delta, indent=2) + '\n')

history_map = json.loads((EVIDENCE / 'release-history-hashes.json').read_text())
history = verify_map(history_map)
actual_history = {str(file.relative_to(ROOT)) for file in (ROOT / 'docs/test-results').rglob('*')
                  if file.is_file() and not file.is_relative_to(EVIDENCE)}
assert actual_history == set(history_map), 'Historical evidence inventory changed'
assert history['allMatch'], history['drift']
authors_map = json.loads((PREVIOUS / 'author-baseline.json').read_text())
for name in ['examples/scene3d/scene.json', 'examples/scene3d/README.md']:
    authors_map[name] = old_sources[name]
authors = verify_map(authors_map)
actual_authors = {str(file.relative_to(ROOT)) for file in (ROOT / 'examples').rglob('*') if file.is_file()}
assert actual_authors == set(authors_map), 'Official author inventory changed'
assert authors['allMatch'], authors['drift']

tools_map = json.loads((PREVIOUS / 'tool-baseline.json').read_text())
tools = []
for name, expected in tools_map.items():
    file = Path(name)
    stat = file.stat()
    actual = {'bytes': stat.st_size, 'sha256': sha(file), 'dev': stat.st_dev, 'ino': stat.st_ino}
    assert actual == expected, name
    tools.append({'path': name, 'sameBytesAndPhysicalIdentity': True})

generated = ['desktop/resources', 'desktop/ui/i18n', 'desktop/.cache', 'src-tauri/binaries', 'mobile/dist']
assert all(not (ROOT / name).exists() and not (ROOT / name).is_symlink() for name in generated)

# Reuse the already reviewed navigation algorithm without editing or invoking
# its historical audit entry point. Point its sole output exclusion at this run.
audit_path = PREVIOUS / 'preservation-audit.py'
spec = importlib.util.spec_from_file_location('historical_navigation_reader', audit_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.EVIDENCE = EVIDENCE
navigation = module.markdown_links()
assert not navigation['errors'], navigation['errors']
subprocess.run(['git', 'diff', '--check'], cwd=ROOT, check=True)
report = {
    'format': 'viento-release-preservation', 'schemaVersion': 1, 'ok': True,
    'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'version': '0.0.10',
    'baseCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
    'source': {'files': len(current), 'manifest': 'source-hashes.json',
               'sha256': sha(EVIDENCE / 'source-hashes.json'), 'approvedDelta': sorted(delta),
               'unchangedSourceFiles': len(current) - len(delta),
               'scope': 'Version carriers, current engine README, source archive whitelist/regression, and one EOF whitespace-only test cleanup; runtime/UI/Rust/protocol sources unchanged since final scene3d proof.'},
    'historical': history, 'authors': authors, 'externalTools': tools,
    'generatedPathsRemainAbsent': generated, 'navigation': navigation,
    'navigationReaderSha256': sha(audit_path), 'whitespace': True,
}
(EVIDENCE / 'preservation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: value for key, value in report.items()
                  if key in ['ok', 'version', 'source', 'historical', 'authors']}, ensure_ascii=False))
