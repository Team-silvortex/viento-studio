# Isolated Xvfb keyboard integration; prints only synthetic-fixture evidence.
import ctypes as c
import json
import os
import subprocess
import sys
import threading
import time

executable, directory = sys.argv[1:]
p = subprocess.Popen([executable, '--path', directory], cwd=directory,
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
lines, samples = [], []
def consume():
    for line in p.stdout:
        lines.append(line.rstrip())
        if line.startswith('MAP_SAMPLE:'):
            samples.append(json.loads(line[len('MAP_SAMPLE:'):]))
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
x.XFree.argtypes=[c.c_void_p]; xt.XTestFakeKeyEvent.argtypes=[c.c_void_p,c.c_uint,c.c_int,c.c_ulong]
d = x.XOpenDisplay(None)
try:
    assert d, 'cannot open isolated display'
    root = x.XDefaultRootWindow(d); window = 0
    for _ in range(120):
        if p.poll() is not None: raise AssertionError('Godot exited early: ' + '\n'.join(lines))
        r=c.c_ulong(); parent=c.c_ulong(); children=c.POINTER(c.c_ulong)(); count=c.c_uint()
        assert x.XQueryTree(d,root,c.byref(r),c.byref(parent),c.byref(children),c.byref(count))
        for i in range(count.value):
            name=c.c_char_p()
            if x.XFetchName(d,children[i],c.byref(name)) and name.value:
                title=name.value.decode(errors='replace'); x.XFree(name)
                if 'godot' in title.lower() or 'viento' in title.lower(): window=children[i]; break
        if children: x.XFree(children)
        if window and samples: break
        time.sleep(.1)
    assert window and samples, 'no Godot window/samples: ' + '\n'.join(lines)
    x.XSetInputFocus(d,window,1,0); x.XSync(d,0)
    focus=c.c_ulong(); revert=c.c_int(); x.XGetInputFocus(d,c.byref(focus),c.byref(revert))
    assert focus.value == window, 'window has no keyboard focus'
    def key(sym,down):
        code=x.XKeysymToKeycode(d,sym); assert code
        assert xt.XTestFakeKeyEvent(d,code,down,0); x.XFlush(d)
    time.sleep(.4); baseline=samples[-1]
    key(ord('d'),1); time.sleep(.7); key(ord('d'),0); time.sleep(.2); after_d=samples[-1]
    key(ord('j'),1); time.sleep(.7); key(ord('j'),0); time.sleep(.2); after_j=samples[-1]
    if any('SCRIPT ERROR' in line or 'ERROR:' in line for line in lines): raise AssertionError('\n'.join(lines))
    print(json.dumps({'baseline':baseline,'afterD':after_d,'afterJ':after_j,'sampleCount':len(samples),'focus':True}))
finally:
    p.terminate()
    try: p.wait(timeout=5)
    except subprocess.TimeoutExpired: p.kill(); p.wait()
