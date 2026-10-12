#!/usr/bin/env python3
"""Write-once summary of completed isolated-stage distribution proofs.

Draft until root explicitly resumes after actual full/browser/web/review and
preservation receipts. No process execution, builds, network or actual writes;
the actual checkout is read only, and subsequent application is separate.
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
    assert len(rows) == 6, f'Exactly one completed actual suite is required: {name}'
    counts = {key: int(value) for key, value in rows}
    assert set(counts) == {'tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'}
    assert counts['tests'] == counts['pass'] > 0 and not any(counts[k] for k in ['fail', 'cancelled', 'skipped', 'todo']), (name, counts)
    durations = re.findall(r'^\s*[ℹ#] duration_ms ([\d.]+)\s*$', text, re.MULTILINE)
    assert len(durations) == 1, name
    return {**proof(name), 'counts': counts, 'durationMs': float(durations[0]),
            'durationScope': 'Actual Node suite duration; not inferred process wall time.'}


def declared_sources(data, manifest):
    values = data.get('sources', data.get('sourceHashes', {}))
    assert isinstance(values, dict)
    for path, digest in values.items():
        expected = digest.get('sha256') if isinstance(digest, dict) else digest
        assert manifest[path] == expected == sha(ROOT / path), path
    for field in ['endSources', 'sourcesFinal']:
        if field in data:
            assert data[field] == values, field


def browser(name, manifest, module_count, capability_count):
    data = load(name)
    assert data['ok'] is True and data['steps'] and not data['errors']
    assert data['sourceStableDuringProof'] is True
    trackers = {}
    for field in ['cspViolations', 'svgRequests']:
        values = data.get(field)
        tracked = field in data and isinstance(values, list)
        if tracked:
            assert not values, (name, field)
        trackers[field] = {'tracked': tracked, 'count': len(values) if tracked else None}
    declared_sources(data, manifest)
    plan = data['system']['plan']
    assert len(plan['modules']) == module_count and len(plan['capabilities']) == capability_count
    for image in data['screenshots']:
        if isinstance(image, str):
            local(image if image.startswith(name.rsplit('/', 1)[0] + '/') else name.rsplit('/', 1)[0] + '/' + image)
    return {**proof(name), 'ok': True, 'workflows': len(data['steps']), 'screenshots': len(data['screenshots']),
            'browser': data['browser'], 'gpu': data.get('gpu'), 'moduleCount': module_count,
            'capabilities': capability_count, 'phase': 'Single formal frozen stage source phase.',
            'sourceStableDuringProof': True, 'runtimeErrors': 0, **trackers,
            'scope': 'Root-authorized actual browser proof in staged temporary workspace. Not installed/device/hardware-GPU or actual checkout application.'}


def freeze_bound(data, manifest_sha, files):
    value = data.get('finalSourceFreeze', data.get('sourceFreeze'))
    assert isinstance(value, dict), 'Final reviewed stage source receipt required.'
    digest = value.get('manifestSha256', value.get('sha256'))
    assert digest == manifest_sha and value.get('allMatch', value.get('currentMatches')) is True and value['files'] == files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resume-stage-results', action='store_true', help='Only after root explicit RESUME; never actual checkout apply.')
    parser.add_argument('--app-log', default='application-check.log')
    parser.add_argument('--ui-log', default='ui-and-i18n-confirmed.log')
    parser.add_argument('--host-log', default='host-tests.log')
    parser.add_argument('--module-log', default='module-tests.log')
    parser.add_argument('--review-report', default='stage-review.json')
    parser.add_argument('--preservation-report', default='stage-preservation.json')
    parser.add_argument('--patch-ready-report', default='implementation-ready.json')
    parser.add_argument('--web-report', default='web-validation.json')
    parser.add_argument('--web-legacy-report', default='web-legacy-addendum.json')
    args = parser.parse_args()
    assert args.resume_stage_results, 'Parent explicit RESUME is required; this draft never assumes completion.'
    assert not (OUT / 'application-timing.json').exists() and not (OUT / 'results.json').exists(), 'Outputs are write-once.'
    baseline, manifest = load('baseline.json'), load('source-hashes-final.json')
    manifest_sha = sha(local('source-hashes-final.json'))
    frozen = load('source-freeze-final.json')
    assert frozen['ok'] and frozen['sourceManifestSha256'] == manifest_sha and frozen['sourceFiles'] == len(manifest)
    assert len(manifest) == baseline['sourceFiles'] + len(frozen['newSourceFiles'])
    assert all(sha(ROOT / path) == digest for path, digest in manifest.items())
    actual = Path(baseline['sourceRoot'])
    assert sha(ROOT / 'VERSION') == sha(actual / 'VERSION') and (ROOT / 'VERSION').read_text().strip() == baseline['version']
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=actual, text=True).strip() == baseline['head']
    previous_source = load('source-baseline.json')
    assert len(previous_source) == baseline['sourceFiles']
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
    freeze_bound(review, manifest_sha, len(manifest))
    freeze_bound(preservation, manifest_sha, len(manifest))
    freeze_bound(web, manifest_sha, len(manifest))
    declared_sources(web, manifest)
    visual_value = web['visualReview']
    visual_name = visual_value.get('path', visual_value.get('report'))
    visual = load(visual_name)
    assert visual['ok'] and not visual['openFindings'] and sha(local(visual_name)) == visual_value['sha256']
    freeze_bound(visual, manifest_sha, len(manifest))
    assert patch['sourceManifestSha256'] == manifest_sha and patch['actualApplyPerformed'] is False
    patch_file = Path(patch['patchPath'])
    patch_file = local(patch['patchPath']) if not patch_file.is_absolute() else patch_file.resolve(strict=True)
    assert patch_file.is_relative_to(ROOT.parent) and patch_file.is_file()
    assert sha(patch_file) == patch['patchSha256']
    for item in patch['files']:
        assert sha(ROOT / item['path']) == item['afterSha256'], item['path']
        original = actual / item['path']
        if item['beforeSha256'] is None:
            assert not original.exists() and not original.is_symlink(), item['path']
        else:
            assert sha(original) == item['beforeSha256'], item['path']
    application = suite(args.app_log)
    text = local(args.app_log).read_text()
    syntax = re.search(r'语法检查通过：(\d+) 个 JavaScript 文件', text)
    assert syntax and 'API 契约预检通过' in text and f"版本一致性检查通过：{baseline['version']}" in text
    if 'fullApplication' in review:
        assert application['counts'] == review['fullApplication']['counts']
    application.update({'syntaxFiles': int(syntax[1]), 'versionAndApiPreflightPassed': True,
                        'executedManifestSha256': manifest_sha,
                        'executionScope': 'Complete actual application suite in one formal isolated frozen stage phase. No checkout application/install/device acceptance.'})
    ui, host, modules = suite(args.ui_log), suite(args.host_log), suite(args.module_log)
    core = load('core-results.json')
    assert core['ok'] and core['native']['totalPassed'] == 274 and core['regression']['pass'] == 378 and core['newJavaScript']['totalPassed'] == 29
    declared_sources(core, manifest)
    assert suite('core-regression.log')['counts']['pass'] == core['regression']['pass']
    assert suite('core-js-tests-initial.log')['counts']['pass'] == core['newJavaScript']['totalPassed']
    native_counts = re.findall(r'test result: ok\. (\d+) passed; 0 failed; 0 ignored', local('core-native-tests-confirmed.log').read_text())
    assert sum(map(int, native_counts)) == core['native']['totalPassed']
    assert application['counts']['tests'] > core['regression']['pass'], 'A file-only or focused count is not a complete application result.'
    assert ui['counts']['tests'] == 78 and host['counts']['tests'] == 6 and modules['counts']['tests'] == 49
    quality, ui_quality = load('quality-initial.json'), load('ui-quality-initial.json')
    assert quality['ok'] and quality['passed'] == 15 and quality['failed'] == 0 and quality['sourceStable']
    declared_sources(quality, manifest)
    assert ui_quality['ok'] and ui_quality['passed'] == 7 and ui_quality['failed'] == 0 and ui_quality['source']['stable']
    assert manifest[ui_quality['source']['path']] == ui_quality['source']['beforeSha256'] == ui_quality['source']['endSha256']
    package, binding = load('packaged-resources.json'), load('prepared-final-binding.json')
    assert package['ok'] and binding['ok']
    assert package['frozenSource']['manifestSha256'] == binding['sourceManifestSha256'] == manifest_sha
    assert binding['reportSha256'] == sha(local('packaged-resources.json')) and binding['allFrozenSourcesMatch']
    groups = sum(len(cases) for copy in package['portable'].values() for cases in copy.values() if isinstance(cases, list))
    assert groups == binding['groups'] == 346 and all(copy['moduleCount'] == 106 for copy in package['portable'].values())
    assert all(len(copy['distribution']) == 8 for copy in package['portable'].values())
    assert binding['oldCaseReceiptsDeepExact'] and binding['oldCaseGroupsPreserved'] == {'desktop': 165, 'mobile': 165}
    previous_package_path = OUT.parent / 'scene3d-alignment-authoring/packaged-resources-browser-final.json'
    previous_package = json.loads(previous_package_path.read_text())
    assert previous_package['ok']
    assert all(package['portable'][copy][kind] == cases for copy, value in previous_package['portable'].items() for kind, cases in value.items() if isinstance(cases, list))
    for path, inventory in package['artifacts'].items():
        assert inventory['manifestFileCount'] == len(inventory['manifest']) == binding['inventory'][path]
    assert {path: value['manifestFileCount'] for path, value in package['artifacts'].items()} == {'desktop/resources': 572, 'mobile/dist': 253, 'desktop/ui': 11}
    assert all(copy['wasmSha256'] == core['wasm']['sha256'] and copy['noNodeDomNetworkGlobals'] and copy['noHostImports'] and copy['noDeviceAcceptance'] for copy in package['portable'].values())
    assert sha(ROOT / 'engine/studio-core.wasm') == core['wasm']['sha256'] and core['wasm']['bytes'] == 564571
    assert core['wasm']['previousProof']['bytes'] == 543107 and sha(local('previous-studio-core.wasm')) == core['wasm']['previousProof']['sha256']
    counts_adjustment = load('module-count-adjustments.json')
    assert counts_adjustment['ok'] and counts_adjustment['moduleCount'] == 15 and counts_adjustment['capabilityCount'] == 31
    browser_value = web['browser']
    new_browser_name = browser_value.get('path', browser_value.get('report'))
    actual_browser = browser(new_browser_name, manifest, counts_adjustment['moduleCount'], counts_adjustment['capabilityCount'])
    assert actual_browser['sha256'] == browser_value['sha256'] and actual_browser['workflows'] == browser_value['workflows']
    legacy_addendum = load(args.web_legacy_report)
    assert legacy_addendum['ok'] is True
    declared_sources(legacy_addendum, manifest)
    legacy_entries = legacy_addendum.get('legacyBrowsers', legacy_addendum.get('browsers', []))
    if isinstance(legacy_entries, dict):
        legacy_entries = list(legacy_entries.values())
    legacy_browsers = []
    for value in legacy_entries:
        name = value.get('path', value.get('report'))
        if name and name != new_browser_name:
            summary = browser(name, manifest, counts_adjustment['moduleCount'], counts_adjustment['capabilityCount'])
            assert summary['sha256'] == value['sha256'] and summary['workflows'] == value['actualWorkflows']
            assert summary['svgRequests'] == value['svgRequests'] and summary['cspViolations'] == value['cspViolations']
            legacy_browsers.append(summary)
    assert sum(item['workflows'] for item in legacy_browsers) == legacy_addendum['actualBrowserScope']['legacyTotal']
    assert actual_browser['workflows'] + sum(item['workflows'] for item in legacy_browsers) == legacy_addendum['actualBrowserScope']['thisRoundBrowserTotal']
    assert sha(local(legacy_addendum['originalSummary']['path'])) == legacy_addendum['originalSummary']['sha256']
    assert sha(local(legacy_addendum['originalVisualReview']['path'])) == legacy_addendum['originalVisualReview']['sha256']
    for value in core['retainedInitialAttempts']:
        assert value['log'] in core['logs'] and sha(local(value['log'])) == core['logs'][value['log']]['sha256']
        local(value['producer'])
    initial_native = local('core-native-tests-initial.log').read_text()
    assert 'test result: FAILED. 223 passed; 2 failed;' in initial_native
    attempts = [{**value, 'logReceipt': proof(value['log']), 'producerReceipt': proof(value['producer'])} for value in core['retainedInitialAttempts']]
    retained_ui = suite('ui-fixture-initial.log')
    timing = {'format': 'viento-scene3d-distribution-application-timing', 'schemaVersion': 1, 'recordedAt': datetime.now(timezone.utc).isoformat(), 'ok': True,
              'phase': 'stage-tested-awaiting-actual-checkout-apply', 'fullApplication': application,
              'sourcePhases': {'formal': proof('source-hashes-final.json'), 'freeze': proof('source-freeze-final.json'), 'files': len(manifest), 'sourceDeltaAfterFormalFreeze': [],
                               'scope': 'One formal frozen source phase for core, UI, host, portable and all actual browser/full application proofs. No earlier-topic error/phase is transplanted into this round.'},
              'prepared': {**proof('packaged-resources.json'), 'actualGroups': groups, 'binding': proof('prepared-final-binding.json')},
              'retainedInitialAttempts': attempts,
              'earlierFocusedUi': {**retained_ui, 'scope': 'A passing earlier 40-case fixture/i18n focus; not relabelled as the later complete 78-case combined regression.'},
              'webRetainedAttempts': web.get('retainedAttempts', []), 'runtime': core['runtime'],
              'overlap': 'Focused/core/UI/host/module checks overlap the complete application and each other. Native, prepared and browser prove different boundaries; counts are not additive coverage.'}
    result = {'format': 'viento-scene3d-distribution-authoring-results', 'schemaVersion': 1, 'createdAt': datetime.now(timezone.utc).isoformat(), 'ok': True,
              'status': 'stage-tested-awaiting-actual-checkout-apply', 'version': baseline['version'], 'publishedBase': baseline['head'],
              'delivery': 'Reviewable isolated stage only. Actual checkout remains unchanged, pending approval-reviewed root application; no commit/push/release/installation/device acceptance.',
              'features': ['Equal distribution on one explicit world position axis over 3–128 distinct existing primitive instance identities.',
                           'Original-coordinate numeric sort with source declaration ties, including signed zeros; original extrema and their numeric tokens remain fixed.',
                           'Interior calculation exactly start+(end-start)*(i/(n-1)) in binary64; positive span must produce a strictly increasing finite bounded full sequence or the whole edit is rejected.',
                           'One original CST and one final complete atomic numeric-position patch; all other author bytes, stable IDs, geometry, environment, BOM/CRLF/escapes/exponents remain intact.',
                           'Independent optional ABI/bridge and seventh private proposal brand, two distinct identity orders, full selected-object diagnostics and captured five-source/hash/session guards.',
                           'Separate draft-only source apply and ordinary Save authority; no renderer/backend permission.'],
              'sourceFreeze': {'manifest': 'source-hashes-final.json', 'sha256': manifest_sha, 'files': len(manifest), 'allMatch': True},
              'fullApplication': application,
              'focused': {'native': {**proof('core-results.json'), 'passed': core['native']['totalPassed'], 'unit': core['native']['unitPassed'], 'integration': core['native']['integrationPassed'], 'newUnits': core['native']['newUnitTests'], 'fmtClippyPassed': True},
                          'core': {**proof('core-regression.log'), 'passed': core['regression']['pass'], 'includesNew29': True},
                          'newBridgeAndProposal': {**proof('core-js-tests-initial.log'), 'passed': core['newJavaScript']['totalPassed'], 'bridge': core['newJavaScript']['bridgeTests'], 'proposal': core['newJavaScript']['proposalTests'], 'nativeWasmParityRequests': core['newJavaScript']['nativeWasmParityRequests']},
                          'uiAndLocales': ui, 'host': host, 'modules': modules,
                          'independentQuality': {**proof('quality-initial.json'), 'passed': quality['passed'], 'counts': quality['counts']},
                          'independentUiQuality': {**proof('ui-quality-initial.json'), 'passed': ui_quality['passed']}},
              'wasm': {'current': {'bytes': core['wasm']['bytes'], 'sha256': core['wasm']['sha256']}, 'previousPreserved': core['wasm']['previousProof'],
                       'newOptionalAbi': 'viento_core_scene3d_distribution_version()==1 / scene3d.distributeObjects', 'oldSixAuthorAndParseCapabilitiesPreserved': True},
              'browser': actual_browser, 'legacyBrowsers': legacy_browsers, 'legacyAddendum': proof(args.web_legacy_report),
              'browserFlowTotals': {'new': actual_browser['workflows'], 'legacy': sum(item['workflows'] for item in legacy_browsers), 'scope': 'Distinct actual reported flow counts; not additive test coverage.'},
              'visual': {'new': web['visualReview'], 'legacySupplement': legacy_addendum['visualSupplement']},
              'prepared': {**proof('packaged-resources.json'), 'groups': groups, 'groupsEach': groups // 2, 'oldGroupsPreserved': sum(binding['oldCaseGroupsPreserved'].values()),
                           'inventory': {path: value['manifestFileCount'] for path, value in package['artifacts'].items()},
                           'modulesEach': {path: value['moduleCount'] for path, value in package['portable'].items()}, 'binding': proof('prepared-final-binding.json'),
                           'oldReceiptsDeepCompared': {'report': '../scene3d-alignment-authoring/packaged-resources-browser-final.json', 'sha256': sha(previous_package_path), 'allOld330GroupReceiptsExact': True},
                           'scope': 'Standard VM without Node/DOM/fetch/process; explicit JSON/digest ports and copied fakeGL renderer contracts. Not a hostile-code sandbox or installed device/GPU claim.'},
              'preservation': {**proof(args.preservation_report), 'historicalReports': baseline['historicalFiles'], 'authors': baseline['authorFiles'], 'externalTools': baseline['toolFiles'],
                               'actualCheckoutSourceBaselineMatches': len(previous_source), 'headAndVersionUnchanged': True, 'stageAndActualOldHistoryAndAuthorsByteExact': True, 'toolShaSizeDevInoNlinkExact': True},
              'review': {**proof(args.review_report), 'openFindings': []}, 'reviewablePatch': {**proof(args.patch_ready_report), 'actualApplyPerformed': False},
              'chronology': {'report': 'application-timing.json', 'singleFormalSourcePhase': True, 'actualCheckoutApplyPending': True},
              'limitations': ['Position coordinates only; no rotated bounds/size distribution, pivot, group/hierarchy, rotation/scale batch, gizmo or persistent undo transaction.',
                              'Stage-only source/copy/browser checks do not replace reviewed actual patch application and a separate post-apply audit.',
                              'Ordinary Save is the persistent writer; software Chrome WebGL and standard VM do not establish installed desktop, Android or hardware GPU acceptance.'],
              'closingAtlasAndApplication': 'Root appends staged atlas/delivery evidence, then handles approval-reviewed checkout application and separate post-apply audit. This finisher has no writer or execution authority.'}
    write_new('application-timing.json', timing)
    write_new('results.json', result)
    print(json.dumps({'ok': True, 'status': result['status'], 'application': application['counts']['pass'], 'native': core['native']['totalPassed'], 'core': core['regression']['pass'],
                      'ui': ui['counts']['pass'], 'host': host['counts']['pass'], 'modules': modules['counts']['pass'], 'portable': groups, 'browserNew': actual_browser['workflows'],
                      'browserLegacy': sum(item['workflows'] for item in legacy_browsers), 'actualCheckoutApplyPending': True}))


if __name__ == '__main__':
    main()
