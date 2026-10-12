#!/usr/bin/env python3
"""Record the independent visual rejection without replacing browser evidence."""
import hashlib
import json
import struct
from datetime import datetime, timezone
from pathlib import Path

out = Path(__file__).resolve().parent
root = out.parents[2]
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
report_path = out / 'browser-final/browser.json'
r = json.loads(report_path.read_text())
assert r['ok'] is True and r['status'] == 'passed'
assert len(r['steps']) == 7 and len(r['screenshots']) == 5 and r['errors'] == []
assert r['sourceStableDuringProof'] is True and r['sources'] == r['sourcesFinal']
current_source_mismatches = [{'path': path, 'reportSha256': digest, 'currentSha256': sha(root / path)}
                             for path, digest in r['sources'].items() if sha(root / path) != digest]
assert len(r['system']['initializedModules']) == 17 and len(r['system']['plan']['capabilities']) == 33
assert len(r['geometryChecks']) == 9 and all(x['corners'] == 24 for x in r['geometryChecks'])
assert 'SwiftShader' in r['gpu']['renderer'] and r['gpu']['error'] == 0
contaminated = {'framing-zh-CN-390.png', 'framing-en-390.png', 'framing-ja-390.png'}
observations = {
 'framing-desktop.png': 'The three dispersed boxes and selected outline fit the drawn desktop canvas. Object UUID declarations and all five footer actions are visible.',
 'framing-zh-CN-390.png': 'Chinese controls and all five footer actions fit the viewport, but the canvas upper area contains an unexpected bright blurred rectangle and editor remnants; this is not accepted as a normal opaque scene image.',
 'framing-en-390.png': 'English heading and footer actions wrap legibly, but the canvas contains a bright blurred region and underlying editor remnants above the rendered boxes.',
 'framing-ja-390.png': 'Japanese actions remain visible in wrapped rows. The canvas upper region is severely contaminated by a large white blurred rectangle and visible editor button remnants.',
 'framing-no-webgl.png': 'The blank viewport and explicit WebGL2 fallback accompany readable native object declarations; unavailable drawing controls, including full-scene framing, are disabled.'
}
images = []
for name in r['screenshots']:
    path = report_path.parent / name
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    width, height = struct.unpack('>II', data[16:24])
    images.append({'path': str(path.relative_to(root)), 'sha256': sha(path), 'width': width, 'height': height,
                   'personallyViewed': True, 'visualAccepted': name not in contaminated, 'observation': observations[name]})
value = {'format': 'viento-scene3d-full-scene-independent-browser-review', 'schemaVersion': 1,
 'observedAt': datetime.now(timezone.utc).isoformat(), 'ok': False, 'status': 'visual-review-rejected',
 'report': {'path': str(report_path.relative_to(root)), 'sha256': sha(report_path), 'assertionStatus': 'passed',
            'steps': r['steps'], 'stepCount': 7, 'errors': [], 'sourceStableDuringThatProof': True, 'sourceFilesInThatProof': len(r['sources']),
            'moduleCount': 17, 'capabilityCount': 33, 'geometryChecks': r['geometryChecks']},
 'blockingFindings': [{'scope': 'composited narrow-screen scene image', 'affectedScreenshots': sorted(contaminated),
   'finding': 'All three 390px language images show unexpected white/blurred/editor content within the opaque WebGL canvas. Matrix containment and desktop readPixels success do not establish that the narrow final composed image is correct.',
   'cause': 'Undetermined; browser/software compositor, scroll timing or product layout must be isolated before acceptance.',
   'disposition': 'Root informed and confirmed the Japanese image; keep current evidence immutable and collect follow-up in a new directory.'}],
 'personallyViewedScreenshots': images,
 'currentSourceMismatches': current_source_mismatches,
 'currentSourceScope': 'Root is independently investigating the rejected screenshots with new harness/CSS experiments. This review binds the immutable original report and images; it does not pretend their old source SHA values bind the advancing investigation.',
 'smokeRepairReview': {'semanticsPreserved': True,
   'initialProducer': 'docs/test-results/scene3d-scene-framing/browser-initial-source.mjs',
   'initialProducerSha256': sha(out / 'browser-initial-source.mjs'),
   'currentProducerSha256': sha(root / 'scripts/tests/scene3d-framing-smoke.mjs'),
   'changes': ['Bound each CDP request by 10 seconds and handle actual browser dialogs.',
     'After all unsaved-draft and reopen assertions complete, reset only the disposable editor fixture to its original text; assert dirty=false and original saved bytes before the fresh no-WebGL page navigation.'],
   'assertionsWeakened': False, 'productChangesInThisRepair': False,
   'initialInterruption': {'path': 'docs/test-results/scene3d-scene-framing/browser-initial-interruption.json',
                           'sha256': sha(out / 'browser-initial-interruption.json'), 'status': 'interrupted-test-harness'}},
 'inputMethod': 'Actual Input.dispatchMouseEvent button entry and pointer orbit. DOM changes are explicit test setup for source text, language, scrolling and renderer instrumentation.',
 'svgRequests': {'tracked': False, 'count': None}, 'cspViolations': {'tracked': False, 'count': None},
 'gpu': {'softwareImplementation': 'SwiftShader', 'hardwareAcceptance': False, 'observedDesktopReadPixels': r['gpu']},
 'limitations': ['This round does not claim a fresh full 3811 application suite or 307 Rust tests.',
  'Recorded real uploaded matrices prove corner clipping checks; they do not substitute for composited screenshot review.',
  'Framing all geometry does not promise a distant tiny object has a visible pixel.',
  'No installed desktop, Android, hardware GPU, new HTTP/test execution or actual-checkout write by this reviewer.']}
with (out / 'browser-review.json').open('x') as stream:
    json.dump(value, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
print(json.dumps({'ok': False, 'personallyViewedImages': 5, 'rejectedNarrowImages': len(contaminated), 'rootNotified': True}))
