from pathlib import Path
from datetime import datetime, timezone
import json, hashlib
OUT=Path(__file__).resolve().parent;ROOT=OUT.parents[2]
sha=lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
prior=json.loads((OUT/'source-baseline.json').read_text())
new=['crates/viento-studio-core/src/scene3d_properties_patch.rs', 'engine/scene3d-properties.mjs', 'web/modules/app-scene3d-properties.js', 'web/scene3d-properties.css', 'scripts/tests/studio-core-scene3d-properties.test.mjs', 'scripts/tests/scene3d-properties.test.mjs', 'scripts/tests/scene3d-property-source-host.test.mjs', 'scripts/tests/scene3d-property-system-ports.test.mjs', 'scripts/tests/scene3d-properties-ui.test.mjs', 'scripts/tests/scene3d-properties-smoke.mjs']
assert not (OUT/'source-hashes-final.json').exists(), 'Do not overwrite a frozen proof.'
keys=sorted(set(prior)|set(new));frozen={p:sha(ROOT/p) for p in keys}
(OUT/'source-hashes-final.json').write_text(json.dumps(frozen,indent=2)+'\n')
report={'createdAt':datetime.now(timezone.utc).isoformat(),'baselineFiles':len(prior),'frozenFiles':len(frozen),'added':{p:frozen[p]for p in new},'changed':{p:{'before':old,'after':frozen[p]}for p,old in prior.items() if frozen[p]!=old},'removed':[],'manifestSha256':sha(OUT/'source-hashes-final.json'),'scope':'Prior exact 708-source manifest plus all ten new product/test files. Documentation under docs and current atlas are independently reviewed after integration evidence; engine README is included. Frozen author/example definitions remain preserved.'}
(OUT/'source-freeze-final.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'frozen':len(frozen),'added':len(new),'changed':len(report['changed']),'manifestSha256':report['manifestSha256']}))
