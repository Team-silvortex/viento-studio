import subprocess,pathlib,concurrent.futures,json
labels=[kind+'-'+seed+'-'+phase for kind in ['stock','custom'] for seed in ['fresh','seeded'] for phase in ['running','paused']]
def run(label):
 p=subprocess.run(['xvfb-run','-a','-s','-screen 0 640x480x24','python','/tmp/viento-wm-stock-single.py',label],capture_output=True,text=True,timeout=20)
 pathlib.Path('/tmp/viento-wm-stock-comparison-matrix/'+label+'/launcher.log').write_text(p.stdout+p.stderr)
 return {'label':label,'exit':p.returncode,'report':json.loads(p.stdout) if p.returncode==0 else p.stdout+p.stderr}
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(run,labels))
report={'ok':all(r['exit']==0 for r in results),'results':results}
pathlib.Path('/tmp/viento-wm-stock-comparison-matrix/report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
for r in results:
 if r['exit']==0:
  t=r['report'];print(json.dumps({k:t[k] for k in ['label','initialAtoms','wmProtocols','closedByRealDelete','exitAfterDelete','closeSignal']},ensure_ascii=False))
 else: print(json.dumps(r,ensure_ascii=False))
