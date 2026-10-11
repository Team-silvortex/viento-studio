"""Record this atomic batch slice and remove only its initially absent artifacts.

Run only after the app, browser and prepared-resource checks complete.
This audit script does not create a release, installer, commit or source archive.
"""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = Path(__file__).resolve().parent
GENERATED = {
    'desktop/resources', 'desktop/ui/i18n', 'desktop/.cache',
    'src-tauri/binaries', 'mobile/dist',
    '/tmp/viento-composition-batch-core-target',
    '/tmp/viento-composition-batch-native-target',
    '/tmp/viento-composition-batch-wasm-target',
}


def read(name):
    return json.loads((EVIDENCE / name).read_text())


def digest(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def save(name, value):
    with (EVIDENCE / name).open('x') as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write('\n')


def preserved(name):
    entries = read(name)
    mismatches = [file for file, expected in entries.items()
                  if digest(ROOT / file) != expected]
    assert not mismatches, (name, mismatches)
    return {'baseline': name, 'files': len(entries),
            'unchanged': len(entries), 'mismatches': mismatches}


def test_facts(name):
    text = (EVIDENCE / name).read_text()
    facts = {key: int(re.findall(r'^[ℹ#] ' + key + r' (\d+)$', text, re.M)[-1])
             for key in ('tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo')}
    facts['durationMs'] = float(re.findall(r'^[ℹ#] duration_ms ([\d.]+)$', text, re.M)[-1])
    assert facts['tests'] == facts['pass']
    assert not any(facts[key] for key in ('fail', 'cancelled', 'skipped', 'todo'))
    return facts, text


assert not any((EVIDENCE / name).exists() for name in
               ('historical-preservation.json', 'cleanup.json', 'results.json'))
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
assert head == '9065667363a99a28aa64855f49052f5ee1d6f581'
assert (ROOT / 'VERSION').read_text().strip() == '0.0.9'
app, app_log = test_facts('app-check.log')
focus, _ = test_facts('focused-tests.log')
core, _ = test_facts('core-focus-tests.log')
assert app['tests'] == 2082 + 66 and focus['tests'] == 249 and core['tests'] == 74
assert '语法检查通过：444 个 JavaScript 文件' in app_log
assert 'API 契约预检通过' in app_log and '版本一致性检查通过：0.0.9（构建 0.0.9）' in app_log
rust_log = (EVIDENCE / 'core-tests.log').read_text()
rust_passed = sum(map(int, re.findall(r'test result: ok\. (\d+) passed;', rust_log)))
assert rust_passed == 93 and not re.search(r'test result: FAILED|[1-9]\d* failed;', rust_log)
browser = read('browser/browser.json')
assert browser['ok'] and len(browser['steps']) == 5 and not browser['errors'] and not browser['svgRequests']
assert all(browser['layout'].values())
single = read('single-regression/browser.json')
assert single['ok'] and len(single['steps']) == 7 and not single['errors'] and not single['svgRequests']
prepared = read('packaged-resources.json')
assert prepared['ok'] and prepared['version'] == '0.0.9' and prepared['embeddedNode']['version'] == 'v24.20.0'
assert prepared['counts'] == {'desktopCases': 8, 'mobileCases': 8, 'totalCases': 16}
assert digest(EVIDENCE / 'prepared-check.mjs') == prepared['proofSourceSha256']
assert prepared['sourceAndPreparedManifestsStableDuringAcceptance']
review = read('boundary-review.json')
assert review['ok'] and not review['openFindings']
for name, expected in review['sourceSha256'].items():
    assert digest(ROOT / name) == expected
helpers = read('native-helpers.json')
for item in helpers['binaries']:
    file = Path(item['path'])
    assert file.stat().st_size == item['bytes'] and digest(file) == item['sha256']
wasm_build = json.loads((ROOT / 'engine/studio-core.build.json').read_text())
assert digest(ROOT / 'engine/studio-core.wasm') == wasm_build['wasmSha256']
for name, expected in wasm_build['sources'].items():
    source = ROOT / ('scripts/build-studio-core.mjs' if name == 'build-script' else 'crates/viento-studio-core/' + name)
    assert digest(source) == expected
preservation = {'ok': True, 'recordedAt': datetime.now(timezone.utc).isoformat(),
                'historical': preserved('historical-baseline.json'),
                'frozenGodotBackend': preserved('frozen-backend-baseline.json'),
                'singleInstanceImplementationsAndSmokeHarnesses': preserved('single-instance-baseline.json'),
                'currentProductTestsVersionsWasmAndEngineReadme': preserved('source-hashes.json'),
                'oldReportsRetainOriginalExecutionConditions': True}
assert preservation['historical']['files'] == 2193
assert preservation['frozenGodotBackend']['files'] == 7
assert preservation['singleInstanceImplementationsAndSmokeHarnesses']['files'] == 5
assert preservation['currentProductTestsVersionsWasmAndEngineReadme']['files'] == 543
save('historical-preservation.json', preservation)
baseline = read('generated-baseline.json')
assert set(baseline) == GENERATED and all(value is False for value in baseline.values())
tools = json.loads((EVIDENCE.parent / 'release-0.0.9/cleanup.json').read_text())['retainedTools']
for tool in tools:
    file = Path(tool['path'])
    assert file.stat().st_size == tool['bytes'] and digest(file) == tool['sha256']
seen, entries = set(), []
for name in baseline:
    target = ROOT / name
    assert target.is_dir() and stat.S_ISDIR(target.lstat().st_mode)
    allocated = logical = count = 0
    for directory, dirs, files in os.walk(target, followlinks=False):
        for file in [Path(directory), *(Path(directory) / value for value in files),
                     *(Path(directory) / value for value in dirs if (Path(directory) / value).is_symlink())]:
            metadata = file.lstat()
            inode = (metadata.st_dev, metadata.st_ino)
            if inode not in seen:
                seen.add(inode)
                allocated += metadata.st_blocks * 512
            if stat.S_ISREG(metadata.st_mode):
                logical += metadata.st_size
                count += 1
    entries.append({'path': name, 'existedBefore': False, 'allocatedBytes': allocated,
                    'logicalFileBytes': logical, 'fileCount': count})
    shutil.rmtree(target)
    assert not target.exists()
    entries[-1]['removed'] = True
freed = sum(item['allocatedBytes'] for item in entries)
cleanup = {'ok': True, 'recordedAt': datetime.now(timezone.utc).isoformat(),
           'scope': 'Only eight exact generated directories proven initially absent. '
                    'No source archive was created. Shared rebuilt WASM and dependencies, '
                    'existing outputs, external tools, user works, settings and installations '
                    'are outside all removal targets.',
           'removedDirectories': len(entries), 'allocatedBytesFreed': freed,
           'allocatedGiBFreed': round(freed / 1024**3, 3), 'entries': entries,
           'retainedTools': tools, 'sharedRebuiltWasmRetained': True,
           'userDataAndInstalledApplicationsExcludedFromMutationTargets': True}
save('cleanup.json', cleanup)

results = {'ok': True, 'date': '2026-10-11', 'recordedAt': datetime.now(timezone.utc).isoformat(),
           'sourceVersion': '0.0.9', 'baseCommit': head, 'delivery': 'unreleased-working-tree',
           'scope': 'One recipe source session, multiple stable instances, position-only atomic source patches. '
                    'Independent canvas selection, Rust geometry and 100-step batch history, full dependency '
                    'review, guarded editor-memory application and ordinary Save remain separate.',
           'feature': {'function': 'scene.composition_batch_canvas', 'fields': ['position'],
                       'maxInstances': 128, 'worldToLocalPerPlacement': True,
                       'unmovedFractionalAxesPreserved': True, 'allBoundsBeforeHistoryMutation': True,
                       'groupDescendantSelectionAndSearch': True, 'sixSizeAwareAlignments': True,
                       'singleRustHistoryForAllInstances': True, 'onlyNetChangedTargetsInSourceOrder': True,
                       'samePlacementAppendsAggregated': True, 'finalSourceBudgetOnly': True,
                       'sharedFragmentsOffsetsOtherFieldsStable': True,
                       'independentOptionalCompositionPositionsCapability': 1},
           'application': {**app, 'log': 'app-check.log', 'node': '24.20.0 (pinned embedded)',
                           'javascriptFiles': 444, 'apiContract': 'passed', 'versionPreflight': '0.0.9',
                           'actualGodotAndBevyRegression': True, 'freshNativeHelpers': True},
           'focused': {**focus, 'log': 'focused-tests.log', 'includedInApplicationCount': True,
                       'newJavascriptTests': app['tests'] - 2082,
                       'coreFocused': {**core, 'log': 'core-focus-tests.log', 'overlapsApplicationAndFocused': True},
                       'pureHelper': 15, 'newProtocolBridge': 10, 'newUi': 24,
                       'parentCallbacks': 7, 'actualEditorHost': 8, 'previewEntryAdded': 2,
                       'initialUiNode': '24.21.0 (system)', 'initialUiFinalLog': 'ui-tests-final.log',
                       'drawingSpyScopeSeparateFromActualBrowser': True},
           'rust': {'passed': rust_passed, 'log': 'core-tests.log', 'oldTests': 87, 'newTests': 6,
                    'fmt': 'core-fmt.log', 'clippyDenyWarnings': 'core-clippy.log',
                    'freshNativeCli': 'core-native-build.log', 'freshWasm': 'core-wasm-build.log',
                    'wasmBytes': wasm_build['bytes'], 'wasmSha256': wasm_build['wasmSha256']},
           'browser': {'evidence': 'browser/browser.json', 'browser': browser['browser'],
                       'steps': len(browser['steps']), 'runtimeExceptions': 0,
                       'localesAt390px': ['zh-CN', 'en', 'ja'], 'screenshotsVisuallyInspected': True,
                       'layout': browser['layout'], 'ordinarySave': browser['normalSave'],
                       'scope': 'Actual Chrome pointer/keyboard and HTTP editor in a disposable workspace.'},
           'singleInstanceBrowserRegression': {'evidence': 'single-regression/browser.json', 'steps': 7,
                                              'actualOldCanvasApplyAndNormalSave': True, 'runtimeExceptions': 0},
           'preparedResources': {'evidence': 'packaged-resources.json', 'scope': prepared['scope'],
                                 'embeddedNode': prepared['embeddedNode'], 'harnessSha256': prepared['proofSourceSha256'],
                                 'artifacts': {name: {key: item[key] for key in
                                     ('manifestFileCount', 'manifestSha256', 'checkedSourceFiles')}
                                     for name, item in prepared['artifacts'].items()},
                                 'counts': prepared['counts'], 'mobileChecks': prepared['mobileChecks']},
           'boundaryReview': {'evidence': 'boundary-review.json', 'probe': 'boundary-probe.json',
                              'resolved': 'A late asynchronous opening failure now checks its originating preview owner before showing an alert.'},
           'sourceHashes': 'source-hashes.json', 'preservation': 'historical-preservation.json',
           'nativeHelperBytes': 'native-helpers.json', 'cleanup': 'cleanup.json',
           'initialAttempts': [
               {'log': 'core-tests-initial.log', 'cause': 'Two newly authored fixtures were invalid or failed to construct the intended malformed source; fixture assertions corrected.'},
               {'log': 'ui-tests-initial.log', 'cause': 'New group fixture counted both checkboxes and buttons; assertion corrected to inputs.'},
               {'log': 'focused-tests-initial.log', 'passed': 248, 'tests': 249,
                'cause': 'New preview fixture changed a clean-source token but incorrectly expected its saved-preview entry to disable. It now simulates an actual edit with dirty=true; product unchanged.'},
               {'log': 'desktop-prepare-initial.log', 'cause': 'Root ran preparation while the pinned executable was in use; ETXTBSY. Final preparation ran with the system Node while the pinned process was idle.'},
               {'log': 'native-helpers-build-initial.log', 'cause': 'Root initially supplied a nonexistent archive-test Cargo feature; retried the documented example command.'},
               {'log': 'native-helpers-resources-initial.log', 'cause': 'Native preparation initially preceded the required desktop resource copy; rebuilt after successful preparation.'},
               {'log': 'prepared-check-initial.log', 'cause': 'Desktop passed all eight groups; the isolated mobile proof linker omitted the prepared local YAML modules. Its proof-only allowlist was corrected; product sources and prepared copies did not change.'},
               {'file': 'source-hashes-initial.json', 'cause': 'Initial manifest inherited the earlier code-only list; engine README was subsequently added to the final source manifest before proof execution.'}],
           'limitations': ['No version bump, commit, push, installer, installed Tauri window or Android device acceptance.',
                           'One recipe/source session; no shared-template or placement-offset editing, cross-file transaction, cross-view common undo or scale expansion.',
                           'Ordinary Save alone persists; recipe files remain outside executable build/run.',
                           'Prepared mobile proof accepts isolated ESM/WASM helper behavior, not a mobile scene editor or execution host.',
                           'Focused, core, new JavaScript and local suites overlap the application count.']}
save('results.json', results)
print(json.dumps({'ok': True, 'applicationPassed': app['pass'], 'focusedPassed': focus['pass'],
                  'rustPassed': rust_passed, 'browserSteps': len(browser['steps']),
                  'preparedCases': prepared['counts']['totalCases'],
                  'historicalFilesPreserved': 2193, 'generatedDirectoriesRemoved': len(entries),
                  'allocatedGiBFreed': cleanup['allocatedGiBFreed']}))
