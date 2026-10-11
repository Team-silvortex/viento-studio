#!/usr/bin/env python3
"""Read current frozen code/evidence only; write this round's independent review."""
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


def verify_map(name, expected_count):
    mapping = read(name)
    assert len(mapping) == expected_count, (name, len(mapping))
    for relative, expected in mapping.items():
        file = ROOT / relative
        assert file.is_file() and not file.is_symlink(), relative
        assert sha(file) == expected, relative
    return mapping, {'files': len(mapping), 'baselineSha256': sha(EVIDENCE / name), 'allMatch': True}


def log_summary(name):
    file = EVIDENCE / name
    text = file.read_text()
    summary = {}
    for key in ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'duration_ms']:
        matches = re.findall(r'^ℹ ' + key + r' ([\d.]+)$', text, re.M)
        assert matches, (name, key)
        summary[key] = float(matches[-1]) if key == 'duration_ms' else int(matches[-1])
    assert summary['tests'] == summary['pass'] and all(summary[key] == 0 for key in ['fail', 'cancelled', 'skipped']), name
    return {'path': name, 'sha256': sha(file), **summary, 'runBy': 'Owner/root, read and checked independently; not rerun by this review.'}


frozen, frozen_check = verify_map('source-hashes.json', 639)
old = read('source-baseline.json')
assert len(old) == 628 and set(old).issubset(frozen)
delta = {name: {'before': old.get(name), 'after': digest} for name, digest in frozen.items() if old.get(name) != digest}
assert delta == read('source-delta.json') and len(delta) == 28
assert sum(item['before'] is None for item in delta.values()) == 11
history, history_check = verify_map('historical-baseline.json', 3111)
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
             or name in ['scripts/adapters/godot4-adapter.mjs', 'scripts/adapters/bevy-adapter.mjs',
                         'src-tauri/src/project_templates.rs', 'src-tauri/src/workspace.rs']
             or name.startswith('scripts/tests/') and name.endswith('-smoke.mjs')}
for name, expected in protected.items():
    assert frozen[name] == expected, name

browser = read('browser-confirmed/browser.json')
assert browser['ok'] and len(browser['steps']) == 10 and browser['sourceStableDuringProof']
assert not browser['errors'] and not browser['svgRequests']
assert browser['node']['version'] == 'v24.20.0'
assert browser['node']['sha256'] == read('fixed-node.json')['nodeSHA256']
assert len(browser['sources']) == 14
for name, expected in browser['sources'].items():
    assert frozen[name] == expected and sha(ROOT / name) == expected, name
assert len(browser['capabilityPhases']) == 2
assert {phase['mode'] for phase in browser['capabilityPhases']} == {'absent', 'unsupported'}
assert all(phase['newEntryDisabled'] and len(phase['oldEditorsOpenedAndCanceled']) == 7 for phase in browser['capabilityPhases'])
assert set(browser['layout']) == {'zh-CN', 'en', 'ja'}
assert all(all(value.values()) for value in browser['layout'].values())
initial = read('browser-initial/browser.json')
assert initial['ok'] is False and len(initial['steps']) == 8 and 'Timed out: #scenePreviewComposition enabled' in initial['failure']
second = read('browser-second/browser.json')
assert second['ok'] and len(second['steps']) == 10
assert len(browser['capturePhases']) == 4
assert browser['captures'] == [entry for phase in browser['capturePhases'] for entry in phase['captures']]
assert all(capture['status'] == 200 and capture['payload']['ok'] for capture in browser['captures'])
changes = [name for name, digest in browser['authorFiles']['before'].items() if browser['authorFiles']['after'].get(name) != digest]
assert changes == [browser['normalSave']['onlyChangedFile']]
assert set(browser['authorFiles']['before']) == set(browser['authorFiles']['after'])

screenshots = ['groups-narrow-zh-CN.png', 'groups-impact-zh-CN.png', 'groups-narrow-en.png', 'groups-impact-en.png',
               'groups-narrow-ja.png', 'groups-impact-ja.png', 'groups-reviewed.png']
screen_records = [{'path': 'browser-confirmed/' + name, 'sha256': sha(EVIDENCE / 'browser-confirmed' / name),
                   'reviewedVisually': True} for name in screenshots]
