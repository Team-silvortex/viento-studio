"""Synthetic XTest keys drive real native physics. Observer only reads the game."""
import ctypes as c,json,pathlib,subprocess,sys,threading,time
executable,directory,output=sys.argv[1:]
out=pathlib.Path(output);out.mkdir(parents=True,exist_ok=True)
p=subprocess.Popen([executable,'--path',directory,'res://topdown-observer.tscn'],cwd=directory,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
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
def ident(n):return 'c011ec70-2026-4113-8113-'+str(n).zfill(12)
def wait(predicate,label,seconds=8):
 deadline=time.monotonic()+seconds
 while time.monotonic()<deadline:
  if predicate():return
  if p.poll() is not None:raise AssertionError(label+': early exit\n'+'\n'.join(lines[-35:]))
  time.sleep(.015)
 raise AssertionError(label+': timeout '+repr(samples[-1:] )+'\n'+'\n'.join(lines[-15:]))
def key(symbol,down):
 code=x.XKeysymToKeycode(d,symbol);assert code
 assert xt.XTestFakeKeyEvent(d,code,down,0);x.XFlush(d)
 if down:held.add(symbol)
 else:held.discard(symbol)
 actions.append({'symbol':hex(symbol),'down':bool(down),'seconds':round(time.monotonic()-started,3)})
def tap(symbol):
 key(symbol,1);time.sleep(.09);key(symbol,0);time.sleep(.15)
def last():return samples[-1]
def state():return last()['state']
def actor(n):return last()['actors'][ident(n)]
def position():return actor(301)['position']
def stage(label,scene,visit):
 wait(lambda:samples and last()['sceneId']==ident(scene) and last()['visit']==visit,label)
 time.sleep(.12);assert last()['sceneId']==ident(scene) and last()['visit']==visit
 stages.append({'label':label,'sample':last()})
def move_axis(axis,target,blocked=False):
 before=position()[axis];delta=target-before
 if abs(delta)<5:return
 symbol=(0xff53 if delta>0 else 0xff51) if axis==0 else (0xff54 if delta>0 else 0xff52)
 key(symbol,1)
 try:
  deadline=time.monotonic()+max(2.5,abs(delta)/180+1)
  while time.monotonic()<deadline:
   if last()['sceneId']!=ident(31):return
   value=position()[axis]
   if (value>=target-5 if delta>0 else value<=target+5):return
   time.sleep(.015)
  assert blocked,'movement blocked before target: '+repr((axis,target,position()))
 finally:key(symbol,0);time.sleep(.12)
def move(xv,yv):
 move_axis(0,xv)
 if last()['sceneId']==ident(31):move_axis(1,yv)
try:
 assert d,'isolated display unavailable'
 root=x.XDefaultRootWindow(d);window=0
 for _ in range(160):
  r=c.c_ulong();parent=c.c_ulong();children=c.POINTER(c.c_ulong)();count=c.c_uint()
  x.XQueryTree(d,root,c.byref(r),c.byref(parent),c.byref(children),c.byref(count))
  for i in range(count.value):
   name=c.c_char_p()
   if x.XFetchName(d,children[i],c.byref(name)) and name.value:
    title=name.value.decode(errors='replace');x.XFree(name)
    if 'Crystal Courtyard' in title:window=children[i];break
  if children:x.XFree(children)
  if window:break
  time.sleep(.05)
 assert window,'native game window unavailable'
 x.XSetInputFocus(d,window,1,0);x.XSync(d,0)
 stage('start',30,1);tap(0xff0d);stage('first-attempt',31,2)
 assert state()=={'score':0,'health':3,'door_open':False},state()
 move(140,560);move_axis(0,1120,blocked=True)
 assert 1020<position()[0]<1080 and state()['score']==0 and not state()['door_open'],last()
 stages.append({'label':'locked-door-real-collision','sample':last()})
 move(300,560);move(300,240);wait(lambda:state()['score']==1,'first crystal')
 assert not actor(302)['visible']
 move(300,480);move(570,480);wait(lambda:state()['score']==2,'second crystal')
 move(450,480);move(570,480);assert state()['score']==2,'duplicate collection'
 stages.append({'label':'second-crystal-once','sample':last()})
 move(800,480);move(800,200);move(900,200);move(900,240)
 wait(lambda:state()['score']==3 and state()['door_open'],'third crystal unlocks door')
 wait(lambda:actor(306)['collisionLayer']==0 and not actor(306)['visible'],'door physically opens')
 assert all(not actor(n)['visible'] for n in [302,303,304])
 stages.append({'label':'all-crystals-door-open','sample':last()})
 move(1180,240);move(1180,380);stage('victory',32,3)
 assert state()['score']==3 and state()['health']==3,state()
 tap(0xff0d);stage('win-retry',31,4)
 assert state()=={'score':0,'health':3,'door_open':False}
 assert all(actor(n)['visible'] for n in [302,303,304,306])
 assert abs(position()[0]-140)<1 and abs(position()[1]-380)<1
 move(600,380);move(600,300);wait(lambda:state()['health']==2,'first hazard entry')
 time.sleep(.65);assert state()['health']==2,'stationary hazard repeated'
 stages.append({'label':'hazard-entry-once','sample':last()})
 move(760,300);move(600,300);wait(lambda:state()['health']==1,'second hazard entry')
 move(760,300);move(600,300);stage('failure',33,5)
 assert state()['health']==0
 tap(0xff0d);stage('failure-retry',31,6)
 assert state()=={'score':0,'health':3,'door_open':False}
 assert all(actor(n)['visible'] for n in [302,303,304,306])
 tap(0xff1b);assert p.wait(timeout=8)==0
 thread.join(timeout=2)
 assert not any('SCRIPT ERROR:' in line or 'ERROR:' in line for line in lines),'\n'.join(lines)
 result={'scope':'Real Godot window with synthetic XTest arrows/Enter; read-only external observer, no physical-device claim','stages':stages,'samples':samples,'actions':actions,'exitCode':p.returncode}
 (out/'keyboard.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({'stages':len(stages),'samples':len(samples),'exitCode':p.returncode}))
finally:
 if d:
  for symbol in list(held):
   code=x.XKeysymToKeycode(d,symbol)
   if code:xt.XTestFakeKeyEvent(d,code,0,0)
  x.XSync(d,0)
 if p.poll() is None:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
 thread.join(timeout=2)
 (out/'window-output.log').write_text('\n'.join(lines)+'\n')
