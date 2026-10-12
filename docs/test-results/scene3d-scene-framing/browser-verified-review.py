import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image


root = Path('/tmp/viento-scene3d-framing-xmbbbvr9/project')
out = root / 'docs/test-results/scene3d-scene-framing'
browser = out / 'browser-verified'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


report_path = browser / 'browser.json'
report_sha = sha(report_path)
report = json.loads(report_path.read_text())
assert report['ok'] is True and report['status'] == 'passed'
assert report['errors'] == []
assert len(report['steps']) == 7
assert len(report['screenshots']) == 5
assert len(report['system']['initializedModules']) == 17
assert len(report['system']['plan']['capabilities']) == 33
assert report['sourceStableDuringProof'] is True
assert report['sources'] == report['sourcesFinal']
assert '--use-gl=angle' in report['chromeArguments']
assert '--use-angle=swiftshader' in report['chromeArguments']

source_matches = {name: sha(root / name) == digest
                  for name, digest in report['sources'].items()}
assert all(source_matches.values())
assert len(report['servedSources']) == 11
assert all(report['sources'][name] == digest
           for name, digest in report['servedSources'].items())
source_before = json.loads((out / 'source-before.json').read_text())
assert source_before['web/scene3d.css'] == sha(root / 'web/scene3d.css')

notes = {
    'framing-desktop.png': 'Three dispersed boxes and the selected outline are visible, with exact instance declarations and all five footer actions. This deliberately scrolled screenshot shows the viewport and footer; the header is above its visible area.',
    'framing-zh-CN-390.png': 'Chinese heading, framing status and five wrapped actions are readable. Three boxes are visible in the tall viewport. The upper canvas is now uniform background without the earlier white rectangle/editor remnants.',
    'framing-en-390.png': 'English heading, status and five wrapped actions are readable without horizontal clipping. Three boxes are visible. No white rectangle or editor remnants are visible inside the canvas.',
    'framing-ja-390.png': 'Japanese heading, status and five wrapped actions are readable. Three boxes are visible. The upper canvas has no earlier underlying editor text or blurred white rectangle.',
    'framing-no-webgl.png': 'The empty viewport and explicit unavailable-WebGL fallback are visible alongside three source declarations. Reset and framing actions appear disabled, while refresh and source location remain available.',
}
viewed = []
for name in report['screenshots']:
    image_path = browser / name
    with Image.open(image_path) as image:
        size = list(image.size)
    viewed.append({'file': str(image_path.relative_to(root)),
                   'sha256': sha(image_path), 'dimensions': size,
                   'personallyViewed': True, 'observation': notes[name]})

pixel_checks = []
for probe in report['compositingProbes']:
    image_path = browser / probe['file']
    mismatches = []
    with Image.open(image_path) as image:
        rgba = image.convert('RGBA')
        for sample in probe['samples']:
            actual = list(rgba.getpixel((sample['x'], sample['y'])))
            if any(abs(a - b) > 3 for a, b in zip(actual, sample['rgba'])):
                mismatches.append({'x': sample['x'], 'y': sample['y'],
                                   'expected': sample['rgba'], 'actual': actual})
    recorded = next(item for item in report['compositingChecks']
                    if item['file'] == probe['file'])
    assert recorded['samples'] == len(probe['samples'])
    assert recorded['mismatches'] == 0
    assert probe['error'] == 0 and mismatches == []
    pixel_checks.append({'file': probe['file'], 'sha256': sha(image_path),
                         'samples': len(probe['samples']), 'tolerance': 3,
                         'mismatches': len(mismatches),
                         'independentDecoder': 'Pillow'})
assert sum(item['samples'] for item in pixel_checks) == 754

prior = ['browser-initial-interruption.json', 'browser-review.json',
         'browser-final/browser.json', 'browser-visual/browser.json',
         'compositing-check.json', 'browser-angle/browser.json',
         'compositing-angle.json']
