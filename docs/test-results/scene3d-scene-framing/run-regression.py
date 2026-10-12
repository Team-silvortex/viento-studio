from pathlib import Path
import subprocess,json,re,datetime,hashlib
S=Path('/tmp/viento-scene3d-framing-xmbbbvr9/project');O=S/'docs/test-results/scene3d-scene-framing';NODE='/home/chiharukiryu/.local/share/nodejs/node-v24.21.0-linux-x64/bin/node'
names=['scene3d-scene-framing-math','scene3d-scene-framing-renderer','scene3d-math-navigation','scene3d-renderer','scene3d-picking','scene3d-navigation','scene3d-navigation-source-host','scene3d-preview-ui','scene3d-system-ports','scene3d-module-boundary','studio-system-ui','studio-modules','i18n','scene3d']
results=[]
for name in names:
 p=S/'scripts/tests'/f'{name}.test.mjs';result=subprocess.run([NODE,str(p)],cwd=S,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT);log=O/(name+'.log');log.write_text(result.stdout)
 counts={}
 for key in ['tests','pass','fail','cancelled','skipped','todo']:
  matches=re.findall(r'(?:ℹ|#) '+key+r' (\d+)',result.stdout);assert matches,(name,key,result.stdout[-1000:]);counts[key]=int(matches[-1])
 row={'file':p.relative_to(S).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'exitCode':result.returncode,'log':log.name,**counts};results.append(row)
 if result.returncode or any(counts[k] for k in ['fail','cancelled','skipped','todo']):
  (O/'regression-initial-failure.json').write_text(json.dumps(results,indent=2)+'\n');raise SystemExit('Regression failed: '+name)
report={'ok':True,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'node':NODE,'scope':'Relevant view math/rendering, readonly navigation/host, module assembly, model and translation regressions; not the full application suite or new Rust execution.','files':results,'tests':sum(r['tests'] for r in results),'pass':sum(r['pass'] for r in results),'fail':0,'skipped':0}
(O/'regression.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='files'}))
