#!/usr/bin/env python3
"""Close this NEW slice from completed confirmed proofs, never guessed totals.

Draft until the parent explicitly resumes after full, web, review, preservation
and cleanup. All previous reports and interrupted/initial evidence stay intact.
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
EXPECTED_REMOVALS = ['desktop/resources', 'desktop/ui/i18n', 'desktop/.cache', 'src-tauri/binaries', 'mobile/dist']


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def local(name):
    value = (OUT / name).resolve(strict=True)
    assert value.is_relative_to(OUT) and value.is_file(), name
    return value


def load(name):
    return json.loads(local(name).read_text(encoding='utf-8'))


def proof(name):
    return {'report': name, 'sha256': sha(local(name))}


def write_new(name, value):
    with (OUT / name).open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def suite(name, require_pass=True):
    text = local(name).read_text(encoding='utf-8')
    rows = re.findall(r'^\s*ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$', text, re.MULTILINE)
    assert len(rows) == 6, f'Exactly one completed suite required: {name}'
    counts = {key: int(value) for key, value in rows}
    assert set(counts) == {'tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'}
    assert counts['tests'] > 0
    if require_pass:
        assert counts['tests'] == counts['pass'] and not any(counts[key] for key in ['fail', 'cancelled', 'skipped', 'todo']), (name, counts)
    durations = re.findall(r'^\s*ℹ duration_ms ([\d.]+)\s*$', text, re.MULTILINE)
    assert len(durations) == 1, name
    return {**proof(name), 'counts': counts, 'durationMs': float(durations[0]),
            'durationScope': 'Node test-runner reported suite duration; not inferred whole-process wall time.'}


def check_sources(report, manifest):
    sources = report.get('sources', report.get('sourceHashes', {}))
    assert isinstance(sources, dict)
    for path, digest in sources.items():
        assert manifest[path] == digest and sha(ROOT / path) == digest, path
    if 'endSources' in report:
        assert report['endSources'] == sources
    if 'sourcesFinal' in report:
        assert report['sourcesFinal'] == sources


def browser(name, manifest, phase):
    data = load(name)
    assert data['ok'] is True and data['steps'] and not data['errors']
    assert not data.get('svgRequests', []) and not data.get('cspViolations', [])
    assert data['sourceStableDuringProof'] is True
    check_sources(data, manifest)
    system = data['system']['plan']
    return {**proof(name), 'workflows': len(data['steps']), 'screenshots': len(data['screenshots']),
            'ok': True, 'browser': data['browser'], 'sourceStableDuringProof': True,
            'runtimeErrors': len(data['errors']), 'svgRequests': len(data.get('svgRequests', [])),
            'cspViolations': len(data.get('cspViolations', [])), 'moduleCount': len(system['modules']),
            'declaredCapabilityCount': len(system['capabilities']), 'gpu': data.get('gpu'),
            'phase': phase,
            'narrativeScope': 'Counts come from actual system metadata; legacy step prose may retain its historical eleven/twelve-module labels.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-log', help='Completed final application log; defaults to independent review fullApplication.report.')
    parser.add_argument('--ui-log', default='ui-regression-late-row-final.log')
    parser.add_argument('--host-log', default='host-tests-confirmed.log')
    parser.add_argument('--module-log', default='module-tests-confirmed.log')
    parser.add_argument('--review-report', default='review.json')
    parser.add_argument('--preservation-report', default='preservation-audit-before-cleanup.json')
    parser.add_argument('--web-report', default='web-validation.json')
    args = parser.parse_args()
    assert not (OUT / 'application-timing.json').exists() and not (OUT / 'results.json').exists(), 'Final outputs are write-once.'
    baseline = load('baseline.json')
    initial, confirmed = load('source-hashes-final.json'), load('source-hashes-confirmed.json')
    manifest_sha = sha(local('source-hashes-confirmed.json'))
    assert len(confirmed) == 737 and set(initial) == set(confirmed)
    assert all(sha(ROOT / path) == digest for path, digest in confirmed.items())
    phase = load('source-phase-confirmation.json')
    assert phase['ok'] and phase['confirmedManifest']['sha256'] == manifest_sha and phase['confirmedManifest']['allMatch']
    changed = sorted(path for path in initial if initial[path] != confirmed[path])
    assert changed == sorted(phase['changed']) == ['scripts/tests/scene3d-translation-smoke.mjs', 'scripts/tests/scene3d-translation-ui.test.mjs', 'web/modules/app-scene3d-translation.js']
    assert phase['nativeAndBridgeProofSourcesUnchanged'] and phase['initialIndependentCoreAndHostProofSourcesUnchanged']
    interruption_name = phase['firstFullInterrupted']['report']
    interruption = load(interruption_name)
    assert interruption['complete'] is False and interruption['noPassingSuiteClaim'] is True
    assert phase['firstFullInterrupted']['exitCode'] == 143 and phase['firstFullInterrupted']['passedSuiteClaim'] is False
    assert load('ui-late-checkbox-confirmed.json')['ok'] is False
    fixed_checkbox = load('ui-late-checkbox-after-fix.json')
    assert fixed_checkbox['ok'] is True
    review, preservation, cleanup, web = load(args.review_report), load(args.preservation_report), load('cleanup.json'), load(args.web_report)
    assert all(data['ok'] for data in [review, preservation, cleanup, web])
    assert not review['openFindings'] and not preservation['openFindings']
    for data in [review, preservation]:
        assert data['finalSourceFreeze']['manifestSha256'] == manifest_sha and data['finalSourceFreeze']['allMatch'] is True
    assert cleanup['sourceManifestSha256'] == manifest_sha and cleanup['directoriesRemainAbsent'] is True
    assert [item['path'] for item in cleanup['removed']] == EXPECTED_REMOVALS
    assert all(not (ROOT / path).exists() and not (ROOT / path).is_symlink() for path in EXPECTED_REMOVALS)
    for name in ['historical-baseline.json', 'author-baseline.json']:
        assert all(sha(ROOT / path) == digest for path, digest in load(name).items()), name
    for path, expected in load('tool-baseline.json').items():
        metadata = Path(path).lstat()
        assert stat.S_ISREG(metadata.st_mode)
        assert {'sha256': sha(path), 'bytes': metadata.st_size, 'dev': metadata.st_dev, 'ino': metadata.st_ino, 'nlink': metadata.st_nlink} == expected
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip() == baseline['head']
    assert (ROOT / 'VERSION').read_text().strip() == baseline['version']
    app_name = args.app_log or review['fullApplication']['report']
    application = suite(app_name)
    assert application['counts'] == review['fullApplication']['counts'] == cleanup['applicationChecks']
    application['executedManifestSha256'] = manifest_sha
    app_text = local(app_name).read_text()
    syntax = re.search(r'语法检查通过：(\d+) 个 JavaScript 文件', app_text)
    assert syntax and 'API 契约预检通过' in app_text and '版本一致性检查通过：0.0.10' in app_text
    application['syntaxFiles'] = int(syntax[1]); application['versionAndApiPreflightPassed'] = True
    ui, host, modules = suite(args.ui_log), suite(args.host_log), suite(args.module_log)
    assert ui['counts']['tests'] >= 232 and host['counts']['tests'] == 47 and modules['counts']['tests'] == 23
    assert web['combinedFocused']['total'] == ui['counts']['tests']
    core = load('core-results.json')
    assert core['ok'] and core['native']['totalPassed'] == 246 and core['regression']['passed'] == 320 and core['newJavaScript']['totalPassed'] == 28
    assert all(sha(ROOT / path) == value['sha256'] for path, value in core['sources'].items())
    assert suite('core-regression.log')['counts']['pass'] == 320 and suite('core-focus-initial.log')['counts']['pass'] == 28
    native = re.findall(r'test result: ok\. (\d+) passed;', local('rust-tests.log').read_text())
    assert sum(map(int, native)) == 246
    quality, host_quality = load('quality-initial.json'), load('host-quality-initial.json')
    assert quality['ok'] and quality['passed'] == 14 and quality['failed'] == 0 and quality['sourceStable']
    assert host_quality['ok'] and host_quality['passed'] == 5 and host_quality['failed'] == 0 and host_quality['source']['stable']
    check_sources(quality, confirmed)
    assert sha(ROOT / host_quality['source']['path']) == host_quality['source']['afterSha256']
    prepared, prepared_confirmation = load('packaged-resources-confirmed.json'), load('prepared-confirmation-confirmed.json')
    assert prepared['ok'] and prepared_confirmation['ok']
    assert prepared['frozenSource']['manifestSha256'] == manifest_sha
    portable = sum(len(v) for copy in prepared['portable'].values() for v in copy.values() if isinstance(v, list))
    assert portable == 314
    assert all(copy['moduleCount'] == 104 for copy in prepared['portable'].values())
    assert prepared_confirmation['previousGroupedCasesPreserved'] == 298 and prepared_confirmation['assertionsRemoved'] == 0
    assert core['wasm']['bytes'] == 528651 and sha(ROOT / 'engine/studio-core.wasm') == core['wasm']['sha256']
    assert core['wasm']['previousProof']['bytes'] == 515406
    assert sha(local('previous-studio-core.wasm')) == core['wasm']['previousProof']['sha256']
    new_browser_name = web['browser'].get('path', web['browser'].get('report'))
    assert new_browser_name == review['browser']['report']
    new_browser = browser(new_browser_name, confirmed, 'After real checkbox-row repair, final source and screenshot frame producer.')
    legacy = {}; entries = web.get('legacyBrowsers', [])
    entries = list(entries.values()) if isinstance(entries, dict) else entries
    for value in entries:
        name = value.get('path', value.get('report'))
        if name and name != new_browser_name:
            legacy[name] = browser(name, confirmed, 'Declared final browser regression phase in web-validation; not inferred from count labels.')
    for value in phase['legacyAuthorBrowserProofs']:
        name = value['report']; summary = browser(name, confirmed, value['phase'])
        assert summary['sha256'] == value['sha256'] and summary['workflows'] == value['flows']
        legacy[name] = summary
    fixture_attempts = [
        {'kind': 'module-registry-fixture', **suite('module-tests-initial.log', False), 'reason': 'Expected fixed module list omitted the new thirteenth module; test fixture updated without changing product rules.'},
        {'kind': 'new-UI-fixture', **suite('ui-regression-initial.log', False), 'reason': 'NEW stubProposal initially copied raw-author object key order instead of the actual native-parsed model. Strict candidate comparison refused the stub and nine downstream expectations failed; only the NEW stub was changed to native parsed before/after objects. The later real checkbox lifecycle bug is separate.'},
        {'kind': 'legacy-system-fixture', **suite('host-tests-initial.log', False), 'reason': 'Legacy no-author-port fixture optional-inactive list extended for translation; no product rule change.'},
    ]
    assert [v['counts']['fail'] for v in fixture_attempts] == [2, 9, 4]
    fixture_attempts[1]['initialFailedLogPreserved'] = True
    fixture_attempts[1]['preCorrectionProducerSnapshotAvailable'] = False
    fixture_attempts[1]['snapshotScope'] = 'initial-ui-source test snapshot is after the stub correction and before the real late-row repair; it is not the initial nine-failure producer.'
    lifecycle = load('ui-lifecycle-fix.json')
    timing = {'format': 'viento-scene3d-translation-application-timing', 'schemaVersion': 1, 'recordedAt': datetime.now(timezone.utc).isoformat(), 'ok': True,
        'fullApplication': application, 'sourcePhases': phase,
        'initialFull': {**proof('application-check-initial.log'), 'interruption': proof(interruption_name), 'complete': False, 'parentRecordedExitCode': 143, 'passedSuiteClaim': False},
        'fixtureFailures': fixture_attempts,
        'realProductRepair': {'issue': 'Detached previous-session checkbox event changed the newly opened selection; stale/modified checkbox dataset could redirect selection.',
            'initialProbe': proof('ui-late-checkbox-confirmed.json'), 'initialProbePassed': False, 'repair': proof('ui-lifecycle-fix.json'),
            'afterFixProbe': proof('ui-late-checkbox-after-fix.json'), 'afterFixPassed': True, 'freshUi': ui,
            'freshConfirmedPortable': proof('packaged-resources-confirmed.json'), 'freshConfirmedBrowser': new_browser,
            'reasonForFullInterruption': interruption['reason']},
        'browserFrameProducerAdjustment': proof('review-frame-producer-change.json'),
        'unalteredEarlierProofs': {'native': proof('rust-tests.log'), 'core': proof('core-results.json'), 'quality': proof('quality-initial.json'), 'hostQuality': proof('host-quality-initial.json'),
            'phaseScope': 'Their actual declared source sets match confirmed bytes. They retain original execution dates and are not mislabelled as later reruns.'},
        'scope': 'Actual final completed Node suite duration and exact phase binding. Focused/core/UI/host/module suites overlap full checks and each other; no summed coverage percentage or invented process wall time.'}
    result = {'format': 'viento-scene3d-translation-authoring-results', 'schemaVersion': 1, 'createdAt': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'ok': True,
        'version': baseline['version'], 'publishedBase': baseline['head'], 'delivery': 'Unpublished working tree after 0.0.10; no commit/push, tag, installation or Android-device acceptance.',
        'features': ['Independent existing-UUID selection and shared XYZ offset authoring, separate from preview and four previous authoring brands.',
            'Rust computes all 1–128 original target positions in one atomic transaction; ±200000 offset and every final ±100000 coordinate are validated before one merged CST splice.',
            'Only genuinely changed position number tokens are replaced; BOM, CRLF, escaped keys, other objects/environment, exponents and signed-zero noops remain exact.',
            'Full-source private proposal and complete before/after target diagnostics, snapshot/hash/owner guards, draft-only apply and ordinary Save/conflict workflow.',
            'Late-row fix binds checkbox closures to their current epoch, source/model and declared UUID rather than mutable detached DOM data.'],
        'sourceFreeze': {'manifest': 'source-hashes-confirmed.json', 'sha256': manifest_sha, 'files': len(confirmed), 'allMatch': True},
        'fullApplication': application,
        'focused': {'native': {**proof('core-results.json'), 'unit': 197, 'integration': 49, 'passed': 246, 'newUnits': 12, 'fmtClippyPassed': True},
            'core': {**proof('core-regression.log'), 'passed': 320, 'includesNew28': True}, 'newBridgeAndProposal': {**proof('core-focus-initial.log'), 'passed': 28, 'bridge': 16, 'proposal': 12, 'nativeWasmParityRequests': 20},
            'uiAndLocales': ui, 'hostAndPorts': host, 'modules': modules,
            'independentQuality': {**proof('quality-initial.json'), 'passed': 14, 'counts': quality['counts']},
            'independentHostQuality': {**proof('host-quality-initial.json'), 'passed': 5, 'counts': host_quality['counts']}},
        'wasm': {'current': {'bytes': 528651, 'sha256': core['wasm']['sha256']}, 'previousPreserved': core['wasm']['previousProof'],
            'addedOptionalAbi': 'viento_core_scene3d_translation_version()==1 / scene3d.translateObjects', 'olderParseAndFourAuthorDomainsPreserved': True, 'actualPredecessorCompatibilityExercised': True},
        'browser': new_browser, 'legacyBrowsers': list(legacy.values()),
        'browserFlowTotals': {'new': new_browser['workflows'], 'legacy': sum(v['workflows'] for v in legacy.values()), 'scope': 'Distinct recorded flows, not additive test coverage; legacy author proofs explicitly predate the row repair.'},
        'visual': web['visualReview'],
        'prepared': {**proof('packaged-resources-confirmed.json'), 'groups': portable, 'groupsEach': portable // 2, 'oldGroupsPreserved': 298,
            'inventory': {p: v['manifestFileCount'] for p, v in prepared['artifacts'].items()}, 'modulesEach': {p: v['moduleCount'] for p, v in prepared['portable'].items()},
            'executedManifestSha256': manifest_sha, 'confirmation': proof('prepared-confirmation-confirmed.json'),
            'scope': 'Standard VM without Node/DOM/fetch/process; actual copied ESM/WASM and explicit digest/DTO ports. Renderer fixtures use fake canvas/WebGL ports, not GPU shader/pixel execution.'},
        'preservation': {**proof(args.preservation_report), 'historicalReports': baseline['historicalFiles'], 'authorFiles': baseline['authorFiles'], 'externalTools': baseline['toolFiles'], 'directPostCleanupByteAndToolIdentityRecheck': True},
        'cleanup': {**proof('cleanup.json'), 'allocatedFileBytesRemoved': cleanup['allocatedFileBytesRemoved'], 'allocatedGiBRemoved': cleanup['allocatedFileBytesRemoved'] / 1024 ** 3, 'exactPaths': EXPECTED_REMOVALS},
        'review': {**proof(args.review_report), 'openFindings': []}, 'chronology': {'report': 'application-timing.json', 'realProductRepair': True, 'initialFullPassingClaim': False},
        'overlap': 'All focused suites overlap the complete application and each other. Native, portable and browser prove different boundaries; counts are not added to a coverage score.',
        'limitations': ['Relative position only; no spatial hierarchy, batch rotation/scale, gizmo, permanent history or cross-file transaction.',
            'Apply changes only the current source draft; ordinary Save and its conflict checks remain independent.',
            'Chrome SwiftShader software WebGL and standard VM checks do not establish installed desktop, Android device, hardware GPU or backend execution acceptance.'],
        'closingAtlas': 'Append-only atlas, historical coordinate/score preservation and final post-cleanup document/source audit are separate closing proofs.'}
    # Complete every precondition before publishing either immutable output.
    write_new('application-timing.json', timing)
    write_new('results.json', result)
    print(json.dumps({'ok': True, 'application': application['counts']['pass'], 'native': 246, 'core': 320, 'ui': ui['counts']['pass'], 'host': 47, 'modules': 23,
                     'portable': portable, 'browserNew': new_browser['workflows'], 'browserLegacy': result['browserFlowTotals']['legacy'], 'allocatedGiBRemoved': result['cleanup']['allocatedGiBRemoved']}))


if __name__ == '__main__':
    main()
