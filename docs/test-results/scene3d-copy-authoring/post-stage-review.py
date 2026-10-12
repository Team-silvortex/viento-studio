#!/usr/bin/env python3
"""Closing stage-only read audit, after root results/docs/atlas freeze.

No actual checkout application, Node execution or cleanup. Only NEW receipt.
This report stays out of atlas sourceSnapshot to avoid a self-hash cycle.
"""
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import unquote, urlsplit
import hashlib
import json
import re
import stat

OUT = Path(__file__).resolve().parent
STAGE = OUT.parents[2]

def sha(path):
    with Path(path).open('rb') as stream: return hashlib.file_digest(stream, 'sha256').hexdigest()

def load(name): return json.loads((OUT / name).read_text())

def unfenced(text):
    return re.sub(r'^\s*(`{3,}|~{3,}).*?^\s*\1\s*$', '', text, flags=re.M | re.S)

def anchors(path):
    content = unfenced(path.read_text())
    values = set(re.findall(r'\bid=["\']([^"\']+)', content)); counts = {}
    for heading in re.findall(r'^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$', content, re.M):
        slug = re.sub(r'[^\w -]', '', re.sub(r'<[^>]*>', '', heading).strip().lower()).replace(' ', '-')
        number = counts.get(slug, 0); counts[slug] = number + 1
        values.add(slug + (f'-{number}' if number else ''))
    return values

