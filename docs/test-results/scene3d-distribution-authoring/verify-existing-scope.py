from pathlib import Path
import datetime,hashlib,json
base=Path('/tmp/viento-scene3d-distribution-n4tesgxn');stage=base/'project';out=stage/'docs/test-results/scene3d-distribution-authoring'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
baseline=json.loads((out/'checkout-files-baseline.json').read_text());ready=json.loads((out/'implementation-ready.json').read_text())
allowed={item['path'] for item in ready['files']}|{'docs/function-atlas.json','docs/FUNCTION_ATLAS.md','docs/function-atlas.mmd','docs/function-atlas.html'}
changed=[]
for path,expected in baseline.items():
 p=stage/path;assert p.is_file() and not p.is_symlink(),path
 if sha(p)!=expected:
  assert path in allowed,path
  changed.append(path)
report={'ok':True,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'baselineFiles':len(baseline),'changedWithinAllowlist':changed,'missing':[],'unexpectedChanged':[],'scope':'Complete initial6046 regular-file staged inventory, excluding node_modules/git and historical dist handoff copies; only42 implementation/test/docs and four atlas outputs may change. New proof folder is separately allowlisted. No initial file removed.'}
with (out/'existing-scope-review.json').open('x') as stream:json.dump(report,stream,indent=2);stream.write('\n')
print(json.dumps({'ok':True,'baselineFiles':len(baseline),'changedWithinAllowlist':len(changed),'missing':0,'unexpectedChanged':0}))
