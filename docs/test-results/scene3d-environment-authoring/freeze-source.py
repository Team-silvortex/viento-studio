from pathlib import Path
from datetime import datetime, timezone
import json, hashlib
OUT=Path(__file__).resolve().parent;ROOT=OUT.parents[2]
sha=lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
prior=json.loads((OUT/'source-baseline.json').read_text())
new=['crates/viento-studio-core/src/scene3d_environment_patch.rs', 'engine/scene3d-environment.mjs', 'web/modules/app-scene3d-environment.js', 'web/scene3d-environment.css', 'scripts/tests/studio-core-scene3d-environment.test.mjs', 'scripts/tests/scene3d-environment.test.mjs', 'scripts/tests/scene3d-environment-source-host.test.mjs', 'scripts/tests/scene3d-environment-system-ports.test.mjs', 'scripts/tests/scene3d-environment-ui.test.mjs', 'scripts/tests/scene3d-environment-smoke.mjs']
assert not (OUT/'source-hashes.json').exists(), 'Do not overwrite a frozen proof.'
keys=sorted(set(prior)|set(new));frozen={p:sha(ROOT/p) for p in keys}
(OUT/'source-hashes.json').write_text(json.dumps(frozen,indent=2)+'\n')
report={'createdAt':datetime.now(timezone.utc).isoformat(),'baselineFiles':len(prior),'frozenFiles':len(frozen),'added':{p:frozen[p]for p in new},'changed':{p:{'before':old,'after':frozen[p]}for p,old in prior.items() if frozen[p]!=old},'removed':[],'manifestSha256':sha(OUT/'source-hashes.json'),'scope':'Prior exact 698-source manifest plus all ten new product/test files. Documentation under docs and current atlas are independently reviewed after integration evidence; engine README is included. Frozen author/example definitions remain preserved.'}
(OUT/'source-freeze.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'frozen':len(frozen),'added':len(new),'changed':len(report['changed']),'manifestSha256':report['manifestSha256']}))
