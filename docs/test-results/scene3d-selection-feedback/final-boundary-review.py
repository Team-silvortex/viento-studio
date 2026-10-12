#!/usr/bin/env python3
"""Read completed proofs and preserved baselines, then write NEW final reports.

This producer never changes products, old evidence, generated resources or tools.
It does not execute application tests, builds, backends or a browser.
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

def write_new(name, value):
    with (OUT / name).open('x') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', default='source-hashes-confirmed.json')
    parser.add_argument('--phase', default='source-phase-confirmation.json')
    parser.add_argument('--browser', required=True)
    parser.add_argument('--prepared', default='packaged-resources.json')
    parser.add_argument('--related-log', default='related-check.log')
    parser.add_argument('--visual', default='visual-review-web.json')
    parser.add_argument('--quality', default='quality-initial.json')
    parser.add_argument('--renderer', default='renderer-results.json')
    args = parser.parse_args()
    assert not (OUT / 'review.json').exists() and not (OUT / 'preservation-audit-before-cleanup.json').exists()
    baseline = load('baseline.json')
    frozen = load(args.manifest)
    previous = load('source-baseline.json')
    assert len(previous) == 726 and len(frozen) == 727
    assert set(previous) <= set(frozen)
    missing = [p for p in frozen if not (ROOT / p).is_file()]
    drift = [p for p, expected in frozen.items() if (ROOT / p).is_file() and sha(ROOT / p) != expected]
    assert not missing and not drift, {'missing': missing, 'drift': drift}
    delta = {'added': sorted(set(frozen) - set(previous)),
             'changed': sorted(p for p in previous if previous[p] != frozen[p]), 'removed': []}
    assert len(delta['added']) == 1 and delta['added'][0].startswith('scripts/tests/scene3d-') and delta['added'][0].endswith('-smoke.mjs'), delta
    allowed_changed = {'web/modules/scene3d-renderer.js', 'scripts/tests/scene3d-renderer.test.mjs',
                       'web/modules/app-scene3d-preview.js', 'scripts/tests/scene3d-preview-ui.test.mjs',
                       'web/i18n/en.js', 'web/i18n/ja.js', 'engine/README.md',
                       'scripts/tests/scene3d-navigation-smoke.mjs', 'scripts/tests/scene3d-picking-smoke.mjs'}
    assert set(delta['changed']) <= allowed_changed, delta
    final = {'manifest': args.manifest, 'manifestSha256': sha(OUT / args.manifest), 'files': len(frozen),
             'allMatch': True, 'missing': [], 'drift': []}
    phase = load(args.phase)
    assert phase['ok'] and phase['confirmedManifest']['sha256'] == final['manifestSha256']
    assert phase['confirmedManifest']['path'] == args.manifest
    initial = load(phase['initialManifest']['path'])
    assert sha(OUT / phase['initialManifest']['path']) == phase['initialManifest']['sha256']
    assert set(initial) == set(frozen)
    phase_delta = {p: {'before': initial[p], 'after': frozen[p]} for p in initial if initial[p] != frozen[p]}
    assert phase_delta == phase['onlyChangedBrowserHarnesses']
    assert set(phase_delta) == {'scripts/tests/scene3d-picking-smoke.mjs', 'scripts/tests/scene3d-selection-smoke.mjs'}
    assert phase['finalSyntax']['files'] == list(phase_delta) and phase['finalSyntax']['exitCodes'] == [0, 0]
    assert phase['finalSyntax']['node'] == 'v24.20.0'
    assert sha(OUT / phase['finalSyntax']['log']) == phase['finalSyntax']['logSha256']
    preserved = {}
    for key, name, expected_count in [('historical', 'historical-baseline.json', 4417), ('authors', 'author-baseline.json', 41)]:
        entries = load(name)
        changes = [p for p, expected in entries.items() if not (ROOT / p).is_file() or sha(ROOT / p) != expected]
        assert len(entries) == expected_count and not changes, {'baseline': name, 'changes': changes}
        preserved[key] = {'files': len(entries), 'baselineSha256': sha(OUT / name), 'changed': [], 'allByteShaMatch': True}
    actual_tools = {}
    for path, expected in load('tool-baseline.json').items():
        item = Path(path).lstat()
        assert stat.S_ISREG(item.st_mode)
        actual = {'sha256': sha(path), 'bytes': item.st_size, 'dev': item.st_dev, 'ino': item.st_ino, 'nlink': item.st_nlink}
        assert actual == expected, path
        actual_tools[path] = actual
    assert len(actual_tools) == 4
    preserved['externalTools'] = {'files': 4, 'changed': [], 'baselineSha256': sha(OUT / 'tool-baseline.json'),
                                  'byteShaSizeDevInoAndNlinkMatch': True, 'actual': actual_tools}
    shared = load('shared-core-baseline.json')
    for path, expected in shared.items():
        assert sha(ROOT / path) == expected['sha256'] and (ROOT / path).stat().st_size == expected['bytes']
    preserved['sharedCore'] = {'files': shared, 'allByteShaSizeMatch': True, 'nativeSchemaAndWasmUnchanged': True}
    protected = [p for p in previous if p.startswith('crates/') or p.startswith('engine/') and p != 'engine/README.md'
                 or p.startswith('scripts/backends/') or p.startswith('scripts/adapters/')
                 or p in {'web/modules/app-runtime.js', 'web/modules/app-studio-system.js',
                          'web/modules/app-scene3d-transforms.js', 'web/modules/app-scene3d-objects.js',
                          'web/modules/app-scene3d-environment.js', 'web/modules/app-scene3d-properties.js',
                          'web/modules/scene3d-math.js', 'web/modules/scene3d-picking.js'}]
    assert all(frozen[p] == previous[p] for p in protected)
    preserved['nativeEngineHostAuthoringAndBackend'] = {'files': len(protected), 'allSourceShaUnchanged': True,
        'sourceShaUnchanged': {p: frozen[p] for p in protected}, 'readonlySourceFields': 3,
        'independentAuthoringSourceFields': 5, 'modules': 12, 'capabilities': 28}
    old_atlas = load('atlas-baseline.json')
    atlas = json.loads((ROOT / 'docs/function-atlas.json').read_text())
    prefixes = {'axes.' + key: atlas['axes'][key][:len(value)] == value for key, value in old_atlas['axes'].items()}
    prefixes.update({key: atlas[key][:len(old_atlas[key])] == old_atlas[key]
                    for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']})
    assert all(prefixes.values()), prefixes
    preserved['atlas'] = {'path': 'docs/function-atlas.json', 'sha256': sha(ROOT / 'docs/function-atlas.json'),
        'baselineSha256': sha(OUT / 'atlas-baseline.json'), 'oldPrefixDeepExact': prefixes,
        'oldScoresCoordinatesAndReasonsExact': True,
        'phase': 'Pre-cleanup JSON; final append-only closing evidence and refreshed sourceSnapshot are reviewed separately.',
        'counts': {'functions': len(atlas['axes']['function']), 'implementations': len(atlas['axes']['implementation']),
                   **{key: len(atlas[key]) for key in ['bindings', 'cells', 'dependencies', 'workflows', 'evidence']}}}
    quality = load(args.quality)
    assert quality['ok'] and quality['passed'] == 23 and quality['failed'] == 0 and quality['sourceStable']
    assert quality['sources'] == quality['endSources']
    assert all(frozen[p] == expected for p, expected in quality['sources'].items())
    renderer = load(args.renderer)
    assert renderer.get('status') == 'passed' or renderer.get('ok') is True
    for path, evidence in renderer['sources'].items():
        assert frozen[path] == evidence['sha256'] and (ROOT / path).stat().st_size == evidence['bytes']
    for path, evidence in renderer['unchanged'].items():
        assert frozen[path] == evidence['sha256'] and (ROOT / path).stat().st_size == evidence['bytes']
    assert sha(OUT / renderer['tests']['log']) == renderer['tests']['logSha256']
    assert renderer['tests']['failed'] == renderer['tests']['skipped'] == renderer['tests']['cancelled'] == 0
    browser = load(args.browser)
    assert (browser.get('ok') is True or browser.get('status') == 'passed') and browser['steps'] and not browser['errors']
    assert not browser.get('cspViolations', []) and not browser.get('svgRequests', [])
    assert browser['sourceStableDuringProof'] and browser['sources'] == browser['sourcesFinal']
    assert all(frozen[p] == expected for p, expected in browser['sources'].items())
    visual = load(args.visual)
    assert visual['ok'] and visual['browserReport'] == args.browser
    for image in visual['screenshots']:
        image_path = (OUT / image['file']).resolve()
        assert image_path.is_relative_to(OUT) and image['personallyViewed'] and sha(image_path) == image['sha256']
    web = load('web-validation.json')
    assert web['ok'] and web['finalManifest']['sha256'] == final['manifestSha256']
    assert all(frozen[p] == expected for p, expected in web['sourceHashes'].items())
    assert web['browser']['path'] == args.browser and web['browser']['sha256'] == sha(OUT / args.browser)
    assert web['ui']['failed'] == web['i18n']['failed'] == web['combinedFocused']['failed'] == 0
    legacy_browsers = []
    for receipt in web['legacyBrowsers']:
        report = load(receipt['path'])
        assert receipt['ok'] and receipt['sha256'] == sha(OUT / receipt['path'])
        assert report.get('ok') is True or report.get('status') == 'passed'
        assert len(report['steps']) == receipt['workflows'] and not report['errors']
        assert report['sourceStableDuringProof'] and report['sources'] == report['sourcesFinal']
        assert all(frozen[p] == expected for p, expected in report['sources'].items())
        legacy_browsers.append({'report': receipt['path'], 'sha256': receipt['sha256'],
            'flowClasses': len(report['steps']), 'sourceStableDuringProof': True,
            'runtimeErrors': 0, 'cspMonitoringPresent': 'cspViolations' in report,
            'svgMonitoringPresent': 'svgRequests' in report})
    independent_visual = load('visual-review-independent.json')
    assert independent_visual['ok'] and independent_visual['finalManifestSha256'] == final['manifestSha256']
    assert independent_visual['canonicalOwnerReportSha256'] == sha(OUT / args.visual)
    for image in independent_visual['screenshots']:
        assert image['personallyViewed'] and sha(OUT / image['file']) == image['sha256']
    prepared = load(args.prepared)
    assert prepared['ok'] and prepared['frozenSource']['manifestSha256'] == phase['initialManifest']['sha256']
    assert phase['prepared']['report'] == args.prepared and phase['prepared']['sha256'] == sha(OUT / args.prepared)
    assert phase['prepared']['initialFrozenManifestSha256'] == phase['initialManifest']['sha256']
    assert phase['prepared']['allMappedSourceAndInventoryBytesStillMatch'] and not phase['prepared']['freshPortableRerunClaim']
    for p, expected in prepared['sourceHashes'].items():
        assert (ROOT / p).is_file() and sha(ROOT / p) == expected
        if p in frozen: assert frozen[p] == expected
    copies = {}
    for path, report in prepared['artifacts'].items():
        base = ROOT / path
        assert not any(item.is_symlink() for item in base.rglob('*'))
        files = {item.relative_to(base).as_posix(): item for item in base.rglob('*') if item.is_file()}
        assert set(files) == set(report['manifest'])
        for relative, item in files.items():
            assert sha(item) == report['manifest'][relative]['sha256'] and item.stat().st_size == report['manifest'][relative]['bytes']
        copies[path] = len(files)
    portable = prepared['portable']
    assert portable['desktop'] == portable['mobile']
    groups = sum(len(value) for value in portable['desktop'].values() if isinstance(value, list)) * 2
    assert groups >= 288
    related_start = load('related-check-start.json')
    assert related_start['sourceManifestSha256'] == phase['initialManifest']['sha256']
    assert related_start['node'] == 'v24.20.0' and related_start['version'] == '0.0.10'
    assert related_start['tests'] and all(p in frozen for p in related_start['tests'])
    assert all(p in frozen for p in related_start['syntaxFiles'])
    assert all(initial[p] == frozen[p] for p in related_start['tests'])
    assert phase['relatedChecks']['log'] == args.related_log
    assert sha(OUT / args.related_log) == phase['relatedChecks']['sha256']
    assert sha(OUT / phase['relatedChecks']['start']) == phase['relatedChecks']['startSha256']
    assert phase['relatedChecks']['allExecutedTestAndProductBytesUnchanged'] and not phase['relatedChecks']['freshRerunClaim']
    app_text = (OUT / args.related_log).read_text()
    rows = re.findall(r'^\s*ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$', app_text, re.M)
    assert len(rows) == 6
    counts = {key: int(value) for key, value in rows}
    assert counts['tests'] > 0 and counts['tests'] == counts['pass']
    assert all(counts[key] == 0 for key in ['fail', 'cancelled', 'skipped', 'todo'])
    assert counts == phase['relatedChecks']['counts'] and len(related_start['tests']) == phase['relatedChecks']['testFiles']
    duration = re.findall(r'^\s*ℹ duration_ms ([\d.]+)\s*$', app_text, re.M)
    related_checks = {'report': args.related_log, 'sha256': sha(OUT / args.related_log), 'counts': counts,
        'durationMs': float(duration[0]) if duration else None, 'files': related_start['tests'],
        'fileCount': len(related_start['tests']), 'javascriptSyntaxFiles': related_start['syntaxFiles'],
        'javascriptSyntaxCount': len(related_start['syntaxFiles']), 'versionAndApiPreflight': True,
        'startReport': 'related-check-start.json', 'startSha256': sha(OUT / 'related-check-start.json'),
        'scope': related_start['scope'], 'notFullApplicationOrNativeExecution': True,
        'actualExecutionManifestSha256': phase['initialManifest']['sha256'],
        'finalBindingPhase': args.phase, 'productAndTestBytesUnchanged': True, 'freshRerunClaim': False}
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    version = (ROOT / 'VERSION').read_text().strip()
    assert head == baseline['head'] and version == '0.0.10'
    now = datetime.now(timezone.utc).isoformat()
    review = {'format': 'viento-scene3d-selection-feedback-independent-review', 'schemaVersion': 1, 'createdAt': now,
        'ok': True, 'openFindings': [], 'head': head, 'version': version, 'finalSourceFreeze': final, 'sourceDelta': delta,
        'sourcePhaseConfirmation': {'report': args.phase, 'sha256': sha(OUT / args.phase), 'details': phase},
        'sourceChangeScope': {'changedProductOrTests': [p for p in delta['changed'] if p != 'engine/README.md'],
            'documentationOnly': [p for p in delta['changed'] if p == 'engine/README.md'],
            'nativeEngineHostAuthoringAndMathUnchanged': True},
        'reviewedSources': {p: frozen[p] for p in ['web/modules/scene3d-picking.js', 'web/modules/scene3d-renderer.js',
            'web/modules/app-scene3d-preview.js', 'web/modules/app-runtime.js', 'web/modules/app-studio-system.js',
            'engine/scene3d-navigation.mjs', 'web/modules/scene3d-math.js']},
        'independent': {'quality': {'report': args.quality, 'sha256': sha(OUT / args.quality),
            'passed': 23, 'failed': 0, 'counts': quality['counts'], 'scope': quality['scope'],
            'additionalSelectionGeometricSamples': 504}},
        'renderer': {'report': args.renderer, 'sha256': sha(OUT / args.renderer), 'details': renderer},
        'browser': {'report': args.browser, 'sha256': sha(OUT / args.browser), 'flowClasses': len(browser['steps']),
            'sourceStableDuringProof': True, 'errors': 0, 'cspViolations': 0, 'screenshots': visual['screenshots']},
        'visualReview': {'canonicalReport': args.visual, 'canonicalSha256': sha(OUT / args.visual),
            'ownerViewedImages': len(visual['screenshots']),
            'independentReport': 'visual-review-independent.json', 'independentReportSha256': sha(OUT / 'visual-review-independent.json'),
            'independentlyViewedImages': len(independent_visual['screenshots'])},
        'web': {'report': 'web-validation.json', 'sha256': sha(OUT / 'web-validation.json'),
            'ui': web['ui'], 'i18n': web['i18n'], 'combinedFocused': web['combinedFocused'],
            'legacyBrowsers': legacy_browsers},
        'prepared': {'report': args.prepared, 'sha256': sha(OUT / args.prepared), 'groups': groups, 'files': copies,
            'actualExecutionManifestSha256': phase['initialManifest']['sha256'], 'finalPhaseSourceAndInventoryMatch': True,
            'freshPortableRerunClaim': False, 'portabilityOnly': True, 'notSecuritySandboxOrInstallation': True}, 'relatedChecks': related_checks,
        'contracts': [
            'The renderer consumes a current stable UUID or null only; there is no source proposal, write or Save port.',
            'Selection uses a boolean uniform inside the same 36-vertex per-box entity pass, original Float32 geometry, LEQUAL depth and source order. It does not inflate, reorder or create X-ray geometry.',
            'The fragment face coordinates highlight the twelve physical box edges, not triangle diagonals or a synthetic near-plane cap. Occluded portions have no through-wall selection rendering.',
            'Only private selection-only redraw may retain the old picking frame, and only after equal pre-draw backing allocation, CSS size, actual Float32 viewProjection/model matrices and full source-ordered UUID checks.',
            'Public redraw, changed allocation/size/camera/model still invalidate the old gesture frame. Position-only movement remaps current client coordinates; pending or approved gestures remain tied to their captured position.',
            'The same UUID or null is a no-draw success; invalid/unknown/unloaded/lost-context/disposed requests are false unchanged. Reset retains selection; setModel and dispose clear it.',
            'UI selection remains the sole UUID state shared by list and canvas. Filters and language changes retain selection without invoking the GPU setter; each admitted new model synchronizes it again.',
            'Last-valid visual selection is allowed after a source token change while strict source location retains exact snapshot guards. Host/native/schema/backend/authoring authority are unchanged.'],
        'resolvedFindings': [],
        'limitations': ['Geometric visible-face selection is not antialias-edge or hardware depth-buffer quantization parity.',
            'Independent renderer proof uses a WebGL uniform/event fixture; browser evidence is separately bound and is not installed/device acceptance.',
            'Flat boxes and view-only feedback only; no hierarchy/material/assets/new schema/native semantics/backend or authoring authority change. No fresh Rust/native acceptance is claimed by this independent slice.',
            'Prepared isolated VM proves portability, not hostile-code sandboxing. All earlier reports and failures remain immutable.']}
    preservation = {'format': 'viento-scene3d-selection-feedback-independent-preservation', 'schemaVersion': 1, 'createdAt': now,
        'ok': True, 'openFindings': [], 'finalSourceFreeze': final,
        'baseline': {'report': 'baseline.json', 'sha256': sha(OUT / 'baseline.json')}, 'preserved': preserved,
        'sourceDelta': delta, 'head': head, 'version': version, 'generatedInitiallyAbsent': load('generated-paths-initial.json'),
        'scope': 'Independent read-only pre-cleanup source/history/author/tool/native/host/atlas/copied-resource audit. No build, cleanup, install, version or publication action.'}
    write_new('review.json', review)
    write_new('preservation-audit-before-cleanup.json', preservation)
    print(json.dumps({'ok': True, 'sourceFiles': len(frozen), 'manifestSha256': final['manifestSha256'],
        'historical': 4417, 'authors': 41, 'tools': 4, 'relatedTests': counts['tests'], 'relatedTestFiles': len(related_start['tests']), 'preparedGroups': groups,
        'browserFlows': len(browser['steps']), 'independentQualityGroups': 23, 'selectionSubconditions': quality['counts']['selectionScenarios']}))

if __name__ == '__main__':
    main()
