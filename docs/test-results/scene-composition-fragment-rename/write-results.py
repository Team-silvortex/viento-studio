#!/usr/bin/env python3
"""Assemble final rename evidence from completed receipts; no build or cleanup.

Draft: do not run while source, copied artifacts or browser proofs are changing.
This writes only the NEW results.json and never replaces existing evidence.
Actual counts are read from logs/reports, not predicted from the previous slice.
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
    return json.loads(evidence_path(name).read_text(encoding='utf-8'))


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def evidence_path(name):
    path = (OUT / name).resolve(strict=True)
    assert path.is_relative_to(OUT) and path.is_file(), name
    return path


def stats(name):
    path = evidence_path(name)
    text = path.read_text(encoding='utf-8')
    groups = re.findall(r'^\s*ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$', text, re.MULTILINE)
    assert len(groups) == 6, f'Exactly one completed suite is required: {name}'
    values = {key: int(value) for key, value in groups}
    assert values.keys() == {'tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'}
    assert values['tests'] > 0 and values['tests'] == values['pass'], name
    assert all(values[key] == 0 for key in ['fail', 'cancelled', 'skipped', 'todo']), name
    durations = re.findall(r'^\s*ℹ duration_ms ([0-9.]+)\s*$', text, re.MULTILINE)
    assert len(durations) == 1, name
    return {**values, 'durationMs': float(durations[0]), 'log': name, 'sha256': sha(path)}


def test_declarations(path):
    return len(re.findall(r'^test\(', (ROOT / path).read_text(encoding='utf-8'), re.MULTILINE))


def prepared_summary(prepared):
    desktop, mobile = prepared['portable']['desktop'], prepared['portable']['mobile']
    kinds = [key for key, value in desktop.items() if isinstance(value, list)]
    assert 'rename' in kinds, 'The NEW rename cases must be exercised in each actual copied module graph'
    assert set(kinds) == {key for key, value in mobile.items() if isinstance(value, list)}
    for copy in [desktop, mobile]:
        assert copy['noNodeDomNetworkGlobals'] is True and copy['noHostImports'] is True
        assert copy['noDeviceAcceptance'] is True
    for kind in kinds:
        assert desktop[kind] and desktop[kind] == mobile[kind], kind
    summary = {'ok': True, **{kind + 'CasesEach': len(desktop[kind]) for kind in kinds},
               'totalCases': sum(len(copy[kind]) for copy in [desktop, mobile] for kind in kinds),
               'artifacts': {name: value['manifestFileCount'] for name, value in prepared['artifacts'].items()},
               'moduleCounts': {name: prepared['portable'][name]['moduleCount'] for name in ['desktop', 'mobile']}}
    lines = evidence_path('prepared-check.log').read_text(encoding='utf-8').strip().splitlines()
    assert json.loads(lines[-1]) == summary, 'Prepared report and final console summary differ'
    for inventory in prepared['artifacts'].values():
        assert len(inventory['manifest']) == inventory['manifestFileCount']
    return summary


def retained_attempts(core, web):
    result = list(core.get('retainedAttempts', [])) + [web['initialAttempt']]
    explanations = {
        'native-tools-build-initial.log': 'The initial native helper build ran before the declared Node sidecar was ready and failed. Final native helper receipts verify the later successful retry; no authoring product repair is inferred from this preparation ordering failure.',
        'native-tools-build-second.log': 'The second native helper build failed because desktop/resources was not yet prepared. Final native helper receipts verify the later successful retry; the successful native-tools-build.log is not mislabeled as this initial failure.',
        'browser-initial/browser.json': 'The NEW smoke opened dialogs without trusted user activation, so Escape closed both close-watcher group members despite declining discard. This actual trace is retained; later complete trusted pointer interaction establishes the normal user behavior. No product repair was made.',
        'browser-second/browser.json': 'The NEW smoke opened the child with a real pointer but still checked it synthetically. Escape closed the child while leaving the parent open. It still lacked the subsequent user activation needed for a cancelable close watcher; no product repair was made.',
        'browser-third/browser.json': 'The NEW trace captured trusted cancel with cancelable:false and defaultPrevented:false before and after the existing preventDefault handler. This confirms the missing activation of the synthetic Check path; the later real-pointer Check made cancel cancelable and declining discard retained approval. No product repair was made.',
        'browser-fourth/browser.json': 'With real pointer opening and Check, Escape discard decline retained the dialog and approval and accepting discard closed it. Five actual workflows passed before an unrelated NEW smoke setup evaluated multiple statements without an IIFE and failed with SyntaxError. Only that NEW fixture was corrected; product bytes remain unchanged.',
        'prepared-check-initial.log': 'The prepared proof correctly rejected a copied engine README that had become stale. Resources were refreshed from the final source; no copy mismatch is counted as a successful prepared proof.',
        'prepared-check-second.log': 'The second prepared proof correctly rejected a NEW browser smoke file that changed after the source freeze. Its source receipt is refreshed for the final proof; no product or old-fixture workaround is implied.',
        'document-review-initial.json': 'The first read-only current-document review requested three scope/button-label corrections; its original report bytes are retained separately from the final recheck.',
    }
    for name, description in explanations.items():
        path = OUT / name
        if not path.is_file():
            continue
        item = {'path': name, 'sha256': sha(path), 'result': description}
        if name.endswith('/browser.json'):
            data = json.loads(path.read_text(encoding='utf-8'))
            item.update(ok=data.get('ok', False), stepsCompleted=len(data.get('steps', [])))
        elif name == 'document-review-initial.json':
            data = json.loads(path.read_text(encoding='utf-8'))
            item.update(status=data['status'], requestedCorrections=len(data['findings']))
        result.append(item)
    return result


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
    app_text = evidence_path(args.app_log).read_text(encoding='utf-8')
    syntax = re.findall(r'语法检查通过：(\d+) 个 JavaScript 文件', app_text)
    assert len(syntax) == 1 and 'API 契约预检通过' in app_text
    assert f'版本一致性检查通过：{baseline["version"]}' in app_text
    core = load('core-results.json')
    verification, rust = core['verification'], core['verification']['rust']
    rust_totals = [int(value) for value in re.findall(r'test result: ok\. (\d+) passed;', evidence_path(rust['log']).read_text())]
    assert sum(rust_totals) == rust['total'] and rust['failed'] == rust['skipped'] == 0
    assert verification['fmt']['passed'] and verification['clippy']['passed'] and verification['clippy']['warningsDenied']
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
    web = load('web-validation.json'); assert web['status'] == 'pass'
    web_focus = stats(web['focused']['path']); assert web_focus['tests'] == web['focused']['total']
    for item in web['frozenFiles']:
        assert frozen[item['path']] == item['sha256'], item['path']
    web_new = test_declarations('scripts/tests/scene-composition-definition-rename-ui.test.mjs')
    assert web_new == web['newTests'] == web['focused']['new']
    workflow = stats(args.workflow_log)
    workflow_new = test_declarations('scripts/tests/scene-composition-definition-rename-workflow.test.mjs')
    previous = json.loads((OUT.parent / 'scene-composition-definition-authoring/results.json').read_text())
    assert workflow['tests'] == previous['verification']['regressions']['workflow']['tests'] + workflow_new
    review = load(args.review_report); assert review['ok'] is True and not review['openFindings']
    assert review['finalSourceFreeze']['manifestSha256'] == manifest_sha
    for path, digest in review['reviewedSources'].items():
        assert frozen[path] == digest, path
    browser_name = args.browser_report or review['browser']['report']
    browser_path = evidence_path(browser_name); browser = json.loads(browser_path.read_text())
    assert browser['ok'] is True and browser['steps'] and not browser['errors'] and not browser['svgRequests']
    assert browser['sourceStableDuringProof'] is True and len(browser['steps']) == review['browser']['flowClasses']
    for path, digest in browser['sources'].items():
        assert frozen[path] == digest, path
    prepared = load('packaged-resources.json')
    assert prepared['ok'] is True and prepared['frozenSource']['manifestSha256'] == manifest_sha
    summary = prepared_summary(prepared)
    docs = load('document-review.json'); assert docs['ok'] and not docs['findings']
    for item in docs['reviewedFiles']:
        assert sha(ROOT / item['path']) == item['sha256'], item['path']
    cleanup = load('cleanup.json'); assert cleanup['ok'] and cleanup['directoriesRemainAbsent']
    assert cleanup['sourceManifestSha256'] == manifest_sha
    for item in cleanup['removed']:
        assert not (ROOT / item['path']).exists() and not (ROOT / item['path']).is_symlink()
    historical, authors, tools = load('historical-baseline.json'), load('author-baseline.json'), load('tool-baseline.json')
    assert len(historical) == baseline['historicalFiles'] and len(authors) == baseline['authorFiles']
    core_new = verification['newJavaScript']['total']
    report = {
        'format': 'viento-scene-composition-fragment-rename-results', 'schemaVersion': 1,
        'createdAt': datetime.now(timezone.utc).isoformat(), 'ok': True, 'head': baseline['head'], 'version': baseline['version'],
        'scope': 'Unpublished fragment identifier RENAME added to the existing independent definition editor. Nine authoring domains remain; no new release, commit, installation, device or execution backend protocol acceptance.',
        'behavior': [
            'Rename changes the selected raw fragmentId value and all matching placement fragmentId reference values atomically, for placed or unused definitions.',
            'Existing instance/group UUIDs, actor/group local keys, declaration order, effective fields, offsets and overrides remain unchanged; no UUID is generated and proposal targets is exactly [].',
            'The new independent optional rename probe/dispatcher does not grant the old three-action capability. Missing or unsupported rename capability disables only rename; prior ADD/COPY/unplaced REMOVE and read-only locations remain available.',
            'The form pre-fills the current ID, requires a distinct unique case-sensitive local ID, reviews every actual related placement identity, and declines unchanged IDs before requesting candidate approval.',
            'Complete original/candidate recipes and source locations are verified within existing budgets. Declared identity/reference token replacement preserves unrelated source bytes, BOM, CRLF and original numeric spelling.',
            'Private source ownership, raw signature, asynchronous candidate cleanup and exact completion receipt remain mandatory. Application is memory-only; ordinary Save owns persistence and external-file conflict protection.',
            'Unused definitions retain basic registered dependency checks; first placement retains effective projection and actual image-content checks. No unplaced rendering guarantee is added.',
        ],
        'verification': {
            'application': {**app, 'runtime': load('fixed-node.json'), 'syntaxJavaScriptFiles': int(syntax[0]), 'frozenSourceManifest': 'source-hashes.json', 'finalSourcesVerifiedUnchanged': True, 'sourceScope': 'Product and unit-test owners froze their files before this application run; these hashes still match. Only the NEW non-unit browser fixture was subsequently corrected and separately passed the final real-browser proof.'},
            'sharedCore': rust, 'fmt': verification['fmt'], 'clippy': verification['clippy'],
            'newJavaScript': {'total': core_new + web_new + workflow_new, 'core': core_new, 'coreDetails': verification['newJavaScript'], 'web': web_new,
                              'workflow': workflow_new, 'containedInApplication': True, 'pure': pure, 'bridge': bridge,
                              'webIncludingPreviousDefinitionCases': web_focus, 'workflowIncludingPreviousCases': workflow},
            'regressions': {'core': core_regression, 'web': web_focus, 'workflow': workflow, 'countsOverlap': True},
            'browser': {**review['browser'], 'stepsPassed': len(browser['steps']), 'path': str(browser_path.relative_to(OUT)), 'sha256': sha(browser_path), 'sourceStableDuringProof': True, 'flowAssertions': browser['steps']},
            'prepared': {**summary, 'report': 'packaged-resources.json', 'sha256': sha(OUT / 'packaged-resources.json'),
                         'scope': 'Actual desktop/mobile copied ESM/WASM in standard VM without Node/DOM/network globals or host imports; portability only, not installation/device acceptance.'},
            'secondaryCoreAudit': {'report': 'core-independent-audit.json', 'sha256': sha(OUT / 'core-independent-audit.json'), 'findings': load('core-independent-audit.json')['findings'], 'additionalActualProbeGroups': load('core-independent-audit.json')['probe']['groups'], 'countsOverlap': True},
            'independentReview': {'report': args.review_report, 'sha256': sha(OUT / args.review_report), 'openFindings': []},
            'currentDocumentationReview': {'report': 'document-review.json', 'sha256': sha(OUT / 'document-review.json')},
        },
        'sources': {'frozenFiles': len(frozen), 'frozenManifest': 'source-hashes.json', 'manifestSha256': manifest_sha, 'deltaFiles': len(delta), 'newFiles': new_files, 'delta': 'source-delta.json', 'wasm': wasm, 'coreSourceHashes': core['sourceHashes']},
        'preservation': {'historicalFiles': len(historical), 'authorFiles': len(authors), 'externalTrustedTools': len(tools), 'audit': 'preservation-audit.json', 'finalConfirmation': 'final-audit.json',
                         'oldAtlasPrefixesAndScoresRetained': True, 'authorDefinitionsAssetsMetadataAndIdsUnchanged': True, 'backendGeneratorsRuntimeAndProtocolsUnchanged': True},
        'cleanup': {'report': 'cleanup.json', 'sha256': sha(OUT / 'cleanup.json'), 'allocatedFileBytesRemoved': cleanup['allocatedFileBytesRemoved'], 'generatedPaths': [item['path'] for item in cleanup['removed']], 'testedWasmAndBuildMetadataRetained': True},
        'retainedAttempts': retained_attempts(core, web),
        'limits': ['Existing 128 KiB, 32 fragment definitions, 128 aggregate declared/expanded actor and group budgets.',
                   'No declaration reordering, cascading delete, spatial transformation, nested/cross-file reuse, multi-file transaction or cross-view history.',
                   'No new author resource acceptance, execution backend protocol, installed desktop build or Android device acceptance.'],
    }
    with (OUT / 'results.json').open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'ok': True, 'application': app['tests'], 'rust': rust['total'], 'newJavaScript': report['verification']['newJavaScript']['total'], 'browser': len(browser['steps']), 'prepared': summary['totalCases']}))


if __name__ == '__main__':
    main()
