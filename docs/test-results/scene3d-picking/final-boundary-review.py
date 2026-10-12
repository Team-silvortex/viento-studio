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
    parser.add_argument('--manifest', default='source-hashes-final.json')
    parser.add_argument('--browser', required=True)
    parser.add_argument('--prepared', default='packaged-resources.json')
    parser.add_argument('--app-log', default='app-check.log')
    parser.add_argument('--quality', default='quality-confirmed.json')
    parser.add_argument('--renderer', default='renderer-results.json')
    args = parser.parse_args()
    assert not (OUT / 'review.json').exists() and not (OUT / 'preservation-audit-before-cleanup.json').exists()
    baseline = load('baseline.json')
    frozen = load(args.manifest)
    previous = load('source-baseline.json')
    assert len(previous) == 723 and len(frozen) == 726
    assert set(previous) <= set(frozen)
    missing = [p for p in frozen if not (ROOT / p).is_file()]
    drift = [p for p, expected in frozen.items() if (ROOT / p).is_file() and sha(ROOT / p) != expected]
    assert not missing and not drift, {'missing': missing, 'drift': drift}
    delta = {'added': sorted(set(frozen) - set(previous)),
             'changed': sorted(p for p in previous if previous[p] != frozen[p]), 'removed': []}
    assert set(delta['added']) == {'web/modules/scene3d-picking.js', 'scripts/tests/scene3d-picking.test.mjs',
                                  'scripts/tests/scene3d-picking-smoke.mjs'}
    allowed_changed = {'web/modules/scene3d-renderer.js', 'scripts/tests/scene3d-renderer.test.mjs',
                       'web/modules/app-scene3d-preview.js', 'scripts/tests/scene3d-preview-ui.test.mjs',
                       'web/i18n/en.js', 'web/i18n/ja.js', 'engine/README.md'}
    assert set(delta['changed']) <= allowed_changed, delta
    final = {'manifest': args.manifest, 'manifestSha256': sha(OUT / args.manifest), 'files': len(frozen),
             'allMatch': True, 'missing': [], 'drift': []}
    preserved = {}
    for key, name, expected_count in [('historical', 'historical-baseline.json', 4319), ('authors', 'author-baseline.json', 41)]:
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
                          'web/modules/scene3d-math.js'}]
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
    extreme = load('extreme-frame-final.json')
    assert quality['ok'] and quality['passed'] == 12 and quality['failed'] == 0 and quality['sourceStable']
    assert extreme['ok'] and extreme['passed'] == 18 and extreme['sourceStable']
    for report in [quality, extreme]:
        assert report['sources'] == report['endSources']
        assert all(frozen[p] == expected for p, expected in report['sources'].items())
    renderer = load(args.renderer)
    assert renderer.get('status') == 'passed' or renderer.get('ok') is True
    for path, evidence in renderer['sources'].items():
        assert frozen[path] == evidence['sha256'] and (ROOT / path).stat().st_size == evidence['bytes']
    assert frozen[renderer['unchangedMath']['path']] == renderer['unchangedMath']['sha256']
    assert sha(OUT / renderer['tests']['log']) == renderer['tests']['logSha256']
    assert renderer['tests']['failed'] == renderer['tests']['skipped'] == renderer['tests']['cancelled'] == 0
    assert renderer['independentQuality']['sha256'] == sha(OUT / args.quality)
    browser = load(args.browser)
    assert browser['ok'] and browser['steps'] and not browser['errors']
    assert not browser.get('cspViolations', []) and not browser.get('svgRequests', [])
    assert browser['sourceStableDuringProof'] and browser['sources'] == browser['sourcesFinal']
    assert all(frozen[p] == expected for p, expected in browser['sources'].items())
    visual = load('visual-review-final.json')
    assert visual['ok'] and visual['browserReport'] == args.browser
    for image in visual['screenshots']:
        image_path = (OUT / image['file']).resolve()
        assert image_path.is_relative_to(OUT) and image['personallyViewed'] and sha(image_path) == image['sha256']
    independent_visual = load('independent-visual-supplement.json')
    assert independent_visual['ok'] and independent_visual['canonicalVisualReportSha256'] == sha(OUT / 'visual-review-final.json')
    prepared = load(args.prepared)
    assert prepared['ok'] and prepared['frozenSource']['manifestSha256'] == final['manifestSha256']
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
    assert groups >= 272
    app_text = (OUT / args.app_log).read_text()
    rows = re.findall(r'^\s*ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$', app_text, re.M)
    assert len(rows) == 6
    counts = {key: int(value) for key, value in rows}
    assert counts['tests'] >= 3381 and counts['tests'] == counts['pass']
    assert all(counts[key] == 0 for key in ['fail', 'cancelled', 'skipped', 'todo'])
    duration = re.findall(r'^\s*ℹ duration_ms ([\d.]+)\s*$', app_text, re.M)
    application = {'report': args.app_log, 'sha256': sha(OUT / args.app_log), 'counts': counts,
                   'durationMs': float(duration[0]) if duration else None}
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    version = (ROOT / 'VERSION').read_text().strip()
    assert head == baseline['head'] and version == '0.0.10'
    now = datetime.now(timezone.utc).isoformat()
    review = {'format': 'viento-scene3d-picking-independent-review', 'schemaVersion': 1, 'createdAt': now,
        'ok': True, 'openFindings': [], 'head': head, 'version': version, 'finalSourceFreeze': final, 'sourceDelta': delta,
        'sourceChangeScope': {'changedProductOrTests': [p for p in delta['changed'] if p != 'engine/README.md'],
            'documentationOnly': [p for p in delta['changed'] if p == 'engine/README.md'],
            'nativeEngineHostAuthoringAndMathUnchanged': True},
        'reviewedSources': {p: frozen[p] for p in ['web/modules/scene3d-picking.js', 'web/modules/scene3d-renderer.js',
            'web/modules/app-scene3d-preview.js', 'web/modules/app-runtime.js', 'web/modules/app-studio-system.js',
            'engine/scene3d-navigation.mjs', 'web/modules/scene3d-math.js']},
        'independent': {'quality': {'report': args.quality, 'sha256': sha(OUT / args.quality),
            'passed': 12, 'failed': 0, 'counts': quality['counts'], 'scope': quality['scope']},
            'extremeFrame': {'report': 'extreme-frame-final.json', 'sha256': sha(OUT / 'extreme-frame-final.json'),
            'passed': 18, 'failed': 0, 'scope': extreme['scope']}},
        'renderer': {'report': args.renderer, 'sha256': sha(OUT / args.renderer), 'details': renderer},
        'browser': {'report': args.browser, 'sha256': sha(OUT / args.browser), 'flowClasses': len(browser['steps']),
            'sourceStableDuringProof': True, 'errors': 0, 'cspViolations': 0, 'screenshots': visual['screenshots']},
        'visualReview': {'canonicalReport': 'visual-review-final.json', 'canonicalSha256': sha(OUT / 'visual-review-final.json'),
            'canonicalOwnerViewedImages': len(visual['screenshots']), 'independentSupplement': 'independent-visual-supplement.json',
            'independentSupplementSha256': sha(OUT / 'independent-visual-supplement.json'),
            'independentlyViewedImages': len(independent_visual['screenshots'])},
        'prepared': {'report': args.prepared, 'sha256': sha(OUT / args.prepared), 'groups': groups, 'files': copies,
            'portabilityOnly': True, 'notSecuritySandboxOrInstallation': True}, 'application': application,
        'contracts': ['The pure hit helper consumes geometry and uploaded matrix payloads; it does not parse or mutate source.',
            'Picking uses the current CSS client rect with the actual last-drawn allocation, floating origin and Float32 matrices.',
            'Only actual box entry/exit surfaces inside the clip volume can win; near clipping never invents a cap. Exact equal depth chooses the later declaration under LEQUAL.',
            'Single click selects a stable UUID. Native double-click may invoke the existing temporary focus; misses retain selection and filter.',
            'Drag/cancel/other pointer/unexpected capture loss/resize/wheel/model replacement/context loss/dispose revoke click or double-click eligibility. Expected pointerup release/capture loss preserves a qualified recent tap for native double-click.',
            'Position-only scrolling remaps current CSS coordinates without a redraw. Movement during an ongoing gesture or between its approved tap and double-click revokes that old gesture owner.',
            'The preview validates current renderer/canvas/model membership and active source path without adding any source write or Save port.',
            'Last-valid visual selection and focus remain available after the token changes; source location retains its stricter exact-snapshot owner guard.'],
        'resolvedFindings': [{'finding': 'A secondary pointer was ignored and left the first pointer click and old tap eligible.',
            'initialProof': 'quality-initial.json', 'resolution': 'Other-pointer/button down cancels gesture and tap; repaired independent proof passes.'},
            {'finding': 'Position-only scrolling incorrectly invalidated every hit until a redraw.',
            'initialProof': 'quality-scroll-initial.json', 'resolution': 'Current CSS position remaps the unchanged frame; ongoing and saved gestures bind position and cancel across movement.'}],
        'limitations': ['Geometric visible-face selection is not antialias-edge or hardware depth-buffer quantization parity.',
            'Independent renderer proof uses a WebGL uniform/event fixture; browser evidence is separately bound and is not installed/device acceptance.',
            'Flat boxes only; no hierarchy/material/assets/new schema/native semantics/backend or authoring authority change.',
            'Prepared isolated VM proves portability, not hostile-code sandboxing. All earlier reports and failures remain immutable.']}
    preservation = {'format': 'viento-scene3d-picking-independent-preservation', 'schemaVersion': 1, 'createdAt': now,
        'ok': True, 'openFindings': [], 'finalSourceFreeze': final,
        'baseline': {'report': 'baseline.json', 'sha256': sha(OUT / 'baseline.json')}, 'preserved': preserved,
        'sourceDelta': delta, 'head': head, 'version': version, 'generatedInitiallyAbsent': load('generated-paths-initial.json'),
        'scope': 'Independent read-only pre-cleanup source/history/author/tool/native/host/atlas/copied-resource audit. No build, cleanup, install, version or publication action.'}
    write_new('review.json', review)
    write_new('preservation-audit-before-cleanup.json', preservation)
    print(json.dumps({'ok': True, 'sourceFiles': len(frozen), 'manifestSha256': final['manifestSha256'],
        'historical': 4319, 'authors': 41, 'tools': 4, 'appTests': counts['tests'], 'preparedGroups': groups,
        'browserFlows': len(browser['steps']), 'independentQualityGroups': 12, 'extremeFrameCases': 18}))

if __name__ == '__main__':
    main()
