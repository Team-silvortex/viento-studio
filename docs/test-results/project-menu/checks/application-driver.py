from pathlib import Path
import datetime,hashlib,json,os,subprocess,re
root=Path('/home/chiharukiryu/cdev/viento-studio');out=Path('/tmp/viento-project-menu-full-final');out.mkdir(exist_ok=True)
paths=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=root).decode().split('\0')
paths=sorted({p for p in paths if p and (p in ['VERSION','package.json','package-lock.json'] or p.startswith(('engine/','scripts/','web/','examples/','desktop/','mobile/','crates/','src-tauri/'))) and (root/p).is_file() and not p.startswith(('desktop/dist/','mobile/dist/')) and not p.endswith('.md')})
def hashes():return {p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in paths}
before=hashes();(out/'sources-before.json').write_text(json.dumps(before,indent=2)+'\n')
env=dict(os.environ);env['PATH']='/home/chiharukiryu/.local/share/nodejs/node-v24.21.0-linux-x64/bin:'+env.get('PATH','')
status={'version':(root/'VERSION').read_text().strip(),'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':['npm','run','check','--','--app-only'],'sourceFiles':len(before)}
(out/'status.json').write_text(json.dumps(status,indent=2)+'\n')
with (out/'check.log').open('w') as log:result=subprocess.run(status['command'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
after=hashes();(out/'sources-after.json').write_text(json.dumps(after,indent=2)+'\n')
log=(out/'check.log').read_text();counts={key:int(m.group(1)) for key in ['tests','pass','fail','cancelled','skipped','todo'] if (m:=re.search(r'^(?:#|ℹ) '+key+r' (\d+)$',log,re.M))}
status.update({'returncode':result.returncode,'endedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourcesUnchanged':before==after,'changedSources':[p for p in before if before[p]!=after[p]],'counts':counts})
(out/'status.json').write_text(json.dumps(status,indent=2)+'\n');print(json.dumps(status));raise SystemExit(result.returncode or int(before!=after))