preserved = [{'file': str((out / name).relative_to(root)),
              'sha256': sha(out / name)} for name in prior]
first_review = json.loads((out / 'browser-review.json').read_text())
default_check = json.loads((out / 'compositing-check.json').read_text())
assert first_review['ok'] is False and default_check['ok'] is False
assert sha(report_path) == report_sha

result = {
    'format': 'viento-scene3d-framing-browser-independent-review',
    'schemaVersion': 1,
    'observedAt': datetime.now(timezone.utc).isoformat(),
    'ok': True,
    'status': 'passed-in-explicit-angle-software-environment',
    'report': {'file': str(report_path.relative_to(root)),
               'sha256': report_sha, 'ok': report['ok'],
               'status': report['status'], 'steps': report['steps'],
               'errors': report['errors'], 'geometryChecks': report['geometryChecks'],
               'initializedModules': 17, 'capabilities': 33,
               'browser': report['browser'], 'node': report['node'],
               'chromeArguments': report['chromeArguments']},
    'blockingFindingsInReviewedEnvironment': [],
    'personallyViewedScreenshots': viewed,
    'independentCompositingChecks': pixel_checks,
    'sourceStable': {'reportedDuringProof': report['sourceStableDuringProof'],
                     'independentlyMatchedCurrentReportSources': source_matches,
                     'matchedSourceCount': len(source_matches),
                     'httpServedSourceCount': len(report['servedSources']),
                     'httpServedSourcesEqualFrozenDisk': True,
                     'scene3dCssEqualsRoundStartingBytes': True},
    'inputMethod': 'The smoke enters the editor and preview and invokes framing, selection, close and reopen with real CDP Input.dispatchMouseEvent events. Source text, language, scrolling and no-WebGL injection are controlled fixture setup; they are not asserted as mouse-only user workflows.',
    'svgRequests': {'tracked': False, 'count': None},
    'cspViolations': {'tracked': False, 'count': None},
    'gpu': report['gpu'],
    'preservedEarlierEvidence': preserved,
    'defaultFallbackLimitation': {
        'status': 'recorded-failure-still-valid',
        'checks': [{'file': item['file'], 'samples': item['samples'],
                    'mismatches': item['mismatches']}
                   for item in default_check['checks']],
        'conclusion': 'Under the recorded default headless fallback, real readPixels and narrow final composed screenshots diverged. The unchanged product passed the explicit ANGLE flags in the verified run. The renderer string is identical, so the exact compositor/backend cause remains unproven. This is a test-environment limitation, not a claim of a universal product rendering fix.',
    },
    'limitations': [
        'Only the five browser-verified PNG files listed here were personally viewed in this final review. Earlier rejected screenshots and reports remain separate and unchanged.',
        'The 754 probes sample visible canvas interior, excluding rounded borders and the sticky footer. They do not establish equality of every screenshot pixel or any hidden viewport area.',
        'The browser fixture contains three boxes; the numerical independent review covers the wider scene boundaries separately. Framing an entire wide scene does not promise pixel visibility of each distant tiny object.',
        'The unsupported-WebGL phase is an injected getContext(webgl2)=null control; this is not proof on a physical unsupported device.',
        'No installed desktop, Android, hardware GPU, native build or complete application suite was run by this review. The 3811 application tests and 307 Rust tests from the earlier round are not claimed for this round.',
        'This producer only reads reports, source bytes and PNGs and writes this new review JSON in the stage OUT; it does not alter products, old evidence, author files or the actual repository.',
    ],
}
(out / 'browser-verified-review.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'ok': result['ok'], 'personallyViewed': len(viewed),
                  'independentPixels': sum(item['samples'] for item in pixel_checks),
                  'pixelMismatches': sum(item['mismatches'] for item in pixel_checks),
                  'sourceMatches': len(source_matches),
                  'reportSha256': report_sha}, ensure_ascii=False))
