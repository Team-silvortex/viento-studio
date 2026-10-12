"""Read-only support for this slice's independent evidence producers."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import re
import stat
import subprocess
from urllib.parse import unquote, urlsplit

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]

def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def load(name):
    path = (OUT / name).resolve(strict=True)
    assert path.is_relative_to(OUT)
    return json.loads(path.read_text())

def write_new(name, value):
    with (OUT / name).open('x') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')

def now():
    return datetime.now(timezone.utc).isoformat()

def suite(name):
    text = (OUT / name).read_text()
    rows = re.findall(r'^\s*ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$', text, re.M)
    assert len(rows) == 6, f'Exactly one completed suite required: {name}'
    counts = {key: int(value) for key, value in rows}
    assert counts['tests'] > 0 and counts['tests'] == counts['pass'], (name, counts)
    assert not any(counts[key] for key in ['fail', 'cancelled', 'skipped', 'todo'])
    duration = re.findall(r'^\s*ℹ duration_ms ([\d.]+)\s*$', text, re.M)
    return {'report': name, 'sha256': sha(OUT / name), 'counts': counts,
            'durationMs': float(duration[0]) if duration else None}

def frozen_source(manifest):
    value = load(manifest)
    assert len(value) == 737
    changed = [path for path, digest in value.items()
               if not (ROOT / path).is_file() or sha(ROOT / path) != digest]
    assert not changed, changed
    return value, {'manifest': manifest, 'manifestSha256': sha(OUT / manifest),
                   'files': len(value), 'allMatch': True, 'changed': []}

def preservation():
    report = {}
    for key, name, count in [('historical', 'historical-baseline.json', 4522),
                             ('authors', 'author-baseline.json', 41)]:
        value = load(name)
        changes = [path for path, digest in value.items()
                   if not (ROOT / path).is_file() or sha(ROOT / path) != digest]
        assert len(value) == count and not changes, (key, changes)
        report[key] = {'files': len(value), 'changed': [], 'baselineSha256': sha(OUT / name),
                       'allByteShaMatch': True}
    actual = {}
    for path, value in load('tool-baseline.json').items():
        item = Path(path).lstat()
        assert stat.S_ISREG(item.st_mode)
        data = {'sha256': sha(path), 'bytes': item.st_size, 'dev': item.st_dev,
                'ino': item.st_ino, 'nlink': item.st_nlink}
        assert data == value, path
        actual[path] = data
    assert len(actual) == 4
    report['externalTools'] = {'files': len(actual), 'changed': [],
        'baselineSha256': sha(OUT / 'tool-baseline.json'),
        'byteShaSizeDevInoAndNlinkMatch': True, 'actual': actual}
    baseline = load('shared-core-baseline.json')
    previous = {'engine/studio-core.wasm': 'previous-studio-core.wasm',
                'engine/studio-core.build.json': 'previous-studio-core.build.json'}
    for path, name in previous.items():
        assert sha(OUT / name) == baseline[path]['sha256']
        assert (OUT / name).stat().st_size == baseline[path]['bytes']
    report['previousCore'] = {'baselineSha256': sha(OUT / 'shared-core-baseline.json'),
                             'allByteShaSizeMatch': True, 'files': previous}
    return report

def atlas_prefix(require_snapshot=False):
    old = load('atlas-baseline.json')
    path = ROOT / 'docs/function-atlas.json'
    current = json.loads(path.read_text())
    checks = {'axes.' + key: current['axes'][key][:len(value)] == value
              for key, value in old['axes'].items()}
    for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows',
                'legacyCoverage', 'priorities']:
        checks[key] = current[key][:len(old[key])] == old[key]
    assert all(checks.values()), checks
    assert current['meta']['historicalSha256'] == old['meta']['historicalSha256']
    assert old['meta']['scope'] in current['meta']['scope']
    for file, digest in current['meta']['historicalSha256'].items():
        assert sha(ROOT / file) == digest
    if require_snapshot:
        for file, digest in current['sourceSnapshot'].items():
            assert (ROOT / file).is_file() and sha(ROOT / file) == digest, file
    return current, {'path': 'docs/function-atlas.json', 'sha256': sha(path),
        'baselineSha256': sha(OUT / 'atlas-baseline.json'), 'oldPrefixDeepExact': checks,
        'oldScoresCoordinatesReasonsAndMetaHistoryExact': True,
        'counts': {'functions': len(current['axes']['function']),
                   'implementations': len(current['axes']['implementation']),
                   **{key: len(current[key]) for key in ['bindings', 'cells', 'dependencies',
                        'workflows', 'evidence', 'sourceSnapshot']}},
        'allSourceSnapshotHashesMatch': True if require_snapshot else None}

def identity():
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    version = (ROOT / 'VERSION').read_text().strip()
    assert head == load('baseline.json')['head'] and version == '0.0.10'
    return {'head': head, 'version': version}

def document_links(snapshot):
    documents = ['README.md', 'docs/STATUS.md', 'docs/ARCHITECTURE.md', 'docs/ROADMAP.md',
                 'docs/STUDIO_MODULES.md', 'docs/SCENE3D.md', 'engine/README.md', 'docs/FUNCTION_ATLAS.md']
    def unfenced(text):
        return re.sub(r'^\s*(`{3,}|~{3,}).*?^\s*\1\s*$', '', text, flags=re.M | re.S)
    def anchors(path):
        content = unfenced(path.read_text())
        result = set(re.findall(r'\bid=["\']([^"\']+)', content))
        counts = {}
        for heading in re.findall(r'^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$', content, re.M):
            slug = re.sub(r'[^\w -]', '', re.sub(r'<[^>]*>', '', heading).strip().lower()).replace(' ', '-')
            number = counts.get(slug, 0); counts[slug] = number + 1
            result.add(slug + (f'-{number}' if number else ''))
        return result
    count = anchor_count = 0
    failures, actual = [], {}
    for name in documents:
        path = ROOT / name; content = unfenced(path.read_text())
        targets = re.findall(r'\[[^\]]*\]\(([^)]+)\)', content)
        targets += re.findall(r'\b(?:href|src)=["\']([^"\']+)', content)
        local = 0
        for value in targets:
            value = value.strip().split(' ', 1)[0].strip('<>')
            parsed = urlsplit(value)
            if parsed.scheme or parsed.netloc or value.startswith('//'):
                continue
            target = (path.parent / unquote(parsed.path)).resolve() if parsed.path else path
            count += 1; local += 1
            if not target.is_file():
                failures.append({'document': name, 'target': value, 'reason': 'missing local file'})
                continue
            if parsed.fragment:
                anchor_count += 1
                if target.suffix == '.md' and unquote(parsed.fragment) not in anchors(target):
                    failures.append({'document': name, 'target': value, 'reason': 'missing Markdown anchor'})
        actual[name] = {'sha256': sha(path), 'localReferences': local,
            'sourceSnapshotIncludes': name in snapshot,
            'sourceSnapshotMatches': snapshot.get(name) == sha(path) if name in snapshot else None}
    assert not failures, failures
    return {'files': actual, 'localReferences': count, 'anchors': anchor_count, 'failures': []}
