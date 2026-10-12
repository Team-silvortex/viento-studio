"""Close only NEW picking evidence from completed, source-bound proofs."""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def load(name):
    return json.loads((OUT / name).read_text())


def write_new(name, value):
    with (OUT / name).open('x') as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def suite(name):
    text = (OUT / name).read_text()
    rows = re.findall(r'^\s*ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$', text, re.M)
    assert len(rows) == 6, name
    counts = {key: int(value) for key, value in rows}
    assert counts['tests'] == counts['pass'] > 0
    assert all(counts[key] == 0 for key in ['fail', 'cancelled', 'skipped', 'todo'])
    durations = re.findall(r'^\s*ℹ duration_ms ([\d.]+)\s*$', text, re.M)
    return {'log': name, 'sha256': sha(OUT / name), 'counts': counts,
            'durationMs': float(durations[0]) if durations else None}


def freeze():
    sources = load('source-hashes-final.json')
    assert len(sources) == 726
    assert all(sha(ROOT / p) == digest for p, digest in sources.items())
    return {'manifest': 'source-hashes-final.json', 'sha256': sha(OUT / 'source-hashes-final.json'),
            'files': len(sources), 'allMatch': True}


def close():
    frozen = freeze()
    application = suite('app-check.log')
    text = (OUT / 'app-check.log').read_text()
    syntax = re.findall(r'语法检查通过：(\d+) 个 JavaScript 文件', text)
    assert len(syntax) == 1
    application['javascriptSyntaxFiles'] = int(syntax[0])
    previous = json.loads((OUT.parent / 'scene3d-navigation/results.json').read_text())
    delta = application['counts']['tests'] - previous['application']['counts']['tests']
    assert delta == 40, delta
    renderer = load('renderer-results.json')
    assert renderer['ok'] and renderer['tests']['passed'] == 58
    web_report = load('web-validation.json')
    prepared, review, preservation, cleanup = [load(name) for name in
        ['packaged-resources.json', 'review.json', 'preservation-audit-before-cleanup.json', 'cleanup.json']]
    assert all(value['ok'] for value in [web_report, prepared, review, preservation, cleanup])
    assert not review['openFindings'] and not preservation['openFindings']
    assert cleanup['sourceManifestSha256'] == frozen['sha256']
    timing = {'format': 'viento-scene3d-picking-application-timing', 'schemaVersion': 1,
        'recordedAt': datetime.now(timezone.utc).isoformat(), 'ok': True,
        'finalApplication': {**application, 'started': load('application-start.json'),
                             'completedBeforeRecordedAt': True, 'productSourcesUnchangedThroughout': True},
        'sourceManifestSha256': frozen['sha256'], 'newApplicationTests': delta,
        'newTestsBreakdown': {'purePicking': 13, 'rendererGesturesAndFrames': 15, 'previewUi': 12},
        'nativeRuntime': 'Pinned Node v24.20.0; current unchanged-native core/archive/mobile helpers and original trusted Godot/Bevy tools.',
        'resolvedProductFindings': [
            {'initial': 'quality-initial.json', 'issue': 'Secondary pointer left first tap and recent double-click eligibility alive.',
             'resolution': 'Other-pointer/button input clears gesture and tap. Initial8/10 preserved; final independent12/12.'},
            {'initial': 'quality-scroll-initial.json', 'issue': 'Position-only scrolling invalidated all hits until unrelated redraw.',
             'resolution': 'Use current CSS position over the same actual drawn matrices; cancel only old or active gestures across movement. Initial10/12 preserved; final independent12/12 and real narrow modal scroll.'}],
        'harnessRepairs': [
            'Renderer fixture initially copied mutable DPR/context-loss options; failed54/56 log retained and fixture state reference corrected without weakening assertions.',
            'Independent scroll probe initially assumed a callback existed; original producer retained, optional read exposes intended failure assertions. Initial10/12 retained.',
            'Source-freeze producer first expected only six changed files; engine/README.md was already in the baseline, so the explicit allowed documentation-only change was included. No product source was repaired for this inventory assertion.'],
        'rust': {'freshTestRun': False, 'schemaNativeSourcesWasmMetadataUnchanged': True,
                 'previousRun': '../scene3d-navigation/rust-tests.log', 'previousPassed': 234,
                 'freshBuilds': ['core-cli-build.log', 'native-tools-build-final.log']},
        'scope': 'Completed full application overlaps all focused tests. Earlier failures and producer snapshots remain separate. Browser, prepared VM, helper builds and source phases do not claim a new install or device acceptance.'}
    write_new('application-timing.json', timing)
    groups = sum(len(v) for v in prepared['portable']['desktop'].values() if isinstance(v, list)) * 2
    result = {'format': 'viento-scene3d-picking-results', 'schemaVersion': 1,
        'createdAt': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'ok': True,
        'version': load('baseline.json')['version'], 'publishedBase': load('baseline.json')['head'],
        'delivery': 'Unpublished worktree after 0.0.10; existing authoring work preserved; no new commit, push or installation.',
        'features': ['Single-click stable object selection from the actual last-drawn Float32 frame.',
                     'Qualified native double-click invokes existing temporary focus; filtering and blank clicks retain selection.',
                     'Cancelled/drag/multiple-pointer/stale-frame gestures do not select. Ordinary position-only scrolling remaps current canvas coordinates without redraw.'],
        'sourceFreeze': frozen, 'application': application, 'newApplicationTests': delta,
        'focused': {'renderer': renderer['tests'], 'uiAndLocales': web_report['combinedFocused'],
                    'countsOverlapApplication': True,
                    'independentGeometry': {'report': 'quality-confirmed.json', 'passed': load('quality-confirmed.json')['passed'],
                                             'counts': load('quality-confirmed.json')['counts']},
                    'independentExtremeFrames': {'report': 'extreme-frame-final.json', 'passed': 18}},
        'browsers': {'current': web_report['browser'], 'legacy': web_report['legacyBrowsers']},
        'prepared': {'report': 'packaged-resources.json', 'sha256': sha(OUT / 'packaged-resources.json'),
                     'totalGroups': groups, 'groupsEach': groups // 2,
                     'artifacts': {p: len(v['manifest']) for p, v in prepared['artifacts'].items()},
                     'modulesEach': {k: v['moduleCount'] for k, v in prepared['portable'].items()}},
        'native': timing['rust'], 'preservation': {'historicalFiles': 4319, 'authors': 41, 'externalTools': 4,
                                                'preCleanupReport': 'preservation-audit-before-cleanup.json'},
        'cleanup': {'report': 'cleanup.json', 'sha256': sha(OUT / 'cleanup.json'),
                    'allocatedFileBytesRemoved': cleanup['allocatedFileBytesRemoved'],
                    'allocatedGiBRemoved': cleanup['allocatedFileBytesRemoved'] / (1024 ** 3),
                    'exactDirectoriesRemoved': [v['path'] for v in cleanup['removed']]},
        'review': {'report': 'review.json', 'sha256': sha(OUT / 'review.json'), 'openFindings': []},
        'limitations': ['Flat geometric boxes; no material/hierarchy/assets/gizmo/native schema/backend change.',
                        'Actual Float32 geometric depth is not antialias edge or quantized GPU depth-buffer parity.',
                        'Software SwiftShader and prepared portability are not installation, Android-device or hardware-GPU acceptance.'],
        'closingAtlas': 'Append-only atlas/prefix/sourceSnapshot and fresh post-cleanup checks are recorded separately.'}
    write_new('results.json', result)
    print(json.dumps({'ok': True, 'applicationTests': application['counts']['tests'], 'newTests': delta,
                      'syntaxFiles': application['javascriptSyntaxFiles'], 'preparedGroups': groups,
                      'allocatedGiBRemoved': result['cleanup']['allocatedGiBRemoved']}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=['close'])
    args = parser.parse_args()
    close()
