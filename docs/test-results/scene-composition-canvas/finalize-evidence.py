"""Record this unreleased slice and remove only its initially absent artifacts.

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
    '/tmp/viento-composition-canvas-core-target',
    '/tmp/viento-composition-canvas-native-target',
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
assert app['tests'] == 2082 and focus['tests'] == 128
assert '语法检查通过：436 个 JavaScript 文件' in app_log
assert 'API 契约预检通过' in app_log
assert '版本一致性检查通过：0.0.9（构建 0.0.9）' in app_log
browser = read('browser-final/browser.json')
assert browser['ok'] and len(browser['steps']) == 7
assert not browser['errors'] and not browser['svgRequests']
assert all(browser['layout'].values())
inheritance = read('inheritance-regression/browser.json')
assert inheritance['ok'] and len(inheritance['steps']) == 9
assert not inheritance['errors'] and not inheritance['svgRequests']
prepared = read('packaged-resources.json')
assert prepared['ok'] and prepared['version'] == '0.0.9'
assert prepared['embeddedNode']['version'] == 'v24.20.0'
assert prepared['counts'] == {'desktopCases': 5, 'mobileCases': 5, 'totalCases': 10}
assert prepared['sourceAndPreparedManifestsStableDuringAcceptance']
assert prepared['mobileChecks']['noNodeDomNetworkGlobals'] and prepared['mobileChecks']['noHostImports']
assert prepared['mobileChecks']['moduleCount'] == 9 and prepared['mobileChecks']['rejectedOperations'] == 13
assert digest(EVIDENCE / 'prepared-check.mjs') == prepared['proofSourceSha256']
review = read('boundary-review.json')
assert review['ok'] and not review['openFindings']
for name, expected in review['sourceSha256'].items():
    assert digest(ROOT / name) == expected
helpers = read('native-helpers.json')
assert helpers['ok']
for helper in helpers['binaries']:
    file = Path(helper['path'])
    assert file.stat().st_size == helper['bytes'] and digest(file) == helper['sha256']
wasm_build = json.loads((ROOT / 'engine/studio-core.build.json').read_text())
assert digest(ROOT / 'engine/studio-core.wasm') == wasm_build['wasmSha256']
for name, expected in wasm_build['sources'].items():
    source = ROOT / ('scripts/build-studio-core.mjs' if name == 'build-script'
                     else 'crates/viento-studio-core/' + name)
    assert digest(source) == expected
preservation = {'ok': True, 'recordedAt': datetime.now(timezone.utc).isoformat(),
                'historical': preserved('historical-baseline.json'),
                'frozenGodotAndWasm': preserved('frozen-backend-baseline.json'),
                'unchangedRustSources': preserved('rust-source-baseline.json'),
                'currentProductTestsVersionsAndWasm': preserved('source-hashes.json'),
                'oldReportsRetainOriginalExecutionConditions': True,
                'noNewRustProtocolOrCoreSourceChanges': True}
assert preservation['historical']['files'] == 2129
assert preservation['frozenGodotAndWasm']['files'] == 9
assert preservation['unchangedRustSources']['files'] == 19
assert preservation['currentProductTestsVersionsAndWasm']['files'] == 534
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
           'scope': 'Only seven exact generated directories proven initially absent. '
                    'No source archive was created. Shared unchanged WASM and dependencies, '
                    'existing outputs, external tools, user works, settings and installations '
                    'are outside all removal targets.',
           'removedDirectories': len(entries), 'allocatedBytesFreed': freed,
           'allocatedGiBFreed': round(freed / 1024**3, 3), 'entries': entries,
           'retainedTools': tools, 'sharedUnchangedWasmRetained': True,
           'userDataAndInstalledApplicationsExcludedFromMutationTargets': True}
save('cleanup.json', cleanup)

results = {'ok': True, 'date': '2026-10-08',
           'recordedAt': datetime.now(timezone.utc).isoformat(),
           'sourceVersion': '0.0.9', 'baseCommit': head, 'delivery': 'unreleased-working-tree',
           'scope': 'One selected recipe instance can be moved in a dedicated canvas dialog. '
                    'Existing Rust geometry/history and exact override patches feed the ordinary '
                    'source draft, dependency check, full review, guarded apply and normal Save.',
           'feature': {'function': 'scene.composition_canvas', 'fields': ['position'],
                       'fixedInstanceUuid': True, 'fullSceneIsContext': True,
                       'worldToLocalOffsetConversion': True,
                       'unchangedAxesPreserveAuthoredLocalNumbers': True,
                       'localAndWorldBoundsCheckedBeforeHistoryMutation': True,
                       'returnToOriginProducesNoOverride': True,
                       'reusedRustGeometryHistoryAndPatchProtocol': True,
                       'sharedFragmentsOffsetsOtherInstancesAndOtherFieldsPreserved': True},
           'application': {**app, 'log': 'app-check.log', 'node': '24.20.0 (pinned embedded)',
                           'javascriptFiles': 436, 'apiContract': 'passed', 'versionPreflight': '0.0.9',
                           'actualGodotAndBevyRegression': True, 'freshNativeHelpers': True},
           'focused': {**focus, 'log': 'focused-tests.log', 'includedInApplicationCount': True,
                       'newJavascriptTests': app['tests'] - 2037,
                       'pureHelper': {'passed': 15, 'log': 'core-layout-tests.log', 'node': '24.20.0'},
                       'uiAndCanvasInitialLocalSuite': {'passed': 49, 'node': '24.21.0 (system)',
                                                      'ui19IncludedInPinnedFocus': True,
                                                      'all49IncludedInPinnedFullApp': True},
                       'uiCanvasSpyDoesNotClaimRenderedBrowserAcceptance': True},
           'rust': {'sourceFilesUnchanged': 19, 'sourceBaseline': 'rust-source-baseline.json',
                    'sharedWasmBytesUnchanged': True, 'wasmSha256': wasm_build['wasmSha256'],
                    'nativeCliFreshlyBuilt': True, 'standaloneUnitTestsRerunThisTurn': False,
                    'priorCore87EvidenceRetainsOriginalConditions': '../scene-composition-inheritance/results.json'},
           'browser': {'evidence': 'browser-final/browser.json', 'browser': browser['browser'],
                       'steps': len(browser['steps']), 'runtimeExceptions': 0,
                       'localesAt390px': ['zh-CN', 'en', 'ja'], 'layout': browser['layout'],
                       'ordinarySave': browser['normalSave'],
                       'scope': 'Actual Chrome pointer drag and keyboard input in the real HTTP editor; '
                                'disposable workspace only.'},
           'sharedCallbackBrowserRegression': {'evidence': 'inheritance-regression/browser.json',
                                              'steps': 9, 'runtimeExceptions': 0,
                                              'actualExistingSixFieldSetResetAndNormalSave': True,
                                              'freshRunDoesNotOverwriteEarlierReports': True},
           'preparedResources': {'evidence': 'packaged-resources.json', 'scope': prepared['scope'],
                                 'embeddedNodeVersion': prepared['embeddedNode']['version'],
                                 'embeddedNodeSha256': prepared['embeddedNode']['sha256'],
                                 'harnessSha256': prepared['proofSourceSha256'],
                                 'artifacts': {name: {key: item[key] for key in
                                     ('manifestFileCount', 'manifestSha256', 'checkedSourceFiles')}
                                     for name, item in prepared['artifacts'].items()},
                                 'counts': prepared['counts'],
                                 'desktopChecks': prepared['desktopChecks'],
                                 'mobileChecks': prepared['mobileChecks']},
           'boundaryReview': {'evidence': 'boundary-review.json',
                              'fix': 'Parent completion compares the complete canonical submitted payload '
                                     'and result identity, accepting legitimate detached child copies '
                                     'while rejecting changed fields. Completion still works after '
                                     'the expected source token increment.'},
           'preservation': 'historical-preservation.json', 'sourceHashes': 'source-hashes.json',
           'nativeHelperBytes': 'native-helpers.json', 'cleanup': 'cleanup.json',
           'initialAttempts': [
               prepared['initialRecordingCorrection'], prepared['fixtureCorrection'],
               {'log': 'core-layout-tests-initial.log', 'node': '24.20.0', 'passed': 13, 'tests': 15,
                'cause': 'New fixture compared actor provenance as runtime semantics, and its first budget '
                         'case grew by only one byte. Fixture assertions corrected; product unchanged.'},
               {'evidence': 'browser/browser.json', 'log': 'browser-check-initial.log',
                'harness': 'browser-harness-initial.mjs',
                'cause': 'New browser harness used nonexistent setLanguage instead of actual applyLanguage; '
                         'only harness corrected. This failure did not reach the parent completion P2.'},
               {'log': 'focused-tests-initial.log', 'passed': 128,
                'scope': 'Real initial passing focus before the independent review found the copied '
                         'proposal completion issue; final focus rerun after correction.'}],
           'limitations': ['No new version, commit, push, installer, installed Tauri window or Android device acceptance.',
                           'One recipe/source session and one UUID; no multi-selection, alignment, '
                           'placement-offset editing, shared-fragment editing or cross-view common undo.',
                           'Only ordinary Save persists; generated recipes still cannot build or run directly.',
                           'Prepared mobile checks exercise isolated ESM/WASM helpers, not a mobile scene GUI.',
                           'Focused, added JavaScript and local suites overlap the full application count.']}
save('results.json', results)
print(json.dumps({'ok': True, 'appPassed': app['pass'], 'focusPassed': focus['pass'],
                  'browserSteps': len(browser['steps']), 'existingWorkflowBrowserSteps': 9,
                  'historicalFilesPreserved': 2129, 'unchangedRustFiles': 19,
                  'generatedDirectoriesRemoved': len(entries), 'allocatedGiBFreed': cleanup['allocatedGiBFreed']}))
