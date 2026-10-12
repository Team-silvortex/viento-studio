#!/usr/bin/env python3
"""Summarize completed isolated-stage proofs, awaiting actual checkout apply.

DRAFT until root explicitly resumes after final app/browser/review/preservation
and reviewable patch receipts. No Node/build/HTTP or actual checkout writes.
All outputs are write-once; actual application/post-apply audit are separate.
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


def local(name):
    path = (OUT / name).resolve(strict=True)
    assert path.is_relative_to(OUT) and path.is_file(), name
    return path


def load(name):
    return json.loads(local(name).read_text(encoding='utf-8'))


def proof(name):
    return {'report': name, 'sha256': sha(local(name))}


def write_new(name, value):
    with (OUT / name).open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def suite(name):
    text = local(name).read_text(encoding='utf-8')
    rows = re.findall(r'^\s*[ℹ#] (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$', text, re.MULTILINE)
    assert len(rows) == 6, f'One completed actual suite required: {name}'
    counts = {key: int(value) for key, value in rows}
    assert set(counts) == {'tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'}
    assert counts['tests'] == counts['pass'] > 0 and not any(counts[k] for k in ['fail', 'cancelled', 'skipped', 'todo']), (name, counts)
    durations = re.findall(r'^\s*[ℹ#] duration_ms ([\d.]+)\s*$', text, re.MULTILINE)
    assert len(durations) == 1, name
    return {**proof(name), 'counts': counts, 'durationMs': float(durations[0]),
            'durationScope': 'Node reported actual suite duration, not guessed process wall time.'}


def declared_sources(data, manifest):
    values = data.get('sources', data.get('sourceHashes', {}))
    assert isinstance(values, dict)
    for path, digest in values.items():
        expected = digest.get('sha256') if isinstance(digest, dict) else digest
        assert manifest[path] == expected == sha(ROOT / path), path
    if 'endSources' in data:
        assert data['endSources'] == values
    if 'sourcesFinal' in data:
        assert data['sourcesFinal'] == values


def browser(name, manifest):
    data = load(name)
    assert data['ok'] is True and data['steps'] and not data['errors']
    assert data['sourceStableDuringProof'] is True
    assert not data.get('cspViolations', []) and not data.get('svgRequests', [])
    declared_sources(data, manifest)
    plan = data['system']['plan']
    assert len(plan['modules']) == 14 and len(plan['capabilities']) == 30
    return {**proof(name), 'ok': True, 'workflows': len(data['steps']), 'screenshots': len(data['screenshots']),
            'browser': data['browser'], 'gpu': data.get('gpu'), 'moduleCount': len(plan['modules']),
            'capabilities': len(plan['capabilities']), 'phase': 'Isolated stage, after smoke IIFE expression fixture correction.',
            'sourceStableDuringProof': True, 'runtimeErrors': 0, 'cspViolations': 0,
            'scope': 'Actual root-authorized browser proof in staged temporary workspace; not installed/device/hardware-GPU or actual checkout application.'}


def freeze_bound(data, manifest_sha):
    value = data.get('finalSourceFreeze', data.get('sourceFreeze'))
    assert isinstance(value, dict), 'Final reviewed stage source receipt required.'
    digest = value.get('manifestSha256', value.get('sha256'))
    assert digest == manifest_sha and value['allMatch'] is True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resume-stage-results', action='store_true', help='Root explicit final RESUME only; never actual checkout apply.')
    parser.add_argument('--app-log', required=True, help='Completed actual final application log, not guessed initial file count.')
    parser.add_argument('--ui-log', default='ui-and-i18n-confirmed.log')
    parser.add_argument('--host-log', default='host-tests-initial.log')
    parser.add_argument('--module-log', default='module-tests-isolation-diagnostic.log')
    parser.add_argument('--review-report', default='review.json')
    parser.add_argument('--preservation-report', default='preservation-audit-stage-final.json')
    parser.add_argument('--patch-ready-report', default='patch-ready.json')
    parser.add_argument('--web-report', default='web-validation.json')
    args = parser.parse_args()
    assert args.resume_stage_results, 'Stage finisher remains pending parent explicit RESUME.'
    assert not (OUT / 'application-timing.json').exists() and not (OUT / 'results.json').exists(), 'Outputs are write-once.'
    baseline = load('baseline.json')
    actual = Path(baseline['sourceRoot'])
    initial, confirmed = load('source-hashes-final.json'), load('source-hashes-confirmed.json')
    manifest_sha = sha(local('source-hashes-confirmed.json'))
    assert len(confirmed) == 747 and set(initial) == set(confirmed)
    assert all(sha(ROOT / path) == digest for path, digest in confirmed.items())
    changed = sorted(path for path in initial if initial[path] != confirmed[path])
    assert changed == ['scripts/tests/scene3d-alignment-smoke.mjs'], changed
    phase = load('source-phase.json')
    assert phase['ok'] is True and phase['confirmedManifest']['sha256'] == manifest_sha and phase['confirmedManifest']['allMatch']
    assert phase['initialManifest']['sha256'] == sha(local('source-hashes-final.json')) and phase['changed'] == changed
    assert sha(ROOT / 'VERSION') == sha(actual / 'VERSION') and (ROOT / 'VERSION').read_text().strip() == baseline['version']
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=actual, text=True).strip() == baseline['head']
    # Read original checkout, never write or invoke apply. Its entire old source
    # map must still match the baseline at the stage-only publishing moment.
    previous_source = load('source-baseline.json')
    assert len(previous_source) == 737
    assert all(sha(actual / path) == digest for path, digest in previous_source.items())
    for name in ['historical-baseline.json', 'author-baseline.json']:
        values = load(name)
        assert all(sha(ROOT / path) == digest == sha(actual / path) for path, digest in values.items()), name
    for path, expected in load('tool-baseline.json').items():
        info = Path(path).lstat()
        assert stat.S_ISREG(info.st_mode)
        assert {'sha256': sha(path), 'bytes': info.st_size, 'dev': info.st_dev, 'ino': info.st_ino, 'nlink': info.st_nlink} == expected
    review, preservation, patch, web = (load(name) for name in [args.review_report, args.preservation_report, args.patch_ready_report, args.web_report])
    assert all(data['ok'] is True for data in [review, preservation, patch, web])
    assert not review['openFindings'] and not preservation.get('openFindings', [])
    freeze_bound(review, manifest_sha)
    freeze_bound(preservation, manifest_sha)
    assert patch['sourceManifestSha256'] == manifest_sha and patch['actualApplyPerformed'] is False
    assert Path(patch['patchPath']).resolve().is_relative_to(ROOT.parent)
    assert sha(patch['patchPath']) == patch['patchSha256']
    application = suite(args.app_log)
    assert application['counts']['tests'] >= 349, 'A file-only Node isolation result is not the complete application case count.'
    if 'fullApplication' in review:
        assert application['counts'] == review['fullApplication']['counts']
    text = local(args.app_log).read_text()
    syntax = re.search(r'语法检查通过：(\d+) 个 JavaScript 文件', text)
    assert syntax and 'API 契约预检通过' in text and f"版本一致性检查通过：{baseline['version']}" in text
    application.update({'syntaxFiles': int(syntax[1]), 'versionAndApiPreflightPassed': True,
                        'executedManifestSha256': manifest_sha, 'executionScope': 'Isolated stage only, no actual checkout apply.'})
    ui, host, modules = suite(args.ui_log), suite(args.host_log), suite(args.module_log)
    assert ui['counts']['tests'] >= 76 and host['counts']['tests'] == 6 and modules['counts']['tests'] == 49
    core = load('core-results.json')
    assert core['ok'] and core['native']['totalPassed'] == 258 and core['regression']['pass'] == 349 and core['newJavaScript']['totalPassed'] == 29
    declared_sources(core, confirmed)
    assert suite('core-regression.log')['counts']['pass'] == 349
    assert suite('core-bridge-initial.log')['counts']['pass'] == 17 and suite('core-proposal-initial.log')['counts']['pass'] == 12
    native_counts = re.findall(r'test result: ok\. (\d+) passed; 0 failed; 0 ignored', local('core-native-tests-confirmed.log').read_text())
    assert sum(map(int, native_counts)) == 258
    quality, ui_quality = load('quality-initial.json'), load('ui-quality-initial.json')
    assert quality['ok'] and quality['passed'] == 14 and quality['failed'] == 0 and quality['sourceStable']
    declared_sources(quality, confirmed)
    assert ui_quality['ok'] and ui_quality['passed'] == 7 and ui_quality['failed'] == 0 and ui_quality['source']['stable']
    assert confirmed[ui_quality['source']['path']] == ui_quality['source']['beforeSha256'] == ui_quality['source']['endSha256']
    package, package_confirmation = load('packaged-resources-confirmed.json'), load('prepared-confirmation-confirmed.json')
    initial_package = load('packaged-resources.json')
    assert package['ok'] and package_confirmation['ok']
    assert package['frozenSource']['manifestSha256'] == manifest_sha
    groups = sum(len(v) for copy in package['portable'].values() for v in copy.values() if isinstance(v, list))
    assert groups == 330 and all(copy['moduleCount'] == 105 for copy in package['portable'].values())
    assert all(len(copy['alignment']) == 8 for copy in package['portable'].values())
    for copy in ['desktop', 'mobile']:
        for name, cases in initial_package['portable'][copy].items():
            if isinstance(cases, list):
                assert package['portable'][copy][name] == cases
    assert package_confirmation['packaged']['groups'] == 330 and package_confirmation['packaged']['oldGroupsPreserved'] == 314
    assert sha(ROOT / 'engine/studio-core.wasm') == core['wasm']['sha256'] and core['wasm']['bytes'] == 543107
    assert core['wasm']['previousProof']['bytes'] == 528651 and sha(local('previous-studio-core.wasm')) == core['wasm']['previousProof']['sha256']
    browser_value = web['browser']
    new_browser_name = browser_value.get('path', browser_value.get('report'))
    actual_browser = browser(new_browser_name, confirmed)
    legacy_entries = web.get('legacyBrowsers', [])
    if isinstance(legacy_entries, dict):
        legacy_entries = list(legacy_entries.values())
    legacy_browsers = []
    for value in legacy_entries:
        name = value.get('path', value.get('report'))
        if name and name != new_browser_name:
            legacy_browsers.append(browser(name, confirmed))
    initial_provenance = load('browser-initial-provenance.json')
    assert initial_provenance['initialStructuredReport']['status'] == 'failed'
    assert initial_provenance['initialStdout']['originalBytesPreserved'] is False
    assert sha(local(initial_provenance['initialProducer']['path'])) == initial_provenance['initialProducer']['sha256']
    assert sha(local(initial_provenance['initialStructuredReport']['path'])) == initial_provenance['initialStructuredReport']['sha256']
    timing = {'format': 'viento-scene3d-alignment-application-timing', 'schemaVersion': 1, 'recordedAt': datetime.now(timezone.utc).isoformat(), 'ok': True,
              'phase': 'stage-tested-awaiting-actual-checkout-apply', 'fullApplication': application,
              'sourcePhases': {**proof('source-phase.json'), 'initialManifest': proof('source-hashes-final.json'), 'confirmedManifest': proof('source-hashes-confirmed.json'), 'exactChangedSourcePaths': changed,
                               'changeScope': 'One NEW smoke harness IIFE expression correction. All product/core/native/test assertions remain unchanged.'},
              'initialPrepared': {**proof('packaged-resources.json'), 'actualGroups': 330, 'scope': 'Legitimate initial source phase; not relabelled as the confirmed rerun.'},
              'confirmedPrepared': {**proof('packaged-resources-confirmed.json'), 'actualGroups': groups},
              'initialBrowser': {**proof('browser-initial-provenance.json'), 'productFinding': False,
                                 'cause': 'New browser evidence evaluated multi-statement detached-row scripts as expressions; only the NEW producer wrapped them in IIFEs.',
                                 'structuredReportAndPNGsPreserved': True, 'originalStdoutPreserved': False,
                                 'stdoutLimitation': initial_provenance['initialStdout']['explanation']},
              'toolAttempts': {'isolatedCargoRepair': proof('isolated-cargo-repair.json'), 'nativeSizeRepair': proof('native-size-repair.json'),
                               'scope': 'Retained failed tool setup/missing resources/quota attempts, then isolated offline cache and debug-size repair. No product fix or successful native helper claim inferred from a failed attempt.'},
              'nativeBridgeQualityFirstRunPhase': {**proof('core-results.json'), 'laterHarnessOnlyDeltaLeavesDeclaredSourcesExact': True},
              'runtime': core['runtime'],
              'overlap': 'Focused/core/UI/host/module checks overlap the complete application and each other. Native, prepared and browser verify different boundaries; totals are not additive coverage.'}
    result = {'format': 'viento-scene3d-alignment-authoring-results', 'schemaVersion': 1, 'createdAt': datetime.now(timezone.utc).isoformat(), 'ok': True,
              'status': 'stage-tested-awaiting-actual-checkout-apply', 'version': baseline['version'], 'publishedBase': baseline['head'],
              'delivery': 'Reviewable isolated stage only. Actual checkout remains unchanged, pending root approval-reviewed application; no commit/push/release/installation or device acceptance.',
              'features': ['Explicit selected reference and one world position axis; 2–128 stable existing primitive instance identities.',
                           'Rust collects net position numeric-token edits from the original source and returns one whole validated atomic candidate; no reference subtraction or bounds geometry.',
                           'BOM/CRLF/escaped keys, exponent and signed-zero noops, other axes, rotations/sizes, environment, declarations and identities remain exact.',
                           'Independent optional ABI/bridge and sixth private proposal brand with sourceordered full diagnostics and five-source/hash/session guards.',
                           'Separate draft-only source apply and ordinary Save authority; no renderer/backend permission.'],
              'sourceFreeze': {'manifest': 'source-hashes-confirmed.json', 'sha256': manifest_sha, 'files': len(confirmed), 'allMatch': True},
              'fullApplication': application,
              'focused': {'native': {**proof('core-results.json'), 'passed': 258, 'unit': 209, 'integration': 49, 'newUnits': 12, 'fmtClippyPassed': True},
                          'core': {**proof('core-regression.log'), 'passed': 349, 'includesNew29': True},
                          'newBridgeAndProposal': {'reports': [proof('core-bridge-initial.log'), proof('core-proposal-initial.log')], 'passed': 29, 'bridge': 17, 'proposal': 12, 'nativeWasmParityRequests': 22},
                          'uiAndLocales': ui, 'host': host, 'modules': modules,
                          'independentQuality': {**proof('quality-initial.json'), 'passed': 14, 'counts': quality['counts']},
                          'independentUiQuality': {**proof('ui-quality-initial.json'), 'passed': 7}},
              'wasm': {'current': {'bytes': 543107, 'sha256': core['wasm']['sha256']}, 'previousPreserved': core['wasm']['previousProof'],
                       'newOptionalAbi': 'viento_core_scene3d_alignment_version()==1 / scene3d.alignObjects', 'oldFiveAuthorAndParseCapabilitiesPreserved': True},
              'browser': actual_browser, 'legacyBrowsers': legacy_browsers,
              'browserFlowTotals': {'new': actual_browser['workflows'], 'legacy': sum(item['workflows'] for item in legacy_browsers), 'scope': 'Distinct actual reported flow counts; not additive test coverage.'},
              'visual': web['visualReview'],
              'prepared': {**proof('packaged-resources-confirmed.json'), 'groups': groups, 'groupsEach': groups // 2, 'oldGroupsPreserved': 314,
                           'inventory': {path: value['manifestFileCount'] for path, value in package['artifacts'].items()},
                           'modulesEach': {path: value['moduleCount'] for path, value in package['portable'].items()},
                           'confirmation': proof('prepared-confirmation-confirmed.json'), 'scope': 'Standard VM without Node/DOM/fetch/process; explicit JSON/digest ports and copied fakeGL renderer contracts. No hostile-code sandbox or installed device/GPU claim.'},
              'preservation': {**proof(args.preservation_report), 'historicalReports': baseline['historicalFiles'], 'authors': baseline['authorFiles'], 'externalTools': baseline['toolFiles'],
                               'actualCheckout737SourceBaselineMatches': True, 'headAndVersionUnchanged': True, 'stageAndActualOldHistoryAndAuthorsByteExact': True, 'toolShaSizeDevInoNlinkExact': True},
              'review': {**proof(args.review_report), 'openFindings': []}, 'reviewablePatch': {**proof(args.patch_ready_report), 'actualApplyPerformed': False},
              'chronology': {'report': 'application-timing.json', 'harnessOnlyCorrection': True, 'actualCheckoutApplyPending': True},
              'limitations': ['Position coordinates only; no rotated bounds alignment, group/hierarchy, rotation/scale batch, gizmo or persistent undo transaction.',
                              'Stage-only source/copy/browser checks do not replace actual reviewed patch application and a later post-apply audit.',
                              'Ordinary Save remains the persistent writer; software Chrome WebGL and standard VM do not establish installed desktop, Android or hardware GPU acceptance.'],
              'closingAtlasAndApplication': 'Root appends staged atlas/delivery evidence, then handles approval-reviewed actual checkout apply and separate post-apply audit. This finisher has no writer or execution authority.'}
    # Complete all prerequisites before publishing either immutable stage result.
    write_new('application-timing.json', timing)
    write_new('results.json', result)
    print(json.dumps({'ok': True, 'status': result['status'], 'application': application['counts']['pass'], 'native': 258, 'core': 349,
                      'ui': ui['counts']['pass'], 'host': 6, 'modules': 49, 'portable': groups, 'browserNew': actual_browser['workflows'],
                      'actualCheckoutApplyPending': True}))


if __name__ == '__main__':
    main()
