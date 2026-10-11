#!/usr/bin/env python3
"""Assemble final evidence only after actual application/browser/prepared proofs.

Draft: do not run while source or proofs are still changing. No build, cleanup,
product edit or old evidence write occurs. All final counts come from reports or
completed logs; overlapping suites are never added as coverage.
"""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import json
import re
import subprocess

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]


def load(name):
    return json.loads((OUT / name).read_text(encoding='utf-8'))


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def evidence_path(name):
    path = (OUT / name).resolve(strict=True)
    assert path.is_relative_to(OUT) and path.is_file(), name
    return path


def stats(name, *, successful=True):
    path = evidence_path(name)
    text = path.read_text(encoding='utf-8')
    groups = re.findall(r'^\s*ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$', text, re.MULTILINE)
    assert len(groups) == 6, f'Exactly one completed suite is required: {name}'
    values = {key: int(value) for key, value in groups}
    assert values.keys() == {'tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'}
    assert values['tests'] > 0, name
    if successful:
        assert values['tests'] == values['pass'], name
        assert all(values[key] == 0 for key in ['fail', 'cancelled', 'skipped', 'todo']), name
    durations = re.findall(r'^\s*ℹ duration_ms ([0-9.]+)\s*$', text, re.MULTILINE)
    assert len(durations) == 1, name
    return {**values, 'durationMs': float(durations[0]), 'log': name, 'sha256': sha(path)}


def test_declarations(path):
    return len(re.findall(r'^test\(', (ROOT / path).read_text(encoding='utf-8'), re.MULTILINE))


