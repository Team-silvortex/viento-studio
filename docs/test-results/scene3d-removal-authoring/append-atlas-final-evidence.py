from pathlib import Path
from datetime import datetime, timezone
import json

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
p = ROOT / 'docs/function-atlas.json'
data = json.loads(p.read_text())
old = json.loads((OUT / 'atlas-baseline.json').read_text())
feature = 'scene.removal_authoring3d'
browser = json.loads((OUT / 'browser-removal-layout/browser.json').read_text())
prepared = json.loads((OUT / 'packaged-resources-layout.json').read_text())
review = json.loads((OUT / 'stage-review.json').read_text())
assert browser['ok'] and browser['status'] == 'passed' and len(browser['toolbarLayouts']) == 9
assert not browser['errors'] and not browser['cspViolations'] and not browser['svgRequests']
assert browser['sourceStableDuringProof']
assert prepared['ok'] and prepared['frozenSource']['allMatch']
assert sum(len(v) for suites in prepared['portable'].values() for v in suites.values() if isinstance(v, list)) == 378
assert review['ok'] and review['reviewedFileCount'] == 47 and not review['findings']
assert data['sourceSnapshot'] == old['sourceSnapshot']
assert data['meta']['historicalSha256'] == old['meta']['historicalSha256']
for key, values in old['axes'].items():
    assert data['axes'][key][:len(values)] == values
for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']:
    assert data[key][:len(old[key])] == old[key]
new_ids = []
start = max(int(row['id'][1:]) for row in data['evidence']) + 1
paths = [
    'docs/test-results/scene3d-removal-authoring/browser-removal-layout/browser.json',
    'docs/test-results/scene3d-removal-authoring/packaged-resources-layout.json',
    'docs/test-results/scene3d-removal-authoring/stage-review.json'
]
assert not any(row['path'] in paths for row in data['evidence'])
for n, relative in enumerate(paths, start):
    assert (ROOT / relative).is_file(), relative
    identity = f'e{n}'
    data['evidence'].append({'id': identity, 'kind': 'report', 'path': relative,
        'note': '最终共享编辑工具栏布局修复后的已存在证据：9个三语／多宽度实际Chrome布局、378组冻结准备副本及47文件静态审查；旧浏览器和准备报告保持其原SHA及当轮范围，不追写旧证据。安装／设备／硬件GPU评分保持。'})
    new_ids.append(identity)
bindings = [row for row in data['bindings'] if row['function'] == feature]
assert len(bindings) == 5
for row in bindings:
    row['evidence'].extend(new_ids)
for key, values in old['axes'].items():
    assert data['axes'][key][:len(values)] == values
for key in ['bindings', 'cells', 'evidence', 'dependencies', 'workflows', 'legacyCoverage', 'priorities']:
    assert data[key][:len(old[key])] == old[key]
assert data['sourceSnapshot'] == old['sourceSnapshot']
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
receipt = {'ok': True, 'createdAt': datetime.now(timezone.utc).isoformat(), 'feature': feature,
    'addedEvidence': [{'id': identity, 'path': path} for identity, path in zip(new_ids, paths)],
    'newFeatureBindingsUpdated': 5, 'oldPrefixesAndScoresExact': True, 'sourceSnapshotUnchanged': True,
    'sourceRefreshDeferredUntilStatusClosingResults': True,
    'counts': {'functions': len(data['axes']['function']), 'implementations': len(data['axes']['implementation']),
        **{key: len(data[key]) for key in ['bindings', 'cells', 'dependencies', 'workflows', 'evidence']}}}
with (OUT / 'atlas-final-evidence-receipt.json').open('x') as f:
    json.dump(receipt, f, ensure_ascii=False, indent=2)
    f.write('\n')
print(json.dumps(receipt['counts']))
