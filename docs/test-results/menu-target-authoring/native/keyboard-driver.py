"""Real Godot window with XTest keys. The observer never drives gameplay."""
import ctypes as c
import json
import pathlib
import subprocess
import sys
import threading
import time

executable, directory, output = sys.argv[1:]
flow = json.loads((pathlib.Path(directory)/'menu-targets-flow.json').read_text())
out = pathlib.Path(output)
out.mkdir(parents=True, exist_ok=True)
lines, samples, actions, stages = [], [], [], []
def consume():
    for line in p.stdout:
        lines.append(line.rstrip())
        if line.startswith('MENU_SAMPLE:'):
            samples.append(json.loads(line[len('MENU_SAMPLE:'):]))
thread = threading.Thread(target=consume, daemon=True)
x = c.CDLL('libX11.so.6')
xt = c.CDLL('libXtst.so.6')
x.XOpenDisplay.argtypes = [c.c_char_p]
x.XOpenDisplay.restype = c.c_void_p
x.XDefaultRootWindow.argtypes = [c.c_void_p]
x.XDefaultRootWindow.restype = c.c_ulong
x.XQueryTree.argtypes = [c.c_void_p,c.c_ulong,c.POINTER(c.c_ulong),c.POINTER(c.c_ulong),c.POINTER(c.POINTER(c.c_ulong)),c.POINTER(c.c_uint)]
x.XFetchName.argtypes = [c.c_void_p,c.c_ulong,c.POINTER(c.c_char_p)]
x.XSetInputFocus.argtypes = [c.c_void_p,c.c_ulong,c.c_int,c.c_ulong]
x.XKeysymToKeycode.argtypes = [c.c_void_p,c.c_ulong]
x.XKeysymToKeycode.restype = c.c_ubyte
x.XFlush.argtypes = [c.c_void_p]
x.XSync.argtypes = [c.c_void_p,c.c_int]
x.XFree.argtypes = [c.c_void_p]
x.XCreateSimpleWindow.argtypes = [c.c_void_p,c.c_ulong,c.c_int,c.c_int,c.c_uint,c.c_uint,c.c_uint,c.c_ulong,c.c_ulong]
x.XCreateSimpleWindow.restype = c.c_ulong
x.XMapWindow.argtypes = [c.c_void_p,c.c_ulong]
x.XDestroyWindow.argtypes = [c.c_void_p,c.c_ulong]
xt.XTestFakeKeyEvent.argtypes = [c.c_void_p,c.c_uint,c.c_int,c.c_ulong]
xt.XTestFakeMotionEvent.argtypes = [c.c_void_p,c.c_int,c.c_int,c.c_int,c.c_ulong]
xt.XTestFakeButtonEvent.argtypes = [c.c_void_p,c.c_uint,c.c_int,c.c_ulong]
x.XTranslateCoordinates.argtypes = [c.c_void_p,c.c_ulong,c.c_ulong,c.c_int,c.c_int,c.POINTER(c.c_int),c.POINTER(c.c_int),c.POINTER(c.c_ulong)]
x.XInternAtom.argtypes = [c.c_void_p,c.c_char_p,c.c_int]
x.XInternAtom.restype = c.c_ulong
x.XSendEvent.argtypes = [c.c_void_p,c.c_ulong,c.c_int,c.c_long,c.c_void_p]
x.XGetWMProtocols.argtypes = [c.c_void_p,c.c_ulong,c.POINTER(c.POINTER(c.c_ulong)),c.POINTER(c.c_int)]
class ClientData(c.Union):
    _fields_ = [('b',c.c_char*20),('s',c.c_short*10),('l',c.c_long*5)]
class ClientMessage(c.Structure):
    _fields_ = [('type',c.c_int),('serial',c.c_ulong),('send_event',c.c_int),('display',c.c_void_p),('window',c.c_ulong),('message_type',c.c_ulong),('format',c.c_int),('data',ClientData)]
class XEvent(c.Union):
    _fields_ = [('client',ClientMessage),('pad',c.c_long*24)]