def main():
    assert not (OUT / 'post-stage-review.json').exists()
    baseline = load('baseline.json'); actual = Path(baseline['sourceRoot'])
    frozen = load('source-hashes-final.json')
    assert len(frozen) == 767 and all(sha(STAGE / path) == digest for path, digest in frozen.items())
    preserved = {}
    for root_name, directory in [('actual', actual), ('stage', STAGE)]:
        for name, count in [('historical-baseline.json', 5075), ('author-baseline.json', 41)]:
            value = load(name); assert len(value) == count
            assert all((directory / path).is_file() and sha(directory / path) == digest for path, digest in value.items())
            preserved[root_name + ':' + name] = {'files': count, 'baselineSha256': sha(OUT / name), 'allByteShaMatch': True, 'changed': []}
    old_source = load('source-baseline.json')
    assert len(old_source) == 757 and all(sha(actual / path) == digest for path, digest in old_source.items())
    tool_actual = {}
    for path, expected in load('tool-baseline.json').items():
        file = Path(path); item = file.lstat(); assert stat.S_ISREG(item.st_mode)
        value = {'sha256': sha(file), 'bytes': item.st_size, 'dev': item.st_dev, 'ino': item.st_ino, 'nlink': item.st_nlink}
        assert value == expected; tool_actual[path] = value
    assert len(tool_actual) == 4
    review = load('stage-review.json'); proof = load('stage-preservation.json')
    assert review['ok'] and proof['ok'] and not review['openFindings'] and not proof['openFindings']
    manifest_sha = sha(OUT / 'source-hashes-final.json')
    assert review['finalSourceFreeze']['manifestSha256'] == proof['finalSourceFreeze']['manifestSha256'] == manifest_sha
    legacy = load('legacy-addon.json'); assert legacy['ok']
    assert legacy['finalSourceFreeze']['manifestSha256'] == manifest_sha
    assert legacy['actualCheckoutApplied'] is False
    for key in ['initialSummary', 'initialVisualReview']:
        item = legacy[key]; assert item['preserved'] and sha(OUT / item['path']) == item['sha256']
    legacy_reports = {}
    for item in legacy['legacyBrowsers']:
        name = item['path']; resolved = (OUT / name).resolve()
        assert resolved.is_relative_to(OUT) and sha(resolved) == item['sha256']
        browser = load(name)
        assert len(browser['steps']) == item['workflows']
        assert browser['ok'] and not browser['errors'] and browser['sourceStableDuringProof']
        assert all(frozen[path] == digest for path, digest in browser['sources'].items())
        legacy_reports[name] = {'sha256': sha(OUT / name), 'flowClasses': len(browser['steps']),
            'boundSourcesMatchFinal': True, 'svgCollectorPresent': 'svgRequests' in browser,
            'cspCollectorPresent': 'cspViolations' in browser,
            'svgMonitoring': item['svgRequests'], 'cspMonitoring': item['cspViolations']}
    assert len(legacy_reports) == 4 and sum(item['flowClasses'] for item in legacy_reports.values()) == 32
    assert legacy['actualBrowserWorkflows']['legacyTotal'] == 32 and legacy['actualBrowserWorkflows']['combinedDifferentScopes'] == 40
    atlas = json.loads((STAGE / 'docs/function-atlas.json').read_text()); old = load('atlas-baseline.json')
    assert json.loads((actual / 'docs/function-atlas.json').read_text()) == old
    prefix = {'axes.' + key: atlas['axes'][key][:len(value)] == value for key, value in old['axes'].items()}
    for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']:
        prefix[key] = atlas[key][:len(old[key])] == old[key]
    assert all(prefix.values()) and atlas['meta']['historicalSha256'] == old['meta']['historicalSha256']
    assert atlas['meta']['version'] == old['meta']['version'] and atlas['meta']['commit'] == old['meta']['commit']
    assert old['meta']['scope'] in atlas['meta']['scope'], 'historical scope missing'
    for path, digest in atlas['sourceSnapshot'].items(): assert (STAGE / path).is_file() and sha(STAGE / path) == digest, path
    assert (OUT / 'post-stage-review.json').relative_to(STAGE).as_posix() not in atlas['sourceSnapshot']
    counts = {'functions': len(atlas['axes']['function']), 'implementations': len(atlas['axes']['implementation']),
        **{key: len(atlas[key]) for key in ['bindings', 'cells', 'dependencies', 'workflows', 'evidence', 'sourceSnapshot']}}
    local_refs = anchor_refs = 0; failures = []; documents = {}
    for name in ['README.md', 'docs/STATUS.md', 'docs/ARCHITECTURE.md', 'docs/ROADMAP.md',
                 'docs/STUDIO_MODULES.md', 'docs/SCENE3D.md', 'engine/README.md', 'docs/FUNCTION_ATLAS.md']:
        doc = STAGE / name; content = unfenced(doc.read_text())
        targets = re.findall(r'\[[^\]]*\]\(([^)]+)\)', content) + re.findall(r'\b(?:href|src)=["\']([^"\']+)', content)
        count = 0
        for value in targets:
            value = value.strip().split(' ', 1)[0].strip('<>'); parsed = urlsplit(value)
            if parsed.scheme or parsed.netloc or value.startswith('//'): continue
            target = (doc.parent / unquote(parsed.path)).resolve() if parsed.path else doc
            local_refs += 1; count += 1
            if not target.is_file(): failures.append({'document': name, 'target': value, 'reason': 'missing local file'}); continue
            if parsed.fragment:
                anchor_refs += 1
                if target.suffix == '.md' and unquote(parsed.fragment) not in anchors(target):
                    failures.append({'document': name, 'target': value, 'reason': 'missing Markdown anchor'})
        documents[name] = {'sha256': sha(doc), 'localReferences': count,
            'sourceSnapshotIncludes': name in atlas['sourceSnapshot'],
            'sourceSnapshotMatches': atlas['sourceSnapshot'].get(name) == sha(doc) if name in atlas['sourceSnapshot'] else None}
    assert not failures, failures
    control = Path(baseline['controlRoot'])
    applier = control / 'apply-reviewed-patch.py'
    copied_applier = OUT / 'apply-reviewed-patch.py'
    adjustment = load('applier-review-adjustment.json')
    assert adjustment['ok'] and adjustment['actualApplyPerformed'] is False
    assert sha(applier) == sha(copied_applier) == adjustment['afterSha256']
    assert 'p.lstat()' in applier.read_text() and 'stat.S_ISREG' in applier.read_text()
    applier_review = {'path': str(applier), 'sha256': sha(applier), 'copiedProofSha256': sha(copied_applier),
        'adjustment': {'report': 'applier-review-adjustment.json', 'sha256': sha(OUT / 'applier-review-adjustment.json')},
        'scope': 'Read-only reviewed allowlist, atomic per-file publication, exact backup/rollback and receipt commit boundary; prepared packet/self SHA binding remains a later root action. No actual application, crash-durable multi-file transaction or hostile same-user race resistance claimed.'}
    results = load('results.json')
    assert results['ok']
    # Final results carry the actual suite/copied source phase; no new execution.
    assert results['fullApplication']['counts'] == review['fullApplication']['counts']
    assert results['fullApplication']['counts']['tests'] == 3752
    application = results['fullApplication']
    assert application['executedManifestSha256'] == sha(OUT / 'source-hashes-final.json')
    assert application.get('finalSourceManifestSha256', manifest_sha) == manifest_sha
    assert application.get('onlyLaterDelta', []) == []
    assert application['executedManifestSha256'] == manifest_sha
    assert results['prepared']['groups'] == 362
    assert results['sourceFreeze']['sha256'] == manifest_sha and results['sourceFreeze']['files'] == 767
    status = (STAGE / 'docs/STATUS.md').read_text()
    assert all(str(number) in status for number in [3752, 290, 362, 767])
    report = {'format': 'viento-scene3d-copy-independent-post-stage-review', 'schemaVersion': 1,
        'observedAt': datetime.now(timezone.utc).isoformat(), 'ok': True, 'openFindings': [],
        'finalSourceFreeze': {'manifest': 'source-hashes-final.json', 'manifestSha256': manifest_sha, 'files': 767, 'allMatch': True},
        'actualCheckout': {'root': str(actual), 'sourceFiles': 757, 'allSourceBytesExact': True, 'atlasDeepExact': True, 'applied': False},
        'preserved': preserved, 'externalTools': {'files': 4, 'allByteShaSizeDevInoNlinkMatch': True, 'actual': tool_actual},
        'legacy': {'report': 'legacy-addon.json', 'sha256': sha(OUT / 'legacy-addon.json'),
            'proofs': legacy_reports, 'actualLegacyFlows': 32, 'newFlowsInFrozenStageReview': 8,
            'scope': 'Readonly legacy report without collectors does not imply zero SVG/CSP monitoring.'},
        'atlas': {'sha256': sha(STAGE / 'docs/function-atlas.json'), 'counts': counts,
                  'oldPrefixDeepExact': prefix, 'allSourceSnapshotHashesMatch': True, 'selfHashCycleExcluded': True},
        'documents': {'files': documents, 'localReferences': local_refs, 'anchors': anchor_refs, 'failures': []},
        'results': {'sha256': sha(OUT / 'results.json'), 'actualCountsAndPhaseMatch': True},
        'applicationProducerReview': applier_review,
        'scope': 'Stage-only closing source/data/tool/atlas/eight-document direct-link audit. Actual repository remains unchanged; no actual apply, install, Node/build/HTTP execution, cleanup or rewriting of completed stage evidence.'}
    with (OUT / 'post-stage-review.json').open('x') as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2); stream.write('\n')
    print(json.dumps({'ok': True, 'stageSource': 767, 'actualSourceUnchanged': 757, 'historical': 5075,
        'authors': 41, 'tools': 4, 'atlas': counts, 'localReferences': local_refs, 'anchors': anchor_refs}))

if __name__ == '__main__': main()
