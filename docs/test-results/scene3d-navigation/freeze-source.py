from pathlib import Path
from datetime import datetime,timezone
import hashlib,json
O=Path(__file__).resolve().parent;R=O.parents[2];sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
base=json.loads((O/'source-baseline.json').read_text());new=['engine/scene3d-navigation.mjs','scripts/tests/scene3d-navigation.test.mjs','scripts/tests/scene3d-navigation-source-host.test.mjs','scripts/tests/scene3d-math-navigation.test.mjs','scripts/tests/scene3d-navigation-smoke.mjs']
assert not (O/'source-hashes-final.json').exists()
final={p:sha(R/p)for p in sorted(set(base)|set(new))}
changed={p:{'before':v,'after':final[p]}for p,v in base.items()if final[p]!=v}
assert not any(p.startswith('crates/')or p in ['engine/studio-core.mjs','engine/scene3d.mjs','engine/studio-modules.mjs','web/modules/app-studio-system.js']for p in changed)
(O/'source-hashes-final.json').write_text(json.dumps(final,indent=2)+'\n')
(O/'source-freeze-final.json').write_text(json.dumps({'createdAt':datetime.now(timezone.utc).isoformat(),'sourceFiles':len(final),'added':{p:final[p]for p in new},'changed':changed,'removed':[],'sourceManifestSha256':sha(O/'source-hashes-final.json'),'scope':'Prior exact718 source bytes plus all five new portable/test/smoke sources. Shared native rules/ABI/schema/build plans/module declarations/root assembly unchanged; docs/current atlas independently reviewed.'},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'sourceFiles':len(final),'added':len(new),'changed':len(changed),'nativeAndAuthorFormatsUnchanged':True}))
