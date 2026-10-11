"""Assemble completed 3D receipts. Never runs tests, engines or deletion."""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]

def sha(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def load(name):
    return json.loads((OUT / name).read_text())

def store(name, value):
    with (OUT / name).open('x') as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def stats(name):
    text = (OUT / name).read_text()
    found = re.findall(r'^\s*ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$', text, re.MULTILINE)
    assert len(found) == 6, name
    result = {key: int(value) for key, value in found}
    assert result['tests'] == result['pass'] > 0
    assert all(result[key] == 0 for key in ['fail', 'cancelled', 'skipped', 'todo'])
    result.update(log=name, sha256=sha(OUT / name), durationMs=float(re.findall(r'^\s*ℹ duration_ms ([0-9.]+)\s*$', text, re.MULTILINE)[0]))
    return result

def receipt(name):
    return {'path': name, 'sha256': sha(OUT / name)}

def confirm():
    frozen = load('source-hashes.json')
    for name, digest in frozen.items():
        assert sha(ROOT / name) == digest, name
    core, web = load('core-results.json'), load('web-validation.json')
    peer, backend = load('core-cross-review.json'), load('core-backend-boundary-review.json')
    assert not peer['findings'] and not backend['openFindings'] and backend['ok']
    assert web['ok']
    for owner, key in [(core, 'sourceHashes'), (peer, 'sourceHashes'), (backend, 'reviewedSourceHashes'), (web, 'sources')]:
        for name, value in owner[key].items():
            digest = value['sha256'] if isinstance(value, dict) else value
            assert frozen[name] == digest, name
    browser_name = web['browser']['path']
    browser = load(browser_name)
    assert browser['ok'] and browser['sourceStableDuringProof'] and not browser['errors'] and len(browser['steps']) == 7
    for name, digest in browser['sources'].items():
        assert frozen[name] == digest, name
    prepared = load('packaged-resources.json')
    assert prepared['ok'] and prepared['frozenSource']['manifestSha256'] == sha(OUT / 'source-hashes.json')
    docs = load('document-review.json')
    assert docs['ok'] and not docs['findings']
    for item in docs['reviewedFiles']:
        assert sha(ROOT / item['path']) == item['sha256'], item['path']
    godot = load('godot-final.json')
    assert godot['ok'] and godot['sourcesBefore'] == godot['sourcesAfter']
    for name, value in godot['sourcesBefore'].items():
        assert frozen[name] == value['sha256'], name
    return frozen, core, web, browser_name, browser, prepared, docs, godot

def review():
    frozen, core, web, browser_name, browser, prepared, docs, godot = confirm()
    preservation = load('preservation-audit-before-cleanup.json')
    assert preservation['ok'] and not preservation['errors']
    report = {'format': 'viento-scene3d-primitives-review', 'schemaVersion': 1, 'ok': True,
              'createdAt': datetime.now(timezone.utc).isoformat(), 'openFindings': [],
              'scope': 'Independent peer source reviews plus actual full suite, fresh native/WASM, browser software GPU, Godot and prepared-copy receipts; author/history/tool preservation. No installed/device or hostile-tool sandbox claim.',
              'finalSourceFreeze': {'manifestSha256': sha(OUT / 'source-hashes.json'), 'files': len(frozen)},
              'reviewedSources': frozen,
              'independent': [receipt(name) for name in ['core-cross-review.json', 'core-backend-boundary-review.json', 'core-independent-audit.json', 'core-final-confirmation-label.json']],
              'application': stats('app-check.log'),
              'finalLabelCorrection': {'files': ['web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/scene3d-preview-ui.test.mjs'],
                                      'scope': 'The full suite started before the final Name/名前 label-only correction. These targeted tests, all seven real browser flows and refreshed prepared copies were repeated after the correction; earlier passed proofs are retained.',
                                      'ui': stats(web['tests']['log']), 'i18n': stats('i18n-label-final.log')},
              'browser': {'report': browser_name, 'flowClasses': len(browser['steps']), 'sha256': sha(OUT / browser_name), 'physicalGpuAcceptance': False},
              'godot': receipt('godot-final.json'), 'prepared': receipt('packaged-resources.json'),
              'documentation': receipt('document-review.json'), 'preservation': receipt('preservation-audit-before-cleanup.json'),
              'limitations': ['Only box geometry, perspective camera, directional light and transforms. No model/texture assets, hierarchy, physics, behavior or source-edit transaction.',
                              'Godot export/run is an independent experimental CLI, not a new button in the existing 2D build workbench.',
                              'Browser actual WebGL2 uses ANGLE SwiftShader; native Godot proof is a finite headless static tree/transform/material check.',
                              'Source/plan bytes and UUIDs remain authoritative; renderer floating point is not bitwise raster parity.',
                              'Only newly created private receipts authorize one bounded execution. Same-user filesystem races and arbitrary executable behavior are not sandboxed.']}
    store('review.json', report)
    print(json.dumps({'ok': True, 'sources': len(frozen), 'browser': len(browser['steps'])}))

def results():
    frozen, core, web, browser_name, browser, prepared, docs, godot = confirm()
    audit, cleanup, review = load('preservation-audit-before-cleanup.json'), load('cleanup.json'), load('review.json')
    assert audit['ok'] and cleanup['ok'] and cleanup['directoriesRemainAbsent'] and review['ok']
    manifest = sha(OUT / 'source-hashes.json')
    assert cleanup['sourceManifestSha256'] == review['finalSourceFreeze']['manifestSha256'] == manifest
    for item in cleanup['removed']:
        assert not (ROOT / item['path']).exists() and not (ROOT / item['path']).is_symlink()
    baseline, delta = load('baseline.json'), load('source-delta.json')
    app = stats('app-check.log')
    syntax = re.findall(r'语法检查通过：(\d+) 个 JavaScript 文件', (OUT / 'app-check.log').read_text())
    assert len(syntax) == 1
    copies = [prepared['portable'][name] for name in ['desktop', 'mobile']]
    kinds = [key for key, value in copies[0].items() if isinstance(value, list)]
    assert all(copies[0][key] == copies[1][key] for key in kinds)
    total = sum(len(value[key]) for value in copies for key in kinds)
    rust = core['verification']['rust']
    rust_total = sum(int(value) for value in re.findall(r'test result: ok\. (\d+) passed;', (OUT / rust['log']).read_text()))
    assert rust_total == rust['total']
    backend = load('backend-results.json')
    retained = []
    for name in sorted(OUT.rglob('*.log')):
        if any(token in name.name for token in ['initial', 'second', 'third', 'fourth', 'fifth', 'sixth', 'before-label', 'confirmed']):
            retained.append({'path': str(name.relative_to(OUT)), 'sha256': sha(name)})
    for directory in ['browser-initial', 'browser-second', 'browser-third', 'browser-fourth', 'browser-fifth', 'browser-sixth', 'browser-final']:
        name = f'{directory}/browser.json'
        if (OUT / name).exists():
            value = load(name)
            retained.append({**receipt(name), 'ok': value.get('ok', False), 'status': value.get('status'), 'completedFlows': len(value['steps']), 'failure': value.get('failure')})
    report = {'format': 'viento-scene3d-primitives-results', 'schemaVersion': 1, 'ok': True,
              'createdAt': datetime.now(timezone.utc).isoformat(), 'head': baseline['head'], 'version': baseline['version'],
              'scope': 'First independent 3D primitive source/readonly-preview/export slice in unpublished worktree. Version, commit and installed applications unchanged.',
              'behavior': ['Strict independent 128KiB JSON box scene with stable UUIDs, exact source ranges, camera/light bounds and optional native ABI.',
                           'Portable deep-frozen model and independent scene3d plan; author raw degrees/colors and source bytes preserved.',
                           'Read-only source/path/byte ownership, GPU orbit/reset, responsive authored viewport, invalid-source recovery and close/disposal.',
                           'Chinese/English/Japanese layout and ordinary source Save/reopen; no implicit Save or World/build write authority.',
                           'Inspectable Godot source plus original author bytes and SHA/size inventory; exclusive new output, branded private receipt and finite real probe.',
                           'Eighth independent module and 24 declared capabilities; old 2D/backend/core operations retained.'],
              'sources': {'files': len(frozen), 'manifestSha256': manifest, 'deltaFiles': len(delta), 'newFiles': sum(value['before'] is None for value in delta.values()),
                          'modifiedFiles': sum(value['before'] is not None for value in delta.values()), 'beforeLabelManifest': receipt('source-hashes-before-label.json')},
              'verification': {
                  'application': {**app, 'syntaxFiles': int(syntax[0]), 'versionAndApiPreflightPassed': True, 'lastLabelTiming': review['finalLabelCorrection']['scope']},
                  'sharedCore': {'total': rust_total, 'newRustUnitTests': rust['newUnitTests'], 'unit': rust['unit'], 'integration': sum(rust['integration']),
                                 'fmt': core['verification']['fmt'], 'clippy': core['verification']['clippy'], 'wasm': core['verification']['wasm'], 'report': receipt('core-results.json')},
                  'newJavaScript': {'total': 99, 'pureAndBridge': core['verification']['newJavaScript']['total'], 'uiMathPorts': web['tests']['newTotal'],
                                    'export': backend['verification']['tests']['passed'], 'moduleSchemaBoundary': 4, 'scope': 'Counts overlap with full application; never added to it.'},
                  'regressions': {'core': stats('core-regression-final.log'), 'assembly': stats('registry-assembly-final.log'), 'projectProfile': stats('project-profile-final.log'), 'ui': stats(web['tests']['log'])},
                  'finalLabelCorrection': {**review['finalLabelCorrection'], 'oldProof': receipt('web-validation-pre-label.json')},
                  'browser': {'report': browser_name, 'sha256': sha(OUT / browser_name), 'stepsPassed': len(browser['steps']), 'errors': len(browser['errors']),
                              'sourceStableDuringProof': browser['sourceStableDuringProof'], 'gpu': browser['gpu'], 'resize': browser['resize'], 'installedOrPhysicalGpuAcceptance': False},
                  'godot': {**receipt('godot-final.json'), 'cases': backend['verification']['actualGodotProof']['cases'], 'euler': godot['euler'], 'scope': 'Two actual finite headless scenes, each with three objects and four successful phases; no GPU pixel parity or 2D runtime protocol claim.'},
                  'prepared': {'ok': prepared['ok'], 'totalCases': total, 'casesEach': {key: len(copies[0][key]) for key in kinds},
                               'moduleCounts': {name: prepared['portable'][name]['moduleCount'] for name in ['desktop', 'mobile']},
                               'artifacts': {name: value['manifestFileCount'] for name, value in prepared['artifacts'].items()}, 'report': receipt('packaged-resources.json'), 'log': 'prepared-check-label-final.log'},
                  'currentDocumentationReview': receipt('document-review.json'), 'independentReview': receipt('review.json')},
              'preservation': {'oldAuthorFilesUnchanged': baseline['authorFiles'], 'newAuthorExampleFiles': 2, 'historicalEvidenceFilesUnchanged': baseline['historicalFiles'],
                               'externalToolFilesUnchanged': 4, 'initialAudit': receipt('preservation-audit-before-cleanup.json'), 'noDataDeletion': True},
              'cleanup': {'receipt': receipt('cleanup.json'), 'generatedPaths': [item['path'] for item in cleanup['removed']], 'allocatedFileBytesRemoved': cleanup['allocatedFileBytesRemoved'],
                          'scope': 'Only five generated directories absent at baseline, after all final proofs and no owned executable activity. Sources, tested WASM, examples, histories, external tools and preferences retained.'},
              'retainedAttempts': retained, 'attemptExplanations': {'core': core.get('retainedAttempts', []), 'web': web.get('retainedAttempts', []), 'backend': backend.get('retainedAttempts', [])},
              'limitations': review['limitations'], 'next': ['Independent model asset references and hierarchy contracts', '3D author transform transactions and OC projections', 'Bevy/NS-Nova adapters behind the independent representation and capability boundaries']}
    assert report['verification']['newJavaScript']['total'] == sum(report['verification']['newJavaScript'][key] for key in ['pureAndBridge', 'uiMathPorts', 'export', 'moduleSchemaBoundary'])
    store('results.json', report)
    print(json.dumps({'ok': True, 'app': app['tests'], 'rust': rust_total, 'browser': len(browser['steps']), 'prepared': total}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['review', 'results'])
    args = parser.parse_args()
    review() if args.phase == 'review' else results()
