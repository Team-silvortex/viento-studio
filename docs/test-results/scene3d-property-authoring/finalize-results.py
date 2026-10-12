from pathlib import Path
from datetime import datetime, timezone
import json, hashlib

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
load = lambda name: json.loads((OUT / name).read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
timing, copy, cleanup, review = [load(name) for name in ['application-timing.json', 'packaged-resources-confirmed.json', 'cleanup.json', 'review.json']]
assert all(item['ok'] for item in [timing, copy, cleanup, review])
browser = load('browser-properties-initial/browser.json')
assert browser['ok'] and browser['sourceStableDuringProof']
proofs = ['baseline.json', 'source-freeze-confirmed.json', 'application-timing.json', 'core-results.json', 'core-document-review.json', 'source-quality-initial.json', 'review.json', 'packaged-resources-confirmed.json', 'preservation-audit-before-cleanup.json', 'cleanup.json', 'atlas-preservation-review.json', 'browser-properties-initial/browser.json']
portable = {name: {key: len(value) for key, value in item.items() if isinstance(value, list)} for name, item in copy['portable'].items()}
report = {'format': 'viento-scene3d-property-authoring-results', 'schemaVersion': 1, 'createdAt': datetime.now(timezone.utc).isoformat(), 'ok': True,
    'version': '0.0.10', 'publishedBase': '3a91e84a5cd543ebb4a6f416f727c544cf9ff083', 'delivery': 'unpublished-working-tree',
    'feature': 'Independent selected 3D object name/color review, guarded unsaved source application and ordinary Save. Stable UUID, geometry, environment, other objects and all unrelated source bytes retained.',
    'application': timing['completedApplication'], 'addedApplicationTests': timing['completedApplication']['tests'] - 3256,
    'syntaxFiles': timing['syntaxFiles'], 'rustTests': 234, 'sharedCoreTests': 259, 'bridgeTests': 20, 'bridgeNativeWasmParityRequests': 20,
    'independentQualityGroups': 9, 'independentNativeWasmParityRequests': 17, 'uiRegressionTests': 155, 'hostSystemTests': 12,
    'browser': {'report': 'browser-properties-initial/browser.json', 'flows': len(browser['steps']), 'screenshots': browser['screenshots'], 'sourceStableDuringProof': True, 'zeroErrorsCspAndSvgRequests': True,
        'ordinarySourceGuards': 'Explicit fields; original CRLF/CR name preserved when textarea untouched; 256 astral codepoints accepted/257 refused; silent input or target edits and newer source revoke approval; ordinary Save and external conflict independently observed.',
        'regressionFlows': {name: len(load(name + '/browser.json')['steps']) for name in ['browser-environment-regression-1', 'browser-objects-regression-1', 'browser-transforms-regression-1']}},
    'prepared': {'cases': portable, 'totalCases': sum(sum(v.values()) for v in portable.values()), 'inventoryCounts': {name: item['manifestFileCount'] for name, item in copy['artifacts'].items()},
        'moduleCounts': {name: item['moduleCount'] for name, item in copy['portable'].items()}, 'noNodeDomNetworkGlobals': True, 'noHostImports': True},
    'sourceFreeze': {'files': copy['frozenSource']['files'], 'manifestSha256': copy['frozenSource']['manifestSha256']},
    'preserved': {'historicalReports': 4024, 'authorFiles': 41, 'externalTools': 4, 'oldAtlasScoresAndReasonsExact': True},
    'cleanup': {'allocatedFileBytesRemoved': cleanup['allocatedFileBytesRemoved'], 'logicalBytesRemoved': cleanup['logicalBytesRemoved'], 'paths': [item['path'] for item in cleanup['removed']]},
    'wasm': {'bytes': (ROOT / 'engine/studio-core.wasm').stat().st_size, 'sha256': sha(ROOT / 'engine/studio-core.wasm'), 'retained': True},
    'proofs': {name: {'path': name, 'sha256': sha(OUT / name)} for name in proofs},
    'limits': ['Software WebGL from explicitly recorded SwiftShader; no hardware GPU acceptance.', 'Prepared mobile portability is not Android device acceptance; no new installation.', 'No version bump, commit, push, tag or release.', 'Specialized counts overlap the full application run; not summed.', 'Properties edit primitive names/colors, not general materials, models, hierarchy, gizmos or multi-object transactions.']}
with (OUT / 'results.json').open('x') as f: f.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'ok': True, 'application': report['application']['tests'], 'prepared': report['prepared']['totalCases'], 'allocatedRemoved': report['cleanup']['allocatedFileBytesRemoved']}))