native = read('native-helpers.json')
assert len(native['binaries']) == 3
for entry in native['binaries']:
    file = Path(entry['path'])
    assert file.is_file() and not file.is_symlink()
    assert file.stat().st_size == entry['bytes'] and sha(file) == entry['sha256'], entry['path']
build = json.loads((ROOT / 'engine/studio-core.build.json').read_text())
assert sha(ROOT / 'engine/studio-core.wasm') == build['wasmSha256']
assert (ROOT / 'engine/studio-core.wasm').stat().st_size == build['bytes'] == 362582
for relative, expected in build['sources'].items():
    file = ROOT / ('scripts/build-studio-core.mjs' if relative == 'build-script' else 'crates/viento-studio-core/' + relative)
    assert sha(file) == expected, relative
rust_file = EVIDENCE / 'core-native-test.log'
rust_runs = re.findall(r'test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored;', rust_file.read_text())
assert sum(int(run[0]) for run in rust_runs) == 150 and all(run[1:] == ('0', '0') for run in rust_runs)
logs = [log_summary(name) for name in ['core-pure-tests.log', 'core-bridge-tests.log', 'core-regression-final.log',
                                     'web-focused-second.log', 'web-regression.log', 'workflow-tests-final.log']]

review = {
    'format': 'viento-scene-composition-group-authoring-independent-review', 'schemaVersion': 1,
    'recordedAt': datetime.now(timezone.utc).isoformat(), 'ok': True, 'openFindings': [],
    'scope': 'Independent read-only source/receipt review and owned NEW real HTTP/Chrome smoke; no product edits, native rebuild, engine execution, installation or device claim.',
    'finalSourceFreeze': {'path': 'source-hashes.json', 'sha256': sha(EVIDENCE / 'source-hashes.json'), **frozen_check,
                          'previousFiles': 628, 'deltaFiles': 28, 'newFiles': 11, 'deltaManifestMatches': True},
    'reviewedSources': browser['sources'],
    'boundaries': [
        'Four independently gated actions: ADD complete explicit source-ordered fresh group UUID mappings; EDIT full raw name and nullable parent; ASSIGN nullable raw groupKey; REMOVE raw empty leaf only. No implicit promotion, transformations or reorder.',
        'ADD generated IDs are distinct from existing generated actor/group and placement IDs. The pure host helper also rejects the selected scene UUID; Rust recipe content alone does not contain that scene UUID. Definition object IDs remain a separate reusable reference domain.',
        'Rust validates the complete original recipe, exact operation shape, one atomic CST patch and the final complete expansion. Original/final UTF-8 128 KiB, fragment/placement and declared/expanded actor/group budgets and depth16 apply, including unused declarations.',
        'Semantic noops preserve original bytes and empty changedPaths in Rust; pure/UI decline an unchanged authoring proposal. Nullable parents and memberships delete only those declarations rather than inserting null.',
        'Pure factory and prepare snapshot complete JSON before awaits, bind original actor/group provenance, recompute exact source patch, changedPaths and every AFTER target name/parent/membership in source order. Forged targets or old source owner fail closed.',
        'The independent groups candidate matcher verifies full source-ordered group/name/parent structures and memberships after identity/provenance checks; UUID matching alone cannot approve group changes. Earlier candidate domains are kept unchanged.',
        'Controller snapshots reviewed proposals, holds one action allocation through raw edits/language changes, rejects silent unreviewed intent and detached asynchronous results, and uses the existing source-owned workflow/ordinary Save ports.',
        'Actual HTTP candidates with correct identities but wrong group name, parent or membership were rejected and their exact temporary previewId was released. A held response after child/parent closure and visible source input never changed or reopened the new owner.',
        'Actual four actions retained old IDs/order, offsets including absence versus explicit zero, all six override values, OC/projection/image references and effective actor geometry/attributes. Unaffected source spans, BOM, CRLF, escaped map keys and fractional exponent spelling remained exact.',
        'Actual source apply is memory-only; ordinary Save persists exact candidate bytes and reopen matches complete structure. External-write Save conflict retains reviewed local draft and disk source separately.',
        'Unused fragments retain raw membership deletion gates, accept source-only edits with targets[], and allow the last empty group to be deleted while keeping groups:[]. No nonexistent effective instance or unused projection rendering is claimed.',
        'Capability absent/unsupported boot injections alter only the new export; all seven prior recipe editors still open/cancel through current real helpers. Backend execution remains unavailable and no backend job is started.'
    ],
    'browser': {'path': 'browser-confirmed/browser.json', 'sha256': sha(EVIDENCE / 'browser-confirmed/browser.json'),
                'runBy': 'This independent reviewer', 'stepsPassed': 10, 'browser': browser['browser'], 'node': browser['node'],
                'realHttpPostCaptures': len(browser['captures']), 'phases': [{'name': phase['name'], 'postCaptures': len(phase['captures']),
                  'observedDeleteCaptures': len(phase['released'])} for phase in browser['capturePhases']],
                'runtimeErrors': 0, 'externalSvgRequests': 0, 'sourceHashesMatchedFrozenManifest': True,
                'onlyChangedDisposableAuthorFile': changes[0], 'ordinarySaveConflictPreserved': True,
                'faultInjections': browser['faultInjections']},
    'visual': {'screenshots': screen_records, 'languages': browser['layout'],
               'finding': 'All seven screenshots inspected. At 390px group names/long IDs wrap, no horizontal overflow, persistent Check/Apply/Cancel footer remains visible; complete impacts and source are scrollable.',
               'limit': 'Viewport samples, not a whole-page proof. The desktop image samples impacts/source/footer; complete labels, ordered identities and memberships are checked from DOM/HTTP beyond screenshots.'},
    'ownerExecutedEvidenceChecked': {'logs': logs, 'rust': {'path': 'core-native-test.log', 'sha256': sha(rust_file), 'passed': 150, 'failed': 0, 'ignored': 0},
                                    'nativeHelpersManifestSha256': sha(EVIDENCE / 'native-helpers.json'), 'allThreeCurrentBinariesReadAndHashMatched': True,
                                    'wasm': {'bytes': build['bytes'], 'sha256': build['wasmSha256'], 'buildSourceHashesMatch': True},
                                    'fullApplicationAndPrepared': 'Root owns full application and prepared-copy checks. They were running/pending at this review; no completed full/prepared result is inferred here.'},
    'preservation': {'historical': history_check, 'authors': author_check, 'externalTools': {'files': 4, 'allBytesAndPhysicalIdentitiesMatch': True},
                     'unchangedProtectedSourceHashes': protected,
                     'note': 'All 3111 historical evidence files and complete historical inventory remain unchanged. All 39 author files and complete example inventory remain unchanged. Existing Rust domain/test files except explicit dispatcher integration, backend sources, prior smoke scripts and native profile/workspace sources are byte-preserved.'},
    'retainedInitialFailure': {'path': 'browser-initial/browser.json', 'sha256': sha(EVIDENCE / 'browser-initial/browser.json'), 'stepsPassedBeforeFailure': 8,
                              'cause': 'Only NEW smoke used scenePreviewComposition instead of existing scenePreviewCompositionOverride for prior form entry. NEW fixture corrected; no product repair. Initial report/log/failure PNG remain immutable.',
                              'second': {'path': 'browser-second/browser.json', 'sha256': sha(EVIDENCE / 'browser-second/browser.json'), 'stepsPassed': 10},
                              'otherOwnerInitialEvidence': 'Owner logs retain initial helper parse failure and NEW workflow overbroad full-DTO comparison failure; final workflow-tests-final.log is the actual 59/59 success. No failed confirmed log is presented as a pass.'},
    'limitations': browser['limitations'] + ['Standard Chrome boot-export/fetch-delivery fault injection is bounded compatibility evidence, not an old binary or hostile-code sandbox test.',
                                          'Source authoring and static preview only. Organizational hierarchy carries no transforms, rendering order or executable backend semantics; no cross-file transaction, runtime behavior, installed Tauri or Android device acceptance.'],
}
(EVIDENCE / 'review.json').write_text(json.dumps(review, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'ok': True, 'sourceFiles': 639, 'historicalFiles': 3111, 'authorFiles': 39, 'tools': 4,
                  'browserFlows': 10, 'httpPostCaptures': len(browser['captures']), 'screenshotsViewed': 7,
                  'openFindings': [], 'reviewSha256': sha(EVIDENCE / 'review.json')}, ensure_ascii=False))
