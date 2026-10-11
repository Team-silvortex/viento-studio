from pathlib import Path
import json,hashlib,os,shutil,stat,datetime
r=Path.cwd();o=r/'docs/test-results/scene-composition-structure';initial=json.loads((o/'generated-paths-initial.json').read_text())
paths=['desktop/resources','desktop/ui/i18n','desktop/.cache','src-tauri/binaries','mobile/dist','/tmp/viento-scene-composition-structure-native-target','/tmp/viento-scene-composition-structure-wasm-target','/tmp/viento-composition-structure-core-target']
# The shorter core directory was created after the baseline under the delegated
# Cargo invocation; kernel birth evidence and fresh CLI bytes preserve ownership.
baseline=json.loads((o/'baseline.json').read_text());birth=(o/'core-target-birth.log').read_text();assert '/tmp/viento-composition-structure-core-target' in birth and 'Birth: 2026-10-11 15:25:59.' in birth
assert baseline['capturedAt'].startswith('2026-10-11T07:22:24.')
assert json.loads((o/'packaged-resources.json').read_text())['ok']
log=(o/'app-check.log').read_text();assert 'ℹ fail 0' in log and 'ℹ skipped 0' in log
for item in json.loads((o/'native-helpers.json').read_text())['binaries']:
 p=Path(item['path']);assert p.stat().st_size==item['bytes'] and hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256']
seen=set();items=[]
for name in paths:
 p=(r/name).resolve() if not name.startswith('/') else Path(name)
 if name!='/tmp/viento-composition-structure-core-target':assert name in initial and not initial[name]['exists'],name
 if not p.exists():continue
 assert not p.is_symlink() and p.is_dir(),name
 before=0;files=0
 for directory,dirs,names in os.walk(p,followlinks=False):
  for child in [Path(directory)]+[Path(directory)/name for name in names]:
   st=child.lstat();key=(st.st_dev,st.st_ino)
   if key not in seen:seen.add(key);before+=st.st_blocks*512
   if stat.S_ISREG(st.st_mode):files+=1
 shutil.rmtree(p);assert not p.exists()
 items.append({'path':name,'allocatedBytes':before,'regularFiles':files,'ownership':'baseline absent' if name in initial else 'new Cargo invocation and post-baseline kernel birth + CLI byte proof'})
result={'ok':True,'removed':items,'allocatedBytes':sum(i['allocatedBytes'] for i in items),'scope':'Only generated directories belonging to this slice. Author examples, historical reports, dependencies, retained tools, shared new WASM and current installed apps/preferences stay in place.','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(o/'cleanup.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'removedDirectories':len(items),'allocatedBytes':result['allocatedBytes'],'GiB':round(result['allocatedBytes']/2**30,3)}))
