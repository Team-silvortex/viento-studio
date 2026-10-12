from pathlib import Path
import datetime, hashlib, json

base = Path('/tmp/viento-scene3d-framing-xmbbbvr9')
stage = base / 'project'
actual = Path('/home/chiharukiryu/cdev/viento-studio')
out = stage / 'docs/test-results/scene3d-scene-framing'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
load = lambda name: json.loads((out / name).read_text())
baseline = json.loads((base / 'control/baseline.json').read_text())
sources = load('source-final.json')
assert all(sha(stage / r) == h for r, h in sources.items())
regression = load('regression.json')
prepared = load('prepared.json')
independent = load('independent-review.json')
browser = load('browser-verified/browser.json')
legacy = load('legacy-browser/browser.json')
review = load('browser-verified-review.json')
assert regression['ok'] and regression['pass'] == 256 and regression['fail'] == 0
assert prepared['ok'] and independent['ok'] and browser['ok'] and legacy['ok']
assert browser['errors'] == [] and legacy['errors'] == []
assert review['ok']
assert sum(c['samples'] for c in browser['compositingChecks']) == 754
assert all(c['mismatches'] == 0 for c in browser['compositingChecks'])
for result in [browser, legacy]:
    assert result['sourceStableDuringProof']
    for rel, value in result['sourcesFinal'].items():
        assert sha(stage / rel) == value, f'browser source changed: {rel}'
implementation = [
    'web/modules/scene3d-math.js', 'web/modules/scene3d-renderer.js',
    'web/modules/app-scene3d-preview.js', 'web/i18n/en.js', 'web/i18n/ja.js',
    'scripts/tests/scene3d-preview-ui.test.mjs',
    'scripts/tests/scene3d-scene-framing-math.test.mjs',
    'scripts/tests/scene3d-scene-framing-renderer.test.mjs',
    'scripts/tests/scene3d-framing-smoke.mjs',
    'docs/SCENE3D.md', 'docs/STATUS.md', 'docs/ROADMAP.md',
    'docs/function-atlas.json', 'docs/function-atlas.html',
    'docs/function-atlas.mmd', 'docs/FUNCTION_ATLAS.md',
]
changed = {r for r, h in baseline.items() if sha(stage / r) != h}
assert changed == set(implementation) & set(baseline)
assert all(sha(actual / r) == h for r, h in baseline.items())
summary = {
    'ok': True, 'finishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'feature': 'Read-only whole-scene framing in the existing 3D preview', 'version': '0.0.10',
    'regression': {'report': 'regression.json', 'passed': 256, 'failed': 0, 'skipped': 0,
                   'scope': regression['scope']},
    'independentReview': {'report': 'independent-review.json', 'groups': 12},
    'preparedResources': {'report': 'prepared.json', 'groups': 16, 'desktop': 8, 'mobile': 8,
                          'scope': 'Copied resources with standard VM and recording GPU port'},
    'browser': {'report': 'browser-verified/browser.json', 'flows': len(browser['steps']),
                'screenshots': len(browser['screenshots']), 'review': 'browser-verified-review.json',
                'renderer': browser['gpu']['renderer'], 'geometryChecks': len(browser['geometryChecks']),
                'sourceStable': True, 'servedSourcesVerified': len(browser['servedSources']),
                'compositingChecks': browser['compositingChecks'], 'cspAndSvgCountersTracked': False},
    'legacyBrowser': {'report': 'legacy-browser/browser.json', 'flows': len(legacy['steps']),
                      'screenshots': len(legacy['screenshots']), 'sourceStable': True},
    'initialBrowserAttempt': {'completed': False, 'report': 'browser-initial-interruption.json',
                             'reason': 'Navigation hung; process stopped. Partial captures are not a passed run.'},
    'automaticHeadlessPath': {'visualReview': 'browser-review.json', 'compositorComparison': 'compositing-compositor.json', 'status': 'Default headless mode has retained screenshot corruption. Explicit ANGLE/SwiftShader mode passes with identical final product files; underlying driver cause is not established.'},
    'sourceFiles': len(sources), 'sourceManifest': 'source-final.json',
    'sourceBoundaries': 'Only view math, renderer, preview UI, two translations and tests changed. Rust, author semantics, backend protocols and persistence are unchanged.',
    'atlas': {'functions': 96, 'implementations': 239, 'bindings': 373, 'cells': 1492,
              'oldPrefixesPreserved': True},
    'limitations': ['Counts for owner, independent and regression checks overlap; do not sum them.',
                    'No rerun of the entire application suite or Rust tests for this view-only change.',
                    'Software WebGL and prepared resources do not constitute hardware GPU, Android-device or installed-package acceptance.',
                    'Working-tree change; no release, commit, push or installation performed.'],
}
(out / 'results.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
(out / 'prepare-packet.py').write_bytes(Path(__file__).read_bytes())
files = sorted(set(implementation) | {str(p.relative_to(stage)) for p in out.rglob('*') if p.is_file()})
assert not any((stage / r).is_symlink() for r in files)
packet = {'actual': str(actual), 'stage': str(stage), 'baselineSha256': sha(base / 'control/baseline.json'),
          'implementationFiles': implementation, 'files': {r: {'before': baseline.get(r), 'after': sha(stage / r)} for r in files}}
(base / 'control/packet.json').write_text(json.dumps(packet, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'ok': True, 'files': len(files), 'implementationFiles': len(implementation),
                  'packetSha256': sha(base / 'control/packet.json')}))
