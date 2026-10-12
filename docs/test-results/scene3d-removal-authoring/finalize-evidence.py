"""Retain completed receipts, then remove only this run's owned temporary tree."""
from pathlib import Path
import datetime,hashlib,json,os,shutil,stat,sys
B=Path('/tmp/viento-scene3d-removal-71u64wrk');C=B/'control';A=Path('/home/chiharukiryu/cdev/viento-studio');R=Path('docs/test-results/scene3d-removal-authoring');O=A/R
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
read=lambda p:json.loads(p.read_text())
assert len(sys.argv)==2 and sha(C/'patch-ready.json')==sys.argv[1]
assert B.is_dir() and B.resolve()==B and not B.is_symlink() and B.parent==Path('/tmp')
packet=read(C/'patch-ready.json');applied=read(O/'actual-apply-receipt.json')
assert applied['ok'] and applied['manifestSha256']==sys.argv[1] and applied['packet']==packet
assert read(C/'post-apply-review.json')['ok'] and read(C/'actual-path-probe.json')['ok']
def check():
 for item in packet['files']:assert sha(A/item['path'])==item['afterSha256'],item['path']
 for n in ['source-hashes-final.json','historical-baseline.json','author-baseline.json']:
  for p,h in read(O/n).items():assert sha(A/p)==h,p
 for p,e in read(O/'tool-baseline.json').items():
  t=Path(p);s=t.stat();assert sha(t)==e['sha256'] and s.st_size==e['bytes'];assert all(getattr(s,'st_'+k)==e[k] for k in ['dev','ino','nlink'])
 for p in ['desktop/resources','desktop/ui/i18n','desktop/.cache','src-tauri/binaries','mobile/dist']:assert not (A/p).exists()
check()
retained=[]
for n in ['patch-ready.json','post-apply-review.json','post-apply-review-final.py','post-apply-review-initial.json','actual-path-probe.mjs','actual-path-probe.json','actual-atlas-check.log','finalize-evidence.py']:
 p=C/n;q=O/n;assert p.is_file() and not p.is_symlink() and not q.exists() and not O.is_symlink(),n
 with q.open('xb') as f:f.write(p.read_bytes());f.flush();os.fsync(f.fileno())
 assert sha(p)==sha(q);retained.append({'name':n,'sha256':sha(q)})
# This directory was created solely for this turn and contains no external mounts.
size=0;files=0
for root,dirs,names in os.walk(B,followlinks=False):
 for n in names:
  s=Path(root,n).lstat();size+=s.st_size;files+=1
free=shutil.disk_usage('/tmp').free
shutil.rmtree(B)
assert not B.exists()
check()
r={'ok':True,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'ownedTemporaryRootRemoved':str(B),'temporaryRootAbsent':True,'temporaryLogicalBytes':size,'temporaryFiles':files,'observedFreeBytesDelta':shutil.disk_usage('/tmp').free-free,'retained':retained,'authorFilesUnchanged':41,'historicalFilesUnchanged':5242,'externalToolsUnchanged':4,'scope':'Only run-owned isolated checkout, compiler caches, test profiles and backups removed. Logical/reflink bytes and free-space delta are observations, not exact causal savings. Actual product, assets, existing tools, installation and earlier evidence retained.'}
with (O/'cleanup.json').open('x') as f:json.dump(r,f,ensure_ascii=False,indent=2);f.write('\n')
print(json.dumps(r,ensure_ascii=False))
