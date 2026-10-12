from pathlib import Path
import hashlib,json,os,stat,tempfile
CLOSE=Path('/tmp/viento-scene3d-copy-close-jxe_q12r');ACTUAL=Path('/home/chiharukiryu/cdev/viento-studio');REL=Path('docs/test-results/scene3d-copy-authoring');OUT=ACTUAL/REL
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def regular(p):
 assert not p.is_symlink() and p.is_file(),str(p)
 return p
m=json.loads((CLOSE/'closure-ready.json').read_text());assert m['ok'] and m['actualRoot']==str(ACTUAL) and m['relativeEvidenceRoot']==str(REL)
import sys
assert len(sys.argv)==2 and sha(CLOSE/'closure-ready.json')==sys.argv[1]
packet=json.loads((CLOSE/'patch-ready.json').read_text());receipt=json.loads((OUT/'actual-apply-receipt.json').read_text());assert receipt['ok'] and receipt['packet']==packet and receipt['manifestSha256']==sha(CLOSE/'patch-ready.json')
for i in packet['files']:assert sha(regular(ACTUAL/i['path']))==i['afterSha256'],i['path']
for name in ['source-hashes-final.json','historical-baseline.json','author-baseline.json']:
 for rel,h in json.loads((OUT/name).read_text()).items():assert sha(regular(ACTUAL/rel))==h,rel
assert not Path('/tmp/viento-scene3d-copy-jxe_q12r').exists()
paths=[]
for i in m['files']:
 n=i['name'];assert Path(n).name==n and n not in ['.','..','closure-ready.json']
 p=regular(CLOSE/n);q=OUT/n;assert sha(p)==i['sha256'] and p.stat().st_size==i['bytes'],n
 for a in [ACTUAL,ACTUAL/'docs',ACTUAL/'docs/test-results',OUT,q]:assert not a.is_symlink(),str(a)
 if q.exists():assert n=='finalize-evidence.py' and sha(regular(q))==sha(p),n
 paths.append((p,q))
assert not (OUT/'closure-ready.json').exists()
paths.append((CLOSE/'closure-ready.json',OUT/'closure-ready.json'))
for p,q in paths:
 if q.exists():continue
 fd,tmp=tempfile.mkstemp(prefix='.viento-closure-',dir=OUT)
 try:
  with os.fdopen(fd,'wb') as f:f.write(p.read_bytes());f.flush();os.fsync(f.fileno())
  os.chmod(tmp,0o644);os.replace(tmp,q)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
for p,q in paths:assert sha(regular(p))==sha(regular(q)),str(q)
print(json.dumps({'ok':True,'appended':len(paths)-1,'existingProducerUnchanged':'finalize-evidence.py','manifestSha256':sha(OUT/'closure-ready.json'),'scope':'Completed closure evidence only; no source/old proof/data changes or deletions.'}))
