#!/usr/bin/env python3
"""Read final frozen products/evidence; write this round's independent review only."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import stat

EVIDENCE = Path(__file__).resolve().parent
ROOT = EVIDENCE.parents[2]


def sha(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def read(name):
    return json.loads((EVIDENCE / name).read_text())


def inventory(root, skip=None):
    result = set()
    for parent, dirs, files in os.walk(root, followlinks=False):
        parent = Path(parent)
        dirs[:] = [item for item in dirs if not (parent / item).is_symlink()
                   and (skip is None or parent / item != skip)]
        result.update(str((parent / item).relative_to(ROOT)) for item in files)
    return result


def verify_map(name, count=None):
    mapping = read(name)
    if count is not None:
        assert len(mapping) == count, (name, len(mapping))
    for relative, expected in mapping.items():
        file = ROOT / relative
        assert file.is_file() and not file.is_symlink(), relative
        assert sha(file) == expected, relative
    return mapping, {'files': len(mapping), 'baselineSha256': sha(EVIDENCE / name), 'allMatch': True}


def log_summary(name):
    file = EVIDENCE / name
    summary = {}
    for key in ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'duration_ms']:
        matches = re.findall(r'^ℹ ' + key + r' ([\d.]+)$', file.read_text(), re.M)
        assert matches, (name, key)
        summary[key] = float(matches[-1]) if key == 'duration_ms' else int(matches[-1])
    assert summary['tests'] == summary['pass'] and all(summary[key] == 0 for key in ['fail', 'cancelled', 'skipped']), name
    return {'path': name, 'sha256': sha(file), **summary,
            'runBy': 'Owner/root; raw evidence read independently, not rerun by this review.'}


frozen, frozen_check = verify_map('source-hashes.json')
old = read('source-baseline.json')
assert len(old) == 639 and set(old).issubset(frozen)
delta = {name: {'before': old.get(name), 'after': digest} for name, digest in frozen.items() if old.get(name) != digest}
assert delta == read('source-delta.json')
history, history_check = verify_map('historical-baseline.json', 3215)
assert inventory(ROOT / 'docs/test-results', EVIDENCE) == set(history)
authors, author_check = verify_map('author-baseline.json', 39)
assert inventory(ROOT / 'examples') == set(authors)
tools = read('tool-baseline.json')
assert len(tools) == 4
for name, expected in tools.items():
    file = Path(name)
    observed = file.lstat()
    assert stat.S_ISREG(observed.st_mode)
    actual = {'bytes': observed.st_size, 'sha256': sha(file), 'dev': observed.st_dev, 'ino': observed.st_ino}
    assert actual == expected, name
protected = {name: digest for name, digest in old.items() if
             (name.startswith('crates/viento-studio-core/') and name.endswith('.rs') and not name.endswith('/lib.rs'))
             or name.startswith('scripts/backends/')
             or name in ['src-tauri/src/project_templates.rs', 'src-tauri/src/workspace.rs']
             or name.startswith('scripts/tests/') and name.endswith('-smoke.mjs')}
for name, expected in protected.items():
    assert frozen[name] == expected, name

browser = read('browser-final/browser.json')
assert browser['ok'] and len(browser['steps']) == 11 and browser['sourceStableDuringProof']
assert not browser['errors'] and not browser['svgRequests']
assert browser['node']['version'] == 'v24.20.0'
assert browser['node']['sha256'] == read('fixed-node.json')['nodeSHA256']
for name, expected in browser['sources'].items():
    assert frozen[name] == expected and sha(ROOT / name) == expected, name
assert {phase['mode'] for phase in browser['capabilityPhases']} == {'absent', 'unsupported'}
assert all(phase['newEntryDisabled'] and len(phase['oldEditorsOpenedAndCanceled']) == 8 for phase in browser['capabilityPhases'])
assert set(browser['layout']) == {'zh-CN', 'en', 'ja'}
assert all(all(value.values()) for value in browser['layout'].values())
assert len(browser['capturePhases']) == 4
assert browser['captures'] == [entry for phase in browser['capturePhases'] for entry in phase['captures']]
saved_conflicts = [capture for capture in browser['captures'] if capture['status'] == 409]
assert all(not capture['payload']['ok'] and capture['payload']['errorCode'] == 'world_read_conflict'
           and 'draft' not in capture['request'] for capture in saved_conflicts)
assert all(capture['status'] == 200 for capture in browser['captures'] if capture not in saved_conflicts)
rejected = [capture for capture in browser['captures'] if capture['status'] == 200 and not capture['payload']['ok']]
assert len(rejected) == 1 and any(item['code'] == 'build_projection_runtime' for item in rejected[0]['payload']['diagnostics'])
assert not any('/node_modules/' in item['url'] for item in browser['bootstrapDiagnostics']['httpFailures'])
changes = [name for name, digest in browser['authorFiles']['before'].items() if browser['authorFiles']['after'].get(name) != digest]
assert changes == [browser['normalSave']['onlyChangedFile']]
assert set(browser['authorFiles']['before']) == set(browser['authorFiles']['after'])
initial = read('browser-initial/browser.json')
assert not initial['ok'] and len(initial['steps']) == 3 and "'support'" in initial['failure']
second = read('browser-second/browser.json')
third = read('browser-third/browser.json')
assert not second['ok'] and not second['steps'] and not third['ok'] and not third['steps']
assert any(item['status'] == 404 and item['url'].endswith('/node_modules/yaml/browser/index.js') for item in third['bootstrapDiagnostics']['httpFailures'])

screenshots = ['definitions-narrow-zh-CN.png', 'definitions-impact-zh-CN.png', 'definitions-narrow-en.png', 'definitions-impact-en.png',
               'definitions-narrow-ja.png', 'definitions-impact-ja.png', 'definitions-reviewed.png']
screen_records = [{'path': 'browser-final/' + name, 'sha256': sha(EVIDENCE / 'browser-final' / name),
                   'reviewedVisually': True} for name in screenshots]
native = read('reviewer-native-provenance-frozen.json')
assert native['ok'] and len(native['binaries']) == 3
assert native['manifestSha256'] == sha(EVIDENCE / 'native-helpers.json')
build = json.loads((ROOT / 'engine/studio-core.build.json').read_text())
assert sha(ROOT / 'engine/studio-core.wasm') == build['wasmSha256'] == native['wasm']['sha256']
assert (ROOT / 'engine/studio-core.wasm').stat().st_size == build['bytes'] == native['wasm']['bytes']
for relative, expected in build['sources'].items():
    file = ROOT / ('scripts/build-studio-core.mjs' if relative == 'build-script' else 'crates/viento-studio-core/' + relative)
    assert sha(file) == expected, relative

rust_file = EVIDENCE / 'core-native-test.log'
rust_runs = re.findall(r'test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored;', rust_file.read_text())
assert sum(int(run[0]) for run in rust_runs) == 163 and all(run[1:] == ('0', '0') for run in rust_runs)
core_results = read('core-results.json')
for name, expected in core_results['sourceHashes'].items():
    assert frozen[name] == expected, name
assert core_results['verification']['wasm']['bytes'] == build['bytes']
assert core_results['verification']['wasm']['sha256'] == build['wasmSha256']
assert core_results['verification']['rust']['total'] == 163

review = {
    'format': 'viento-scene-composition-definition-authoring-independent-review', 'schemaVersion': 1,
    'recordedAt': datetime.now(timezone.utc).isoformat(), 'ok': True, 'openFindings': [],
    'scope': 'Independent read-only source/receipt review and owned NEW real HTTP/Chrome smoke; no product edits, native build, execution backend, installation or device claim.',
    'finalSourceFreeze': {'path': 'source-hashes.json', 'sha256': sha(EVIDENCE / 'source-hashes.json'), **frozen_check,
                          'previousFiles': 639, 'deltaFiles': len(delta), 'newFiles': sum(item['before'] is None for item in delta.values()), 'deltaManifestMatches': True},
    'reviewedSources': browser['sources'],
    'boundaries': [
        'ADD appends a complete native raw fragment. UI creates one actor and groups:[]. COPY appends an independent definition by replacing only the original fragmentId value token in its CST span. REMOVE accepts only a non-last unplaced definition. No rename, reorder, cascade, generated instance allocation, transforms or cross-file transaction.',
        'Every new proposal has the exact eight-field source-owned shape and targets:[]; empty targets represent no generated instance effects, not permission to skip exact source recomputation or complete candidate checks.',
        'Rust validates complete original and final recipe expansion with the existing UTF-8 128 KiB, 32-fragment, 128 declared/expanded actor/group/placement and hierarchy limits, including unused declarations. Pure prepare snapshots JSON before awaits and reconstructs the exact action, complete candidate bytes and changedPaths.',
        'Complete candidate review binds ordered actors/groups, organization names/parents/memberships, recipe ownership and revisions, counts, declared runtime fields and every provided current declaration/contributor source range after unused-fragment removal. Optional omission retains the existing DTO contract.',
        'The candidate imports no host YAML parser. A separately dispatched read-only definition ABI operation locates bounded unique pointers in Rust CST, emits UTF16 ranges including BOM and non-BMP text, and leaves author edit receipts/live geometry sessions separate. Existing static node_modules denial remains.',
        'Controller allocates no UUID, preserves local keys/raw input through checks and live languages, declines silent unreviewed intent or detached asynchronous results, and uses independently owned source review/ordinary Save ports.',
        'Basic object and explicit-image registration checks already cover all raw fragments. Effective projection compatibility and inherited/consumed image contents are checked at first actual placement. A valid raw unused inheritance declaration can remain unrenderable until placement; no unused ready-render claim or new read gate is introduced.',
        'Actual creation passed through the existing independent shared actor, organization group and placement editors before ordinary Save/reopen. Only placement allocated instance/group UUID maps and first consumed the new inherited image.',
        'Nine actual HTTP deliveries with wrong actor position/order/provenance, group provenance, fragment count, pointer, range start/end or contribution order were rejected. True server captures were detached before mutation and rejected preview leases were released.',
        'Memory Apply retains disk bytes until ordinary Save. Exact BOM/CRLF, escaped keys, exponent coordinates, explicit null/default flags, old definition bodies and placements/offsets/overrides are preserved; external-write Save conflict retains local reviewed candidate and external disk bytes.',
        'Capability absence or unsupported version closes only the ninth entry; all eight earlier recipe editors still open/cancel through current real helpers. Recipes remain static authoring/preview documents; no execution backend job starts.'
    ],
    'browser': {'path': 'browser-final/browser.json', 'sha256': sha(EVIDENCE / 'browser-final/browser.json'),
                'runBy': 'This independent reviewer', 'stepsPassed': 11, 'browser': browser['browser'], 'node': browser['node'],
                'realHttpPostCaptures': len(browser['captures']), 'expectedFirstPlacementRejections': len(rejected),
                'guardedBackgroundSavedReadConflicts': len(saved_conflicts),
                'networkDiagnosticsScope': 'Three background saved-preview requests encountered guarded world_read_conflict while author Save/rebuild changed the source; every explicitly reviewed candidate succeeded or failed as expected. Final Save conflict deliberately returned409. No private-module loading failure remained.',
                'phases': [{'name': phase['name'], 'postCaptures': len(phase['captures']), 'observedDeleteCaptures': len(phase['released'])} for phase in browser['capturePhases']],
                'runtimeErrors': 0, 'externalSvgRequests': 0, 'sourceHashesMatchedFrozenManifest': True,
                'onlyChangedDisposableAuthorFile': changes[0], 'ordinarySaveConflictPreserved': True, 'faultInjections': browser['faultInjections']},
    'visual': {'screenshots': screen_records, 'languages': browser['layout'],
               'finding': 'All seven viewport images inspected after final success: 390px forms/impact rows wrap without horizontal overflow and persistent Check/Apply/Cancel actions remain visible.',
               'limit': 'Viewport samples; complete definition data, dependencies, identities, organization and shifted provenance are checked by DOM and real HTTP beyond screenshots.'},
    'ownerExecutedEvidenceChecked': {'logs': [log_summary(name) for name in ['core-pure-tests.log', 'core-bridge-tests.log', 'core-regression-final.log', 'web-focused-second.log', 'web-regression.log', 'workflow-tests-final.log']],
                                    'rust': {'path': 'core-native-test.log', 'sha256': sha(rust_file), 'passed': 163, 'failed': 0, 'ignored': 0},
                                    'coreResults': {'path': 'core-results.json', 'sha256': sha(EVIDENCE / 'core-results.json'), 'allSourceHashesAndFinalNativeWasmCountsMatch': True},
                                    'nativeProof': {'path': 'reviewer-native-provenance-frozen.json', 'sha256': sha(EVIDENCE / 'reviewer-native-provenance-frozen.json'), **native},
                                    'fullApplicationAndPrepared': 'Root owns full application and prepared-copy checks; their final counts are reported by root separately, not inferred from this browser review.'},
    'preservation': {'historical': history_check, 'authors': author_check, 'externalTools': {'files': 4, 'allBytesAndPhysicalIdentitiesMatch': True},
                     'unchangedProtectedSourceHashes': protected,
                     'note': 'Complete historical evidence and example inventories match. Existing Rust domains/tests apart from explicit dispatcher integration, backends, prior smokes and native profile/workspace sources remain byte-preserved.'},
    'retainedFailures': [
        {'path': 'browser-initial/browser.json', 'sha256': sha(EVIDENCE / 'browser-initial/browser.json'), 'stepsPassed': 3,
         'cause': 'NEW fixture confused identity-map key ordering with actor declaration ordering; repaired only NEW assertion to check the map key set and actual declaration order separately.'},
        {'path': 'browser-second/browser.json', 'sha256': sha(EVIDENCE / 'browser-second/browser.json'), 'stepsPassed': 0,
         'cause': 'Actual editor bootstrap failed after new candidate imported host-only YAML source parser.'},
        {'path': 'browser-third/browser.json', 'sha256': sha(EVIDENCE / 'browser-third/browser.json'), 'stepsPassed': 0,
         'cause': 'Independent console/network diagnostics confirm blocked /node_modules/yaml/browser/index.js HTTP404/application-json/ERR_ABORTED. Root/core repaired the dependency through a native CST receipt; the static node_modules denial remains.'}
    ],
    'limitations': browser['limitations'] + ['Boot-export and detached-response injections are bounded compatibility tests, not an old binary or hostile-code sandbox proof.',
                                          'Joint last/used UI gate is checked on a valid one-fragment recipe; the native last-fragment rejection remains a separate operation contract. No unused resource-readiness, installed Tauri or Android device acceptance.'],
}
(EVIDENCE / 'review.json').write_text(json.dumps(review, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'ok': True, 'sourceFiles': len(frozen), 'historicalFiles': 3215, 'authorFiles': 39,
                  'browserFlows': 11, 'httpPostCaptures': len(browser['captures']), 'screenshotsViewed': 7,
                  'openFindings': [], 'reviewSha256': sha(EVIDENCE / 'review.json')}, ensure_ascii=False))
