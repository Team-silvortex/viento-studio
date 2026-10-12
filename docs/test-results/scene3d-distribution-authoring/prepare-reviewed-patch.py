#!/usr/bin/env python3
import datetime, difflib, hashlib, json, os, stat
from pathlib import Path
BASE=Path('/tmp/viento-scene3d-distribution-n4tesgxn'); STAGE=BASE/'project'; ACTUAL=Path('/home/chiharukiryu/cdev/viento-studio'); CONTROL=BASE/'control'; REL=Path('docs/test-results/scene3d-distribution-authoring'); OUT=STAGE/REL
sha=lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
read=lambda p: json.loads(p.read_text())
baseline=read(CONTROL/'baseline-files.json')
ready=read(OUT/'implementation-ready.json')
assert ready['actualApplyPerformed'] is False
for name in ['results.json','stage-review.json','stage-preservation.json','post-stage-review.json','atlas-preservation-review.json']:
 assert read(OUT/name)['ok'] is True, name
for rel,h in read(OUT/'source-hashes-final.json').items(): assert sha(STAGE/rel)==h, rel
for rel,h in read(OUT/'source-baseline.json').items(): assert sha(ACTUAL/rel)==h, rel
implementation=[f['path'] for f in ready['files']]
assert len(implementation)==42
atlas=['docs/function-atlas.json','docs/FUNCTION_ATLAS.md','docs/function-atlas.mmd','docs/function-atlas.html']
diff=[]
for rel in implementation + atlas[:2] + atlas[2:3]:
 p=STAGE/rel; q=ACTUAL/rel
 before=q.read_bytes() if q.exists() else b''; after=p.read_bytes()
 try:
  a=before.decode('utf-8'); b=after.decode('utf-8')
  diff.extend(difflib.unified_diff(a.splitlines(keepends=True), b.splitlines(keepends=True), fromfile='a/'+rel if q.exists() else '/dev/null',tofile='b/'+rel))
 except UnicodeDecodeError:
  diff.append(f'Binary changed: {rel}; before SHA256 {hashlib.sha256(before).hexdigest()} -> after SHA256 {sha(p)}, {len(after)} bytes\n')
with (OUT/'final-source.diff').open('x') as stream: stream.write(''.join(diff))
evidence=[]
for root,dirs,files in os.walk(OUT):
 assert not Path(root).is_symlink()
 dirs[:]=sorted(d for d in dirs if d!='__pycache__')
 for name in sorted(files):
  p=Path(root,name)
  assert not p.is_symlink() and p.is_file(), str(p)
  evidence.append(str(p.relative_to(STAGE)))
files=[]
for rel in sorted(set(implementation+atlas+evidence)):
 p=STAGE/rel; q=ACTUAL/rel; old=baseline.get(rel)
 assert not p.is_symlink() and p.is_file()
 if old is None: assert not q.exists(), rel
 else: assert q.is_file() and sha(q)==old, rel
 files.append({'path':rel,'beforeSha256':old,'afterSha256':sha(p),'bytes':p.stat().st_size,'mode':stat.S_IMODE(p.stat().st_mode)})
packet={
 'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'ok':True,
 'phase':'concrete-validated-reviewed-patch-awaiting-actual-application',
 'actualApplyPerformed':False,'actualRoot':str(ACTUAL),'stageRoot':str(STAGE),
 'implementationPaths':implementation,'atlasPaths':atlas,'evidencePaths':evidence,'files':files,'deletions':[],
 'finalSourceManifestSha256':sha(OUT/'source-hashes-final.json'),
 'sourceDiff':{'path':str(REL/'final-source.diff'),'sha256':sha(OUT/'final-source.diff')},
 'postStageReviewSha256':sha(OUT/'post-stage-review.json'),
 'applier':{'path':str(CONTROL/'apply-reviewed-patch.py'),'sha256':sha(CONTROL/'apply-reviewed-patch.py')},
 'scope':'Only the 42 reviewed source/test/docs files, four generated atlas views, and the new alignment evidence folder. No deletions, caches, dependencies, tools, git, assets, or user project contents.',
}
with (CONTROL/'patch-ready.json').open('x') as stream: json.dump(packet,stream,ensure_ascii=False,indent=2);stream.write('\n')
print(json.dumps({'ok':True,'files':len(files),'implementationFiles':len(implementation),'atlasFiles':len(atlas),'evidenceFiles':len(evidence),'bytes':sum(x['bytes'] for x in files),'manifestSha256':sha(CONTROL/'patch-ready.json'),'applierSha256':packet['applier']['sha256']}))
