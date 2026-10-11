"""Record this shared fragment slice and remove only its initially absent artifacts.

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
    '/tmp/viento-fragment-editor-core-target',
    '/tmp/viento-fragment-editor-native-target',
    '/tmp/viento-fragment-editor-wasm-target',
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
focus, _ = test_facts('focused-tests-final.log')
core, _ = test_facts('core-focus-tests-final.log')
assert app['tests'] == 2148 + 75 and focus['tests'] == 358 and core['tests'] == 161
assert '语法检查通过：453 个 JavaScript 文件' in app_log
assert 'API 契约预检通过' in app_log and '版本一致性检查通过：0.0.9（构建 0.0.9）' in app_log
rust_log = (EVIDENCE / 'core-tests.log').read_text()
rust_passed = sum(map(int, re.findall(r'test result: ok\. (\d+) passed;', rust_log)))
assert rust_passed == 101 and not re.search(r'test result: FAILED|[1-9]\d* failed;', rust_log)
browser = read('browser/browser.json')
assert browser['ok'] and len(browser['steps']) == 6 and not browser['errors'] and not browser['svgRequests']
assert all(browser['layout'].values())
batch = read('batch-regression/browser.json')
assert batch['ok'] and len(batch['steps']) == 5 and not batch['errors'] and not batch['svgRequests']
single = read('single-regression/browser.json')
assert single['ok'] and len(single['steps']) == 7 and not single['errors'] and not single['svgRequests']
prepared = read('packaged-resources.json')
assert prepared['ok'] and prepared['version'] == '0.0.9' and prepared['embeddedNode']['version'] == 'v24.20.0'
assert prepared['counts']['desktopCases'] == prepared['counts']['mobileCases'] > 0
assert prepared['counts']['totalCases'] == prepared['counts']['desktopCases'] + prepared['counts']['mobileCases']
assert prepared['counts']['totalLegacyCases'] == prepared['counts']['desktopLegacyCases'] + prepared['counts']['mobileLegacyCases'] == 4
assert prepared['counts']['totalGroups'] == prepared['counts']['totalCases'] + prepared['counts']['totalLegacyCases'] == 22
assert digest(EVIDENCE / 'prepared-check.mjs') == prepared['proofSourceSha256']
assert prepared['sourceAndPreparedManifestsStableDuringAcceptance']
review = read('boundary-review.json')
assert review['ok'] and review['findings'] == []
assert len(review['reviewedSources']) == 10
for name, entry in review['reviewedSources'].items():
    assert digest(ROOT / name) == entry['sha256']
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
                'protectedSingleBatchOverrideSlices': preserved('protected-scene-slices.json'),
                'currentProductTestsVersionsWasmAndEngineReadme': preserved('source-hashes.json'),
                'oldReportsRetainOriginalExecutionConditions': True}
assert preservation['historical']['files'] == 2257
assert preservation['frozenGodotBackend']['files'] == 7
assert preservation['protectedSingleBatchOverrideSlices']['files'] == 9
assert preservation['currentProductTestsVersionsWasmAndEngineReadme']['files'] == 553
save('historical-preservation.json', preservation)
baseline = read('generated-baseline.json')
assert set(baseline) == GENERATED and all(value is False for value in baseline.values())
for name in baseline:
    target = ROOT / name
    assert target.is_dir() and stat.S_ISDIR(target.lstat().st_mode)
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

results = {
    'ok': True, 'date': '2026-10-11', 'recordedAt': datetime.now(timezone.utc).isoformat(),
    'sourceVersion': '0.0.9', 'baseCommit': head, 'delivery': 'unreleased-working-tree',
    'scope': 'One existing shared fragment actor in one recipe source. Explicit set-only declaration edits, related instance override masks, full candidate dependency review, guarded source-memory application and ordinary Save.',
    'feature': {
        'function': 'scene.composition_fragment_editor',
        'fields': ['position', 'size', 'color', 'speed', 'controls', 'imageResourceId'],
        'setOnly': True, 'rawDeclarationValuesOnly': True, 'explicitFieldSelection': True,
        'absenceRetainedUnlessExplicitlySet': True, 'noEffectiveOrLocalOverridePromotion': True,
        'sourceOrderedRelatedTargetsAndOverrideMasks': True, 'sourceChangeValidEvenIfAllInstancesOverride': True,
        'independentOptionalFragmentCapability': 1, 'allPlacementsValidatedBeforeAnyPatchIsReturned': True,
        'localOverridesIdentitiesGroupsOffsetsAndOtherDeclarationsStable': True,
    },
    'application': {**app, 'log': 'app-check.log', 'node': '24.20.0 (pinned embedded)',
        'javascriptFiles': 453, 'apiContract': 'passed', 'versionPreflight': '0.0.9',
        'actualGodotAndBevyRegression': True, 'freshNativeHelpers': True},
    'focused': {**focus, 'log': 'focused-tests-final.log', 'includedInApplicationCount': True,
        'newJavascriptTests': 75, 'pureHelper': 16, 'newProtocolBridge': 11, 'newUi': 28,
        'parentCallbacks': 9, 'actualEditorHost': 8, 'previewEntry': 3,
        'coreFocused': {**core, 'log': 'core-focus-tests-final.log', 'overlapsApplicationAndFocused': True},
        'initialUiNode': '24.21.0 (system)', 'initialUiFinalLog': 'ui-tests.acceptance.log',
        'browserDrawingVerifiedSeparately': True},
    'rust': {'passed': rust_passed, 'oldTests': 93, 'newTests': 8, 'log': 'core-tests.log',
        'fmt': 'core-fmt.log', 'clippyDenyWarnings': 'core-clippy.log',
        'freshNativeCli': 'core-native-build.log', 'freshWasm': 'core-wasm-build.log',
        'wasmBytes': wasm_build['bytes'], 'wasmSha256': wasm_build['wasmSha256']},
    'browser': {'evidence': 'browser/browser.json', 'browser': browser['browser'],
        'steps': len(browser['steps']), 'runtimeExceptions': 0, 'localesAt390px': ['zh-CN', 'en', 'ja'],
        'screenshotsVisuallyInspected': True, 'layout': browser['layout'], 'ordinarySave': browser['normalSave'],
        'scope': 'Actual Chrome interaction and HTTP editor in a disposable workspace.'},
    'oldCanvasBrowserRegressions': {
        'single': {'evidence': 'single-regression/browser.json', 'steps': 7, 'runtimeExceptions': 0},
        'batch': {'evidence': 'batch-regression/browser.json', 'steps': 5, 'runtimeExceptions': 0}},
    'preparedResources': {'evidence': 'packaged-resources.json', 'scope': prepared['scope'],
        'embeddedNode': prepared['embeddedNode'], 'harnessSha256': prepared['proofSourceSha256'],
        'artifacts': {name: {key: item[key] for key in ('manifestFileCount', 'manifestSha256', 'checkedSourceFiles')}
            for name, item in prepared['artifacts'].items()}, 'counts': prepared['counts'],
        'mobileChecks': prepared['mobileChecks']},
    'boundaryReview': {'evidence': 'boundary-review.json', 'probe': 'boundary-probe.json',
        'receiptAndCapabilityProbe': 'boundary-receipt-probe.json',
        'findings': review['findings'], 'verdict': review['verdict']},
    'sourceHashes': 'source-hashes.json', 'preservation': 'historical-preservation.json',
    'nativeHelperBytes': 'native-helpers.json', 'cleanup': 'cleanup.json',
    'initialAttempts': [
        {'log': 'core-tests-initial.log', 'cause': 'New fixture assertions compared floating JSON lexemes or assumed insertion indentation; only assertions corrected.'},
        {'log': 'core-fragment-tests-initial.log', 'cause': 'New lexeme fixture did not match its actual indentation; fixture corrected.'},
        {'log': 'ui-tests.initial.log', 'cause': 'New fixture used image=null on an actor without projection inheritance, making the starting recipe invalid; fixture corrected.'},
        {'log': 'ui-tests.extended.log', 'cause': 'New missing-pair fixture deleted a required position declaration; replaced with a valid missing-size input boundary.'},
        {'log': 'host-parent-initial.log', 'cause': 'A new test used deepStrictEqual across VM array realms; detached JSON assertion corrected.'},
        {'log': 'preview-entry-tests-initial.log', 'cause': 'The new test harness initially omitted its fragment-callback collection; fixture variable added.'},
        {'log': 'core-focus-tests.log', 'cause': 'First broad core run omitted the real Godot tool and reported one explicit skip; final same suite supplied the tool and passed without skips.'},
        {'log': 'focused-tests.log', 'cause': 'First root focused run omitted archive/storage helpers and reported two explicit skips; final same suite supplied both fresh binaries.'},
        {'log': 'app-check-initial.log', 'cause': 'Root invocation contained a duplicated Godot path; the incomplete owned run was terminated and a fresh complete run used the verified path.'},
        {'log': 'boundary-receipt-probe-initial.log', 'cause': 'The new forged-UUID proof fixture initially used the original UUID; its assertion was corrected to a different valid UUID. Product unchanged.'},
        {'log': 'finalize-evidence-initial.log', 'cause': 'The evidence aggregator expected openFindings/sourceSha256 while the independent report uses findings/reviewedSources. It stopped before writing final reports or deleting artifacts; only the aggregator schema was corrected.'},
    ],
    'limitations': [
        'No version bump, commit, push, installer, installed Tauri window or Android device acceptance.',
        'Existing actor six-field SET-only; no reset/delete, actor/group/key/identity structure editing, placement offsets, cross-file transaction or common cross-view undo.',
        'Only ordinary Save persists; executable recipe build/run remains separate.',
        'Prepared mobile proof accepts isolated ESM/WASM helper behavior, not an Android editing or persistence host.',
        'Focused/core/new-JavaScript/local suites overlap the application count.',
    ],
}
save('results.json', results)
print(json.dumps({'ok': True, 'applicationPassed': app['pass'], 'focusedPassed': focus['pass'],
    'rustPassed': rust_passed, 'browserSteps': len(browser['steps']), 'legacyBrowserSteps': 12,
    'preparedNewCases': prepared['counts']['totalCases'], 'preparedGroups': prepared['counts']['totalGroups'], 'historicalFilesPreserved': 2257,
    'generatedDirectoriesRemoved': len(entries), 'allocatedGiBFreed': cleanup['allocatedGiBFreed']}))
