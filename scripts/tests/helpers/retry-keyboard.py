# Synthetic X11 keyboard events in a real Godot window, on an isolated Xvfb.
import ctypes as c
import json
import pathlib
import subprocess
import sys
import threading
import time

executable, directory, output = sys.argv[1:]
output = pathlib.Path(output); output.mkdir(parents=True, exist_ok=True)
assembly = json.loads((pathlib.Path(directory) / 'assembly.json').read_text())
ids = [row['sceneId'] for row in assembly['scenes']]
p = subprocess.Popen([executable, '--path', directory, 'res://retry-probe.tscn'], cwd=directory,
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
lines, samples, actions, stages = [], [], [], []
def consume():
    for line in p.stdout:
        lines.append(line.rstrip())
        if line.startswith('RETRY_SAMPLE:'):
            samples.append(json.loads(line[len('RETRY_SAMPLE:'):]))
thread = threading.Thread(target=consume, daemon=True); thread.start()
x = c.CDLL('libX11.so.6'); xt = c.CDLL('libXtst.so.6')
x.XOpenDisplay.argtypes=[c.c_char_p]; x.XOpenDisplay.restype=c.c_void_p
x.XDefaultRootWindow.argtypes=[c.c_void_p]; x.XDefaultRootWindow.restype=c.c_ulong
x.XQueryTree.argtypes=[c.c_void_p,c.c_ulong,c.POINTER(c.c_ulong),c.POINTER(c.c_ulong),c.POINTER(c.POINTER(c.c_ulong)),c.POINTER(c.c_uint)]
x.XFetchName.argtypes=[c.c_void_p,c.c_ulong,c.POINTER(c.c_char_p)]
x.XSetInputFocus.argtypes=[c.c_void_p,c.c_ulong,c.c_int,c.c_ulong]
x.XGetInputFocus.argtypes=[c.c_void_p,c.POINTER(c.c_ulong),c.POINTER(c.c_int)]
x.XKeysymToKeycode.argtypes=[c.c_void_p,c.c_ulong]; x.XKeysymToKeycode.restype=c.c_ubyte
x.XFlush.argtypes=[c.c_void_p]; x.XSync.argtypes=[c.c_void_p,c.c_int]
x.XFree.argtypes=[c.c_void_p]
x.XCreateSimpleWindow.argtypes=[c.c_void_p,c.c_ulong,c.c_int,c.c_int,c.c_uint,c.c_uint,c.c_uint,c.c_ulong,c.c_ulong]; x.XCreateSimpleWindow.restype=c.c_ulong
x.XMapWindow.argtypes=[c.c_void_p,c.c_ulong]; x.XDestroyWindow.argtypes=[c.c_void_p,c.c_ulong]
xt.XTestFakeKeyEvent.argtypes=[c.c_void_p,c.c_uint,c.c_int,c.c_ulong]
d=x.XOpenDisplay(None); dummy=0; started=time.monotonic()
def wait(predicate, label, seconds=8):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        if predicate(): return
        if p.poll() is not None: raise AssertionError(label+': Godot exited early\n'+'\n'.join(lines))
        time.sleep(.02)
    raise AssertionError(label+': timeout\n'+'\n'.join(lines[-35:]))
def key(symbol, down):
    code=x.XKeysymToKeycode(d,symbol); assert code
    assert xt.XTestFakeKeyEvent(d,code,down,0); x.XFlush(d)
    actions.append({'symbol':hex(symbol),'down':bool(down),'seconds':round(time.monotonic()-started,3)})
def tap(symbol):
    key(symbol,1); time.sleep(.08); key(symbol,0); time.sleep(.12)
def stage(label, scene, visit, pause=.2):
    wait(lambda:samples and samples[-1]['sceneId']==scene and samples[-1]['visit']==visit,label)
    time.sleep(pause)
    assert samples[-1]['sceneId']==scene and samples[-1]['visit']==visit,label+': unexpected navigation '+repr(samples[-1])
    stages.append({'label':label,'sample':samples[-1]})
def move_focus(window, focused):
    x.XSetInputFocus(d,window if focused else dummy,1,0); x.XSync(d,0)
    wait(lambda:samples and samples[-1]['focused']==focused,'focus transition')
try:
    assert d,'cannot open isolated display'
    root=x.XDefaultRootWindow(d); window=0
    for _ in range(120):
        r=c.c_ulong(); parent=c.c_ulong(); children=c.POINTER(c.c_ulong)(); count=c.c_uint()
        assert x.XQueryTree(d,root,c.byref(r),c.byref(parent),c.byref(children),c.byref(count))
        for index in range(count.value):
            name=c.c_char_p()
            if x.XFetchName(d,children[index],c.byref(name)) and name.value:
                title=name.value.decode(errors='replace'); x.XFree(name)
                if assembly['assembly']['title'] in title: window=children[index]; break
        if children: x.XFree(children)
        if window and samples: break
        if p.poll() is not None: raise AssertionError('Godot exited before window\n'+'\n'.join(lines))
        time.sleep(.05)
    assert window and samples,'no Godot window/sample'
    dummy=x.XCreateSimpleWindow(d,root,1000,0,32,32,0,0,0); x.XMapWindow(d,dummy); x.XSync(d,0)
    move_focus(window,True); stage('menu-ready',ids[0],1)
    key(0xff0d,1); time.sleep(.1); key(0x20,1); time.sleep(.1); key(0x20,0)
    stage('mapped-key-held-gui-consumed',ids[0],1)
    key(0xff0d,0); stage('gui-consumed',ids[0],1)
    assert samples[-1]['guiCount']>=1 and samples[-1]['guiOpen']
    key(0xff0d,1); time.sleep(.1); tap(0xffc5)
    wait(lambda:samples and not samples[-1]['guiOpen'],'GUI hidden')
    move_focus(window,False); stage('menu-unfocused-held',ids[0],1)
    move_focus(window,True); stage('menu-refocused-held',ids[0],1,.35)
    key(0xff0d,0); time.sleep(.15); key(0xff0d,1)
    stage('first-game',ids[1],2)
    first=samples[-1]; assert first['state']['score']==0 and first['state']['health']==100 and first['state']['level']==1 and first['state']['key_found'] is False
    tap(ord('m')); wait(lambda:samples and samples[-1]['state'].get('score')==75,'gameplay state mutation')
    key(0xff53,1); time.sleep(.45); key(0xff53,0)
    wait(lambda:samples and samples[-1]['position'][0]>first['position'][0]+25,'real actor movement')
    stage('game-dirty-and-moved',ids[1],2)
    assert samples[-1]['audits']==1
    tap(ord('f')); stage('failure-held-retry',ids[2],3,.55)
    dirty=samples[-1]['state']; assert dirty['score']==75 and dirty['health']==12 and dirty['level']==4 and dirty['key_found'] is True
    move_focus(window,False); stage('failure-unfocused-held',ids[2],3)
    move_focus(window,True); stage('failure-refocused-held',ids[2],3,.35)
    key(0xff0d,0); time.sleep(.15); key(0xff0d,1)
    stage('game-retried',ids[1],4,.4); key(0xff0d,0)
    reset=samples[-1]; assert reset['state']=={'health':100,'key_found':False,'level':1,'progress':'checkpoint-7','score':0},repr(reset)
    assert reset['audits']==0 and reset['actorId']!=first['actorId'] and reset['gameBehaviorId']!=first['gameBehaviorId'] and reset['hudId']!=first['hudId']
    assert reset['position']==first['position'],(reset,first)
    tap(0xff1b); assert p.wait(timeout=8)==0,'\n'.join(lines); thread.join(timeout=2)
    assert not any('SCRIPT ERROR:' in line or 'ERROR:' in line for line in lines),'\n'.join(lines)
    print(json.dumps({'scope':'Real Godot window; synthetic XTest keyboard in isolated software-rendered Xvfb, no physical-device claim','stages':stages,'samples':samples,'actions':actions,'exitCode':p.returncode}))
finally:
    if d:
        for symbol in [0xff0d,0x20,0xff53,ord('m'),ord('f'),0xff1b,0xffc5]:
            code=x.XKeysymToKeycode(d,symbol)
            if code: xt.XTestFakeKeyEvent(d,code,0,0)
        x.XSync(d,0)
        if dummy:x.XDestroyWindow(d,dummy)
    if p.poll() is None:
        p.terminate()
        try:p.wait(timeout=5)
        except subprocess.TimeoutExpired:p.kill();p.wait()
    if lines:(output/'window-output.log').write_text('\n'.join(lines)+'\n')
