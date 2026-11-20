# Only XTest Enter/Escape drive the generated project. The Godot observer reads.
import ctypes as c,json,pathlib,subprocess,sys,threading,time
executable,directory,output=sys.argv[1:];out=pathlib.Path(output);out.mkdir(parents=True,exist_ok=True)
assembly=json.loads((pathlib.Path(directory)/'assembly.json').read_text());member_ids=[r['sceneId'] for r in assembly['scenes']];assert len(member_ids)==2;ids=[assembly['entrySceneId'],next(value for value in member_ids if value!=assembly['entrySceneId'])]
p=subprocess.Popen([executable,'--path',directory,'res://parameter-observer.tscn'],cwd=directory,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
lines=[];samples=[];actions=[];stages=[]
def consume():
 for line in p.stdout:
  lines.append(line.rstrip())
  if line.startswith('TOPDOWN_SAMPLE:'):samples.append(json.loads(line[len('TOPDOWN_SAMPLE:'):]))
thread=threading.Thread(target=consume,daemon=True);thread.start()
x=c.CDLL('libX11.so.6');xt=c.CDLL('libXtst.so.6')
x.XOpenDisplay.argtypes=[c.c_char_p];x.XOpenDisplay.restype=c.c_void_p
x.XDefaultRootWindow.argtypes=[c.c_void_p];x.XDefaultRootWindow.restype=c.c_ulong
x.XQueryTree.argtypes=[c.c_void_p,c.c_ulong,c.POINTER(c.c_ulong),c.POINTER(c.c_ulong),c.POINTER(c.POINTER(c.c_ulong)),c.POINTER(c.c_uint)]
x.XFetchName.argtypes=[c.c_void_p,c.c_ulong,c.POINTER(c.c_char_p)]
x.XSetInputFocus.argtypes=[c.c_void_p,c.c_ulong,c.c_int,c.c_ulong]
x.XKeysymToKeycode.argtypes=[c.c_void_p,c.c_ulong];x.XKeysymToKeycode.restype=c.c_ubyte
x.XFlush.argtypes=[c.c_void_p];x.XSync.argtypes=[c.c_void_p,c.c_int];x.XFree.argtypes=[c.c_void_p]
xt.XTestFakeKeyEvent.argtypes=[c.c_void_p,c.c_uint,c.c_int,c.c_ulong]
d=x.XOpenDisplay(None);started=time.monotonic();held=set()
def wait(predicate,label,seconds=10):
 deadline=time.monotonic()+seconds
 while time.monotonic()<deadline:
  if predicate():return
  if p.poll() is not None:raise AssertionError(label+': early exit\n'+'\n'.join(lines[-30:]))
  time.sleep(.02)
 raise AssertionError(label+': timeout '+repr(samples[-1:])+'\n'+'\n'.join(lines[-20:]))
def key(symbol,down):
 code=x.XKeysymToKeycode(d,symbol);assert code;assert xt.XTestFakeKeyEvent(d,code,down,0);x.XFlush(d)
 if down:held.add(symbol)
 else:held.discard(symbol)
 actions.append({'symbol':hex(symbol),'down':bool(down),'seconds':round(time.monotonic()-started,3)})
def tap(symbol):key(symbol,1);time.sleep(.10);key(symbol,0);time.sleep(.20)
try:
 assert d,'isolated display unavailable';root=x.XDefaultRootWindow(d);window=0
 for _ in range(160):
  r=c.c_ulong();parent=c.c_ulong();children=c.POINTER(c.c_ulong)();count=c.c_uint();x.XQueryTree(d,root,c.byref(r),c.byref(parent),c.byref(children),c.byref(count))
  for i in range(count.value):
   name=c.c_char_p()
   if x.XFetchName(d,children[i],c.byref(name)) and name.value:
    title=name.value.decode(errors='replace');x.XFree(name)
    if assembly['assembly']['title'] in title:window=children[i];break
  if children:x.XFree(children)
  if window:break
  time.sleep(.05)
 assert window,'native project window missing';x.XSetInputFocus(d,window,1,0);x.XSync(d,0)
 wait(lambda:samples and samples[-1]['sceneId']==ids[0] and samples[-1]['visit']==1 and samples[-1]['focused'],'start scene focused')
 time.sleep(.2);stages.append({'label':'start','sample':samples[-1]});assert samples[-1]['state']=={},samples[-1]['state']
 wait(lambda:len(list((out/'frames').glob('*.png')))>=1,'start rendered screenshot')
 tap(0xff0d)
 wait(lambda:samples and samples[-1]['sceneId']==ids[1] and samples[-1]['visit']==2,'real keyboard enters level')
 wait(lambda:any(h['text']=='Health: 3' for h in samples[-1]['hudTexts']) and any(h['text']=='Score: 0' for h in samples[-1]['hudTexts']),'initialized live HUD')
 assert samples[-1]['state']=={'score':0,'health':3},samples[-1]['state'];stages.append({'label':'level-initialized','sample':samples[-1]})
 wait(lambda:len(list((out/'frames').glob('*.png')))>=2,'level rendered screenshot')
 tap(0xff1b);assert p.wait(timeout=10)==0;thread.join(timeout=2)
 assert not any('SCRIPT ERROR:' in line or 'ERROR:' in line for line in lines),'\n'.join(lines)
 result={'scope':'Real generated Godot window; XTest Enter/Escape in Xvfb/Mesa; observer reads only, no runtime or author gameplay patch','stages':stages,'samples':samples,'actions':actions,'exitCode':p.returncode}
 (out/'keyboard.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'stages':len(stages),'samples':len(samples),'screenshots':len(list((out/'frames').glob('*.png'))),'exitCode':p.returncode}))
finally:
 if d:
  for symbol in held:
   code=x.XKeysymToKeycode(d,symbol)
   if code:xt.XTestFakeKeyEvent(d,code,0,0)
  x.XSync(d,0)
 if p.poll() is None:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
 thread.join(timeout=2);(out/'window-output.log').write_text('\n'.join(lines)+'\n')
