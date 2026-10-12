"""Freeze a concrete source/docs/evidence allowlist; does not write the actual checkout."""
from pathlib import Path
import datetime,difflib,hashlib,json,os,stat,shutil
B=Path('/tmp/viento-scene3d-removal-71u64wrk');S=B/'project';C=B/'control';A=Path('/home/chiharukiryu/cdev/viento-studio');R=Path('docs/test-results/scene3d-removal-authoring');O=S/R
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
read=lambda p:json.loads(p.read_text())
for n in ['results.json','stage-review.json','post-stage-review.json','web-review.json','atlas-preservation-review.json']:assert read(O/n)['ok'],n
baseline=read(C/'baseline-files.json');final=read(O/'source-hashes-final.json')
for p,h in final.items():assert sha(S/p)==h,p
for p,h in read(O/'source-baseline.json').items():assert sha(A/p)==h,p
candidates=list(final)+['docs/STATUS.md','docs/ROADMAP.md','docs/ARCHITECTURE.md','docs/SCENE3D.md','docs/STUDIO_MODULES.md']
implementation=sorted(p for p in candidates if sha(S/p)!=baseline.get(p));assert len(implementation)==47
atlas=['docs/function-atlas.json','docs/FUNCTION_ATLAS.md','docs/function-atlas.mmd','docs/function-atlas.html']
# Retain exact producers before inventorying the proof directory.
for name in ['apply-reviewed-patch.py','prepare-reviewed-patch.py','close-results.py','post-apply-review.py','run-full.sh','run-legacy-browsers.sh','integrate-removal.py','make-removal-ui.py','localize-removal.py','make-removal-ui-tests.py','update-docs.py']:
 data=(C/name).read_bytes();p=O/name
 if p.exists():assert p.read_bytes()==data,name
 else:p.write_bytes(data)
diff=[]
for p in implementation+atlas[:3]:
 a=(A/p).read_bytes() if (A/p).exists() else b'';b=(S/p).read_bytes()
 try:diff.extend(difflib.unified_diff(a.decode().splitlines(keepends=True),b.decode().splitlines(keepends=True),fromfile='a/'+p,tofile='b/'+p))
 except UnicodeDecodeError:diff.append(f'Binary {p}: {hashlib.sha256(a).hexdigest()} -> {sha(S/p)}, {len(b)} bytes\n')
(O/'final-source.diff').write_text(''.join(diff))
evidence=[]
for root,dirs,files in os.walk(O):
 assert not Path(root).is_symlink();dirs[:]=sorted(d for d in dirs if d!='__pycache__')
 for name in sorted(files):
  p=Path(root,name);assert p.is_file() and not p.is_symlink();evidence.append(p.relative_to(S).as_posix())
files=[]
for p in sorted(set(implementation+atlas+evidence)):
 source=S/p;target=A/p;old=baseline.get(p)
 if old is None:assert not target.exists(),p
 else:assert target.is_file() and sha(target)==old,p
 files.append({'path':p,'beforeSha256':old,'afterSha256':sha(source),'bytes':source.stat().st_size,'mode':stat.S_IMODE(source.stat().st_mode)})
packet={'ok':True,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'actualRoot':str(A),'stageRoot':str(S),'actualApplyPerformed':False,'implementationPaths':implementation,'atlasPaths':atlas,'evidencePaths':evidence,'files':files,'deletions':[],'finalSourceManifestSha256':sha(O/'source-hashes-final.json'),'applier':{'path':str(C/'apply-reviewed-patch.py'),'sha256':sha(C/'apply-reviewed-patch.py')},'scope':'Only 47 tested implementation/docs files, four generated atlas views and this new evidence directory. No assets, author projects, git, generated dependencies or tools.'}
with (C/'patch-ready.json').open('x') as f:json.dump(packet,f,ensure_ascii=False,indent=2);f.write('\n')
print(json.dumps({'ok':True,'files':len(files),'implementationFiles':len(implementation),'atlasFiles':len(atlas),'evidenceFiles':len(evidence),'bytes':sum(x['bytes'] for x in files),'manifestSha256':sha(C/'patch-ready.json')}))
