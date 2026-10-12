#!/usr/bin/env python3
"""Bind personally inspected final screenshots to the actual browser report."""
import hashlib
import json
import struct
from datetime import datetime, timezone
from pathlib import Path

out = Path(__file__).resolve().parent
root = out.parents[2]
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
report_path = out / 'browser-removal-layout/browser.json'
initial_path = out / 'browser-removal/browser.json'
r = json.loads(report_path.read_text())
assert r['ok'] is True and r['status'] == 'passed'
assert len(r['steps']) == 8 and len(r['screenshots']) == 6
assert r['errors'] == r['svgRequests'] == r['cspViolations'] == []
assert r['sourceStableDuringProof'] is True and r['sources'] == r['sourcesFinal']
assert all(sha(root / path) == expected for path, expected in r['sources'].items())
assert len(r['system']['initializedModules']) == len(r['system']['plan']['modules']) == 17
assert len(r['system']['plan']['capabilities']) == 33
assert 'SwiftShader' in r['gpu']['renderer'] and r['gpu']['error'] == r['afterRemovalGpu']['error'] == 0
observations = {
 'removal-desktop-review.png': 'Desktop removed and surviving declarations are separate readable columns; counts, raw UUIDs and the three sticky actions are visible. The previously observed whole-page horizontal scrollbar is absent.',
 'removal-zh-CN-390.png': 'Chinese title, return control, selection hidden outside the filter, literal multiline author name and all three sticky actions fit the narrow viewport.',
 'removal-en-390.png': 'English text and title wrap legibly. The actions wrap into two rows without clipping or horizontal spill; authored CJK text remains literal author content.',
 'removal-ja-390.png': 'Japanese title, return control and explanatory text wrap in the narrow dialog; all three actions remain visible. Literal author text is retained.',
 'removal-save-conflict.png': 'The existing save-conflict dialog clearly separates load latest, retain draft, force overwrite and cancel. The page horizontal scrollbar from the initial screenshots is absent.',
 'removal-without-webgl.png': 'The native author interface still shows a complete 3-to-2 review with separate removed and surviving declarations and visible actions. The page horizontal scrollbar is absent. Renderer unavailability is established by the actual report, rather than inferred from this image.'
}
images = []
for name in r['screenshots']:
    p = report_path.parent / name
    data = p.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    width, height = struct.unpack('>II', data[16:24])
    images.append({'path': str(p.relative_to(root)), 'sha256': sha(p), 'width': width, 'height': height,
                   'personallyViewed': True, 'blockingFinding': False, 'observation': observations[name]})
layouts = []
assert len(r['toolbarLayouts']) == 9
for layout in r['toolbarLayouts']:
    identity = layout['identity']
    assert layout['documentWidth'] == layout['width']
    assert identity['left'] >= 0 and identity['right'] <= layout['width']
    assert len(layout['buttons']) == 17
    assert all(b['left'] >= 0 and b['right'] <= layout['width'] and b['top'] >= 0 for b in layout['buttons'])
    layouts.append({'language': layout['language'], 'width': layout['width'], 'documentWidth': layout['documentWidth'],
                    'identityInBounds': True, 'visibleButtonsInBounds': 17})
assert set((x['language'], x['width']) for x in layouts) == {(lang, width) for lang in ['zh-CN', 'en', 'ja'] for width in [1440, 1024, 390]}
assert [x['columns'] for x in r['columnChecks']] == [2, 1, 1, 1]
languages = []
for value in r['narrowFooterChecks']:
    assert 0 <= value['top'] < value['bottom'] <= 844
    languages.append({'language': value['language'], 'width': 390, 'columns': 1,
                       'applyTop': value['top'], 'applyBottom': value['bottom'], 'viewportHeight': 844, 'visible': True})
value = {'format': 'viento-scene3d-removal-independent-web-review', 'schemaVersion': 1,
 'observedAt': datetime.now(timezone.utc).isoformat(), 'ok': True, 'blockingFindings': [],
 'report': {'path': str(report_path.relative_to(root)), 'sha256': sha(report_path), 'steps': [x['name'] for x in r['steps']],
            'stepCount': 8, 'errors': r['errors'], 'sourceStable': True, 'verifiedSourceFiles': len(r['sources']),
            'moduleCount': 17, 'capabilityCount': 33},
 'svgRequests': {'trackedBy': 'actual Network.requestWillBeSent events with .svg URL matching', 'count': 0},
 'cspViolations': {'trackedBy': 'actual Log.entryAdded events with CSP/style-src/policy matching', 'count': 0},
 'gpu': {'softwareImplementation': 'SwiftShader', 'hardwareAcceptance': False, 'before': r['gpu'], 'after': r['afterRemovalGpu']},
 'toolbarLayouts': layouts, 'narrowLanguages': languages, 'personallyViewedFinalScreenshots': images,
 'resolvedFinding': {'description': 'The initial desktop screenshots showed whole-document horizontal overflow after the new author entry enlarged the toolbar.',
   'initialReport': str(initial_path.relative_to(root)), 'initialReportSha256': sha(initial_path),
   'initialVisibleEvidence': ['removal-desktop-review.png', 'removal-save-conflict.png', 'removal-without-webgl.png'],
   'resolution': 'Only shared toolbar layout CSS and the new smoke producer changed; header/tools wrap locally with bounded width. The final 9 width/language measurements and the final screenshots confirm the overflow is resolved.'},
 'readonlySelectionMethod': {'type': 'direct DOM HTMLElement.click() invocation', 'actualProducer': "removalOpen({stacked:true}) invokes document.querySelector('#scene3dRemovalBtn').click() while the readonly modal remains open",
   'userPointerEntryAcceptance': False, 'meaning': 'This exercises the real click handler, source application and readonly refresh/fallback ownership; it does not demonstrate a normal user pointer can open a sibling control behind an active modal.',
   'observed': r['readonlyRefresh']},
 'scope': 'Personally inspected only the six final images listed here, plus initial images for the resolved finding. Legacy browser report counts can support regression execution but their entire screenshot set was not visually inspected. No installed desktop, Android, hardware GPU, new build, Save or actual-checkout mutation by this reviewer.'}
with (out / 'web-review.json').open('x') as stream:
    json.dump(value, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
print(json.dumps({'ok': True, 'personallyViewedFinalImages': len(images), 'layouts': len(layouts), 'trackedSvgRequests': 0, 'trackedCspViolations': 0}))
