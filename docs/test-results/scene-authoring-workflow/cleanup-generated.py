from pathlib import Path
import json,hashlib,os,shutil,stat,datetime
r=Path.cwd();o=r/'docs/test-results/scene-authoring-workflow';initial=json.loads((o/'generated-paths-initial.json').read_text())
paths=['desktop/resources','desktop/ui/i18n','desktop/.cache','src-tauri/binaries','mobile/dist','/tmp/viento-scene-authoring-workflow-native-target','/tmp/viento-scene-authoring-workflow-wasm-target','/tmp/viento-scene-authoring-workflow-core-target']
assert json.loads((o/'packaged-resources.json').read_text())['ok']
log=(o/'app-check.log').read_text();assert 'ℹ fail 0' in log and 'ℹ skipped 0' in log
for item in json.loads((o/'native-helpers.json').read_text())['binaries']:
 p=Path(item['path']);assert p.stat().st_size==item['bytes'] and hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256']
seen=set();items=[]
for name in paths:
 p=(r/name).resolve() if not name.startswith('/') else Path(name)
 assert name in initial and not initial[name]['exists'],name
 if not p.exists():continue
 assert not p.is_symlink() and p.is_dir(),name
 before=0;files=0
 for directory,dirs,names in os.walk(p,followlinks=False):
  for child in [Path(directory)]+[Path(directory)/name for name in names]:
   st=child.lstat();key=(st.st_dev,st.st_ino)
   if key not in seen:seen.add(key);before+=st.st_blocks*512
   if stat.S_ISREG(st.st_mode):files+=1
 shutil.rmtree(p);assert not p.exists()
 items.append({'path':name,'allocatedBytes':before,'regularFiles':files,'ownership':'baseline absent; generated only for this slice'})
result={'ok':True,'removed':items,'allocatedBytes':sum(i['allocatedBytes'] for i in items),'scope':'Only generated directories belonging to this slice. Author examples, historical reports, dependencies, retained tools, retained unchanged WASM and current installed apps/preferences stay in place.','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(o/'cleanup.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'removedDirectories':len(items),'allocatedBytes':result['allocatedBytes'],'GiB':round(result['allocatedBytes']/2**30,3)}))
