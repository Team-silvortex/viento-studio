"""Read-only final hash and preservation confirmation after atlas refresh."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess
O=Path(__file__).resolve().parent
R=O.parents[2]
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def load(n):return json.loads((O/n).read_text())
assert not (O/'final-confirmation.json').exists()
audit=load('final-audit.json');assert audit['ok']
atlas=json.loads((R/'docs/function-atlas.json').read_text())
assert audit['atlas']['currentSha256']==sha(R/'docs/function-atlas.json')
for p,h in atlas['sourceSnapshot'].items():assert sha(R/p)==h,p
frozen=load('source-hashes.json')
for p,h in frozen.items():assert sha(R/p)==h,p
for group in ['historical-baseline.json','author-baseline.json']:
 for p,h in load(group).items():assert sha(R/p)==h,p
review=load('review.json');assert review['ok'] and not review['openFindings']
assert review['finalSourceFreeze']['sha256']==sha(O/'source-hashes.json')
prepared=load('packaged-resources.json');assert prepared['ok']
assert prepared['frozenSource']['manifestSha256']==sha(O/'source-hashes.json')
for item in load('document-review.json')['reviewedFiles']:assert sha(R/item['path'])==item['sha256'],item['path']
assert subprocess.run(['git','diff','--check'],cwd=R).returncode==0
counts={k:len(atlas[k]) for k in ['bindings','cells','evidence','dependencies','workflows']}
counts.update({k:len(v) for k,v in atlas['axes'].items()})
report={'ok':True,'createdAt':datetime.now(timezone.utc).isoformat(),'sourceFiles':len(frozen),'referencedSourceFiles':len(atlas['sourceSnapshot']),'atlas':counts,'atlasSHA256':sha(R/'docs/function-atlas.json'),'auditSHA256':sha(O/'final-audit.json'),'scope':'Read-only confirmation after final atlas source refresh; no mutation of referenced reports.','authorFiles':len(load('author-baseline.json')),'historicalFiles':len(load('historical-baseline.json'))}
(O/'final-confirmation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False))
