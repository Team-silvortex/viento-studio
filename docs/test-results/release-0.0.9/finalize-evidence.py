"""Record actual release facts and remove only initially absent validation outputs.

Run after app, prepared-module and temporary-source-archive verification. This
script and its outputs are final audit metadata, not part of the tested archive.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = Path(__file__).resolve().parent
EXPECTED_GENERATED = {
    'desktop/resources', 'desktop/ui/i18n', 'desktop/.cache',
    'src-tauri/binaries', 'mobile/dist',
    '/tmp/viento-release-009-native-target',
    '/tmp/viento-release-009-core-target',
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
    manifest = read(name)
    mismatches = [file for file, expected in manifest.items()
                  if digest(ROOT / file) != expected]
    assert not mismatches, (name, mismatches)
    return {'files': len(manifest), 'unchanged': len(manifest),
            'mismatches': mismatches, 'baseline': name}


assert not any((EVIDENCE / name).exists() for name in
               ('historical-preservation.json', 'cleanup.json', 'results.json'))
prepared = read('packaged-resources.json')
inventories = read('prepared-manifests.json')
archive = read('source-archive.json')
helpers = read('native-helpers-proof.json')
versions = read('version-files.json')
assert prepared['ok'] and prepared['version'] == '0.0.9'
assert inventories['ok'] and archive['ok']
assert archive['temporarySourceArchiveAndOwnDirectoryRemoved']
assert archive['sourceOnlySnapshotBeforeFinalAuditAndCommit']
assert versions['ok'] and versions['version'] == '0.0.9'
for helper in helpers['helpers'].values():
    file = ROOT / helper['path']
    assert file.stat().st_size == helper['bytes']
    assert digest(file) == helper['sha256']

preservation = {'ok': True, 'recordedAt': datetime.now(timezone.utc).isoformat(),
                'sourceVersion': '0.0.9',
                'historical': preserved('historical-baseline.json'),
                'frozenBackendAndWasm': preserved('frozen-backend-baseline.json'),
                'rustSources': preserved('rust-source-baseline.json'),
                'currentProductTestsAndVersions': preserved('source-hashes.json'),
                'oldReportsRetainOriginalExecutionVersionAndConditions': True}
assert preservation['historical']['files'] == 2017
assert preservation['frozenBackendAndWasm']['files'] == 9
assert preservation['rustSources']['files'] == 19
assert preservation['currentProductTestsAndVersions']['files'] == 527
save('historical-preservation.json', preservation)

baseline = read('generated-baseline.json')
assert set(baseline) == EXPECTED_GENERATED and all(value is False for value in baseline.values())
retained_tools = json.loads((EVIDENCE.parent / 'release-0.0.8/cleanup.json').read_text())['retainedTools']
for tool in retained_tools:
    file = Path(tool['path'])
    assert file.stat().st_size == tool['bytes'] and digest(file) == tool['sha256']
seen = set()
entries = []
for text in baseline:
    target = ROOT / text
    assert target.is_dir() and stat.S_ISDIR(target.lstat().st_mode)
    allocated = logical = count = 0
    for directory, dirs, files in os.walk(target, followlinks=False):
        for file in [Path(directory), *(Path(directory) / name for name in files),
                     *(Path(directory) / name for name in dirs if (Path(directory) / name).is_symlink())]:
            metadata = file.lstat()
            inode = (metadata.st_dev, metadata.st_ino)
            if inode not in seen:
                seen.add(inode)
                allocated += metadata.st_blocks * 512
            if stat.S_ISREG(metadata.st_mode):
                logical += metadata.st_size
                count += 1
    entries.append({'path': text, 'existedBefore': False, 'kind': 'directory',
                    'allocatedBytes': allocated, 'logicalFileBytes': logical,
                    'fileCount': count, 'removed': False})
    shutil.rmtree(target)
    assert not target.exists()
    entries[-1]['removed'] = True
freed = sum(entry['allocatedBytes'] for entry in entries)
cleanup = {'ok': True, 'recordedAt': datetime.now(timezone.utc).isoformat(),
           'scope': 'Only the seven exact generated paths proven initially absent were removed. '
                    'The source-archive probe independently removed its own unique dist directory. '
                    'Shared WASM, dependencies, existing dist outputs, external tools, user works, '
                    'preferences and installed applications are outside all mutation targets.',
           'removedDirectories': len(entries), 'removedValidationArchives': 1,
           'allocatedBytesFreed': freed, 'allocatedGiBFreed': round(freed / (1024 ** 3), 3),
           'allocatedBytesScope': 'Seven generated directories only; archive allocated blocks were not measured.',
           'entries': entries, 'retainedTools': retained_tools,
           'temporaryArchiveRemoval': {'proof': 'source-archive.json',
                                      'compressedBytes': archive['archive']['bytes'],
                                      'removedByOwningProbe': True, 'includedInAllocatedBytesTotal': False},
           'sharedWasmRetained': (ROOT / 'engine/studio-core.wasm').is_file(),
           'userDataAndInstalledApplicationsExcludedFromMutationTargets': True}
save('cleanup.json', cleanup)


def test_facts(name):
    text = (EVIDENCE / name).read_text()
    facts = {}
    for name in ('tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'):
        facts[name] = int(re.findall(r'^[ℹ#] ' + name + r' (\d+)$', text, re.M)[-1])
    facts['durationMs'] = float(re.findall(r'^[ℹ#] duration_ms ([\d.]+)$', text, re.M)[-1])
    return facts, text


app, app_log = test_facts('app-check.log')
version_tests, _ = test_facts('version-source-tests.log')
javascript = int(re.search(r'语法检查通过：(\d+) 个', app_log).group(1))
assert app['tests'] == app['pass'] == 2017 and javascript == 430
assert not any(app[name] for name in ('fail', 'cancelled', 'skipped', 'todo'))
assert '版本一致性检查通过：0.0.9（构建 0.0.9）' in app_log
assert version_tests['tests'] == version_tests['pass'] == 7
assert not any(version_tests[name] for name in ('fail', 'cancelled', 'skipped', 'todo'))
application = {'tests': app['tests'], 'passed': app['pass'], 'failed': app['fail'],
               'cancelled': app['cancelled'], 'skipped': app['skipped'], 'todo': app['todo'],
               'durationMs': app['durationMs'], 'javascriptFiles': javascript,
               'log': 'app-check.log', 'apiContract': 'passed', 'versionPreflight': '0.0.9',
               'node': '24.20.0 (pinned embedded runtime)',
               'realGodot': True, 'realBevy': True,
               'freshNativeCoreArchiveAndMobileHelpers': True}
browser = json.loads((EVIDENCE.parent / 'runtime-case-reports/results.json').read_text())['browser']
assert browser['scenarios'] == 6 and browser['jobs'] == 5 and browser['localesAt390px'] == 3
assert browser['runtimeExceptions'] == 0
assert (EVIDENCE.parent / 'runtime-case-reports' / browser['evidence']).is_file()
results = {'ok': True, 'date': '2026-10-08',
           'recordedAt': datetime.now(timezone.utc).isoformat(), 'sourceVersion': '0.0.9',
           'version': '0.0.9',
           'baseCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
           'delivery': 'Validated source candidate for commit and push to origin/main; '
                       'not an installer, installation, GitHub Release or version tag.',
           'scope': ['Trusted execution-tool identity and explicit Chinese/English/Japanese feedback.',
                     'Portable bounded verification cases sharing the frozen Godot/Bevy execution contracts.',
                     'Project-owned case documents, revision guards and stable-identity migration.',
                     'Ordered same-scene suites, captured inputs, assertion continuation and terminal execution guards.',
                     'Pinned independent member reports, current-job readback and explicit JSON download.',
                     'Dependency, stale-build, UI module, cancellation and narrow-screen fixes from the five retained development rounds.',
                     'Version counters, current documentation and source-release atlas updates.'],
           'versions': versions, 'application': application,
           'versionAndSourcePackagingRules': {**version_tests, 'log': 'version-source-tests.log',
                                             'overlapsApplicationTotal': True, 'addedTestsForRelease': 0},
           'nativeHelpers': {'proof': 'native-helpers-proof.json', 'freshBuild': True,
                             'offlineLocked': True, 'coreLog': 'core-native-build.log',
                             'archiveAndMobileLog': 'native-helpers-build.log',
                             'independentRustTestsRerun': False},
           'prepared': {'proof': 'packaged-resources.json', 'log': 'packaged-check.log',
                        'manifestProof': 'prepared-manifests.json',
                        'counts': prepared['counts'],
                        'desktopFiles': inventories['artifacts']['desktop/resources']['files'],
                        'desktopLibraryFiles': inventories['artifacts']['desktop/ui']['files'],
                        'mobileFiles': inventories['artifacts']['mobile/dist']['files'],
                        'focusedDesktopFiles': prepared['artifacts']['desktop/resources']['checkedSourceFiles'],
                        'focusedMobileFiles': prepared['artifacts']['mobile/dist']['checkedSourceFiles'],
                        'mobilePureEntrypoints': 1, 'mobilePureModules': 4,
                        'mobileAccepted': prepared['mobileChecks']['acceptedCases'],
                        'mobileRejected': prepared['mobileChecks']['rejectedCases'],
                        'androidHostOrDeviceExecutionClaimed': False},
           'sourceArchive': {'proof': 'source-archive.json', 'files': archive['archive']['files'],
                             'bytes': archive['archive']['bytes'], 'removed': True,
                             'snapshotBeforeFinalAuditMetadataAndCommit': True,
                             'finalCommitArchiveDeliveryClaimed': False},
           'preservation': {'proof': 'historical-preservation.json',
                            'historicalFiles': 2017, 'frozenBackendAndWasmFiles': 9,
                            'rustSourceFiles': 19, 'currentProductTestsAndVersionFiles': 527,
                            'sourceManifest': 'source-hashes.json'},
           'cleanup': {'proof': 'cleanup.json', 'removedGeneratedDirectories': 7,
                       'allocatedBytesFreed': freed, 'allocatedGiBFreed': cleanup['allocatedGiBFreed'],
                       'validationArchiveRemovalSeparatelyRecorded': True},
           'priorEvidenceRetained': {'fiveDevelopmentRounds': [
               '../runtime-tool-probe/results.json', '../runtime-verification-cases/results.json',
               '../runtime-case-documents/results.json', '../runtime-case-suites/results.json',
               '../runtime-case-reports/results.json'],
               'latestBrowser': {'proof': '../runtime-case-reports/' + browser['evidence'],
                                 'executionVersion': '0.0.8 unreleased working tree',
                                 'scenarios': 6, 'uniqueJobs': 5, 'languages': ['zh', 'en', 'ja'],
                                 'viewportWidthPx': 390, 'newBrowserRunClaimed': False},
               'independentRustTestsRerun': False,
               'note': 'Old logs, reports, screenshots, counts, execution versions and fingerprints are byte-preserved.'},
           'preservedInitialConditions': [
               {'log': 'packaged-check-initial.log', 'reason': 'A publication banner changed the engine README after preparation. '
                'The full source-copy guard refused the stale copy before engine execution; final resources were regenerated and passed.'},
               {'log': 'node-license-download.log', 'reason': 'An auxiliary curl request for the fixed Node license failed TLS. '
                'The license from the SHA-verified official archive matched the expected digest; normal desktop prepare also succeeded.'},
               {'log': 'version-tests-development.log', 'reason': 'An initial command named a nonexistent optional test file, '
                'which Node ignored. The actual seven version tests were rerun explicitly under pinned Node in version-source-tests.log.'}],
           'limits': ['No new installer, installed Tauri window, Windows/macOS native interaction or Android-device acceptance.',
                      'No new browser run or independent Rust fmt/clippy/test results; previous evidence retains its original conditions.',
                      'Verification supports bounded headless replay of no-behavior frozen plan 2. '
                      'Reports are current-service/current-job, with no external import or cross-restart history.',
                      'Actual cancelled Godot report contains 64/64 samples and is incomplete; no partial engine-step interruption is claimed.',
                      'Bevy remains a separately configured headless ECS tool; no images, windows, GPU or author Rust behavior support.',
                      'The source archive was a temporary pre-audit snapshot, not the final committed archive or a project migration export.']}
save('results.json', results)
print(json.dumps({'ok': True, 'version': results['sourceVersion'], 'application': application,
                  'preserved': {key: value['files'] for key, value in preservation.items()
                                if isinstance(value, dict) and 'files' in value},
                  'generatedDirectoriesRemoved': len(entries), 'allocatedBytesFreed': freed,
                  'sourceArchiveFiles': archive['archive']['files']}))
