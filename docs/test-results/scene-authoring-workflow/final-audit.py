from pathlib import Path
import hashlib,json,re,urllib.parse,subprocess
r=Path.cwd();o=r/'docs/test-results/scene-authoring-workflow'
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
source=json.loads((o/'source-hashes.json').read_text());hist=json.loads((o/'historical-baseline.json').read_text())
for mapping in [source,hist]:
 for name,digest in mapping.items():assert (r/name).is_file() and h(r/name)==digest,name
old=json.loads((o/'atlas-baseline.json').read_text());new=json.loads((r/'docs/function-atlas.json').read_text())
for name in ['bindings','cells','evidence','dependencies','workflows','legacyCoverage','priorities']:assert new[name][:len(old[name])]==old[name],name
for name in old['axes']:assert new['axes'][name][:len(old['axes'][name])]==old['axes'][name],name
protected={}
for filename in ['core-source-hashes-final.json','frozen-backend-baseline.json','protected-scene-slices.json','author-baseline.json']:
 original=json.loads((o/filename).read_text())
 for name,digest in original.items():assert h(r/name)==digest,name
 protected[filename]=len(original)
oldcore=json.loads((o/'core-source-hashes.json').read_text());finalcore=json.loads((o/'core-source-hashes-final.json').read_text())
assert finalcore==oldcore
corechanged=[]
# All previous scene sources survive except the narrow parent/fixture coupling
# changes documented by this slice. Existing domain rules, views and source host
# are retained exactly; the override bridge changes only function sharing tests.
scene=json.loads((o/'scene-source-baseline.json').read_text())
allowed={'web/modules/app-project-build.js','scripts/tests/dialog-harness.mjs','scripts/tests/scene-composition-overrides-bridge.test.mjs'}
scenechanged=[name for name,digest in scene.items() if h(r/name)!=digest]
assert set(scenechanged)<=allowed,scenechanged
retained=baseline_core=json.loads((o/'baseline.json').read_text())['retainedSharedCore']
assert (r/retained['path']).stat().st_size==retained['bytes'] and h(r/retained['path'])==retained['sha256']
assert json.loads((r/'engine/studio-core.build.json').read_text())==json.loads((o/'studio-core-build-baseline.json').read_text())
for name,item in json.loads((o/'tool-baseline.json').read_text()).items():
 p=Path(name);st=p.stat();assert p.is_file() and st.st_size==item['bytes'] and h(p)==item['sha256'] and st.st_dev==item['dev'] and st.st_ino==item['ino'],name
baseline=json.loads((o/'baseline.json').read_text());head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
assert head==baseline['head'] and (r/'VERSION').read_text().strip()==baseline['version']
subprocess.run(['git','diff','--check'],check=True,stdout=subprocess.DEVNULL)
# Markdown links are repository navigation; source examples and external URLs
# are not local documents. Keep all historical files unchanged while checking.
files=list((r/'docs').rglob('*.md'))+list((r/'.github').rglob('*.md'))+[r/'README.md',r/'engine/README.md',r/'desktop/README.md',r/'mobile/README.md']
links=anchors=0; errors=[];heading_cache={}
def slugs(file):
 if file in heading_cache:return heading_cache[file]
 text=file.read_text();text=re.sub(r'```[^\n]*\n[\s\S]*?```','',text);found=set();counts={}
 for line in text.splitlines():
  m=re.match(r'^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$',line)
  if not m:continue
  value=re.sub(r'<[^>]*>','',m.group(1));value=re.sub(r'\[([^]]+)\]\([^)]*\)',r'\1',value)
  value=value.lower();value=''.join(c for c in value if c.isalnum() or c in ' _-');value=value.replace(' ','-');num=counts.get(value,0);counts[value]=num+1;found.add(value if not num else f'{value}-{num}')
 for m in re.finditer(r'(?:id|name)=["\']([^"\']+)',text):found.add(m.group(1))
 heading_cache[file]=found;return found
for file in files:
 text=file.read_text();text=re.sub(r'```[^\n]*\n[\s\S]*?```','',text)
 for match in re.finditer(r'(?<!!)\[[^\]]*\]\(([^\s)]+)(?:\s+["\'][^)]*["\'])?\)',text):
  target=match.group(1).strip('<>');u=urllib.parse.urlsplit(target)
  if u.scheme or u.netloc or target.startswith('/') or '${' in target:continue
  path=urllib.parse.unquote(u.path);anchor=urllib.parse.unquote(u.fragment);dest=(file.parent/path).resolve() if path else file
  links+=1
  if not dest.exists():errors.append({'file':str(file.relative_to(r)),'target':target,'reason':'missing'});continue
  if anchor and dest.suffix=='.md':
   anchors+=1
   if anchor not in slugs(dest):errors.append({'file':str(file.relative_to(r)),'target':target,'reason':'anchor'})
assert not errors,json.dumps(errors,ensure_ascii=False,indent=2)
result={'ok':True,'sourceFiles':len(source),'historicalFiles':len(hist),'protected':protected,'oldAtlasPrefixesAndScores':'unchanged','head':head,'version':baseline['version'],'markdownLinks':links,'markdownAnchors':anchors,'sourceDrift':0,'historicalDrift':0,'diffWhitespace':'passed','atlas':'old prefixes and scoring cells byte-equivalent; new independent authoring workflow slice appended','coreSourceChanges':corechanged,'wasm':'retained bytes and build metadata unchanged','oldSceneSourceChanges':scenechanged,'retainedTools':4,'artifactsRemoved':json.loads((o/'cleanup.json').read_text()) if (o/'cleanup.json').exists() else 'not yet cleaned'}
(o/'final-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k not in ['artifactsRemoved']},ensure_ascii=False))
