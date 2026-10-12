#!/usr/bin/env python3
"""Final read-only document and preservation audit; output is deliberately
not registered in the atlas to avoid a self-referential source hash cycle."""
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import unquote, urlsplit
import hashlib
import json
import re
import stat
import subprocess

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
DOCS = ['README.md', 'docs/STATUS.md', 'docs/ARCHITECTURE.md', 'docs/ROADMAP.md',
        'docs/STUDIO_MODULES.md', 'docs/SCENE3D.md', 'engine/README.md', 'docs/FUNCTION_ATLAS.md']

def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def read(name):
    return json.loads((OUT / name).read_text())

def text_without_fences(text):
    return re.sub(r'^\s*(`{3,}|~{3,}).*?^\s*\1\s*$', '', text, flags=re.M | re.S)

def anchors(path):
    content = text_without_fences(path.read_text())
    ids = set(re.findall(r'\bid=["\']([^"\']+)', content))
    counts = {}
    for heading in re.findall(r'^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$', content, re.M):
        heading = re.sub(r'<[^>]*>', '', heading).strip().lower()
        slug = re.sub(r'[^\w -]', '', heading).replace(' ', '-')
        number = counts.get(slug, 0); counts[slug] = number + 1
        ids.add(slug + (f'-{number}' if number else ''))
    return ids

