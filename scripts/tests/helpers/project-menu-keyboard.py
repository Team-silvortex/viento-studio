"""Real Godot window with XTest keys. The observer never drives gameplay."""
import ctypes as c
import json
import pathlib
import subprocess
import sys
import threading
import time

executable, directory, output, mode = sys.argv[1:]
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

def ident(number):
    return 'c011ec70-2026-4113-8113-' + str(number).zfill(12)
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
    wait(lambda: samples and last()['sceneId'] == ident(scene) and last()['visit'] == visit, label)
    time.sleep(pause)
    assert last()['sceneId'] == ident(scene) and last()['visit'] == visit, label + ': unexpected scene visit'
    stages.append({'label': label, 'sample': last()})
def focus(window, value):
    x.XSetInputFocus(d, window if value else dummy, 1, 0)
    x.XSync(d, 0)
    wait(lambda: samples and last()['focused'] == value, 'focus change')
def actor(number):
    return last()['actors'][ident(number)]
def move_axis(axis, target):
    before = actor(301)['position'][axis]
    delta = target-before
    if abs(delta) < 5:
        return
    symbol = (0xff53 if delta > 0 else 0xff51) if axis == 0 else (0xff54 if delta > 0 else 0xff52)
    key(symbol, 1)
    try:
        wait(lambda: last()['sceneId'] != ident(31) or (actor(301)['position'][axis] >= target-5 if delta > 0 else actor(301)['position'][axis] <= target+5),
             'real player movement to '+str(target), max(3, abs(delta)/180+1.5))
    finally:
        key(symbol, 0)
        time.sleep(.12)
def move(xv, yv):
    move_axis(0, xv)
    if last()['sceneId'] == ident(31):
        move_axis(1, yv)
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
def close_window():
    protocols=c.POINTER(c.c_ulong)();count=c.c_int()
    assert x.XGetWMProtocols(d,window,c.byref(protocols),c.byref(count)), 'window declares no ICCCM protocols'
    declared=[protocols[index] for index in range(count.value)]
    x.XFree(protocols)
    delete_atom=x.XInternAtom(d,b'WM_DELETE_WINDOW',0)
    assert delete_atom and delete_atom in declared, 'native window does not advertise standard WM_DELETE_WINDOW'
    event=XEvent();event.client.type=33;event.client.display=d;event.client.window=window
    event.client.message_type=x.XInternAtom(d,b'WM_PROTOCOLS',0);event.client.format=32
    event.client.data.l[0]=delete_atom;event.client.data.l[1]=0
    assert x.XSendEvent(d,window,0,0,c.byref(event));x.XFlush(d)
    actions.append({'windowClose':True,'standardDeleteAtom':delete_atom,'declaredProtocols':declared,'seconds':round(time.monotonic()-started,3)})
def phase(value, label):
    wait(lambda: samples and last()['phase'] == value, label)
def stable(label, seconds=.65):
    time.sleep(.2)
    before = last()
    time.sleep(seconds)
    after = last()
    for name in ['sceneId', 'visit', 'state', 'stateRevision', 'actors', 'identities', 'animation', 'hudTexts', 'budget', 'eventSequence', 'audioSequence', 'animationSequence', 'subscriptions', 'elapsedSeconds', 'totalSeconds', 'ticks']:
        assert after[name] == before[name], label + ': ' + name + ' changed ' + repr([before[name], after[name]])
    assert before['ticks'] and after['treePaused'], label + ': missing normal callback probe or tree pause'
    for track, prior in before['audio'].items():
        current = after['audio'][track]
        assert current['id'] == prior['id'] and current['playing'] == prior['playing']
        if prior['playing']:
            assert current['streamPaused'] and prior['streamPaused'], label + ': native playing stream not paused'
        assert abs(current['position'] - prior['position']) <= .025, label + ': audio progressed'
    stages.append({'label': label, 'before': before, 'sample': after})
    return after