d = x.XOpenDisplay(None)
assert d, 'isolated X display unavailable'
# An ordinary window manager pre-registers ICCCM protocol atoms. Bare Xvfb
# has none; register them before Godot opens its display, keeping this client
# alive so the server does not reset its atom table between initialization.
# Closing still sends the real WM_DELETE_WINDOW ClientMessage to the window.
assert x.XInternAtom(d, b'WM_PROTOCOLS', 0)
assert x.XInternAtom(d, b'WM_DELETE_WINDOW', 0)
p = subprocess.Popen([executable, '--path', directory, 'res://project-menu-observer.tscn'], cwd=directory,
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
thread.start()
dummy = 0
started = time.monotonic()
held = set()
P, SPACE, ENTER, ESCAPE, F8, TAB = ord('p'), 0x20, 0xff0d, 0xff1b, 0xffc5, 0xff09

def last():
    return samples[-1]
def wait(predicate, label, seconds=8):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        if p.poll() is not None:
            raise AssertionError(label + ': early native exit\n' + '\n'.join(lines[-40:]))
        time.sleep(.015)
    raise AssertionError(label + ': timeout ' + repr(samples[-1:]) + '\n' + '\n'.join(lines[-15:]))
def key(symbol, down):
    code = x.XKeysymToKeycode(d, symbol)
    assert code
    assert xt.XTestFakeKeyEvent(d, code, down, 0)
    x.XFlush(d)
    if down:
        held.add(symbol)
    else:
        held.discard(symbol)
    actions.append({'symbol': hex(symbol), 'down': bool(down), 'seconds': round(time.monotonic()-started, 3)})
    # A freshly imported software-rendered window may still be compiling its
    # first frame. Observe each real key edge before releasing it; do not batch
    # a fast press and release ahead of the actual Godot input dispatch.
    physical = {ENTER: 4194309, F8: 4194339, SPACE: 32, P: 80, TAB: 4194306,
                0xff51: 4194319, 0xff52: 4194320, 0xff53: 4194321, 0xff54: 4194322}.get(symbol)
    if physical is not None and p.poll() is None:
        wait(lambda: samples and last().get('keys', {}).get(str(physical)) == bool(down),
             'native key edge ' + hex(symbol) + (' pressed' if down else ' released'))
def tap(symbol):
    key(symbol, 1)
    time.sleep(.08)
    key(symbol, 0)
    time.sleep(.15)
def stage(label, scene, visit, pause=.15):
    wait(lambda: samples and last()['sceneId'] == scene and last()['visit'] == visit, label)
    time.sleep(pause)
    assert last()['sceneId'] == scene and last()['visit'] == visit, label + ': unexpected scene visit'
    stages.append({'label': label, 'sample': last()})
def button(identity):
    return next((row for row in last()['menuButtons'] if row['id'] == identity and row['visible']), None)
def ready_button(identity):
    wait(lambda: button(identity) is not None and not button(identity)['disabled'] and last()['menuArmed'], 'actual menu button ready '+identity)
    return button(identity)
def click_button(identity, exiting=False, hold_seconds=.08, expected_visit=None):
    row = ready_button(identity)
    before_frame = last()['frame']
    wait(lambda: last()['frame'] > before_frame, 'rendered menu before click')
    row = button(identity)
    client_x,client_y,child = c.c_int(),c.c_int(),c.c_ulong()
    assert x.XTranslateCoordinates(d,window,root,0,0,c.byref(client_x),c.byref(client_y),c.byref(child))
    rect = row['rect']; viewport=last()['viewportSize']; size=last()['windowSize']
    target_x=client_x.value+round((rect[0]+rect[2]/2)*size[0]/viewport[0])
    target_y=client_y.value+round((rect[1]+rect[3]/2)*size[1]/viewport[1])
    assert xt.XTestFakeMotionEvent(d,-1,target_x,target_y,0)
    x.XSync(d,0)
    assert xt.XTestFakeButtonEvent(d,1,1,0); x.XFlush(d)
    wait(lambda: last()['mouseButtons'].get('1') is True, 'native mouse down')
    time.sleep(hold_seconds)
    if expected_visit is not None:
        assert last()['visit'] == expected_visit, 'held mouse gesture activated or repeated restart before release'
    assert xt.XTestFakeButtonEvent(d,1,0,0); x.XFlush(d)
    actions.append({'mouse': identity, 'rootPosition':[target_x,target_y], 'rect':rect, 'seconds':round(time.monotonic()-started,3)})
    if not exiting:
        wait(lambda: last()['mouseButtons'].get('1') is False, 'native mouse release')
        time.sleep(.15)
def keyboard_button(identity, exiting=False, hold_seconds=.08, expected_visit=None):
    ready_button(identity)
    # Exercise real focus traversal even if the first item already has focus.
    for _ in range(8):
        tap(TAB)
        if button(identity) is not None and button(identity)['focused']:
            break
    assert button(identity)['focused'], 'Tab did not reach '+identity
    if exiting:
        key(ENTER,1)
        time.sleep(.12)
        key(ENTER,0)
    else:
        key(ENTER,1)
        time.sleep(hold_seconds)
        if expected_visit is not None:
            assert last()['visit'] == expected_visit, 'held Enter or echo activated or repeated restart before release'
        key(ENTER,0)
        time.sleep(.15)

try:
    root = x.XDefaultRootWindow(d)
    window = 0
    for _ in range(160):
        r, parent, children, count = c.c_ulong(), c.c_ulong(), c.POINTER(c.c_ulong)(), c.c_uint()
        assert x.XQueryTree(d, root, c.byref(r), c.byref(parent), c.byref(children), c.byref(count))
        for index in range(count.value):
            name = c.c_char_p()
            if x.XFetchName(d, children[index], c.byref(name)) and name.value:
                title = name.value.decode(errors='replace'); x.XFree(name)
                if flow['assemblyTitle'] in title:
                    window = children[index]; break
        if children: x.XFree(children)
        if window: break
        time.sleep(.05)
    assert window, 'generated menu project window missing'
    x.XSetInputFocus(d, window, 1, 0); x.XSync(d, 0)
    wait(lambda: samples and last()['focused'], 'project focused')
    stage('start-menu', flow['start'], 1)
    assert last()['state'] == {}, last()['state']
    click_button('go', hold_seconds=.35, expected_visit=1)
    stage('mouse-navigate-result', flow['result'], 2)
    assert last()['state'] == {}
    keyboard_button('back', hold_seconds=.35, expected_visit=2)
    stage('keyboard-back-start', flow['start'], 3)
    keyboard_button('retry', hold_seconds=.35, expected_visit=3)
    stage('keyboard-retry-game', flow['game'], 4)
    assert last()['state'] == {}, 'retry values:{} must not invent state'
    click_button('back', hold_seconds=.35, expected_visit=4)
    stage('mouse-back-start', flow['start'], 5)
    click_button('finish', exiting=True)
    assert p.wait(timeout=12) == 0
    thread.join(timeout=2)
    assert not any('SCRIPT ERROR:' in line or 'ERROR:' in line for line in lines), '\n'.join(lines)
    result = {'ok':True, 'scope':'Real generated Godot menu GUI, XTest mouse/Tab/Enter in Xvfb/Mesa; unmodified read-only observer, no author or gameplay port invocation.',
              'stages':stages, 'samples':samples, 'actions':actions, 'exitCode':p.returncode, 'flow':flow}
    (out/'keyboard.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'ok':True,'stages':len(stages),'visits':5,'samples':len(samples),'screenshots':len(list((out/'frames').glob('*.png')))}))
finally:
    for symbol in held:
        code=x.XKeysymToKeycode(d,symbol)
        if code: xt.XTestFakeKeyEvent(d,code,0,0)
    x.XSync(d,0)
    if p.poll() is None:
        p.terminate()
        try: p.wait(timeout=5)
        except subprocess.TimeoutExpired: p.kill();p.wait()
    thread.join(timeout=2)
    (out/'window-output.log').write_text('\n'.join(lines)+'\n')