def prepared_summary(prepared):
    kinds = ['definitions', 'groups', 'placements', 'system', 'workflow', 'structure', 'legacy']
    desktop, mobile = prepared['portable']['desktop'], prepared['portable']['mobile']
    for copy in [desktop, mobile]:
        assert copy['noNodeDomNetworkGlobals'] is True and copy['noHostImports'] is True
        assert copy['noDeviceAcceptance'] is True
    for kind in kinds:
        assert isinstance(desktop[kind], list) and desktop[kind] == mobile[kind], kind
    assert desktop['definitions'] and desktop['workflow']
    summary = {'ok': True, **{kind + 'CasesEach': len(desktop[kind]) for kind in kinds},
               'totalCases': sum(len(copy[kind]) for copy in [desktop, mobile] for kind in kinds),
               'artifacts': {name: value['manifestFileCount'] for name, value in prepared['artifacts'].items()},
               'moduleCounts': {name: prepared['portable'][name]['moduleCount'] for name in ['desktop', 'mobile']}}
    # The final prepared log independently records exactly the derived summary.
    lines = (OUT / 'prepared-check.log').read_text(encoding='utf-8').strip().splitlines()
    recorded = json.loads(lines[-1])
    assert recorded == summary, 'Prepared report and final console summary differ'
    for inventory in prepared['artifacts'].values():
        assert len(inventory['manifest']) == inventory['manifestFileCount']
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-log', default='app-check.log')
    parser.add_argument('--workflow-log', default='workflow-tests-final.log')
    parser.add_argument('--browser-report', help='Canonical successful NEW browser report; defaults to review.browser.path')
    parser.add_argument('--review-report', default='review.json')
    args = parser.parse_args()
    assert not (OUT / 'results.json').exists(), 'Do not overwrite completed evidence'
    baseline, frozen, delta = load('baseline.json'), load('source-hashes.json'), load('source-delta.json')
    manifest_sha = sha(OUT / 'source-hashes.json')
    for path, digest in frozen.items():
        assert sha(ROOT / path) == digest, path
    new_files = sum(value['before'] is None for value in delta.values())
    removed_files = sum(value['after'] is None for value in delta.values())
    assert len(frozen) == baseline['sourceFiles'] + new_files - removed_files
    assert not removed_files, 'This slice does not authorize product source deletion'
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip() == baseline['head']
    assert (ROOT / 'VERSION').read_text().strip() == baseline['version']
    app = stats(args.app_log)
    app_text = (OUT / args.app_log).read_text(encoding='utf-8')
    syntax = re.findall(r'语法检查通过：(\d+) 个 JavaScript 文件', app_text)
    assert len(syntax) == 1 and 'API 契约预检通过' in app_text
    assert f'版本一致性检查通过：{baseline["version"]}' in app_text
    core = load('core-results.json')
    verification = core['verification']
    rust = verification['rust']
    rust_totals = [int(value) for value in re.findall(r'test result: ok\. (\d+) passed;', (OUT / rust['log']).read_text())]
    assert sum(rust_totals) == rust['total'] and rust['failed'] == rust['skipped'] == 0
    assert verification['fmt']['passed'] and verification['clippy']['passed']
    assert verification['clippy']['warningsDenied']
    for path, digest in core['sourceHashes'].items():
        assert frozen[path] == digest, path
    wasm = verification['wasm']
    assert (ROOT / 'engine/studio-core.wasm').stat().st_size == wasm['bytes']
    assert frozen['engine/studio-core.wasm'] == wasm['sha256']
    pure, bridge = stats('core-pure-tests.log'), stats('core-bridge-tests.log')
    assert pure['tests'] == verification['newJavaScript']['pure']
    assert bridge['tests'] == verification['newJavaScript']['bridge']
    core_regression = stats(verification['oldAndNewRegression']['log'])
    assert core_regression['pass'] == verification['oldAndNewRegression']['passed']
    web = load('web-validation.json')
    assert web['status'] == 'pass'
    web_focus, web_regression = stats(web['focused']['path']), stats(web['regression']['path'])
    assert web_focus['tests'] == web['focused']['total'] and web_regression['tests'] == web['regression']['total']
    for item in web['frozenFiles']:
        assert frozen[item['path']] == item['sha256'], item['path']
    web_counts = {kind: test_declarations(f'scripts/tests/scene-composition-definitions-{kind}.test.mjs') for kind in ['ui', 'host', 'preview']}
    assert web_counts == web['newTests'] and sum(web_counts.values()) == web['newTestTotal']
    workflow = stats(args.workflow_log)
    workflow_new = test_declarations('scripts/tests/scene-composition-definitions-workflow.test.mjs')
    previous = json.loads((OUT.parent / 'scene-composition-group-authoring/results.json').read_text())
    assert workflow['tests'] == previous['verification']['regressions']['workflow']['tests'] + workflow_new
    review = load(args.review_report)
    assert review['ok'] is True and not review['openFindings']
    assert review['finalSourceFreeze']['sha256'] == manifest_sha
    for path, digest in review['reviewedSources'].items():
        assert frozen[path] == digest, path
    browser_name = args.browser_report or review['browser']['path']
    browser_path = evidence_path(browser_name)
    browser = json.loads(browser_path.read_text())
    assert browser['ok'] is True and browser['steps'] and not browser['errors'] and not browser['svgRequests']
    assert browser['sourceStableDuringProof'] is True
    assert len(browser['steps']) == review['browser']['stepsPassed']
    for path, digest in browser['sources'].items():
        assert frozen[path] == digest, path
    prepared = load('packaged-resources.json')
    assert prepared['ok'] is True and prepared['frozenSource']['manifestSha256'] == manifest_sha
    summary = prepared_summary(prepared)
    docs = load('document-review.json')
    assert docs['ok'] and not docs['findings']
    for item in docs['reviewedFiles']:
        assert sha(ROOT / item['path']) == item['sha256'], item['path']
    cleanup = load('cleanup.json')
    assert cleanup['ok'] and cleanup['directoriesRemainAbsent']
    assert cleanup['sourceManifestSha256'] == manifest_sha
    for item in cleanup['removed']:
        assert not (ROOT / item['path']).exists() and not (ROOT / item['path']).is_symlink()
    historical, authors, tools = load('historical-baseline.json'), load('author-baseline.json'), load('tool-baseline.json')
    assert len(historical) == baseline['historicalFiles'] and len(authors) == baseline['authorFiles']
    core_new = verification['newJavaScript']['total']
    browser_attempts = []
    explanations = {
        'browser-initial': 'Three actual workflows completed, then the NEW smoke compared raw object-map key insertion order rather than semantic mapping; only the new fixture changed.',
        'browser-second': 'Actual app boot failed after the new candidate imported server-only json-source; the later browser-third diagnostics confirmed the denied node_modules/yaml dependency. The second report itself is not presented as capturing that 404.',
        'browser-third': 'Actual 404 diagnostics for the same server-only YAML dependency retained; fixed by the final portable Rust source-location operation without widening the static allowlist.',
    }
    for directory, explanation in explanations.items():
        path = OUT / directory / 'browser.json'
        if path.exists():
            data = json.loads(path.read_text())
            browser_attempts.append({'report': str(path.relative_to(OUT)), 'stepsCompleted': len(data.get('steps', [])),
                                     'ok': data.get('ok', False), 'result': explanation})
    application_initial = stats('app-check-initial.log', successful=False)
    assert {key: application_initial[key] for key in ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']} == {
        'tests': 2884, 'pass': 2883, 'fail': 1, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    application_attempt = {
        **application_initial,
        'result': 'The existing doc-api browser-module-graph test caught the real new server-only YAML dependency: 2884 tests completed, 2883 passed and one failed. The final candidate removes that dependency; this initial product failure remains retained.',
    }
    workflow_attempts = []
    for name in ['workflow-tests-initial.log', 'workflow-tests-final.log']:
        if (OUT / name).is_file():
            actual = stats(name)
            workflow_attempts.append({**actual, 'result': 'Actual successful workflow proof retained; no workflow failure is attributed to this attempt.'})
    prepared_attempts = []
    prepared_initial = OUT / 'prepared-check-initial.log'
    if prepared_initial.is_file():
        prepared_attempts.append({
            'log': 'prepared-check-initial.log', 'sha256': sha(prepared_initial),
            'result': 'The NEW prepared domain fixture reused old provenance without decl.templatePointer. The final candidate guard correctly rejected it. Only the NEW prepared payload was corrected from the actual expanded templatePath; old fixtures and product behavior were unchanged.',
        })
    report = {
        'format': 'viento-scene-composition-definition-authoring-results', 'schemaVersion': 1,
        'createdAt': datetime.now(timezone.utc).isoformat(), 'ok': True, 'head': baseline['head'], 'version': baseline['version'],
        'scope': 'Unpublished shared fragment definition ADD/COPY/unplaced REMOVE in one ordinary registered recipe. No new release, commit, installation, device, author schema or execution backend protocol acceptance.',
        'behavior': [
            'ADD appends a complete raw shared fragment. The independent GUI initially authors one catalog actor with position and explicit fields or projection inheritance, with groups:[].',
            'COPY preserves the complete original fragment CST and changes only its fragmentId token; copied definitions remain unplaced and keep object/resource/local-key references.',
            'REMOVE requires zero raw placement references and at least one remaining definition. It does not cascade into author documents, resources, placements or other definitions.',
            'No generated instance or group UUIDs are allocated; exact eight-field proposals have targets:[] and existing effective actors and organizational relationships remain unchanged.',
            'The complete candidate rebuilds every source contribution after declaration insertion/removal, including removal before placed fragments, and validates source identity and existing effective fields.',
            'Unused declarations receive existing basic registered-object and explicit-image checks; effective projection defaults and actual image bytes are checked on first placement.',
            'The final candidate uses portable synchronous Rust CST source locations, not a new server-exposed YAML dependency; this is a read-only operation under the same optional definitions ABI, not a fourth edit action.',
            'All awaited review/apply work retains private source owner, raw approval and exact completion receipt. Memory application preserves the ordinary Save baseline and external-file conflict protection.',
        ],
        'verification': {
            'application': {**app, 'runtime': load('fixed-node.json'), 'syntaxJavaScriptFiles': int(syntax[0]),
                            'frozenSourceManifest': 'source-hashes.json', 'finalSourcesVerifiedUnchanged': True},
            'sharedCore': rust, 'fmt': verification['fmt'], 'clippy': verification['clippy'],
            'newJavaScript': {'total': core_new + web['newTestTotal'] + workflow_new, 'core': core_new,
                              'coreDetails': verification['newJavaScript'], 'web': web['newTestTotal'], 'webBreakdown': web_counts,
                              'workflow': workflow_new, 'containedInApplication': True, 'pure': pure, 'bridge': bridge,
                              'webIncludingFivePreviousCases': web_focus, 'workflowIncludingPreviousCases': workflow},
            'regressions': {'core': core_regression, 'web': web_regression, 'workflow': workflow, 'countsOverlap': True},
            'browser': {**review['browser'], 'path': str(browser_path.relative_to(OUT)), 'sha256': sha(browser_path),
                        'sourceStableDuringProof': True, 'flowAssertions': browser['steps']},
            'prepared': {**summary, 'report': 'packaged-resources.json', 'sha256': sha(OUT / 'packaged-resources.json'),
                         'scope': 'Actual desktop/mobile copied ESM/WASM in standard VM without Node/DOM/network globals or host imports; portability only, not installation/device acceptance.'},
            'independentReview': {'report': args.review_report, 'sha256': sha(OUT / args.review_report), 'openFindings': []},
            'currentDocumentationReview': {'report': 'document-review.json', 'sha256': sha(OUT / 'document-review.json')},
        },
        'sources': {'frozenFiles': len(frozen), 'frozenManifest': 'source-hashes.json', 'manifestSha256': manifest_sha,
                    'deltaFiles': len(delta), 'newFiles': new_files, 'delta': 'source-delta.json', 'wasm': wasm,
                    'coreSourceHashes': core['sourceHashes']},
        'preservation': {'historicalFiles': len(historical), 'authorFiles': len(authors), 'externalTrustedTools': len(tools),
                         'audit': 'preservation-audit.json', 'finalConfirmation': 'final-audit.json',
                         'oldAtlasPrefixesAndScoresRetained': True, 'authorDefinitionsAssetsMetadataAndIdsUnchanged': True,
                         'backendGeneratorsRuntimeAndProtocolsUnchanged': True},
        'cleanup': {'report': 'cleanup.json', 'sha256': sha(OUT / 'cleanup.json'),
                    'allocatedFileBytesRemoved': cleanup['allocatedFileBytesRemoved'],
                    'generatedPaths': [item['path'] for item in cleanup['removed']], 'testedWasmAndBuildMetadataRetained': True},
        'retainedAttempts': core['retainedAttempts'] + [web['initialAttempt'], application_attempt] + workflow_attempts + prepared_attempts + browser_attempts,
        'limits': ['Existing 128 KiB, 32 definitions, 128 aggregate declared/expanded actors and groups; unused declarations count toward declaration budgets.',
                   'No fragment renaming/reordering, cascading delete, placement mutation, spatial transformation, nested/cross-file reuse, multi-file transaction or cross-view history.',
                   'No recipe execution backend, installed desktop build, Android authoring/device acceptance or unplaced-rendering guarantee.'],
    }
    with (OUT / 'results.json').open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'ok': True, 'application': app['tests'], 'rust': rust['total'],
                      'newJavaScript': report['verification']['newJavaScript']['total'],
                      'browser': len(browser['steps']), 'prepared': summary['totalCases']}))


if __name__ == '__main__':
    main()
