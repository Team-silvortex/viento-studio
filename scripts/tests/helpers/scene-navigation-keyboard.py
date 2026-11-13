# Real Godot window under isolated Xvfb; XTest synthesizes X11 keyboard events.
# This is not a claim about a physical keyboard or the user's desktop.
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
p = subprocess.Popen([executable, '--path', directory, 'res://navigation-probe.tscn'], cwd=directory,
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
lines, samples, actions, stages = [], [], [], []
def consume():
    for line in p.stdout:
        lines.append(line.rstrip())
        if line.startswith('NAV_SAMPLE:'):
            samples.append(json.loads(line[len('NAV_SAMPLE:'):]))
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
d = x.XOpenDisplay(None); dummy = 0; start = time.monotonic()
def wait(predicate, label, seconds=8):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        if predicate(): return
        if p.poll() is not None: raise AssertionError(label + ': Godot exited early\n' + '\n'.join(lines))
        time.sleep(.02)
    raise AssertionError(label + ': timeout\n' + '\n'.join(lines[-30:]))
def key(sym, down):
    code = x.XKeysymToKeycode(d, sym); assert code
    assert xt.XTestFakeKeyEvent(d, code, down, 0); x.XFlush(d)
    actions.append({'symbol':hex(sym),'down':bool(down),'seconds':round(time.monotonic()-start,3)})
def tap(sym):
    key(sym, 1); time.sleep(.08); key(sym, 0); time.sleep(.12)
def stage(label, scene, pause=.2):
    wait(lambda: samples and samples[-1]['sceneId']==scene, label)
    time.sleep(pause)
    assert samples[-1]['sceneId']==scene, label + ': unexpected scene chain ' + repr(samples[-1])
    stages.append({'label':label,'sample':samples[-1]})
try:
    assert d, 'cannot open isolated display'
    root = x.XDefaultRootWindow(d); window = 0
    for _ in range(120):
        r=c.c_ulong(); parent=c.c_ulong(); children=c.POINTER(c.c_ulong)(); count=c.c_uint()
        assert x.XQueryTree(d,root,c.byref(r),c.byref(parent),c.byref(children),c.byref(count))
        for i in range(count.value):
            name=c.c_char_p()
            if x.XFetchName(d,children[i],c.byref(name)) and name.value:
                title=name.value.decode(errors='replace'); x.XFree(name)
                if assembly['assembly']['title'] in title: window=children[i]; break
        if children: x.XFree(children)
        if window and samples: break
        if p.poll() is not None: raise AssertionError('Godot exited before window\n'+'\n'.join(lines))
        time.sleep(.05)
    assert window and samples, 'no Godot window/sample\n'+'\n'.join(lines)
    x.XSetInputFocus(d,window,1,0); x.XSync(d,0)
    focus=c.c_ulong(); revert=c.c_int(); x.XGetInputFocus(d,c.byref(focus),c.byref(revert)); assert focus.value==window
    stage('menu-ready',ids[0])
    # Focused GUI Button consumes both mapped physical keys. Observe Godot's
    # own action state when one key is released while another remains held.
    key(0xff0d,1); time.sleep(.1); key(0x20,1); time.sleep(.1); key(0x20,0)
    stage('one-mapped-key-released-other-held',ids[0])
    key(0xff0d,0); stage('gui-consumed',ids[0])
    assert samples[-1]['guiCount']>=1 and samples[-1]['guiOpen']
    # Keep Enter held, hide only the test GUI via F8, lose and regain actual
    # X11 focus, and prove that the old key/candidate is not replayed.
    key(0xff0d,1); time.sleep(.1); tap(0xffc5)
    wait(lambda: samples and not samples[-1]['guiOpen'], 'test GUI hidden')
    dummy=x.XCreateSimpleWindow(d,root,1000,0,32,32,0,0,0); x.XMapWindow(d,dummy); x.XSync(d,0)
    x.XSetInputFocus(d,dummy,1,0); x.XSync(d,0)
    wait(lambda: samples and not samples[-1]['focused'], 'focus exited')
    stage('unfocused-held',ids[0])
    x.XSetInputFocus(d,window,1,0); x.XSync(d,0)
    wait(lambda: samples and samples[-1]['focused'], 'focus entered')
    stage('refocused-held',ids[0],.35)
    key(0xff0d,0); time.sleep(.15)
    # Enter stays down across Game -> Results. Results must wait for release.
    key(0xff0d,1); stage('game-from-action',ids[1])
    tap(ord('g')); stage('results-held-action',ids[2],.65)
    key(0xff0d,0); time.sleep(.15)
    key(0xff0d,1); stage('menu-reentered-held-action',ids[0],.4)
    key(0xff0d,0); time.sleep(.15)
    key(0xff0d,1); stage('game-second-visit',ids[1]); key(0xff0d,0); time.sleep(.1)
    tap(ord('g')); stage('results-second-visit',ids[2])
    tap(0xff1b)
    assert p.wait(timeout=8)==0, '\n'.join(lines)
    thread.join(timeout=2)
    assert not any('SCRIPT ERROR:' in line or 'ERROR:' in line for line in lines), '\n'.join(lines)
    (output/'window-output.log').write_text('\n'.join(lines)+'\n')
    print(json.dumps({'scope':'XTest synthetic X11 keyboard in a real Godot window; software Xvfb rendering; no physical-device claim','focus':True,'stages':stages,'samples':samples,'actions':actions,'exitCode':p.returncode}))
finally:
    if d:
        for symbol in [0xff0d,0x20,ord('g'),0xff1b,0xffc5]:
            code=x.XKeysymToKeycode(d,symbol)
            if code: xt.XTestFakeKeyEvent(d,code,0,0)
        x.XSync(d,0)
        if dummy: x.XDestroyWindow(d,dummy)
    if p.poll() is None:
        p.terminate()
        try: p.wait(timeout=5)
        except subprocess.TimeoutExpired: p.kill(); p.wait()
    if lines: (output/'window-output.log').write_text('\n'.join(lines)+'\n')
