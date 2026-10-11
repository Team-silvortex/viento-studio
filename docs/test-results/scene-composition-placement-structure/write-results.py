"""Summarize completed evidence; overlapping runs are not added as coverage."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import re
import subprocess

root = Path.cwd()
out = root / 'docs/test-results/scene-composition-placement-structure'
def read(name):
    return json.loads((out / name).read_text())
def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()
def stats(name):
    text = (out / name).read_text()
    data = {key: int(value) for key, value in re.findall(r'ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)', text)}
    assert data['tests'] == data['pass'] and all(data[key] == 0 for key in ['fail', 'cancelled', 'skipped', 'todo'])
    return {**data, 'log': name, 'sha256': sha(out / name)}

baseline = read('baseline.json')
app = stats('app-check.log'); assert app['pass'] == 2744
core = read('core-results.json')
rust = [int(value) for value in re.findall(r'test result: ok\. (\d+) passed;', (out / 'core-native-test-final.log').read_text())]
assert sum(rust) == core['verification']['rust']['total'] == 138
core_js = stats('core-js-tests-final.log'); assert core_js['pass'] == 24
core_regression = stats('core-regression-final.log'); assert core_regression['pass'] == 194
web = stats('web-focused-initial.log'); assert web['pass'] == 40
web_regression = stats('web-regression.log'); assert web_regression['pass'] == 286
workflow = stats('workflow-tests.log'); assert workflow['pass'] == 51
browser = read('browser-confirmed/browser.json'); assert browser['ok'] and not browser['errors'] and not browser['svgRequests']
review = read('review.json'); assert review['ok'] and not review['openFindings']
assert review['browser']['flows'] == 8
prepared = read('packaged-resources.json'); assert prepared['ok']
assert all(len(item['placements']) == 11 for item in prepared['portable'].values())
prepared_summary = json.loads((out / 'prepared-check-final.log').read_text().strip().splitlines()[-1])
assert prepared_summary['totalCases'] == 114 and prepared_summary['moduleCounts'] == {'desktop': 91, 'mobile': 91}
assert prepared_summary['artifacts'] == {'desktop/resources': 534, 'mobile/dist': 220, 'desktop/ui': 11}
cleanup = read('cleanup.json'); assert cleanup['ok'] and cleanup['directoriesRemainAbsent']
docs = read('final-doc-review.json'); assert docs['ok']
frozen = read('source-hashes.json'); before_docs = read('source-hashes-before-doc-final.json')
assert len(frozen) == 628 and [name for name in frozen if frozen[name] != before_docs[name]] == ['engine/README.md']
for name, digest in frozen.items(): assert sha(root / name) == digest, name
assert review['finalSourceFreeze']['sha256'] == sha(out / 'source-hashes.json')
for name, digest in review['reviewedSources'].items(): assert frozen[name] == digest, name
delta = read('source-delta.json'); assert len(delta) == 28 and sum(item['before'] is None for item in delta.values()) == 11
assert prepared['frozenSource']['manifestSha256'] == sha(out / 'source-hashes.json')
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip() == baseline['head']
assert (root / 'VERSION').read_text().strip() == baseline['version']

report = {
    'format': 'viento-scene-composition-placement-structure-results', 'schemaVersion': 1,
    'createdAt': datetime.now(timezone.utc).isoformat(), 'ok': True,
    'head': baseline['head'], 'version': baseline['version'],
    'scope': 'Unpublished whole-placement add/copy/remove in one ordinary registered recipe source document. No author-format or backend-protocol changes, release, commit, installation or Android-device acceptance.',
    'behavior': [
        'Add an existing fragment, including previously unused fragments, with fresh placement and complete actor/group identity maps.',
        'Copy the original placement CST span, replacing only identity value tokens; preserve offsets, declaration absence, local overrides/null, key order and numeric lexemes.',
        'Remove one complete placement while retaining at least one placement; removal may remove the current preview opener actor.',
        'Independent optional Rust placements_version=1 and pure proposal/prepare APIs; absence disables only the new editor.',
        'Complete source-owned preview and all actor/group provenance are checked before application to memory. Ordinary Save alone writes author files and retains external-conflict guards.',
    ],
    'verification': {
        'application': {**app, 'runtime': read('fixed-node.json'), 'syntaxJavaScriptFiles': 522,
            'sourceManifestDuringRun': 'source-hashes-before-doc-final.json',
            'finalDocumentationOnlyDelta': ['engine/README.md'],
            'finalExecutableSourcesUnchanged': True},
        'sharedCore': core['verification']['rust'], 'fmt': core['verification']['fmt'], 'clippy': core['verification']['clippy'],
        'newJavaScript': {'total': 64, 'core': 24, 'web': 35, 'workflow': 5,
            'webBreakdown': {'ui': 23, 'host': 7, 'preview': 5}, 'containedInApplication': True,
            'nativeWasmParityRequests': 12, 'coreLog': core_js, 'webWithFiveOldCases': web, 'workflowWith46OldCases': workflow},
        'regressions': {'core': core_regression, 'web': web_regression, 'workflow': workflow, 'countsOverlap': True},
        'browser': {**review['browser'], 'screenshots': 7, 'screenshotsVisuallyInspected': True},
        'prepared': {**prepared_summary, 'report': 'packaged-resources.json', 'sha256': sha(out / 'packaged-resources.json'),
            'scope': 'Actual prepared copies in standard VM without Node/DOM/fetch/process globals; not a hostile-code sandbox, installation or device proof.'},
        'independentReview': {'report': 'review.json', 'sha256': sha(out / 'review.json'), 'openFindings': []},
        'currentDocumentationReview': {'report': 'final-doc-review.json', 'sha256': sha(out / 'final-doc-review.json')},
    },
    'sources': {'frozenFiles': 628, 'frozenManifest': 'source-hashes.json', 'manifestSha256': sha(out / 'source-hashes.json'),
        'deltaFiles': 28, 'newFiles': 11, 'delta': 'source-delta.json', 'wasm': core['verification']['wasm'],
        'sharedCoreChanges': ['src/lib.rs dispatcher and new optional capability', 'src/scene_composition_placements_patch.rs'],
        'oldCoreImplementationsAndNativeHostUnchanged': True,
        'systemRegistryUnchanged': {'modules': 7, 'declarativeCapabilities': 22}},
    'preservation': {'historicalFiles': 3012, 'authorFiles': 39, 'externalTrustedTools': 4,
        'audit': 'preservation-audit.json', 'finalConfirmation': 'final-audit.json',
        'oldAtlasPrefixesAndScoresRetained': True,
        'authorDefinitionsAssetsMetadataAndIdsUnchanged': True, 'backendGeneratorsRuntimeAndProtocolsUnchanged': True},
    'cleanup': {'report': 'cleanup.json', 'sha256': sha(out / 'cleanup.json'),
        'allocatedFileBytesRemoved': cleanup['allocatedFileBytesRemoved'], 'generatedPaths': [item['path'] for item in cleanup['removed']],
        'testedWasmAndBuildMetadataRetained': True},
    'retainedAttempts': core['retainedAttempts'] + [
        {'log': 'native-tools-build-before-preparation.log', 'result': 'Missing pinned sidecar; seeded exact catalog-verified Node before preparation.'},
        {'log': 'native-tools-build-before-resources.log', 'result': 'Resources not prepared; actual desktop prepare completed before fresh native helpers were built.'},
        {'log': 'browser-initial.log', 'result': 'New fixture used unsupported wasd controls; corrected to supported arrows/none, then actual flows passed.'},
        {'log': 'desktop-prepare-busy-node.log', 'result': 'Attempted overwrite of active pinned Node returned ETXTBSY; resource-only preparation retained the running executable.'},
        {'log': 'prepared-check-before-resource-refresh.log', 'result': 'Stale helper copy rejected; refreshed actual resources and passed the copied-core proof.'},
        {'log': 'prepared-check-doc-final.log', 'result': 'Final documentation-only README update rejected against stale prepared copy; actual resources refreshed.'},
        {'log': 'prepared-check-doc-refreshed.log', 'result': 'Immutable report guard rejected overwriting prior report after checks; prior report retained under before-doc-final, final proof wrote a fresh report.'},
    ],
    'limits': ['Append-only add/copy, no placement reorder', 'Existing 128 KiB and 128 expanded actor/group/placement budgets',
        'No fragment/group definition structure editor, spatial transforms, nested/cross-file fragments, multi-file transaction or cross-view history',
        'No executable recipe build, new backend adapter/runtime protocol or new installed desktop/mobile acceptance'],
}
(out / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'ok': True, 'application': 2744, 'rust': 138, 'newJavaScript': 64, 'browser': 8, 'prepared': 114}))
