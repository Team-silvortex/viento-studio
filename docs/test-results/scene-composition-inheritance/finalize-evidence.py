"""Record this unreleased slice and remove only its initially absent artifacts.

Run only after the app, browser, core and prepared-resource checks complete.
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
    '/tmp/viento-mainline-restore-core-target',
    '/tmp/viento-mainline-restore-wasm-target',
    '/tmp/viento-mainline-restore-native-target',
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
assert app['tests'] == 2037 and focus['tests'] == 74
assert '语法检查通过：431 个 JavaScript 文件' in app_log
assert 'API 契约预检通过' in app_log
assert '版本一致性检查通过：0.0.9（构建 0.0.9）' in app_log
rust_log = (EVIDENCE / 'core-tests.log').read_text()
rust_results = re.findall(r'test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored;', rust_log)
assert sum(int(item[0]) for item in rust_results) == 87
assert all(item[1:] == ('0', '0') for item in rust_results)
assert (EVIDENCE / 'core-fmt.log').read_bytes() == b''
assert 'Finished' in (EVIDENCE / 'core-clippy.log').read_text()
browser = read('browser/browser.json')
assert browser['ok'] and len(browser['steps']) == 9
assert not browser['errors'] and not browser['svgRequests']
assert all(browser['inheritance'].values())
prepared = read('prepared-resources.json')
assert prepared['ok'] and prepared['version'] == '0.0.9'
assert prepared['embeddedNodeVersion'] == 'v24.20.0'
assert prepared['runtime']['inheritance']['desktopCases'] == 5
assert prepared['runtime']['inheritance']['isolatedMobileCases'] == 5
assert digest(EVIDENCE / 'prepared-check.mjs') == prepared['harnessSha256']
review = read('boundary-review.json')
assert review['ok'] and not review['blockingFindings']
for item in review['files']:
    assert digest(ROOT / item['path']) == item['sha256']
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
                'frozenGodotBackend': preserved('frozen-backend-baseline.json'),
                'currentProductTestsVersionsAndWasm': preserved('source-hashes.json'),
                'oldReportsRetainOriginalExecutionConditions': True,
                'rustAndSharedWasmIntentionallyChangedForThisFeature': True}
assert preservation['historical']['files'] == 2066
assert preservation['frozenGodotBackend']['files'] == 7
assert preservation['currentProductTestsVersionsAndWasm']['files'] == 529
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

results = {'ok': True, 'date': '2026-10-08',
           'recordedAt': datetime.now(timezone.utc).isoformat(),
           'sourceVersion': '0.0.9', 'baseCommit': head, 'delivery': 'unreleased-working-tree',
           'scope': 'Six-field per-instance composition inheritance restoration; mixed sets '
                    'and resets form one Rust-validated exact-source candidate. Check, review '
                    'and apply stay in editor memory; only ordinary Save writes author text.',
           'feature': {'function': 'scene.composition_inheritance',
                       'fields': ['position', 'size', 'color', 'speed', 'controls', 'imageResourceId'],
                       'operation': 'sceneComposition.editOverrides', 'independentCapabilityVersion': 1,
                       'legacySetOperationAndProbeUnchanged': True,
                       'imageNullMeansExplicitClearAndResetDeletesOverride': True,
                       'lastEmptyActorOverrideRemoved': True,
                       'fragmentsStableIdentitiesAndOtherPlacementsPreserved': True},
           'application': {**app, 'log': 'app-check.log', 'node': '24.20.0 (pinned embedded)',
                           'javascriptFiles': 431, 'apiContract': 'passed', 'versionPreflight': '0.0.9',
                           'actualGodotAndBevyRegression': True, 'freshNativeHelpers': True},
           'focused': {**focus, 'log': 'focused-tests.log', 'includedInApplicationCount': True,
                       'newJavascriptTests': 20,
                       'newUiCasesUseExplicitlyLabelledProposalBoundarySpy': True},
           'rust': {'passed': 87, 'failed': 0, 'ignored': 0, 'newUnitTests': 12,
                    'log': 'core-tests.log', 'format': 'core-fmt.log',
                    'clippyWarningsDenied': 'core-clippy.log', 'newWasmBytes': wasm_build['bytes'],
                    'newWasmSha256': wasm_build['wasmSha256']},
           'browser': {'evidence': 'browser/browser.json', 'browser': browser['browser'],
                       'steps': len(browser['steps']), 'runtimeExceptions': 0,
                       'localesAt390px': ['zh-CN', 'en', 'ja'],
                       'inheritance': browser['inheritance'], 'ordinarySave': browser['normalSave'],
                       'scope': 'Real HTTP editor in Chrome; disposable author workspace only.'},
           'preparedResources': {'evidence': 'prepared-resources.json', 'scope': prepared['scope'],
                                 'embeddedNodeVersion': prepared['embeddedNodeVersion'],
                                 'embeddedNodeSha256': prepared['embeddedNodeSha256'],
                                 'runtime': prepared['runtime'],
                                 'inventories': {name: {'files': item['manifestFileCount'],
                                                       'sha256': item['manifestSha256'],
                                                       'checkedFocusFiles': item.get('checkedFiles')}
                                                 for name, item in prepared['artifacts'].items()}},
           'boundaryReview': {'evidence': 'boundary-review.json',
                              'fix': 'Strict expansion of both original and candidate blocks forged deletion '
                                     'that could erase duplicate decoded keys from the original.',
                              'beforeProbe': 'boundary-original-source-probe.json',
                              'afterProbe': 'boundary-original-source-probe-final.json'},
           'preservation': 'historical-preservation.json', 'sourceHashes': 'source-hashes.json',
           'nativeHelperBytes': 'native-helpers.json', 'cleanup': 'cleanup.json',
           'initialAttempts': [
               {'log': 'native-helpers-build.log', 'cause': 'Missing prepared Node sidecar prerequisite; '
                'retry after preparation passed in native-helpers-build-final.log.'},
               {'log': 'desktop-prepare.log', 'cause': 'Node download fetch failure; SHA-verified '
                'mirror archive and extracted pinned LICENSE used, final preparation passed.'},
               {'log': 'core-targeted-initial-tail.log', 'scope': 'Actual retained terminal tail excerpt, '
                'not a full command log.', 'cause': 'Test expected integer 30 while serde emits 30.0; '
                'raw-byte preservation check passed. Fixture assertion corrected.'},
               {'script': 'prepared-check-initial.mjs', 'log': 'prepared-check-initial.log',
                'cause': 'The plain OC fixture did not contain the projection required by useProjectionDefaults; '
                         'actual build_projection_runtime diagnosis retained in prepared-check-diagnostic.log.'},
               {'script': 'prepared-check-projection-fixture.mjs', 'log': 'prepared-check-projection-fixture.log',
                'cause': 'Golden observed record lacked disk metadata format/version; only synthetic fixture repaired.'},
               {'script': 'prepared-check-provenance-fixture.mjs', 'log': 'prepared-check-provenance-fixture.log',
                'cause': 'Whole-actor equality accidentally included expected changed provenance; runtime equality '
                         'and strict source-location/CST assertions now checked separately.'},
               {'script': 'prepared-check-single-source-fixture.mjs', 'log': 'prepared-check-single-source-fixture.log',
                'cause': 'Restored image correctly has one exact template source without contributors array; '
                         'harness now checks that actual single-source shape.'}],
           'limitations': ['No new version, commit, push, installer, Tauri window or Android device acceptance.',
                           'One existing composition instance/source session; no cross-file transaction, '
                           'shared-fragment editing, direct recipe build, realtime preview or GPU claim.',
                           'Prepared mobile tests exercise isolated ESM/WASM helpers; no mobile preview GUI.',
                           'Focused and added JavaScript tests overlap the full application count.']}
save('results.json', results)
print(json.dumps({'ok': True, 'appPassed': app['pass'], 'corePassed': 87,
                  'browserSteps': len(browser['steps']), 'historicalFilesPreserved': 2066,
                  'generatedDirectoriesRemoved': len(entries), 'allocatedGiBFreed': cleanup['allocatedGiBFreed']}))
