#!/usr/bin/env python3
"""Run after actual final root browser/full/copied proof completion.

Only NEW isolated-stage review files are created. Original checkout and old
reports are read-only. These receipts do not authorize or claim checkout apply.
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
STAGE = OUT.parents[2]

def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def load(name):
    path = (OUT / name).resolve(strict=True)
    assert path.is_relative_to(OUT)
    return json.loads(path.read_text())

def suite(name):
    text = (OUT / name).read_text()
    rows = re.findall(r'^\s*ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$', text, re.M)
    assert len(rows) == 6, f'Exactly one actual completed suite required: {name}'
    counts = {key: int(value) for key, value in rows}
    assert counts['tests'] > 0 and counts['tests'] == counts['pass']
    assert not any(counts[key] for key in ['fail', 'cancelled', 'skipped', 'todo'])
    duration = re.findall(r'^\s*ℹ duration_ms ([\d.]+)\s*$', text, re.M)
    return {'report': name, 'sha256': sha(OUT / name), 'counts': counts,
            'durationMs': float(duration[0]) if duration else None}

def exact_baseline(directory, filename, count):
    baseline = load(filename)
    changed = [path for path, digest in baseline.items()
               if not (directory / path).is_file() or sha(directory / path) != digest]
    assert len(baseline) == count and not changed, (directory, filename, changed)
    return {'files': count, 'baselineSha256': sha(OUT / filename), 'changed': [], 'allByteShaMatch': True}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', default='source-hashes-final.json')
    parser.add_argument('--prepared', default='packaged-resources.json')
    parser.add_argument('--confirmation', default='prepared-final-binding.json')
    parser.add_argument('--browser', default='browser-copy/browser.json')
    parser.add_argument('--app-log', default='application-checks.log')
    parser.add_argument('--app-manifest', default='source-hashes-final.json')
    parser.add_argument('--visual', default='visual-review-independent.json')
    args = parser.parse_args()
    assert not any((OUT / name).exists() for name in ['stage-review.json', 'stage-preservation.json'])
    baseline = load('baseline.json'); original = Path(baseline['sourceRoot'])
    assert STAGE == Path(baseline['stageRoot'])
    frozen = load(args.manifest); before = load('source-baseline.json')
    assert len(frozen) == 767 and len(before) == 757 and set(before) <= set(frozen)
    assert all(sha(STAGE / path) == digest for path, digest in frozen.items())
    final = {'manifest': args.manifest, 'manifestSha256': sha(OUT / args.manifest),
             'files': len(frozen), 'allMatch': True, 'sourceRoot': str(STAGE)}
    initial = load('source-hashes-final.json')
    assert set(initial) == set(frozen)
    confirmed_delta = {path: {'before': initial[path], 'after': frozen[path]}
                       for path in initial if initial[path] != frozen[path]}
    assert not confirmed_delta, 'This round has one frozen phase'
    executed = load(args.app_manifest)
    assert set(executed) == set(frozen)
    executed_delta = {path: {'before': executed[path], 'after': frozen[path]}
                      for path in executed if executed[path] != frozen[path]}
    assert not executed_delta, 'Actual full suite consumed the same frozen phase'
    ready = load('implementation-ready.json')
    assert ready['ok'] and ready['actualApplyPerformed'] is False
    first_freeze = {'protectedUnchanged': [path for path in before if before[path] == frozen[path]]}
    additions = sorted(set(frozen) - set(before))
    changes = [path for path in before if before[path] != frozen[path]]
    assert len(additions) == 10
    assert set(additions + changes) <= {item['path'] for item in ready['files']}
    assert all(before[path] == frozen[path] for path in first_freeze['protectedUnchanged'])
    required_protected = [path for path in before if path.startswith(('schemas/', 'scripts/backends/', 'web/modules/scene3d-', 'crates/viento-studio-core/src/')) and path != 'crates/viento-studio-core/src/lib.rs']
    assert all(before[path] == frozen[path] for path in required_protected)
    for path in ['engine/scene3d.mjs', 'engine/scene3d-transform.mjs', 'engine/scene3d-objects.mjs', 'engine/scene3d-environment.mjs', 'engine/scene3d-properties.mjs', 'engine/scene3d-translation.mjs', 'engine/scene3d-alignment.mjs', 'engine/scene3d-distribution.mjs', 'engine/scene3d-authoring.mjs']:
        assert before[path] == frozen[path]
    actual_preserved = {'source': exact_baseline(original, 'source-baseline.json', 757),
                        'historical': exact_baseline(original, 'historical-baseline.json', 5075),
                        'authors': exact_baseline(original, 'author-baseline.json', 41)}
    stage_preserved = {'historical': exact_baseline(STAGE, 'historical-baseline.json', 5075),
                       'authors': exact_baseline(STAGE, 'author-baseline.json', 41)}
    tools = {}
    for path, expected in load('tool-baseline.json').items():
        file = Path(path); metadata = file.lstat()
        assert stat.S_ISREG(metadata.st_mode)
        actual = {'sha256': sha(file), 'bytes': metadata.st_size, 'dev': metadata.st_dev,
                  'ino': metadata.st_ino, 'nlink': metadata.st_nlink}
        assert actual == expected, path
        tools[path] = actual
    assert len(tools) == 4
    tool_receipt = {'files': 4, 'changed': [], 'baselineSha256': sha(OUT / 'tool-baseline.json'),
                    'byteShaSizeDevInoAndNlinkMatch': True, 'actual': tools}
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=original, text=True).strip()
    assert head == baseline['head'] and (original / 'VERSION').read_text().strip() == (STAGE / 'VERSION').read_text().strip() == '0.0.10'
    old_atlas = load('atlas-baseline.json')
    actual_atlas = json.loads((original / 'docs/function-atlas.json').read_text())
    assert actual_atlas == old_atlas
    stage_atlas = json.loads((STAGE / 'docs/function-atlas.json').read_text())
    prefix = {'axes.' + key: stage_atlas['axes'][key][:len(value)] == value for key, value in old_atlas['axes'].items()}
    for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']:
        prefix[key] = stage_atlas[key][:len(old_atlas[key])] == old_atlas[key]
    assert all(prefix.values())
    assert stage_atlas['meta']['historicalSha256'] == old_atlas['meta']['historicalSha256']
    quality, ui_quality = load('quality-initial.json'), load('ui-quality-initial.json')
    assert quality['ok'] and quality['passed'] == 15 and quality['failed'] == 0 and quality['sourceStable']
    assert quality['sources'] == quality['endSources'] and all(frozen[path] == digest for path, digest in quality['sources'].items())
    assert ui_quality['ok'] and ui_quality['passed'] == 7 and ui_quality['failed'] == 0 and ui_quality['prohibitedApplyRequests'] == 0
    assert ui_quality['source']['stable'] and frozen[ui_quality['source']['path']] == ui_quality['source']['beforeSha256'] == ui_quality['source']['endSha256']
    assert quality['counts']['nativeParityRequests'] == 23 and quality['counts']['forgedReceipts'] == 28
    assert quality['counts']['oldOperations'] == 7 and quality['counts']['pairwiseBrandDirections'] == 14
    core = load('core-results.json')
    assert core['ok'] and core['native']['totalPassed'] == 290 and core['newJavaScript']['totalPassed'] == 29
    assert core['regression']['pass'] == 407 and core['newJavaScript']['nativeWasmParityRequests'] == 19
    assert all(frozen[path] == item['sha256'] for path, item in core['sources'].items())
    for name, item in core['logs'].items():
        assert sha(OUT / name) == item['sha256']
    assert suite('core-js-tests-initial.log')['counts']['tests'] == 29
    assert suite('core-regression.log')['counts']['tests'] == 407
    rust = (OUT / 'core-native-tests-initial.log').read_text()
    passed = [int(value) for value in re.findall(r'test result: ok\. (\d+) passed;', rust)]
    assert passed[0] == 241 and sum(passed[1:]) == 49 and sum(passed) == 290
    assert not any(int(value) for value in re.findall(r'test result: ok\. \d+ passed; (\d+) failed;', rust))
    assert sha(Path(core['native']['cli']['path'])) == core['native']['cli']['sha256'] == quality['native']['beforeSha256'] == quality['native']['endSha256']
    assert (STAGE / 'engine/studio-core.wasm').stat().st_size == 589027
    assert frozen['engine/studio-core.wasm'] == quality['wasm']['sha256'] == core['wasm']['sha256']
    assert sha(OUT / 'previous-studio-core.wasm') == before['engine/studio-core.wasm'] == core['wasm']['previousProof']['sha256']
    assert sha(OUT / 'previous-studio-core.build.json') == before['engine/studio-core.build.json']
    app = suite(args.app_log); ui = suite('ui-and-i18n-confirmed.log')
    module = suite('module-tests.log'); host = suite('host-tests.log')
    assert ui['counts']['tests'] == 82 and module['counts']['tests'] == 49 and host['counts']['tests'] == 6
    web = load('web-validation.json'); assert web['ok'] and web['actualCheckoutApplied'] is False
    assert web['finalSourceFreeze']['manifestSha256'] == final['manifestSha256']
    assert all(frozen[path] == digest for path, digest in web['sources'].items())
    assert web['ui']['counts'] == ui['counts']
    browser = load(args.browser)
    assert browser['ok'] and len(browser['steps']) == 8 and not browser['errors']
    assert browser['sourceStableDuringProof'] and browser['sources'] == browser['sourcesFinal']
    assert all(frozen[path] == digest for path, digest in browser['sources'].items())
    assert not browser.get('svgRequests', []) and not browser.get('cspViolations', [])
    visual = load(args.visual)
    assert visual['ok'] and not visual['openFindings'] and visual['browser']['report'] == args.browser
    assert len(visual['screenshots']) == 6
    for item in visual['screenshots']:
        path = (OUT / item['file']).resolve(strict=True)
        assert path.is_relative_to(OUT) and item['personallyViewed'] and sha(path) == item['sha256']
    prepared = load(args.prepared); confirmation = load(args.confirmation)
    assert prepared['ok'] and prepared['frozenSource']['manifestSha256'] == final['manifestSha256']
    assert confirmation['ok'] and confirmation['sourceManifestSha256'] == final['manifestSha256']
    assert confirmation['reportSha256'] == sha(OUT / args.prepared) and confirmation['cases'] == 362
    assert confirmation['allPriorCaseReceiptsDeepEqual'] and confirmation['oldCasesUnchanged'] == 346 and confirmation['newCases'] == 16
    portable = prepared['portable']; kinds = [key for key, value in portable['desktop'].items() if isinstance(value, list)]
    groups = sum(len(portable[side][kind]) for side in ['desktop', 'mobile'] for kind in kinds)
    assert groups == 362 and len(portable['desktop']['copy']) == len(portable['mobile']['copy']) == 8
    assert portable['desktop']['moduleCount'] == portable['mobile']['moduleCount'] == 107
    for side in ['desktop', 'mobile']:
        assert portable[side]['noNodeDomNetworkGlobals'] and portable[side]['noHostImports']
    assert all(portable['desktop'][kind] == portable['mobile'][kind] for kind in kinds)
    inventories = {}
    for name, item in prepared['artifacts'].items():
        directory = STAGE / name
        assert not any(path.is_symlink() for path in directory.rglob('*'))
        actual = {path.relative_to(directory).as_posix(): path for path in directory.rglob('*') if path.is_file()}
        assert set(actual) == set(item['manifest'])
        for path, file in actual.items():
            assert sha(file) == item['manifest'][path]['sha256'] and file.stat().st_size == item['manifest'][path]['bytes']
        inventories[name] = len(actual)
    assert inventories == {'desktop/resources': 575, 'mobile/dist': 256, 'desktop/ui': 11}
    for path, digest in prepared['sourceHashes'].items():
        assert sha(STAGE / path) == digest
        if path in frozen: assert frozen[path] == digest
    assert app['counts']['tests'] == 3752
    previous_prepared = json.loads((STAGE / 'docs/test-results/scene3d-distribution-authoring/packaged-resources.json').read_text())
    for side in ['desktop', 'mobile']:
        for kind, items in previous_prepared['portable'][side].items():
            if isinstance(items, list): assert portable[side][kind] == items, (side, kind)
    legacy = load('legacy-addon.json')
    assert legacy['ok'] and legacy['actualCheckoutApplied'] is False
    assert legacy['finalSourceFreeze']['manifestSha256'] == final['manifestSha256']
    for key in ['initialSummary', 'initialVisualReview']:
        item = legacy[key]; assert item['preserved'] and sha(OUT / item['path']) == item['sha256']
    legacy_reports = []
    for item in legacy['legacyBrowsers']:
        old_browser = load(item['path'])
        assert sha(OUT / item['path']) == item['sha256'] and old_browser['ok'] and not old_browser['errors']
        assert old_browser['sourceStableDuringProof'] and len(old_browser['steps']) == item['workflows']
        assert all(frozen[path] == digest for path, digest in old_browser['sources'].items())
        legacy_reports.append({'report': item['path'], 'sha256': item['sha256'], 'flowClasses': item['workflows'],
            'svgMonitoring': {'tracked': item['svgTracked'], 'count': item['svgRequests']},
            'cspMonitoring': {'tracked': item['cspTracked'], 'count': item['cspViolations']}})
    assert len(legacy_reports) == 4 and sum(item['flowClasses'] for item in legacy_reports) == 32
    assert legacy['actualBrowserWorkflows']['combinedDifferentScopes'] == 40
    registry = (STAGE / 'engine/studio-modules.mjs').read_text()
    assert 'org.viento.scene3d-copy' in registry and 'scene.authoring.copy3d' in registry
    created = datetime.now(timezone.utc).isoformat()
    common = {'schemaVersion': 1, 'createdAt': created, 'ok': True, 'openFindings': [],
              'head': head, 'version': '0.0.10', 'finalSourceFreeze': final,
              'executionScope': 'Isolated staged code/copies only; actual checkout byte exact. No checkout write, commit, push, installation or device acceptance claimed.'}
    review = {**common, 'format': 'viento-scene3d-copy-independent-stage-review',
        'reviewedSources': {path: frozen[path] for path in ['crates/viento-studio-core/src/lib.rs',
            'crates/viento-studio-core/src/scene3d_copy_patch.rs', 'engine/studio-core.mjs', 'engine/scene3d-copy.mjs',
            'engine/scene3d-authoring.mjs', 'engine/studio-modules.mjs', 'web/modules/app-runtime.js',
            'web/modules/app-studio-system.js', 'web/modules/app-scene3d-copy.js', 'web/scene3d-copy.css']},
        'independent': {'sourceNative': {'report': 'quality-initial.json', 'sha256': sha(OUT / 'quality-initial.json'),
            'passed': 15, 'failed': 0, 'counts': quality['counts']},
            'controller': {'report': 'ui-quality-initial.json', 'sha256': sha(OUT / 'ui-quality-initial.json'),
                           'passed': 7, 'failed': 0, 'writerRequests': 0}},
        'fullApplication': {**app, 'executedManifest': args.app_manifest,
            'executedManifestSha256': sha(OUT / args.app_manifest),
            'scope': 'Actual root execution with stage native helpers. Product and Node.test files remained unchanged; any later browser-producer-only correction is recorded separately and not falsely attributed to this suite. Focused counts are not added.'},
        'browser': {'report': args.browser, 'sha256': sha(OUT / args.browser), 'flowClasses': 8,
                    'boundSources': len(browser['sources']), 'sourceStableDuringProof': True,
                    'independentVisual': {'report': args.visual, 'sha256': sha(OUT / args.visual), 'personallyViewed': 6}},
        'legacyBrowserAddendum': {'report': 'legacy-addon.json', 'sha256': sha(OUT / 'legacy-addon.json'), 'proofs': legacy_reports, 'flows': 32, 'allSourcesMatch': True},
        'prepared': {'report': args.prepared, 'sha256': sha(OUT / args.prepared), 'groups': groups,
                     'inventory': inventories, 'modulesEach': 107, 'actualCurrentCopiedBytesMatch': True,
                     'scope': 'Standard VM copied ESM/WASM portability with injected DTO/hash and fake GPU ports; no sandbox/GPU/device acceptance.'},
        'ownerEvidence': {'core': {'report': 'core-results.json', 'sha256': sha(OUT / 'core-results.json'),
            'native': 290, 'rawNativePassedGroups': passed, 'newJS': 29, 'regression': 407, 'nativeWasmRequests': 19},
            'uiAndI18n': ui, 'modulesAndPriorAssembly': module, 'sourceHost': host,
            'sourceHostCases': {'completeContentWritesPerWinner': 1, 'scope': 'Raw actual six host tests bind the eighth brand and existing awaited document ownership guard.'},
            'web': {'report': 'web-validation.json', 'sha256': sha(OUT / 'web-validation.json')}},
        'sourcePhases': {'initialManifestSha256': sha(OUT / 'source-hashes-final.json'),
                        'finalBrowserManifest': args.manifest,
                        'initialToFinalDelta': confirmed_delta, 'executedApplicationToFinalDelta': executed_delta,
                        'productAndNodeTestBytesUnchanged': True},
        'resolvedFindings': [],
        'sourceContract': {'requestKeys': ['protocolVersion', 'operation', 'content', 'copies', 'offset'],
            'receiptKeys': ['copies', 'offset', 'beforeContent', 'afterContent', 'changedPaths'],
            'semantics': 'Explicit distinct known source/new-fresh UUID pairs1–127 admitted; original plus copy count at most128, so successful batch max64 and per-scene max min(originalCount,128-originalCount). Canonical source order preserves pair binding and appends all clones in ONE original CST insertion. All original bytes and clone names/keys/nonposition fields/trivia stay exact; only clone fresh UUID value and net position numeric slots change. Common author-axis XYZ offset±200000 with final coords±100000 and full original/final128KiB validation. Zero and rounded positional no-net offsets remain genuine structural changes with approval.',
            'authority': 'Eighth independent private brand and source5 port, shared host three awaited ownership guards and one complete source-memory write. Source3 readonly preview, seven sibling author domains, renderer/schema/backend and ordinary Save remain separate.'},
        'initialBrowserProvenance': {'firstCanonicalAttemptPassed': True, 'sourcePhaseCount': 1,
            'note': 'This round has one frozen product/browser-producer phase. Native initial fixture failures are retained separately in core-results; no browser retry or overwritten stdout is invented.'},
        'scopeLimits': ['No actual-repository application or final patch-ready claim; those are later parent actions.',
            'Only root performed subsequent permission-reviewed HTTP/full browser executions; reviewer did not bypass parent execution limits.',
            'Runtime is recorded actual v24.21.0 copied available tool, with no download/install claim.',
            'One raw clone per explicit source/fresh-ID pair with world-axis positional offset; no hierarchy, resource copy, material expansion, automatic naming, pivot transform or history.']}
    preservation = {**common, 'format': 'viento-scene3d-copy-independent-stage-preservation',
        'actualCheckout': {'root': str(original), 'preserved': actual_preserved,
                          'atlasCompleteDeepExact': True, 'allSourceDataUnchanged': True},
        'stage': {'root': str(STAGE), 'preserved': stage_preserved,
                  'sourceDelta': {'added': additions, 'changed': changes, 'removed': [],
                                  'protectedUnchanged': first_freeze['protectedUnchanged']},
                  'atlas': {'baselineSha256': sha(OUT / 'atlas-baseline.json'), 'oldPrefixDeepExact': prefix,
                            'phase': 'Prior to parent closing reports/atlas generation; final post-review verifies append-only state separately.'}},
        'externalTools': tool_receipt, 'previousCoreProof': {'bytes': 564571,
            'wasmSha256': sha(OUT / 'previous-studio-core.wasm'), 'metadataSha256': sha(OUT / 'previous-studio-core.build.json'),
            'actualSevenPredecessorOperationsPassed': True},
        'scope': 'Fresh independent read-only byte/identity checks of real checkout and old staged data. No old evidence rewritten or original path changed. New stage review receipts only.'}
    for name, value in [('stage-review.json', review), ('stage-preservation.json', preservation)]:
        with (OUT / name).open('x') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2); stream.write('\n')
    print(json.dumps({'ok': True, 'stageSource': 767, 'actualSourceExact': 757, 'historical': 5075,
        'authors': 41, 'tools': 4, 'application': app['counts'], 'prepared': groups,
        'reviewSha256': sha(OUT / 'stage-review.json'), 'preservationSha256': sha(OUT / 'stage-preservation.json')}))

if __name__ == '__main__':
    main()