try:
    assert d, 'isolated X display unavailable'
    root = x.XDefaultRootWindow(d)
    window = 0
    for _ in range(160):
        r, parent, children, count = c.c_ulong(), c.c_ulong(), c.POINTER(c.c_ulong)(), c.c_uint()
        assert x.XQueryTree(d, root, c.byref(r), c.byref(parent), c.byref(children), c.byref(count))
        for index in range(count.value):
            name = c.c_char_p()
            if x.XFetchName(d, children[index], c.byref(name)) and name.value:
                title = name.value.decode(errors='replace')
                x.XFree(name)
                if 'Crystal Courtyard' in title:
                    window = children[index]
                    break
        if children:
            x.XFree(children)
        if window and samples:
            break
        time.sleep(.05)
    assert window, 'native game window unavailable'
    dummy = x.XCreateSimpleWindow(d, root, 1100, 0, 32, 32, 0, 0, 0)
    x.XMapWindow(d, dummy)
    x.XSync(d, 0)
    focus(window, True)
    stage('start', 30, 1)
    wait(lambda: list((out/'frames').glob('*.png')), 'first rendered frame')
    if mode == 'scene-restart':
        ready_button('restart')
        first = last()
        click_button('restart', hold_seconds=1.2, expected_visit=1)
        stage('mouse-restart-same-member',30,2,pause=.8)
        second = last()
        assert second['identities']['scene'] != first['identities']['scene']
        assert second['actors'][ident(320)]['id'] != first['actors'][ident(320)]['id']
        assert second['state'] == {'score':0,'health':3,'door_open':False}
        assert second['budget']['stateMutations'] >= first['budget']['stateMutations']+3
        assert second['totalSeconds'] >= first['totalSeconds'] and second['elapsedSeconds'] < second['totalSeconds']
        keyboard_button('restart', hold_seconds=1.4, expected_visit=2)
        stage('keyboard-restart-same-member',30,3,pause=.8)
        third = last()
        assert third['identities']['scene'] != second['identities']['scene']
        assert third['actors'][ident(320)]['id'] != second['actors'][ident(320)]['id']
        assert third['state'] == second['state']
        assert third['budget']['stateMutations'] >= second['budget']['stateMutations']+3
        assert third['totalSeconds'] >= second['totalSeconds'] and third['elapsedSeconds'] < third['totalSeconds']
        for key_name, count in second['budget'].items():
            assert third['budget'][key_name] >= count, 'restart reset session budget '+key_name
        click_button('exit',exiting=True)
        assert p.wait(timeout=8)==0
        thread.join(timeout=2)
        assert not any('SCRIPT ERROR:' in line or 'ERROR:' in line for line in lines), '\n'.join(lines)
        data={'scope':'Actual ordinary scene menu, read-only observer and real XTest mouse/Enter gestures; no direct activation API.', 'mode':mode,'stages':stages,'samples':samples,'actions':actions,'exitCode':p.returncode}
        (out/'keyboard.json').write_text(json.dumps(data,indent=2)+'\n')
        print(json.dumps({'stages':len(stages),'samples':len(samples),'exitCode':p.returncode}))
        sys.exit(0)
    ready_button('start')
    click_button('start')
    stage('mouse-start', 31, 2)
    phase('running', 'game running')
    assert last()['state'] == {'score':0,'health':3,'door_open':False}
    move(300,380);move(300,240)
    wait(lambda: last()['state']['score']==1, 'real crystal collected')
    wait(lambda: last()['audio'][ident(500)]['playing'], 'native collection audio playing')
    running=last();stages.append({'label':'playing-with-live-audio','sample':running})
    tap(P);phase('paused','P pauses gameplay')
    frozen=stable('paused-gameplay-frozen')
    if mode == 'full':
        keyboard_button('resume');phase('running','keyboard menu resumes after release')
        assert last()['visit']==frozen['visit'] and last()['identities']==frozen['identities']
        assert last()['state']==frozen['state']
        wait(lambda:last()['ticks']!=frozen['ticks'],'normal callbacks resume')
        stages.append({'label':'keyboard-resume-same-visit','sample':last()})
        tap(P);phase('paused','pause before mouse resume');frozen=stable('mouse-resume-frozen',.3)
        click_button('resume');phase('running','mouse menu resumes after release')
        assert last()['visit']==frozen['visit'] and last()['identities']==frozen['identities']
        assert last()['state']==frozen['state']
        stages.append({'label':'mouse-resume-same-visit','sample':last()})
        move(300,480);move(570,480)
        wait(lambda:last()['state']['score']==2,'second collectible')
        move(800,480);move(800,200);move(900,200);move(900,240)
        wait(lambda:last()['state']['score']==3 and last()['state']['door_open'],'three collectibles open door')
        wait(lambda:not actor(306)['visible'] and actor(306)['collisionLayer']==0,'door physically opens')
        stages.append({'label':'all-crystals-door-open','sample':last()})
        move(1180,240);move(1180,380);stage('victory',32,3)
        assert last()['state']['score']==3 and last()['state']['health']==3
        click_button('title');stage('mouse-return-to-title',30,4)
        assert last()['state']['score']==3, 'navigation unexpectedly reset state'
        keyboard_button('start');stage('keyboard-new-attempt',31,5)
        assert last()['state']=={'score':0,'health':3,'door_open':False}
        assert actor(301)['position']==[140,380]
        move(600,380);move(600,300);wait(lambda:last()['state']['health']==2,'first hazard entry')
        time.sleep(.4);assert last()['state']['health']==2,'stationary hazard repeated'
        move(760,300);move(600,300);wait(lambda:last()['state']['health']==1,'second hazard entry')
        move(760,300);move(600,300);stage('failure',33,6)
        assert last()['state']['health']==0
        keyboard_button('title');stage('keyboard-return-to-title',30,7)
        click_button('exit',exiting=True)
    elif mode == 'paused-finish':
        click_button('exit',exiting=True)
    elif mode == 'paused-escape':
        code=x.XKeysymToKeycode(d,ESCAPE);assert xt.XTestFakeKeyEvent(d,code,1,0);x.XFlush(d)
        actions.append({'escape':True})
    elif mode == 'paused-close':
        close_window()
    else:
        raise AssertionError('Unknown menu mode '+mode)
    assert p.wait(timeout=8) == 0
    thread.join(timeout=2)
    assert not any('SCRIPT ERROR:' in line or 'ERROR:' in line for line in lines), '\n'.join(lines)
    data = {'scope': 'Actual generated Godot window, independent read-only ALWAYS observer, XTest mouse and keyboard in isolated Xvfb/Mesa; no physical-device or installed-app claim.', 'mode':mode, 'stages': stages, 'samples': samples, 'actions': actions, 'exitCode': p.returncode}
    (out/'keyboard.json').write_text(json.dumps(data, indent=2)+'\n')
    print(json.dumps({'stages': len(stages), 'samples': len(samples), 'exitCode': p.returncode}))
finally:
    if d:
        for symbol in list(held) + [ESCAPE]:
            code = x.XKeysymToKeycode(d, symbol)
            if code:
                xt.XTestFakeKeyEvent(d, code, 0, 0)
        x.XSync(d, 0)
        if dummy:
            x.XDestroyWindow(d, dummy)
    if p.poll() is None:
        p.terminate()
        try:
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait()
    thread.join(timeout=2)
    (out/'window-output.log').write_text('\n'.join(lines)+'\n')
