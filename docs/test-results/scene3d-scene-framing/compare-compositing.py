from pathlib import Path
import hashlib, json, sys
from PIL import Image

directory = Path(sys.argv[1])
output = Path(sys.argv[2])
report = json.loads((directory / 'browser.json').read_text())
assert report['ok']
checks = []
for probe in report['compositingProbes']:
    image = Image.open(directory / probe['file']).convert('RGBA')
    failures = []
    for sample in probe['samples']:
        actual = list(image.getpixel((sample['x'], sample['y'])))
        diff = max(abs(a-b) for a, b in zip(actual, sample['rgba']))
        if diff > 3:
            failures.append({**sample, 'actual': actual, 'diff': diff})
    checks.append({'file': probe['file'], 'samples': len(probe['samples']), 'mismatches': len(failures),
                   'examples': failures[:20], 'screenshotSha256': hashlib.sha256((directory / probe['file']).read_bytes()).hexdigest()})
result = {'ok': all(c['mismatches'] == 0 for c in checks), 'tolerance': 3, 'checks': checks,
          'reportSha256': hashlib.sha256((directory / 'browser.json').read_bytes()).hexdigest(),
          'scope': 'Visible canvas interior samples, excluding rounded borders and sticky footer; expected pixels are real readPixels, screenshot includes the browser compositor.'}
output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result, ensure_ascii=False))
sys.exit(0 if result['ok'] else 1)
