from pathlib import Path
import datetime,hashlib,json
b=Path('/tmp/viento-scene3d-alignment-fayrkhch');p=b/'project';o=p/'docs/test-results/scene3d-alignment-authoring';control=b/'control'
h=lambda q:hashlib.sha256(q.read_bytes()).hexdigest()
baseline=json.loads((control/'baseline-files.json').read_text());ready=json.loads((o/'implementation-ready.json').read_text())
allowed={x['path'] for x in ready['files']}|{'docs/function-atlas.json','docs/FUNCTION_ATLAS.md','docs/function-atlas.mmd','docs/function-atlas.html'}
changed=[];missing=[];unexpected=[];preexistingSymlinks=0
for rel,expected in baseline.items():
 q=p/rel
 if not q.exists(): missing.append(rel);continue
 if q.is_symlink(): preexistingSymlinks+=1
 if h(q)!=expected:
  changed.append(rel)
  if rel not in allowed:unexpected.append(rel)
result={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'ok':not missing and not unexpected,'scope':'Entire 6136-file staged pre-existing inventory excluding node_modules, compared with pre-implementation baseline; only 40 reviewed implementation/test/docs paths and four atlas outputs may change. No pre-existing file deleted. New evidence is separately allowlisted.', 'preexistingReadableSymlinks':preexistingSymlinks,'baselineFiles':len(baseline),'baselineSha256':h(control/'baseline-files.json'),'missing':missing,'unexpectedChanged':unexpected,'changedWithinAllowlist':sorted(changed)}
assert result['ok'],result
with (o/'existing-scope-review.json').open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps({'ok':True,'preexistingReadableSymlinks':preexistingSymlinks,'baselineFiles':len(baseline),'changedWithinAllowlist':len(changed),'missing':0,'unexpectedChanged':0}))
