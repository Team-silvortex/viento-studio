from pathlib import Path
import subprocess,os,json,datetime
r=Path('/home/chiharukiryu/.cache/io.viento.studio/toolchains/.build/godot-audio-shutdown');src=r/'godot-ed1daf0bf001b61586d9930840f2f1394092c079'
cmd=['nice','-n','10','/usr/bin/python3','-m','SCons','platform=linuxbsd','target=editor','arch=x86_64','-j3','use_llvm=yes','linker=lld','debug_symbols=no','lto=none']
env={**os.environ,'PATH':'/usr/bin:/bin:'+os.environ.get('PATH',''),'PYTHONPATH':str(r/'scons-site'),'BUILD_NAME':'viento_audiofix1_ed1daf0bf'}
record={'command':cmd,'source':str(src),'buildName':env['BUILD_NAME'],'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(r/'build-command.json').write_text(json.dumps(record,indent=2)+'\n')
with (r/'build.log').open('w') as f: result=subprocess.run(cmd,cwd=src,env=env,stdout=f,stderr=subprocess.STDOUT)
record.update({'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':result.returncode});(r/'build-result.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record),flush=True)
raise SystemExit(result.returncode)
