#!/usr/bin/env python3
"""Only read repo bytes and publish new sibling review/browser summaries."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent


def sha(path):
    result = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def read(name):
    return json.loads((HERE / name).read_text())


def save(name, value):
    with (HERE / name).open('x') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write('\n')


def verify(name):
    values = read(name)
    for path, expected in values.items():
        assert sha(ROOT / path) == expected, (name, path)
    return {'files': len(values), 'allBytesMatch': True, 'manifestSha256': sha(HERE / name)}


history = verify('historical-baseline.json')
assert history['files'] == 2799
actual_history = {str(path.relative_to(ROOT)) for path in (ROOT / 'docs/test-results').rglob('*')
                  if path.is_file() and HERE not in path.parents}
assert actual_history == set(read('historical-baseline.json'))
source = verify('source-hashes.json')
assert source['files'] == 610
initial = read('source-hashes-initial.json')
assert initial == read('previous-source-hashes.json') and len(initial) == 604
final = read('source-hashes.json')
delta = {path: {'before': initial.get(path), 'after': final.get(path)}
         for path in sorted(set(initial) | set(final)) if initial.get(path) != final.get(path)}
assert delta == read('source-delta.json') and len(delta) == 10
protected = {name: verify(name) for name in ['core-source-hashes.json', 'core-source-hashes-final.json',
             'frozen-backend-baseline.json', 'protected-scene-slices.json', 'author-baseline.json']}
assert read('core-source-hashes.json') == read('core-source-hashes-final.json')
assert [protected[name]['files'] for name in ['core-source-hashes.json', 'frozen-backend-baseline.json',
                                           'protected-scene-slices.json', 'author-baseline.json']] == [14, 7, 23, 39]
author_paths = {str(path.relative_to(ROOT)) for path in (ROOT / 'examples').rglob('*') if path.is_file()}
assert author_paths == set(read('author-baseline.json'))
for path, expected in read('tool-baseline.json').items():
    file = Path(path)
    stat = file.stat()
    assert (stat.st_size, stat.st_dev, stat.st_ino, sha(file)) == (
        expected['bytes'], expected['dev'], expected['ino'], expected['sha256']), path
baseline = read('baseline.json')
assert sha(ROOT / 'engine/studio-core.wasm') == baseline['retainedSharedCore']['sha256']
assert sha(ROOT / 'engine/studio-core.build.json') == baseline['retainedSharedCore']['buildMetadataSha256']
assert (ROOT / 'engine/studio-core.wasm').stat().st_size == 337188

provenance = read('browser-provenance-initial.json')
for path, expected in provenance['sourceHashes'].items():
    assert sha(ROOT / path) == expected, path
entries = []
for row in provenance['entries']:
    assert sha(ROOT / row['script']) == initial[row['script']] == row['scriptSha256']
    output = ROOT / row['outputDirectory']
    result = json.loads((output / 'browser.json').read_text())
    assert result['ok'] is True and len(result['steps']) == row['expectedExistingWorkflows']
    assert result['errors'] == [] and result['svgRequests'] == []
    assert result['browser'] == 'Chrome/154.0.8037.97'
    entries.append({'domain': row['domain'], 'script': row['script'], 'scriptSha256': row['scriptSha256'],
                    'report': str((output / 'browser.json').relative_to(HERE)),
                    'reportSha256': sha(output / 'browser.json'),
                    'logSha256': sha(HERE / (output.name + '.log')),
                    'workflows': len(result['steps']), 'runtimeErrors': 0, 'externalSvgRequests': 0})
assert sum(row['workflows'] for row in entries) == 37
screenshots = ['browser-override/inheritance-complete-review.png', 'browser-canvas/canvas-source-review.png',
               'browser-batch/batch-source-review.png', 'browser-fragment-inheritance/fragment-inheritance-review.png',
               'browser-placement/placement-reviewed.png', 'browser-structure/structure-reviewed.png',
               'browser-structure/structure-narrow-zh-CN.png', 'browser-structure/structure-narrow-en.png',
               'browser-structure/structure-narrow-ja.png']
browser = {'schemaVersion': 1, 'ok': True, 'capturedAt': datetime.now(timezone.utc).isoformat(),
           'node': provenance['node'], 'browser': 'Chrome/154.0.8037.97', 'entries': entries, 'totalWorkflows': 37,
           'sourceHashes': provenance['sourceHashes'], 'sourceFilesStableDuringRun': len(provenance['sourceHashes']),
           'visualInspection': {'viewed': 9, 'files': {path: sha(HERE / path) for path in screenshots},
                'result': 'All six controller representative screenshots plus the three 390px structure locales were viewed. Layout, translated actions and scrollable source/identity review remain readable; no horizontal clipping or changed visual behavior was found.',
                'scope': 'Representative existing UI regression, not exhaustive visual acceptance of every screenshot or new layout design.'},
           'scope': 'Actual real HTTP editor and Chrome regression using six old scripts unchanged; mocked transport is not used for these workflows.',
           'unclaimed': ['Installed Tauri application', 'Android device acceptance', 'Native engine execution', 'New visual redesign acceptance']}
save('browser-regression.json', browser)

review = {'schemaVersion': 1, 'capturedAt': datetime.now(timezone.utc).isoformat(), 'ok': True, 'openFindings': [],
          'mode': 'Independent read-only design/implementation audit plus real browser regression and byte preservation checks',
          'reviewScriptSha256': sha(Path(__file__).resolve()),
          'reviewedSources': {path: sha(ROOT / path) for path in [
              'engine/scene-authoring-candidate.mjs', 'engine/scene-authoring-workflow.mjs',
              'web/modules/app-scene-authoring.js', 'web/modules/app-project-build.js', 'web/modules/app-runtime.js',
              'engine/README.md', 'scripts/tests/scene-authoring-candidate.test.mjs',
              'scripts/tests/scene-authoring-workflow.test.mjs', 'scripts/tests/scene-authoring-ui.test.mjs',
              'scripts/tests/scene-composition-overrides-bridge.test.mjs']},
          'preservation': {'historical': history, 'source': source, 'previousSourceFiles': 604,
              'protected': protected, 'tools': {'files': 4, 'allByteHashesAndPhysicalIdentityMatch': True},
              'retainedWasmBytes': 337188, 'retainedWasmSha256': baseline['retainedSharedCore']['sha256'],
              'retainedBuildMetadataSha256': baseline['retainedSharedCore']['buildMetadataSha256'],
              'sourceDeltaEntries': 10, 'sourceDeltaManifestSha256': sha(HERE / 'source-delta.json'),
              'oldCouplingSpecificTestChange': 'old-test-contract-review.json'},
          'executedByThisReviewer': {'browserWorkflows': 37, 'browserReport': 'browser-regression.json',
              'browserReportSha256': sha(HERE / 'browser-regression.json'), 'screenshotsViewed': 9,
              'independentNativeEngineOrProductUnitTestsRun': 0},
          'reviewedBoundaries': [
              {'area': 'layer-separation', 'result': 'passed', 'detail': 'Synchronous pure candidate validation receives detached JSON and a captured source SHA. Workflow owns per-domain lifecycle through explicit ports and contains no DOM, HTTP, execution backend or ordinary Save authority. Browser adapter binds transport, catalog and each existing renderer; build parent only provides current source owner and navigation context.'},
              {'area': 'six-independent-workflows', 'result': 'passed', 'detail': 'Override and single canvas share the established instance candidate rule while retaining separate workflow functions/epochs/receipts. Batch, fragment, placement and structure use their fixed distinct strategies. No shared child form state or global approval bus was added; capability context exposes only the current entry capability and six existing source-owner fields.'},
              {'area': 'candidate-contract-preservation', 'result': 'passed', 'detail': 'The five existing accepted domains retain their envelope and target policies. Structure accepts removed openers and source-only unused targets[] while verifying complete ordered actor/group provenance; placement matches real sceneStructure.groups; final source SHA/path, draft baseline, composition identity and preview lease are bound before acceptance. Candidate validation grants no source write or executable scene authority.'},
              {'area': 'detached-asynchronous-lifecycle', 'result': 'passed', 'detail': 'Model/source/catalog/proposals are detached at ownership boundaries before asynchronous use; accessors/serializers, malformed non-JSON data and late caller/submitted DTO mutations reject. Open/reset generations and independent review/apply epochs invalidate older responses. All returned valid preview IDs are best-effort released even for stale or malformed responses.'},
              {'area': 'committed-receipt', 'result': 'passed', 'detail': 'The trusted ordinary source port still recomputes exact domain patches and guards the editor baseline. Successful memory application may advance its source token; completion retains the original parent/source/session, current apply epoch, detached proposal fingerprint and exact result identity. Sibling workflows, closed sessions and older overlapping apply responses cannot replay that receipt.'},
              {'area': 'unchanged-editor-policy', 'result': 'passed', 'detail': 'Existing editable/source-mode, request-busy/running and selected recipe/session rules remain supplied by the parent port. This extraction adds no execution-time author permissions, source disk Save, asset import/export, generated-engine reverse editing or new metadata transaction.'},
              {'area': 'render-and-engine-isolation', 'result': 'passed', 'detail': 'Six renderers, 14 Rust sources, existing shared WASM/build metadata, backend generators/runtime files and protected old scene domains retain their bytes. Browser snapshots add explicit new workflow/candidate/adapter hashes that old smoke scripts do not capture themselves. Represented editor review, cancel, ordinary Save, source conflicts, image ownership and stable UUID flows all passed.'}
          ],
          'resolvedFindings': [{'area': 'unknown-kind-prototype-members',
              'finding': 'The initial normal-object capability table allowed constructor/toString/__proto__ lookups to reach inherited values and throw an unclassified TypeError.',
              'resolution': 'Workflow owner added string and own-key checks before capability lookup, retaining the established invalid errorCode.',
              'evidence': 'scripts/tests/scene-authoring-workflow.test.mjs invalid kind/capability test; workflow-tests.log 31/31'}],
          'reviewSuggestionsImplemented': ['Latest-request epochs protect overlapping reviews and applies without sharing form state.',
              'Reset/open expire prior child owners; complete model is snapshotted before source/catalog awaits.',
              'Exact committed receipt tolerates the source-token increment but rejects owner replacement.'],
          'retainedInitialEvidence': {'compositionRegression': 'composition-regression-initial.log',
              'reason': '337 old tests initially had only the obsolete same-function reference assertion fail (336 pass, one fail, zero skip). The approved independent-function contract change retains both full POST validation and preview DELETE release; original evidence was not overwritten.',
              'workflowInitial': 'workflow-tests-initial.log', 'candidateInitial': 'candidate-tests-initial.log'},
          'unclaimed': ['Installed desktop or Android acceptance', 'Native engine execution in this reviewer scope',
              'New UI layout or ergonomic design acceptance', 'Cross-file transactions or unified cross-view history',
              'Hostile-code VM sandbox', 'Expanded candidate format support or runtime permissions']}
save('boundary-review.json', review)
print(json.dumps({'ok': True, 'sourceFiles': 610, 'historicalFiles': 2799,
                  'browserWorkflows': 37, 'screenshotsViewed': 9, 'openFindings': []}))
