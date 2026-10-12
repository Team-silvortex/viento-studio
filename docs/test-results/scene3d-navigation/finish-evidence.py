#!/usr/bin/env python3
"""Bind completed, real checks to this slice; never edit prior reports."""
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
    return json.loads((OUT / name).read_text())


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def suite(name, passed=True):
    text = (OUT / name).read_text()
    rows = re.findall(r'^\s*ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$', text, re.M)
    assert len(rows) == 6, name
    counts = {k: int(v) for k, v in rows}
    assert all(counts[k] == 0 for k in ['cancelled', 'skipped', 'todo'])
    if passed:
        assert counts['tests'] == counts['pass'] and counts['fail'] == 0
    return {'log': name, 'sha256': sha(OUT / name), 'counts': counts,
            'durationMs': float(re.search(r'^\s*ℹ duration_ms ([\d.]+)', text, re.M)[1]),
            'javascriptSyntaxFiles': int(re.search(r'语法检查通过：(\d+) 个 JavaScript 文件', text)[1])}


def write_new(name, value):
    with (OUT / name).open('x') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=['timing', 'results'])
    args = parser.parse_args()
    final = suite('app-check-verified.log')
    first = suite('app-check.log', passed=False)
    assert final['counts']['tests'] == 3381 and first['counts']['tests'] == 3380
    assert first['counts']['pass'] == 3379 and first['counts']['fail'] == 1
    assert 'en: duplicate message 清空搜索' in (OUT / first['log']).read_text()
    frozen = load('source-hashes-verified.json')
    assert len(frozen) == 723 and all(sha(ROOT / p) == digest for p, digest in frozen.items())
    manifest_sha = sha(OUT / 'source-hashes-verified.json')
    now = datetime.now(timezone.utc).isoformat()
    if args.stage == 'timing':
        write_new('application-timing.json', {
            'format': 'viento-scene3d-navigation-application-timing', 'schemaVersion': 1,
            'recordedAt': now, 'ok': True,
            'firstApplication': {**first, 'started': load('application-start.json'),
                'scope': 'Actual edition after source-input notification and browser fixture repair; one newly duplicated English translation key failed. Original log and source manifest retained.'},
            'repair': {'files': load('source-freeze-verified.json')['changedSinceInputRepair'],
                'reason': 'Remove only the newly repeated English search-clear key; make Reset restore translated author-camera status, with one new independent UI regression and browser assertion. Existing catalogue coverage is unchanged.'},
            'finalApplication': {**final, 'started': load('application-start-verified.json'),
                'completedBeforeRecordedAt': True, 'productSourcesUnchangedThroughout': True},
            'sourceManifestSha256': manifest_sha,
            'nativeRuntime': 'Pinned Node v24.20.0, current native archive/mobile/core helpers and trusted Godot/Bevy tools.',
            'harnessFailures': ['First new browser fixture called an already computed array; preserved and repaired separately.',
                'Prepared harness initially redeclared box, then referenced a missing copied baseline filename; preserved producers/logs and repaired only new evidence.'],
            'browserDetectedProductRepairs': ['Exact native CRLF/CR ranges now map only into complete LF-normalized textarea display without changing author bytes.',
                'Normal source input broadcasts after actual dirty/epoch update through the composition root, so stale source-location controls immediately expire.',
                'Reset restores both temporary camera and localized status instead of retaining a misleading focused-view message.'],
            'scope': 'Completed application counts overlap all focused suites. Browser, native, copied VM and source phases are recorded separately; no install/device/GPU-hardware claim.'})
        print(json.dumps({'ok': True, 'tests': final['counts']['tests'], 'priorFailed': first['counts']['fail']}))
        return
    review, preservation = load('review.json'), load('preservation-audit-before-cleanup.json')
    prepared, web, cleanup = load('packaged-resources-verified.json'), load('web-validation.json'), load('cleanup.json')
    assert review['ok'] and not review['openFindings'] and preservation['ok'] and not preservation['openFindings']
    assert prepared['ok'] and cleanup['ok']
    assert cleanup['sourceManifestSha256'] == manifest_sha
    assert review['finalSourceFreeze']['manifestSha256'] == manifest_sha
    native_text = (OUT / 'rust-tests.log').read_text()
    native_counts = [int(n) for n in re.findall(r'test result: ok\. (\d+) passed', native_text)]
    assert sum(native_counts) == 234 and all('0 failed' in line for line in native_text.splitlines() if 'test result:' in line)
    baseline = load('baseline.json')
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip() == baseline['head']
    assert (ROOT / 'VERSION').read_text().strip() == '0.0.10'
    write_new('results.json', {
        'format': 'viento-scene3d-navigation-results', 'schemaVersion': 1, 'createdAt': now,
        'status': 'passed', 'ok': True, 'version': '0.0.10', 'publishedBase': baseline['head'],
        'delivery': 'Unpublished worktree after 0.0.10; existing authoring work preserved; no new commit, push or installation.',
        'features': ['Literal case-insensitive 3D object name/UUID search with stable selection, count, clear and hidden-selection explanation.',
            'Temporary framing of all rotated box corners using actual GPU canvas aspect and separate clipping; Reset restores the author camera and status.',
            'Jump from a stable instance UUID to its declaration in the current complete source through native parsing and guarded selection/scroll/once-only focus.'],
        'sourceFreeze': {'manifest': 'source-hashes-verified.json', 'sha256': manifest_sha, 'files': 723, 'allMatch': True},
        'application': final, 'newApplicationTests': 51,
        'rust': {'log': 'rust-tests.log', 'sha256': sha(OUT / 'rust-tests.log'), 'passed': 234,
                 'unit': 185, 'integration': 49, 'failed': 0, 'schemaAndWasmUnchanged': True},
        'focused': {'renderer': load('renderer-results.json')['verification']['finalPinned'],
                    'ui': web['ui'], 'independentSourceQuality': load('quality-confirmed.json'),
                    'sourceInputBroadcast': load('source-input-broadcast.json'),
                    'countsOverlapApplication': True},
        'browser': web['browser'],
        'browserChronology': {'report': 'web-validation.json', 'sha256': sha(OUT / 'web-validation.json'),
             'note': 'Final navigation 8 and readonly 7 run on the verified edition. Earlier authoring regression 32 runs retain their actual before-Reset-status source binding; unchanged author controllers/native/host are checked separately.'},
        'prepared': {'report': 'packaged-resources-verified.json', 'sha256': sha(OUT / 'packaged-resources-verified.json'),
            'groups': 272, 'groupsPerSide': 136, 'modulesPerSide': 101,
            'files': {k: v['manifestFileCount'] for k, v in prepared['artifacts'].items()},
            'scope': 'Actual exact copied bytes and pure VM portability, without Node/DOM/fetch host globals; not device or installation acceptance.'},
        'independentReview': {'report': 'review.json', 'sha256': sha(OUT / 'review.json'), 'openFindings': []},
        'preservation': {'report': 'preservation-audit-before-cleanup.json', 'sha256': sha(OUT / 'preservation-audit-before-cleanup.json'),
            'historicalFiles': 4143, 'authorFiles': 41, 'externalTools': 4,
            'sourceAndAuthorBytesExact': True, 'externalToolShaSizeDevInoNlinkExact': True},
        'cleanup': {'report': 'cleanup.json', 'sha256': sha(OUT / 'cleanup.json'),
            'allocatedFileBytesRemoved': cleanup['allocatedFileBytesRemoved'], 'exactGeneratedDirectories': 5,
            'retained': cleanup['retained']},
        'functionAtlas': {'newFunction': 'scene.navigation3d', 'newImplementations': ['i203', 'i204', 'i205', 'i206'],
            'closingProof': 'atlas-preservation-review.json', 'sourceSnapshotGenerationFollowsThisReport': True,
            'fixedModules': 12, 'declaredCapabilities': 28},
        'chronology': {'report': 'application-timing.json', 'sha256': sha(OUT / 'application-timing.json'),
            'priorFailureAndAllEarlierEvidenceRetained': True},
        'boundaries': ['Native Rust is still the source parser. No new author schema, textures/models, spatial hierarchy, behavior/runtime bindings, ray picking or gizmo.',
            'Display index, temporary camera, GUI and source owner are separate; readonly preview receives no author proposal, source writer, Save or backend control.',
            'Source navigation preserves raw content, saved baseline, dirty state and cache; serialized/getter/late receipts do not acquire navigation authority.',
            'BOM/CRLF/CR/nonBMP tests preserve native raw UTF16 ranges while deriving only the matching textarea LF display selection.',
            'Actual browser uses explicitly recorded SwiftShader software WebGL. No new installed app, Android device or hardware GPU test.']})
    print(json.dumps({'ok': True, 'tests': final['counts']['tests'], 'native': sum(native_counts),
                      'allocatedFileBytesRemoved': cleanup['allocatedFileBytesRemoved']}))


if __name__ == '__main__':
    main()
