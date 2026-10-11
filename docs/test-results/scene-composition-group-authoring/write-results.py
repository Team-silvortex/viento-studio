"""Record completed evidence without adding overlapping counts as coverage."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import re
import subprocess

root = Path.cwd()
out = root / 'docs/test-results/scene-composition-group-authoring'
def read(name):
    return json.loads((out / name).read_text())
def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()
def stats(name, expected):
    text = (out / name).read_text()
    values = {key: int(value) for key, value in re.findall(r'ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)', text)}
    assert values['tests'] == values['pass'] == expected
    assert all(values[key] == 0 for key in ['fail', 'cancelled', 'skipped', 'todo'])
    return {**values, 'log': name, 'sha256': sha(out / name)}

assert not (out / 'results.json').exists()
baseline = read('baseline.json')
app = stats('app-check.log', 2816)
core = read('core-results.json')
rust = [int(value) for value in re.findall(r'test result: ok\. (\d+) passed;', (out / 'core-native-test.log').read_text())]
assert sum(rust) == core['verification']['rust']['total'] == 150
pure = stats('core-pure-tests.log', 18)
bridge = stats('core-bridge-tests.log', 10)
core_regression = stats('core-regression-final.log', 238)
web = stats('web-focused-second.log', 41)
web_regression = stats('web-regression.log', 322)
workflow = stats('workflow-tests-final.log', 59)
review = read('review.json')
assert review['ok'] and not review['openFindings']
assert review['browser']['stepsPassed'] == 10
browser = read('browser-confirmed/browser.json')
assert browser['ok'] and len(browser['steps']) == 10 and not browser['errors'] and not browser['svgRequests']
prepared = read('packaged-resources.json')
assert prepared['ok']
summary = json.loads((out / 'prepared-check.log').read_text().strip().splitlines()[-1])
assert summary['totalCases'] == 142 and summary['groupsCasesEach'] == 12
assert summary['moduleCounts'] == {'desktop': 92, 'mobile': 92}
assert summary['artifacts'] == {'desktop/resources': 536, 'mobile/dist': 222, 'desktop/ui': 11}
cleanup = read('cleanup.json')
assert cleanup['ok'] and cleanup['directoriesRemainAbsent']
docs = read('document-review.json')
assert docs['ok'] and not docs['findings']
for item in docs['reviewedFiles']: assert sha(root / item['path']) == item['sha256'], item['path']
frozen = read('source-hashes.json')
assert len(frozen) == 639
for name, digest in frozen.items(): assert sha(root / name) == digest, name
for name, digest in core['sourceHashes'].items(): assert frozen[name] == digest, name
assert review['finalSourceFreeze']['sha256'] == sha(out / 'source-hashes.json')
for name, digest in review['reviewedSources'].items(): assert frozen[name] == digest, name
for name, digest in browser['sources'].items(): assert frozen[name] == digest, name
assert prepared['frozenSource']['manifestSha256'] == sha(out / 'source-hashes.json')
delta = read('source-delta.json')
assert len(delta) == 28 and sum(item['before'] is None for item in delta.values()) == 11
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip() == baseline['head']
assert (root / 'VERSION').read_text().strip() == baseline['version']

report = {
    'format': 'viento-scene-composition-group-authoring-results', 'schemaVersion': 1,
    'createdAt': datetime.now(timezone.utc).isoformat(), 'ok': True,
    'head': baseline['head'], 'version': baseline['version'],
    'scope': 'Unpublished shared organizational group authoring in one ordinary registered recipe document. No author-schema/backend-protocol change, release, commit, installation or device acceptance.',
    'behavior': [
        'ADD one shared group with one caller-allocated fresh group UUID per related placement, stable across form changes and rechecks.',
        'EDIT the raw display name and parent while retaining group key and generated identities; forbid cycles and hierarchy beyond sixteen levels.',
        'ASSIGN one existing shared actor to a group or remove its group declaration; effective runtime fields, coordinates and actor order remain.',
        'REMOVE only an empty leaf with no direct actor or child, removing every related group map; permit the last empty group and retain empty containers.',
        'All four actions work for unused fragments with no generated targets. CST patches retain unrelated source bytes, BOM/CRLF, offsets and overrides.',
        'Independent optional groups ABI and pure proposal/apply contracts; the new UI cannot grant sibling editors or execution backends authority.',
        'Complete candidates bind source, stable identities, names, parent declaration presence and ordered memberships before memory application. Ordinary Save alone persists and guards external conflicts.',
    ],
    'verification': {
        'application': {**app, 'runtime': read('fixed-node.json'), 'syntaxJavaScriptFiles': 532,
                        'frozenSourceManifest': 'source-hashes.json', 'finalSourcesVerifiedUnchanged': True},
        'sharedCore': core['verification']['rust'], 'fmt': core['verification']['fmt'], 'clippy': core['verification']['clippy'],
        'newJavaScript': {'total': 72, 'core': 28, 'web': 36, 'workflow': 8,
            'webBreakdown': {'ui': 23, 'host': 8, 'preview': 5}, 'containedInApplication': True,
            'nativeWasmParityRequests': 19, 'pure': pure, 'bridge': bridge,
            'webIncludingFivePreviousCases': web, 'workflowIncluding51PreviousCases': workflow},
        'regressions': {'core': core_regression, 'web': web_regression, 'workflow': workflow, 'countsOverlap': True},
        'browser': {**review['browser'], 'screenshots': 7, 'screenshotsVisuallyInspected': True,
                    'sourceStableDuringProof': browser['sourceStableDuringProof'], 'flowAssertions': browser['steps']},
        'prepared': {**summary, 'report': 'packaged-resources.json', 'sha256': sha(out / 'packaged-resources.json'),
            'scope': 'Actual desktop/mobile prepared copies in standard VM without Node/DOM/fetch/process; this is portability, not a hostile-code sandbox or installed/device acceptance.'},
        'independentReview': {'report': 'review.json', 'sha256': sha(out / 'review.json'), 'openFindings': []},
        'currentDocumentationReview': {'report': 'document-review.json', 'sha256': sha(out / 'document-review.json')},
    },
    'sources': {'frozenFiles': 639, 'frozenManifest': 'source-hashes.json', 'manifestSha256': sha(out / 'source-hashes.json'),
        'deltaFiles': 28, 'newFiles': 11, 'delta': 'source-delta.json', 'wasm': core['verification']['wasm'],
        'sharedCoreChanges': ['src/lib.rs dispatcher/new optional capability', 'src/scene_composition_groups_patch.rs'],
        'oldCoreImplementationsAndNativeHostUnchanged': True, 'systemRegistryUnchanged': {'modules': 7, 'declarativeCapabilities': 22}},
    'preservation': {'historicalFiles': 3111, 'authorFiles': 39, 'externalTrustedTools': 4,
        'audit': 'preservation-audit.json', 'finalConfirmation': 'final-audit.json',
        'oldAtlasPrefixesAndScoresRetained': True, 'authorDefinitionsAssetsMetadataAndIdsUnchanged': True,
        'backendGeneratorsRuntimeAndProtocolsUnchanged': True},
    'cleanup': {'report': 'cleanup.json', 'sha256': sha(out / 'cleanup.json'),
        'allocatedFileBytesRemoved': cleanup['allocatedFileBytesRemoved'], 'generatedPaths': [item['path'] for item in cleanup['removed']],
        'testedWasmAndBuildMetadataRetained': True},
    'retainedAttempts': core['retainedAttempts'] + [
        {'log': 'workflow-tests-initial.log', 'result': 'New group helper still being authored had a closing-parenthesis syntax error; corrected before frozen/final runs.'},
        {'log': 'workflow-tests-confirmed.log', 'result': '58 passed and one NEW assertion incorrectly compared changing source provenance ranges/revisions; retain all effective actor fields, independently verify full provenance; final 59 pass.'},
        {'log': 'web-focused-initial.log', 'result': 'Helper syntax and NEW host fixture import failed during initial authoring; only new helper/fixture corrected, final 41 pass and 322 regression pass.'},
        {'log': 'browser-initial.log', 'result': 'Eight workflows passed, then NEW smoke used the wrong old override button ID; fixture corrected and both full ten-flow actual browser reruns passed.'},
    ],
    'limits': ['Only organizational declaration and mapping tokens are changed; existing 128 KiB/128 actor-group-placement and depth16 budgets',
        'No implicit deletion promotion, reorder, spatial transform, fragment-definition editor, nested/cross-file reuse, multi-file transaction or cross-view history',
        'No executable recipe build, backend/runtime protocol update or installed desktop/mobile acceptance'],
}
(out / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'ok': True, 'application': 2816, 'rust': 150, 'newJavaScript': 72, 'browser': 10, 'prepared': 142}))
