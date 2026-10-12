#!/usr/bin/env python3
"""Read frozen source and completed evidence; write only two NEW reports.

No product edits, test execution, build, install, generated cleanup or old-report
mutation. The optional final supplement inputs preserve earlier source phases.
"""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import json
import re
import stat
import subprocess

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]

def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def load(name):
    return json.loads((OUT / name).read_text())

def suite(name, require_pass=True):
    text = (OUT / name).read_text()
    rows = re.findall(r'^\s*ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$', text, re.M)
    assert len(rows) == 6, f'Completed single suite required: {name}'
    counts = {k: int(v) for k, v in rows}
    assert counts['tests'] > 3330
    if require_pass:
        assert counts['tests'] == counts['pass']
        assert all(counts[k] == 0 for k in ['fail', 'cancelled', 'skipped', 'todo'])
    duration = re.findall(r'^\s*ℹ duration_ms ([\d.]+)\s*$', text, re.M)
    return {'report': name, 'sha256': sha(OUT / name), 'counts': counts,
            'durationMs': float(duration[0]) if duration else None}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', default='source-hashes-confirmed.json')
    parser.add_argument('--browser', default='browser-navigation-third/browser.json')
    parser.add_argument('--prepared', default='packaged-resources.json')
    parser.add_argument('--timing', default='application-timing.json')
    parser.add_argument('--application', '--app-log', dest='application', default='app-check.log')
    args = parser.parse_args()
    assert not (OUT / 'review.json').exists() and not (OUT / 'preservation-audit-before-cleanup.json').exists()
    app = suite(args.application)
    prior_app = suite('app-check.log', require_pass=False)
    assert prior_app['counts'] == {'tests': 3380, 'pass': 3379, 'fail': 1, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    frozen = load(args.manifest)
    assert len(frozen) == 723
    drift = [p for p, digest in frozen.items() if not (ROOT / p).is_file() or sha(ROOT / p) != digest]
    assert not drift, drift
    initial = load('source-hashes-final.json')
    confirmed = load('source-hashes-confirmed.json')
    assert set(initial) == set(confirmed) == set(frozen)
    confirmed_changes = [p for p in initial if initial[p] != confirmed[p]]
    assert set(confirmed_changes) == {'web/modules/app-runtime.js', 'scripts/tests/scene3d-navigation-source-host.test.mjs', 'scripts/tests/scene3d-navigation-smoke.mjs'}
    manifest_sha = sha(OUT / args.manifest)
    final = {'manifest': args.manifest, 'manifestSha256': manifest_sha, 'files': len(frozen), 'allMatch': True,
             'drift': [], 'missing': [], 'firstManifest': 'source-hashes-final.json',
             'firstManifestSha256': sha(OUT / 'source-hashes-final.json'),
             'inputRepairManifest': 'source-hashes-confirmed.json', 'inputRepairManifestSha256': sha(OUT / 'source-hashes-confirmed.json'),
             'firstToInputRepairChanges': confirmed_changes,
             'inputRepairToFinalChanges': [p for p in confirmed if confirmed[p] != frozen[p]]}
    assert set(final['inputRepairToFinalChanges']) == {'web/modules/app-scene3d-preview.js', 'web/i18n/en.js',
        'web/i18n/ja.js', 'scripts/tests/scene3d-preview-ui.test.mjs', 'scripts/tests/scene3d-navigation-smoke.mjs'}
    previous = load('source-baseline.json')
    assert len(previous) == 718 and set(previous) <= set(frozen)
    delta = {'added': sorted(set(frozen) - set(previous)),
             'changed': sorted(p for p in previous if previous[p] != frozen[p]), 'removed': []}
    assert len(delta['added']) == 5 and len(delta['changed']) == 14
    preserved = {}
    for key, name, count in [('historical', 'historical-baseline.json', 4143), ('authors', 'author-baseline.json', 41)]:
        data = load(name)
        changes = [p for p, digest in data.items() if not (ROOT / p).is_file() or sha(ROOT / p) != digest]
        assert len(data) == count and not changes, changes
        preserved[key] = {'files': len(data), 'baselineSha256': sha(OUT / name), 'changed': [], 'allByteShaMatch': True}
    tool_actual = {}
    for p, expected in load('tool-baseline.json').items():
        item = Path(p).lstat()
        assert stat.S_ISREG(item.st_mode)
        actual = {'sha256': sha(p), 'bytes': item.st_size, 'dev': item.st_dev, 'ino': item.st_ino, 'nlink': item.st_nlink}
        assert actual == expected, p
        tool_actual[p] = actual
    preserved['externalTools'] = {'files': len(tool_actual), 'changed': [], 'baselineSha256': sha(OUT / 'tool-baseline.json'),
                                  'byteShaSizeDevInoAndNlinkMatch': True, 'actual': tool_actual}
    shared = load('shared-core-baseline.json')
    for p, expected in shared.items():
        assert sha(ROOT / p) == expected['sha256'] and (ROOT / p).stat().st_size == expected['bytes']
    preserved['sharedCore'] = {'files': shared, 'allByteShaSizeMatch': True, 'nativeSchemaAndWasmUnchanged': True}
    legacy_sources = ['engine/studio-core.mjs', 'engine/scene3d.mjs', 'engine/scene3d-authoring.mjs', 'engine/scene3d-transform.mjs',
                      'engine/scene3d-objects.mjs', 'engine/scene3d-environment.mjs', 'engine/scene3d-properties.mjs',
                      'web/modules/app-scene3d-transforms.js', 'web/modules/app-scene3d-objects.js',
                      'web/modules/app-scene3d-environment.js', 'web/modules/app-scene3d-properties.js']
    assert all(frozen[p] == previous[p] for p in legacy_sources)
    preserved['legacyAuthoring'] = {'files': len(legacy_sources), 'sourceShaUnchanged': {p: frozen[p] for p in legacy_sources},
                                   'readonlyPreviewGetsNoApplyOrSavePort': True, 'modules': 12, 'capabilities': 28}
    old_atlas = load('atlas-baseline.json')
    atlas = json.loads((ROOT / 'docs/function-atlas.json').read_text())
    prefixes = {'axes.' + k: atlas['axes'][k][:len(v)] == v for k, v in old_atlas['axes'].items()}
    prefixes.update({k: atlas[k][:len(old_atlas[k])] == old_atlas[k] for k in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']})
    assert all(prefixes.values()), prefixes
    preserved['atlas'] = {'path': 'docs/function-atlas.json', 'sha256': sha(ROOT / 'docs/function-atlas.json'),
                          'baselineSha256': sha(OUT / 'atlas-baseline.json'), 'oldPrefixDeepExact': prefixes,
                          'oldScoresCoordinatesAndReasonsExact': True,
                          'phase': 'Current atlas JSON before root closing references and final derived generation; later append-only evidence and sourceSnapshot changes reviewed after cleanup.',
                          'counts': {'functions': len(atlas['axes']['function']), 'implementations': len(atlas['axes']['implementation']),
                                     **{k: len(atlas[k]) for k in ['bindings', 'cells', 'dependencies', 'workflows', 'evidence']}}}
    quality = load('quality-confirmed.json')
    broadcast = load('source-input-broadcast.json')
    assert quality['ok'] and quality['passed'] == 7 and broadcast['ok'] and broadcast['passed'] == 3
    assert all(frozen[p] == digest for p, digest in quality['reviewedSources'].items())
    assert broadcast['sourceSha256'] == frozen['web/modules/app-runtime.js']
    renderer = load('renderer-results.json')
    assert renderer['status'] == 'passed'
    for item in renderer['sourceFiles']:
        assert frozen[item['path']] == item['sha256']
    document = load('renderer-document-review-confirmed.json')
    assert document['status'] == 'passed' and not document['links']['failures']
    for item in document['sourceFiles'] + document['interfaceSources'] + document['translationSources']:
        assert sha(ROOT / item['path']) == item['sha256']
    assert sha(ROOT / document['initialReview']['path']) == document['initialReview']['sha256']
    browser = load(args.browser)
    assert browser['ok'] and len(browser['steps']) == 8 and not browser['errors'] and not browser['cspViolations'] and not browser['svgRequests']
    assert browser['sourceStableDuringProof'] and browser['sources'] == browser['sourcesFinal']
    assert all(frozen[p] == digest for p, digest in browser['sources'].items())
    readonly_name = 'browser-preview-regression-reset-final/browser.json'
    readonly_browser = load(readonly_name)
    assert readonly_browser['ok'] and len(readonly_browser['steps']) == 7 and not readonly_browser['errors']
    assert readonly_browser['sourceStableDuringProof'] and readonly_browser['sources'] == readonly_browser['sourcesFinal']
    assert all(frozen[p] == digest for p, digest in readonly_browser['sources'].items())
    visual = load('visual-review-final.json')
    assert visual['ok'] and visual['browserReport'] == args.browser
    assert all(item['personallyViewed'] and sha(OUT / Path(args.browser).parent / item['file']) == item['sha256'] for item in visual['screenshots'])
    prepared = load(args.prepared)
    assert prepared['ok'] and prepared['frozenSource']['manifestSha256'] == manifest_sha
    copies = {}
    for name, evidence in prepared['artifacts'].items():
        base = ROOT / name
        assert not any(p.is_symlink() for p in base.rglob('*'))
        files = {p.relative_to(base).as_posix(): p for p in base.rglob('*') if p.is_file()}
        assert set(files) == set(evidence['manifest'])
        for p, file in files.items():
            assert sha(file) == evidence['manifest'][p]['sha256'] and file.stat().st_size == evidence['manifest'][p]['bytes']
        copies[name] = len(files)
    assert sorted(copies.values()) == [11, 243, 562]
    portable = prepared['portable']
    assert portable['desktop'] == portable['mobile']
    groups = sum(len(value) for value in portable['desktop'].values() if isinstance(value, list)) * 2
    assert groups == 272
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    version = (ROOT / 'VERSION').read_text().strip()
    assert head == load('baseline.json')['head'] and version == '0.0.10'
    timing = load(args.timing)
    now = datetime.now(timezone.utc).isoformat()
    review = {'format': 'viento-scene3d-navigation-independent-review', 'schemaVersion': 1, 'createdAt': now,
              'ok': True, 'openFindings': [], 'head': head, 'version': version, 'finalSourceFreeze': final, 'sourceDelta': delta,
              'reviewedSources': {p: frozen[p] for p in ['engine/scene3d-navigation.mjs', 'web/modules/app-runtime.js',
                  'web/modules/app-studio-system.js', 'web/modules/app-scene3d-preview.js', 'web/modules/scene3d-renderer.js', 'web/modules/scene3d-math.js']},
              'independent': {'sourceQuality': {'report': 'quality-confirmed.json', 'sha256': sha(OUT / 'quality-confirmed.json'),
                  'passed': 7, 'failed': 0, 'counts': quality['counts'], 'scope': quality['scope']},
                  'sourceInputBroadcast': {'report': 'source-input-broadcast.json', 'sha256': sha(OUT / 'source-input-broadcast.json'), 'passed': 3, 'failed': 0}},
              'renderer': {'report': 'renderer-results.json', 'sha256': sha(OUT / 'renderer-results.json'), 'verification': renderer['verification']},
              'documentSupplement': {'report': 'renderer-document-review-confirmed.json',
                  'sha256': sha(OUT / 'renderer-document-review-confirmed.json'), 'links': document['links']['checked'],
                  'initialReviewPreserved': document['initialReview'], 'finalInterfaceHashesMatch': True},
              'browser': {'report': args.browser, 'sha256': sha(OUT / args.browser), 'flowClasses': len(browser['steps']),
                  'sourceStableDuringProof': True, 'errors': 0, 'cspViolations': 0, 'screenshots': visual['screenshots']},
              'finalReadonlyRegression': {'report': readonly_name, 'sha256': sha(OUT / readonly_name), 'flowClasses': 7,
                  'sourceStableDuringProof': True, 'allBoundSourcesMatchFinal': True},
              'prepared': {'report': args.prepared, 'sha256': sha(OUT / args.prepared), 'groups': groups, 'files': copies,
                           'portabilityOnly': True, 'notSecuritySandboxOrInstallation': True},
              'application': app, 'priorApplication': prior_app,
              'applicationTiming': {'report': args.timing, 'sha256': sha(OUT / args.timing), 'details': timing},
              'lastUIRefinement': {'scope': 'Reset replaces the stale focused-view status with an explicit temporary author-camera reset message. Remove duplicate English search-clear key. No native, source-selection host, renderer, schema or authoring authority change.',
                  'sourceChanges': final['inputRepairToFinalChanges'],
                  'timing': 'The prior actual 3380-test suite had one duplicate-English-key failure. The final completed application, UI/i18n and real-browser proofs are bound separately; earlier browser screenshots and reports are preserved.'},
              'contracts': ['Native parser alone admits source and supplies UTF16 declaration ranges; object index/query is display-only.',
                  'The readonly source snapshot remains exactly three fields; selection host rederives native range from exact bytes and stable UUID, not caller range.',
                  'Source navigation changes selection/scroll/status only, then once-only focus checks captured editor owner after intended modal close.',
                  'Normal source input updates dirty/epoch before root broadcasts refresh; stale visible source location is disabled without granting write authority.',
                  'Temporary camera frame uses actual drawing aspect and enclosing sphere; floating-origin Float32 matrices preserve authored coordinates.',
                  'Source Save, four private authoring brands, old 2D domains, backend generation and native schema remain independent.'],
              'resolvedFindings': ['CRLF versus textarea LF location mismatch fixed with private raw-to-display UTF16 mapping.',
                  'Missing/nonfrozen/extra/getter locator receipts reject without trusting late completion.',
                  'Ordinary source input now broadcasts through the existing composition root before stale preview navigation can remain visibly active.',
                  'Reset now replaces the misleading focused-view status, and the repeated English search-clear dictionary key is removed.'],
              'limitations': ['Prototype flat boxes only; no hierarchy, assets, new authoring authority, engine/editor backend integration or schema additions.',
                  'Headless Chrome WebGL and simulated Float32 payload checks are not installed/device/hardware-GPU or pixel parity acceptance.',
                  'Prepared VM proves portability, not a hostile-code sandbox.', 'All earlier failures and pre-refinement snapshots remain immutable.']}
    preservation = {'format': 'viento-scene3d-navigation-independent-preservation', 'schemaVersion': 1, 'createdAt': now,
                    'ok': True, 'openFindings': [], 'finalSourceFreeze': final,
                    'baseline': {'report': 'baseline.json', 'sha256': sha(OUT / 'baseline.json')}, 'preserved': preserved,
                    'sourceDelta': delta, 'head': head, 'version': version,
                    'generatedInitiallyAbsent': load('generated-paths-initial.json'),
                    'scope': 'Read-only independent pre-cleanup source/report/author/tool/atlas/copy audit. No cleanup, build, install, version or publication action performed.'}
    for name, report in [('review.json', review), ('preservation-audit-before-cleanup.json', preservation)]:
        with (OUT / name).open('x') as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2); stream.write('\n')
    print(json.dumps({'ok': True, 'sourceFiles': len(frozen), 'manifestSha256': manifest_sha,
                      'historical': 4143, 'authors': 41, 'tools': 4, 'appTests': app['counts']['tests'], 'preparedGroups': groups}))

if __name__ == '__main__':
    main()
