from pathlib import Path
import datetime,hashlib,json,os,re,subprocess,concurrent.futures
root=Path('/home/chiharukiryu/cdev/viento-studio');out=Path('/tmp/viento-project-menu-legacy-final');out.mkdir(exist_ok=True)
base=json.loads(Path('/tmp/viento-project-menu-full-final/sources-before.json').read_text())
def hashes():return {p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in base}
before=hashes();(out/'sources-before.json').write_text(json.dumps(before,indent=2)+'\n')
env=dict(os.environ);env['PATH']='/home/chiharukiryu/.local/share/nodejs/node-v24.21.0-linux-x64/bin:'+env.get('PATH','');env['VIENTO_GODOT_BIN']='/home/chiharukiryu/.cache/io.viento.studio/toolchains/godot/4.7.2-viento-audiofix1/linux-x86_64/Godot_v4.7.2-viento-audiofix1_linux.x86_64';env['VIENTO_XVFB_TEST']='1';env['LIBGL_ALWAYS_SOFTWARE']='1';env['GODOT_SILENCE_ROOT_WARNING']='1'
groups={'legacy': ['godot4-camera2d-limits-native.test.mjs','godot4-camera2d-native.test.mjs','godot4-hud2d-native.test.mjs','project-scene-switching-godot.test.mjs','godot-project-pause-native.test.mjs'],'animation':['animation-selectors-godot.test.mjs','animation-combinations-godot.test.mjs']}
def run(pair):
 name,files=pair;command=['xvfb-run','-a','-s','-screen 0 1280x800x24','node','--test','--test-reporter=tap','--test-concurrency=1']+['scripts/tests/'+f for f in files]
 receipt={'name':name,'command':command,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 with (out/(name+'.log')).open('w') as log:result=subprocess.run(command,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
 text=(out/(name+'.log')).read_text();counts={key:int(m.group(1)) for key in ['tests','pass','fail','cancelled','skipped','todo'] if (m:=re.search(r'^# '+key+r' (\d+)$',text,re.M))}
 receipt.update({'returncode':result.returncode,'endedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'counts':counts});(out/(name+'.json')).write_text(json.dumps(receipt,indent=2)+'\n');return receipt
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(run,groups.items()))
after=hashes();(out/'sources-after.json').write_text(json.dumps(after,indent=2)+'\n')
status={'results':results,'sourceFiles':len(before),'sourcesUnchanged':before==after,'changedSources':[p for p in before if before[p]!=after[p]],'ok':all(x['returncode']==0 and x['counts'].get('fail')==0 and x['counts'].get('skipped')==0 for x in results) and before==after}
(out/'status.json').write_text(json.dumps(status,indent=2)+'\n');print(json.dumps(status));raise SystemExit(0 if status['ok'] else 1)
