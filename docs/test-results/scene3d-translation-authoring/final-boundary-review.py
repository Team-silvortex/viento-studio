#!/usr/bin/env python3
"""Run only after the final actual application/browser/copy proofs complete.

Read current frozen files and immutable proofs. Write only two NEW reports;
no build, product mutation, native execution, installation or cleanup.
"""
import argparse
import json
from review_support import OUT, ROOT, sha, load, write_new, now, suite, frozen_source, preservation, atlas_prefix, identity

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', default='source-hashes-confirmed.json')
    parser.add_argument('--prepared', default='packaged-resources-confirmed.json')
    parser.add_argument('--confirmation', default='prepared-confirmation-confirmed.json')
    parser.add_argument('--browser', default='browser-translation-confirmed/browser.json')
    parser.add_argument('--visual', default='visual-review-independent.json')
    parser.add_argument('--app-log', default='application-check-confirmed.log')
    parser.add_argument('--ui-log', required=True)
    args = parser.parse_args()
    assert not any((OUT / name).exists() for name in ['review.json', 'preservation-audit-before-cleanup.json'])
    app = suite(args.app_log)
    frozen, final = frozen_source(args.manifest)
    old = load('source-baseline.json')
    assert len(old) == 727 and set(old) <= set(frozen)
    added = sorted(set(frozen) - set(old))
    changed = [path for path in old if old[path] != frozen[path]]
    assert len(added) == 10
    protected = load('source-freeze-final.json')['protectedUnchanged']
    assert all(frozen[path] == old[path] for path in protected)
    source_delta = {'previous': len(old), 'current': len(frozen), 'added': added, 'changed': changed,
                    'removed': [], 'protectedFiles': len(protected), 'protectedUnchanged': True}
    preserved = preservation()
    _, atlas = atlas_prefix()
    preserved['atlas'] = {**atlas, 'phase': 'Before root closing reports and final derived views; old full ordered prefixes checked now, final snapshot reviewed after cleanup.'}
    quality, host, core = load('quality-initial.json'), load('host-quality-initial.json'), load('core-results.json')
    assert quality['ok'] and quality['passed'] == 14 and quality['failed'] == 0
    assert quality['sourceStable'] and quality['sources'] == quality['endSources']
    assert all(frozen[path] == digest for path, digest in quality['sources'].items())
    assert host['ok'] and host['passed'] == 5 and host['failed'] == 0 and host['source']['stable']
    assert frozen[host['source']['path']] == host['source']['beforeSha256'] == host['source']['afterSha256']
    assert core['ok'] and core['native']['totalPassed'] == 246 and core['native']['failed'] == 0
    assert core['newJavaScript']['totalPassed'] == 28 and core['newJavaScript']['nativeWasmParityRequests'] == 20
    assert all(frozen[path] == item['sha256'] for path, item in core['sources'].items())
    for name, item in core['logs'].items():
        assert sha(OUT / name) == item['sha256']
    assert suite(core['newJavaScript']['log'])['counts']['tests'] == 28
    assert suite(core['regression']['log'])['counts']['tests'] == core['regression']['passed']
    assert sha(ROOT / core['native']['cli']['path']) == core['native']['cli']['sha256']
    assert frozen['engine/studio-core.wasm'] == core['wasm']['sha256'] == quality['wasm']['sha256']
    assert (ROOT / 'engine/studio-core.wasm').stat().st_size == core['wasm']['bytes'] == 528651
    bad, repaired = load('ui-late-checkbox-confirmed.json'), load('ui-late-checkbox-after-fix.json')
    assert bad['ok'] is False and bad['before'] != bad['after']
    assert repaired['ok'] and repaired['passed'] >= 2 and repaired['failed'] == 0
    assert repaired['sourceStable'] and repaired['sourceSha256'] == frozen['web/modules/app-scene3d-translation.js']
    browser = load(args.browser)
    assert browser['ok'] and len(browser['steps']) == 8 and not browser['errors']
    assert not browser.get('svgRequests', []) and not browser.get('cspViolations', [])
    assert browser['sourceStableDuringProof'] and browser['sources'] == browser['sourcesFinal']
    assert all(frozen[path] == digest for path, digest in browser['sources'].items())
    visual = load(args.visual)
    assert visual['ok'] and not visual['openFindings'] and len(visual['screenshots']) == 6
    assert visual['browser']['report'] == args.browser
    for item in visual['screenshots']:
        path = (OUT / item['file']).resolve(strict=True)
        assert path.is_relative_to(OUT) and item['personallyViewed'] and sha(path) == item['sha256']
    web = load('web-validation.json')
    assert web.get('ok', web.get('status') == 'passed')
    ui = suite(args.ui_log)
    assert web['finalManifest']['sha256'] == final['manifestSha256']
    assert all(frozen[path] == digest for path, digest in web['sourceHashes'].items())
    assert web['combinedFocused']['passed'] == ui['counts']['tests'] == 232
    assert web['ui']['passed'] == 229 and web['i18n']['passed'] == 3
    lifecycle = load('ui-lifecycle-fix.json')
    assert lifecycle['ok'] and lifecycle['sourceAfter'] == frozen['web/modules/app-scene3d-translation.js']
    assert lifecycle['independentAfterFix']['sha256'] == sha(OUT / 'ui-late-checkbox-after-fix.json')
    for item in lifecycle['preservedSources']:
        assert sha(OUT / item['snapshot']) == item['sha256']
    owner_visual = load('visual-review-web.json')
    assert owner_visual['ok'] and not owner_visual.get('openFindings', [])
    for item in owner_visual['screenshots']:
        image = (OUT / item['file']).resolve(strict=True)
        assert image.is_relative_to(OUT) and item['personallyViewed'] and sha(image) == item['sha256']
    legacy = {}
    for kind in ['properties', 'environment', 'objects', 'transforms']:
        name = f'browser-{kind}-regression-final/browser.json'
        proof = load(name)
        assert proof['ok'] and not proof['errors'] and proof['sourceStableDuringProof']
        assert all(frozen[path] == digest for path, digest in proof['sources'].items())
        legacy[kind] = {'report': name, 'sha256': sha(OUT / name), 'flowClasses': len(proof['steps']),
                        'boundSources': len(proof['sources']), 'sourceStableDuringProof': True,
                        'phase': 'Actual legacy proof preceded the later translation-row-only repair. Every declared consumed source remains exact in confirmed manifest; this does not certify the new translation row callbacks.'}
    readonly_legacy = {}
    for item in web['legacyBrowsers']:
        proof = load(item['path'])
        assert sha(OUT / item['path']) == item['sha256']
        assert proof['ok'] and not proof['errors'] and proof['sourceStableDuringProof']
        assert all(frozen[path] == digest for path, digest in proof['sources'].items())
        readonly_legacy[item['path']] = {'sha256': item['sha256'], 'flowClasses': len(proof['steps']),
            'sourceStableDuringProof': True, 'boundSources': len(proof['sources']), 'phase': 'Actual confirmed-source execution.'}
    assert sum(item['flowClasses'] for item in readonly_legacy.values()) == 25
    prepared, confirmation = load(args.prepared), load(args.confirmation)
    assert prepared['ok'] and prepared['frozenSource']['manifestSha256'] == final['manifestSha256']
    assert confirmation['ok'] and confirmation['source']['manifestSha256'] == final['manifestSha256']
    assert confirmation['proof']['reportSha256'] == sha(OUT / args.prepared)
    copies = {}
    for name, item in prepared['artifacts'].items():
        directory = ROOT / name
        assert not any(path.is_symlink() for path in directory.rglob('*'))
        actual = {path.relative_to(directory).as_posix(): path for path in directory.rglob('*') if path.is_file()}
        assert set(actual) == set(item['manifest'])
        for path, file in actual.items():
            assert sha(file) == item['manifest'][path]['sha256'] and file.stat().st_size == item['manifest'][path]['bytes']
        copies[name] = len(actual)
    portable = prepared['portable']
    kinds = [key for key, value in portable['desktop'].items() if isinstance(value, list)]
    groups = sum(len(portable['desktop'][key]) + len(portable['mobile'][key]) for key in kinds)
    assert groups == confirmation['totalGroupedCases'] == 314
    assert len(portable['desktop']['translation']) == len(portable['mobile']['translation']) == 8
    for kind in kinds:
        assert portable['desktop'][kind] == portable['mobile'][kind]
    assert all(portable[name]['noNodeDomNetworkGlobals'] and portable[name]['noHostImports'] for name in ['desktop', 'mobile'])
    for path, digest in prepared['sourceHashes'].items():
        assert sha(ROOT / path) == digest
        if path in frozen:
            assert frozen[path] == digest
    host_suite, module_suite = suite('host-tests-confirmed.log'), suite('module-tests-confirmed.log')
    assert host_suite['counts']['tests'] == 47 and module_suite['counts']['tests'] == 23
    registry = (ROOT / 'engine/studio-modules.mjs').read_text()
    assert 'org.viento.scene3d-translation' in registry and 'scene.authoring.translation3d' in registry
    initial = load('source-hashes-final.json')
    assert set(initial) == set(frozen)
    phase_delta = {path: {'before': initial[path], 'after': frozen[path]} for path in initial if initial[path] != frozen[path]}
    assert set(phase_delta) <= {'web/modules/app-scene3d-translation.js', 'scripts/tests/scene3d-translation-ui.test.mjs', 'scripts/tests/scene3d-translation-smoke.mjs'}
    report = {'format': 'viento-scene3d-translation-independent-review', 'schemaVersion': 1,
        'createdAt': now(), 'ok': True, 'openFindings': [], **identity(), 'finalSourceFreeze': final,
        'reviewedSources': {path: frozen[path] for path in ['crates/viento-studio-core/src/lib.rs',
            'crates/viento-studio-core/src/scene3d_translation_patch.rs', 'engine/studio-core.mjs',
            'engine/scene3d-translation.mjs', 'engine/scene3d-authoring.mjs', 'engine/studio-modules.mjs',
            'web/modules/app-runtime.js', 'web/modules/app-studio-system.js',
            'web/modules/app-scene3d-translation.js', 'web/scene3d-translation.css']},
        'independent': {'nativeBridgeProposal': {'report': 'quality-initial.json', 'sha256': sha(OUT / 'quality-initial.json'),
            'passed': 14, 'failed': 0, 'counts': quality['counts'], 'recordedSourcePhaseUnchanged': True},
            'actualHostConcurrency': {'report': 'host-quality-initial.json', 'sha256': sha(OUT / 'host-quality-initial.json'),
                'passed': 5, 'failed': 0, 'counts': host['counts'], 'recordedSourcePhaseUnchanged': True},
            'checkboxOwnership': {'report': 'ui-late-checkbox-after-fix.json', 'sha256': sha(OUT / 'ui-late-checkbox-after-fix.json'),
                'passed': repaired['passed'], 'failed': 0}},
        'browser': {'report': args.browser, 'sha256': sha(OUT / args.browser), 'flowClasses': len(browser['steps']),
            'errors': 0, 'sourceStableDuringProof': True, 'boundSources': len(browser['sources']),
            'independentVisual': {'report': args.visual, 'sha256': sha(OUT / args.visual), 'personallyViewed': 6}},
        'legacyBrowserRegressions': legacy,
        'readonlyBrowserRegressions': readonly_legacy,
        'prepared': {'report': args.prepared, 'sha256': sha(OUT / args.prepared), 'confirmation': args.confirmation,
            'groups': groups, 'files': copies, 'modulesEach': portable['desktop']['moduleCount'],
            'allCurrentCopiedBytesMatch': True, 'vmPortabilityOnly': True,
            'sourceHashesOutsideProductManifest': {path: digest for path, digest in prepared['sourceHashes'].items() if path not in frozen},
            'outsideManifestSourcesActualCurrentShaMatch': True},
        'ownerEvidence': {'nativeCore': {'report': 'core-results.json', 'sha256': sha(OUT / 'core-results.json'),
            'native': core['native'], 'newJavaScript': core['newJavaScript'], 'regression': core['regression']},
            'hostAndSystem': host_suite, 'moduleRegistry': module_suite, 'ui': ui,
            'web': {'report': 'web-validation.json', 'sha256': sha(OUT / 'web-validation.json'),
                    'ui': web['ui']['passed'], 'i18n': web['i18n']['passed'], 'combined': ui['counts']['tests']},
            'lifecycleRepair': {'report': 'ui-lifecycle-fix.json', 'sha256': sha(OUT / 'ui-lifecycle-fix.json')},
            'ownerVisual': {'report': 'visual-review-web.json', 'sha256': sha(OUT / 'visual-review-web.json'),
                            'personallyViewedByOwner': len(owner_visual['screenshots']),
                            'note': 'Owner inspection is distinct from the independent reviewer six-image inspection; overlapping images are not summed.'}},
        'fullApplication': {**app, 'state': 'completed', 'scope': 'Read actual final completed suite. Focused executions are not added to this total.'},
        'sourcePhases': {'initialManifest': 'source-hashes-final.json', 'initialSha256': sha(OUT / 'source-hashes-final.json'),
            'initialToConfirmedChanges': phase_delta, 'note': 'Initial full application was deliberately interrupted for the concrete checkbox ownership repair. Final full application, copies and browser bind the confirmed sources. Immutable native/host quality executions retain their original source phase, whose consumed code remained exact.'},
        'resolvedFindings': [{'finding': 'A detached prior-session checkbox callback changed the next session selection.',
            'before': 'ui-late-checkbox-confirmed.json', 'after': 'ui-late-checkbox-after-fix.json',
            'impact': 'Selection and review state only; the independent reproducer performed no Check/Apply/Save/source write.',
            'repair': 'Owner-only current session and rendered-row admission. Old close/reopen and same-session rebuilt rows cannot modify current selection.'}],
        'boundaries': ['One original Rust model/CST validates all selected final positions before one atomic token splice; source ordered IDs include partial-noop targets, paths contain only net changed axes.',
            'Only selected position numeric value tokens change. Keys/string tokens/trivia/BOM/CRLF and all other author values/order/identities are immutable; native original/final 128KiB admission and whole final model validation.',
            'Fifth private proposal brand with detached five-field source and repeated native candidate verification; no serialized or four sibling author proposal grants this authority.',
            'Host rechecks editor document/load/source token/path/content/savedbaseline at awaited boundaries and performs one source-memory write. Completion cannot focus a replaced source session. Ordinary Save retains disk conflict handling.',
            'Independent boot-only module13/capability29 and optional ABI1. Actual predecessor WASM denies only new translation while four old native operations remain usable; renderer/picking/schema/backend/old four author controllers are byte-exact.'],
        'scopeLimits': ['No version/commit/push/install/device acceptance; no backend execution/Godot export or GPU renderer change.',
            'Browser GPU implementation is recorded by producer; no hardware GPU claim.',
            'Prepared ESM/WASM standard-VM injection proves portability, not a hostile-code sandbox or device run.',
            'No hierarchy, gizmo, rotations/scales batch, undo workflow or implicit Save is introduced.'],
        'initialAttemptsRetained': ['ui-late-checkbox-initial.log (NEW probe lacked queueMicrotask)',
            'ui-late-checkbox-confirmed.json/log (actual pre-repair selection failure)',
            'host-tests-initial.log, module-tests-initial.log (registry-count fixtures)',
            'ui-regression-initial.log (NEW native model-order fixture)',
            'application-check-initial.log and interruption metadata (deliberately interrupted full suite)',
            'initial browser/prepared/source snapshots retain the pre-checkbox-repair phase']}
    preserved_report = {'format': 'viento-scene3d-translation-independent-preservation', 'schemaVersion': 1,
        'createdAt': now(), 'ok': True, 'openFindings': [], 'finalSourceFreeze': final,
        'preserved': preserved, 'sourceDelta': source_delta,
        'generatedDirectories': {'initial': 'generated-paths-initial.json',
            'current': {name: {'exists': (ROOT / name).exists(), 'isSymlink': (ROOT / name).is_symlink()}
                        for name in load('generated-paths-initial.json')},
            'note': 'Recorded before root-only cleanup; reviewer did not delete or adopt generated directories.'},
        'scope': 'Fresh read-only final product/history/author/tool/previous-core preservation and ordered atlas-prefix check. Current new core retained separately from the predecessor proof.'}
    write_new('review.json', report)
    write_new('preservation-audit-before-cleanup.json', preserved_report)
    print(json.dumps({'ok': True, 'source': len(frozen), 'historical': preserved['historical']['files'],
        'authors': preserved['authors']['files'], 'tools': preserved['externalTools']['files'], 'application': app['counts'],
        'prepared': groups, 'reviewSha256': sha(OUT / 'review.json'),
        'preservationSha256': sha(OUT / 'preservation-audit-before-cleanup.json')}))

if __name__ == '__main__':
    main()
