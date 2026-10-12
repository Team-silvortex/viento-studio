#!/usr/bin/env python3
import datetime,hashlib,json,os,shutil,stat
from pathlib import Path
BASE=Path('/tmp/viento-scene3d-alignment-fayrkhch'); CLOSE=Path('/tmp/viento-scene3d-alignment-close-fayrkhch'); ACTUAL=Path('/home/chiharukiryu/cdev/viento-studio'); REL=Path('docs/test-results/scene3d-alignment-authoring'); OUT=ACTUAL/REL
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
read=lambda p:json.loads(p.read_text())
assert BASE.resolve()==BASE and CLOSE.resolve()==CLOSE and BASE.parent==Path('/tmp') and CLOSE.parent==Path('/tmp')
assert not BASE.is_symlink() and not CLOSE.is_symlink() and BASE.is_dir()
control=BASE/'control'; packet=read(control/'patch-ready.json'); receipt=read(OUT/'actual-apply-receipt.json'); post=read(control/'post-apply-review.json'); probe=read(control/'actual-path-probe.json'); result=read(OUT/'results.json')
assert receipt['ok'] and receipt['actualApplyPerformed'] and post['ok'] and post['openFindings']==[] and probe['ok']
assert sha(control/'patch-ready.json')==receipt['manifestSha256']
for src,dst in [('post-apply-review.json','post-apply-review.json'),('post-apply-review.py','post-apply-review.py'),('post-apply-review-initial.log','post-apply-review-initial.log'),('actual-path-probe.json','actual-path-probe.json'),('patch-ready.json','patch-ready.json')]:
 data=(control/src).read_bytes()
 if (CLOSE/dst).exists():assert (CLOSE/dst).read_bytes()==data
 else:
  with (CLOSE/dst).open('xb') as f:f.write(data)

def check_actual():
 for item in packet['files']:
  p=ACTUAL/item['path']; assert not p.is_symlink() and sha(p)==item['afterSha256'],item['path']
 frozen=read(OUT/'source-hashes-browser-final.json')
 assert len(frozen)==747
 for rel,h in frozen.items(): assert sha(ACTUAL/rel)==h,rel
 for name in ['historical-baseline.json','author-baseline.json']:
  for rel,h in read(OUT/name).items(): assert sha(ACTUAL/rel)==h,rel
 for path,expected in read(OUT/'tool-baseline.json').items():
  p=Path(path); s=p.stat(); assert sha(p)==expected['sha256'] and s.st_size==expected['bytes']
  for key in ['dev','ino','nlink']: assert getattr(s,'st_'+key)==expected[key]
check_actual()
assert sha(CLOSE/'post-apply-review.json')=='4de80e8903fb27dbfb5e7257f2e45963ba1f4b42a1b9f58e8ab5c509c3fc49ba'
seen=set();counts={'files':0,'logicalBytes':0,'allocatedBlocksBytes':0}
for root,dirs,files in os.walk(BASE,followlinks=False):
 for name in dirs+files:
  p=Path(root,name); s=p.lstat(); key=(s.st_dev,s.st_ino)
  if key in seen:continue
  seen.add(key);counts['allocatedBlocksBytes']+=s.st_blocks*512
  if not stat.S_ISDIR(s.st_mode):counts['files']+=1;counts['logicalBytes']+=s.st_size
before=shutil.disk_usage('/tmp').free
shutil.rmtree(BASE)
assert not BASE.exists()
after=shutil.disk_usage('/tmp').free
check_actual()
cleanup={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'ok':True,'ownedTemporaryRootRemoved':str(BASE),'ownedTemporaryRootAbsent':True,'inventoryBefore':counts,'observedFilesystemFreeBytesBefore':before,'observedFilesystemFreeBytesAfter':after,'observedFreeByteDelta':after-before,'scope':'Only this turn-owned isolated stage, Cargo home, build targets, test profiles/config, and backups removed after all proofs and validated actual application were retained. No actual checkout path, assets, global toolchain/cache or existing installation removed. Per-tree allocated blocks may include shared reflink extents; filesystem delta is an observation, not an exact causal savings claim.'}
with (CLOSE/'cleanup.json').open('x') as f:json.dump(cleanup,f,indent=2);f.write('\n')
audit={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'ok':True,'openFindings':[],'status':'implemented-tested-reviewed-applied-and-owned-temporary-files-cleaned','actualRoot':str(ACTUAL),'version':receipt['version'],'head':receipt['head'],'actualApplyPerformed':True,'sourceFilesVerified':747,'applicationPacketFilesVerified':len(packet['files']),'actualPathProposalProbe':probe,'independentPostApplyReview':{'report':'post-apply-review.json','sha256':sha(CLOSE/'post-apply-review.json')},'tests':{'fullApplication':result['fullApplication'],'focused':result['focused'],'browserFlowTotals':result['browserFlowTotals'],'prepared':result['prepared']},'preserved':{'historicalFiles':4714,'authorFiles':41,'externalToolFiles':4},'atlas':post['atlas'],'cleanup':{'report':'cleanup.json','sha256':sha(CLOSE/'cleanup.json')},'scope':'Full and browser tests ran on the isolated source phases documented in unchanged results.json; actual approved product/test bytes match final 747-source freeze, and actual-path WASM/proposal loading plus independent post-apply audit passed. No commit/push/version bump, new installation, Android device or hardware GPU acceptance.'}
with (CLOSE/'final-audit.json').open('x') as f:json.dump(audit,f,ensure_ascii=False,indent=2);f.write('\n')
files=[]
for p in sorted(CLOSE.iterdir()):
 if p.is_file() and not p.is_symlink():files.append({'name':p.name,'sha256':sha(p),'bytes':p.stat().st_size})
manifest={'ok':True,'actualRoot':str(ACTUAL),'relativeEvidenceRoot':str(REL),'files':files,'scope':'Append only completed closure evidence; every target must be absent. No source or old evidence changed.'}
with (CLOSE/'closure-ready.json').open('x') as f:json.dump(manifest,f,indent=2);f.write('\n')
print(json.dumps({'ok':True,'closureRoot':str(CLOSE),'files':len(files),'closureManifestSha256':sha(CLOSE/'closure-ready.json'),'ownedTemporaryRootRemoved':str(BASE),'allocatedBlocksBytesBefore':counts['allocatedBlocksBytes'],'observedFreeByteDelta':after-before}))