def main():
    assert not (OUT / 'post-cleanup-review.json').exists()
    frozen = read('source-hashes-final.json')
    assert len(frozen) == 726
    assert all((ROOT / path).is_file() and sha(ROOT / path) == expected for path, expected in frozen.items())
    preserved = {}
    for name, expected_count in [('historical-baseline.json', 4319), ('author-baseline.json', 41)]:
        baseline = read(name)
        changed = [path for path, expected in baseline.items() if not (ROOT / path).is_file() or sha(ROOT / path) != expected]
        assert len(baseline) == expected_count and not changed, changed
        preserved[name] = {'files': len(baseline), 'allByteShaMatch': True, 'changed': [], 'baselineSha256': sha(OUT / name)}
    tools = {}
    for path, expected in read('tool-baseline.json').items():
        item = Path(path).lstat(); assert stat.S_ISREG(item.st_mode)
        actual = {'sha256': sha(path), 'bytes': item.st_size, 'dev': item.st_dev, 'ino': item.st_ino, 'nlink': item.st_nlink}
        assert actual == expected, path
        tools[path] = actual
    assert len(tools) == 4
    shared = read('shared-core-baseline.json')
    for path, expected in shared.items():
        assert sha(ROOT / path) == expected['sha256'] and (ROOT / path).stat().st_size == expected['bytes']
    cleanup = read('cleanup.json'); results = read('results.json'); review = read('review.json')
    assert cleanup['ok'] and results['ok'] and review['ok']
    manifest_sha = sha(OUT / 'source-hashes-final.json')
    assert cleanup['sourceManifestSha256'] == results['sourceFreeze']['sha256'] == review['finalSourceFreeze']['manifestSha256'] == manifest_sha
    expected_dirs = {'desktop/resources', 'desktop/ui/i18n', 'desktop/.cache', 'src-tauri/binaries', 'mobile/dist'}
    assert {item['path'] for item in cleanup['removed']} == expected_dirs
    assert not any((ROOT / path).exists() or (ROOT / path).is_symlink() for path in expected_dirs)
    for evidence in cleanup['evidence'].values():
        assert sha(OUT / evidence['path']) == evidence['sha256']
    assert results['application']['counts'] == cleanup['application'] == review['application']['counts']
    assert results['application']['sha256'] == sha(OUT / results['application']['log'])
    assert results['application']['counts']['tests'] == 3421 and results['application']['javascriptSyntaxFiles'] == 603
    assert review['prepared']['groups'] == 288 and results['sourceFreeze']['files'] == 726
    atlas_path = ROOT / 'docs/function-atlas.json'
    atlas = json.loads(atlas_path.read_text()); old = read('atlas-baseline.json')
    prefix = {'axes.' + key: atlas['axes'][key][:len(value)] == value for key, value in old['axes'].items()}
    prefix.update({key: atlas[key][:len(old[key])] == old[key] for key in
                   ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']})
    assert all(prefix.values()), prefix
    assert atlas['meta']['historicalSha256'] == old['meta']['historicalSha256']
    assert old['meta']['scope'] in atlas['meta']['scope']
    for path, expected in atlas['meta']['historicalSha256'].items():
        assert sha(ROOT / path) == expected
    snapshot = atlas['sourceSnapshot']
    assert all((ROOT / path).is_file() and sha(ROOT / path) == expected for path, expected in snapshot.items())
    assert snapshot['docs/STATUS.md'] == sha(ROOT / 'docs/STATUS.md')
    assert 'docs/test-results/scene3d-picking/post-cleanup-review.json' not in snapshot
    counts = {'functions': len(atlas['axes']['function']), 'implementations': len(atlas['axes']['implementation']),
              **{key: len(atlas[key]) for key in ['bindings', 'cells', 'dependencies', 'workflows', 'evidence']},
              'sourceSnapshot': len(snapshot)}
    links, anchor_count, failures, documents = 0, 0, [], {}
    for name in DOCS:
        doc = ROOT / name; content = text_without_fences(doc.read_text())
        targets = re.findall(r'\[[^\]]*\]\(([^)]+)\)', content)
        targets += re.findall(r'\b(?:href|src)=["\']([^"\']+)', content)
        local = 0
        for target in targets:
            target = target.strip().split(' ', 1)[0].strip('<>')
            parsed = urlsplit(target)
            if parsed.scheme or parsed.netloc or target.startswith('//'):
                continue
            path = (doc.parent / unquote(parsed.path)).resolve() if parsed.path else doc
            links += 1; local += 1
            if not path.is_file():
                failures.append({'document': name, 'target': target, 'reason': 'missing local file'}); continue
            if parsed.fragment:
                anchor_count += 1
                if path.suffix == '.md' and unquote(parsed.fragment) not in anchors(path):
                    failures.append({'document': name, 'target': target, 'reason': 'missing Markdown anchor'})
        documents[name] = {'sha256': sha(doc), 'localReferences': local,
                           'sourceSnapshotIncludes': name in snapshot,
                           'sourceSnapshotMatches': snapshot.get(name) == sha(doc) if name in snapshot else None}
    assert not failures, failures
    status = (ROOT / 'docs/STATUS.md').read_text()
    assert all(str(number) in status for number in [3421, 603, 58, 184, 288, 726])
    web = read('web-validation.json')
    assert web['ui']['passed'] == 184 and web['combinedFocused']['passed'] == 187
    assert results['focused']['uiAndLocales']['passed'] == web['combinedFocused']['passed']
    assert '翻译目录 **3** 项' in status
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    version = (ROOT / 'VERSION').read_text().strip()
    assert head == read('baseline.json')['head'] and version == '0.0.10'
    report = {'format': 'viento-scene3d-picking-independent-post-cleanup-review', 'schemaVersion': 1,
        'observedAt': datetime.now(timezone.utc).isoformat(), 'ok': True, 'openFindings': [],
        'finalSourceFreeze': {'manifest': 'source-hashes-final.json', 'manifestSha256': manifest_sha, 'files': 726, 'allMatch': True},
        'preserved': preserved, 'externalTools': {'files': 4, 'allByteShaSizeDevInoNlinkMatch': True, 'actual': tools},
        'sharedCore': {'allByteShaSizeMatch': True, 'files': shared}, 'head': head, 'version': version,
        'cleanup': {'report': 'cleanup.json', 'sha256': sha(OUT / 'cleanup.json'), 'generatedPathsRemainAbsent': sorted(expected_dirs),
            'allocatedFileBytesRemoved': cleanup['allocatedFileBytesRemoved'], 'logicalBytesRemoved': cleanup['logicalBytesRemoved'],
            'canonicalProofShaPathsMatch': True,
            'scope': 'Actual retained files and current absence checked after cleanup; fresh helpers were verified by the root before deletion, not re-read by this reviewer after deletion.'},
        'results': {'report': 'results.json', 'sha256': sha(OUT / 'results.json'), 'actualApplicationCountsMatch': True,
            'sourceFreezeAndPreparedMetadataMatch': True},
        'atlas': {'path': 'docs/function-atlas.json', 'sha256': sha(atlas_path), 'counts': counts,
            'oldPrefixDeepExact': prefix, 'oldScoresCoordinatesReasonsAndMetaHistoryExact': True,
            'oldScopeTextRetained': True, 'allSourceSnapshotHashesMatch': True, 'statusIncludedAndMatches': True,
            'closingReportExcludedToAvoidSelfHashCycle': True},
        'documents': {'files': documents, 'localReferences': links, 'anchors': anchor_count, 'failures': [],
            'currentStatusCountsMatchActualReports': True},
        'scope': 'Fresh read-only post-cleanup source/history/author/tool/WASM/atlas/metadata/eight-document links audit. No semantic test, Node sidecar, build, install, deletion or modification of completed evidence/product/docs/atlas.'}
    with (OUT / 'post-cleanup-review.json').open('x') as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2); stream.write('\n')
    print(json.dumps({'ok': True, 'sourceFiles': 726, 'historical': 4319, 'authors': 41, 'tools': 4,
        'atlas': counts, 'localReferences': links, 'anchors': anchor_count, 'generatedPathsAbsent': 5}))

if __name__ == '__main__':
    main()
