"""Close NEW selection feedback evidence from completed, immutable proofs."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def load(name):
    return json.loads((OUT / name).read_text())


def write_new(name, value):
    with (OUT / name).open('x') as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def main():
    initial, current = load('source-hashes-final.json'), load('source-hashes-confirmed.json')
    assert len(current) == 727 and all(sha(ROOT / p) == digest for p, digest in current.items())
    phase = load('source-phase-confirmation.json')
    assert phase['ok'] and phase['confirmedManifest']['sha256'] == sha(OUT / 'source-hashes-confirmed.json')
    assert {p for p in initial if initial[p] != current[p]} == set(phase['onlyChangedBrowserHarnesses'])
    log = (OUT / 'related-check.log').read_text()
    rows = re.findall(r'^\s*ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$', log, re.M)
    assert len(rows) == 6
    counts = {key: int(value) for key, value in rows}
    assert counts['tests'] == counts['pass'] == 442
    assert all(counts[k] == 0 for k in ['fail', 'cancelled', 'skipped', 'todo'])
    start = load('related-check-start.json')
    assert len(start['tests']) == 29 and len(start['syntaxFiles']) == 9
    assert all(initial[p] == current[p] for p in start['tests'])
    duration = float(re.search(r'^\s*ℹ duration_ms ([\d.]+)\s*$', log, re.M)[1])
    related = {'log': 'related-check.log', 'sha256': sha(OUT / 'related-check.log'), 'counts': counts,
               'durationMs': duration, 'testFiles': len(start['tests']), 'initialSyntaxFiles': len(start['syntaxFiles']),
               'executedManifestSha256': start['sourceManifestSha256'],
               'allExecutedTestsAndProductBytesUnchangedAtConfirmedManifest': True,
               'sourcePhaseConfirmation': 'source-phase-confirmation.json'}
    renderer = load('renderer-results.json')
    quality = load('quality-initial.json')
    prepared = load('packaged-resources.json')
    web = load('web-validation.json')
    review = load('review.json')
    preservation = load('preservation-audit-before-cleanup.json')
    cleanup = load('cleanup.json')
    assert all(value['ok'] for value in [renderer, quality, prepared, web, review, preservation, cleanup])
    assert not review['openFindings'] and not preservation['openFindings']
    assert quality['passed'] == 23 and not quality['failed']
    assert web['combinedFocused']['total'] == 196
    assert cleanup['sourceManifestSha256'] == sha(OUT / 'source-hashes-confirmed.json')
    portable_count = sum(len(v) for v in prepared['portable']['desktop'].values() if isinstance(v, list)) * 2
    assert portable_count == 298
    timing = {'format': 'viento-scene3d-selection-feedback-application-timing', 'schemaVersion': 1,
        'recordedAt': datetime.now(timezone.utc).isoformat(), 'ok': True,
        'relatedChecks': related, 'sourcePhases': phase,
        'browserProducerRepair': load('producer-fix.json'),
        'firstBrowser': {'report': 'browser-selection-initial/browser.json',
                         'sha256': sha(OUT / 'browser-selection-initial/browser.json'),
                         'scope': 'Initial eight completed flows followed by a wrong near-clipping pixel expectation. Report, screenshots and exact producer snapshots retained.'},
        'productRepairForBrowserFailure': False,
        'reason': 'The existing renderer draws both sides. The test originally expected a farther object after clipping the front surface; the actual box back surface is valid. Final test compares the same near-clipped model before/after selection. Orbit/focus/reset pixels compare the same selected UUID and camera.',
        'notRerun': {'fullApplication': {'priorReport': '../scene3d-picking/results.json', 'priorPassed': 3421},
                     'rust': {'priorReport': '../scene3d-navigation/rust-tests.log', 'priorPassed': 234},
                     'nativeCliAndBackend': True},
        'scope': 'Current related29 files, actual browser and copied modules are fresh slice proofs. Focused counts overlap related442. After first execution, only two browser producers changed; static syntax and source/inventory phase confirmation are fresh, while previous product tests and portable execution retain their real dates. No invented full/Rust/device/install rerun.'}
    write_new('application-timing.json', timing)
    baseline = load('baseline.json')
    result = {'format': 'viento-scene3d-selection-feedback-results', 'schemaVersion': 1,
        'createdAt': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'ok': True,
        'version': baseline['version'], 'publishedBase': baseline['head'],
        'delivery': 'Unpublished working tree after 0.0.10. No new commit, push, installation or Android-device acceptance.',
        'features': ['Stable-UUID canvas/list selection controls a pale-and-dark physical-edge band on the existing box surfaces.',
                     'Original one-pass geometry, actual Float32 projection, depth, clipping and source declaration order stay unchanged; no triangle diagonals, clipping caps or x-ray outlines.',
                     'Selection-only drawing preserves qualified native double-click on identical geometry; model/camera/size/backing changes retain normal invalidation.',
                     'Filtering, reset, last-valid source and refresh/deletion use the existing independent UI selection and guarded source locator.'],
        'sourceFreeze': {'manifest': 'source-hashes-confirmed.json', 'sha256': sha(OUT / 'source-hashes-confirmed.json'), 'files': 727, 'allMatch': True},
        'relatedChecks': related,
        'newTests': {'renderer': 9, 'previewUi': 9, 'total': 18, 'overlapRelatedChecks': True},
        'focused': {'renderer': {'report': 'renderer-results.json', 'passed': 67},
                    'uiAndLocales': web['combinedFocused'],
                    'independent': {'report': 'quality-initial.json', 'passed': 23, 'counts': quality['counts']}},
        'browser': web['browser'], 'legacyBrowsers': web['legacyBrowsers'],
        'visual': web['visualReview'],
        'prepared': {'report': 'packaged-resources.json', 'sha256': sha(OUT / 'packaged-resources.json'),
                     'groups': portable_count, 'groupsEach': portable_count // 2,
                     'oldGroupsPreserved': 288,
                     'inventory': {p: len(v['manifest']) for p, v in prepared['artifacts'].items()},
                     'modulesEach': {p: v['moduleCount'] for p, v in prepared['portable'].items()},
                     'executedManifestSha256': prepared['frozenSource']['manifestSha256'],
                     'confirmedPhase': 'source-phase-confirmation.json',
                     'scope': 'Standard VM with injected canvas/WebGL spy: actual copied renderer interfaces, draws, uniforms, lifetime and frame ownership. No real shader compilation or pixel/device claim from this fixture.'},
        'preservation': {'historicalReports': baseline['historicalFiles'], 'authorFiles': 41, 'externalTools': 4,
                         'report': 'preservation-audit-before-cleanup.json',
                         'nativeEngineHostSchemaMathPickerAndBackendUnchanged': True},
        'cleanup': {'report': 'cleanup.json', 'sha256': sha(OUT / 'cleanup.json'),
                    'allocatedFileBytesRemoved': cleanup['allocatedFileBytesRemoved'],
                    'allocatedGiBRemoved': cleanup['allocatedFileBytesRemoved'] / 1024 ** 3,
                    'exactPaths': [v['path'] for v in cleanup['removed']]},
        'review': {'report': 'review.json', 'sha256': sha(OUT / 'review.json'), 'openFindings': []},
        'limitations': ['Approximate derivative-based physical-edge width; extremely small/thin boxes may have no distinguishable interior.',
                        'Hidden and clipped selection is represented by list/inspector/focus; no x-ray or pixel-ID parity guarantee.',
                        'Chrome software SwiftShader and copied VM are not installed desktop, Android device, hardware GPU or execution-backend acceptance.'],
        'closingAtlas': 'Final append-only atlas, old score preservation, local-reference and post-cleanup current-source checks are reported separately.'}
    write_new('results.json', result)
    print(json.dumps({'ok': True, 'relatedTests': 442, 'testFiles': 29, 'portableGroups': portable_count,
                      'allocatedGiBRemoved': result['cleanup']['allocatedGiBRemoved']}))


if __name__ == '__main__':
    main()
