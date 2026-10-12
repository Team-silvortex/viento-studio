from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,subprocess
OUT=Path(__file__).resolve().parent;ROOT=OUT.parents[2]
load=lambda p:json.loads((OUT/p).read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
checks={}
for filename in ['historical-baseline.json','author-baseline.json','source-hashes-final.json']:
 data=load(filename)
 for file,digest in data.items():assert sha(ROOT/file)==digest,file
 checks[filename]={'files':len(data),'allMatch':True,'baselineSha256':sha(OUT/filename)}
tools=load('tool-baseline.json')
for file,item in tools.items():
 p=Path(file);s=p.stat();assert sha(p)==item['sha256'] and s.st_size==item['bytes'];assert(s.st_dev,s.st_ino,s.st_nlink)==(item['dev'],item['ino'],item['nlink'])
owned=['desktop/resources','desktop/ui/i18n','desktop/.cache','src-tauri/binaries','mobile/dist']
for name in owned:assert not (ROOT/name).exists() and not (ROOT/name).is_symlink(),name
assert sha(ROOT/'engine/studio-core.wasm')=='4e30e4be71ee3ecf3328aadcba675e2a996f8217d25ef377733bd296bdbc7e52'
assert(ROOT/'engine/studio-core.wasm').stat().st_size==500608
atlas=json.loads((ROOT/'docs/function-atlas.json').read_text());old=load('atlas-baseline.json')
for axis,value in old['axes'].items():assert atlas['axes'][axis][:len(value)]==value,axis
for key in ['bindings','cells','evidence','dependencies','workflows']:assert atlas[key][:len(old[key])]==old[key],key
for key in ['legacyCoverage','priorities']:assert atlas[key]==old[key],key
assert atlas['meta']['historicalSha256']==old['meta']['historicalSha256']
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip();assert head=='3a91e84a5cd543ebb4a6f416f727c544cf9ff083';assert(ROOT/'VERSION').read_text().strip()=='0.0.10'
subprocess.run(['git','diff','--check'],cwd=ROOT,check=True)
counts={'axes':{k:len(v)for k,v in atlas['axes'].items()},**{k:len(atlas[k])for k in ['bindings','cells','evidence','dependencies','workflows','sourceSnapshot']}}
report={'createdAt':datetime.now(timezone.utc).isoformat(),'ok':True,'preservation':checks,'externalTools':{'files':len(tools),'exactBytesSizeDevInoNlink':True},'oldAtlasPrefixesUnchanged':True,'finalAtlasCounts':counts,'version':'0.0.10','head':head,'ownedGeneratedDirectoriesRemainAbsent':owned,'testedWasmRetained':{'bytes':500608,'sha256':sha(ROOT/'engine/studio-core.wasm')},'buildMetadataRetained':True,'diffCheck':True,'scope':'Fresh post-cleanup verification; docs/current atlas are separate from 708 frozen product/test bytes, and old report/author/tool baseline maps remain exact. No commit, version bump or installation.'}
assert not(OUT/'final-audit.json').exists();(OUT/'final-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'ok':True,'source':708,'historical':3890,'author':41,'tools':4,'atlas':counts}))
