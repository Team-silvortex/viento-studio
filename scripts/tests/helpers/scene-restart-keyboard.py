"""Real Godot window with XTest keys. The observer never drives gameplay."""
import ctypes as c
import json
import pathlib
import subprocess
import sys
import threading
import time

executable, directory, output = sys.argv[1:]
out = pathlib.Path(output)
out.mkdir(parents=True, exist_ok=True)
p = subprocess.Popen([executable, '--path', directory, 'res://scene-restart-observer.tscn'], cwd=directory,
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
lines, samples, actions, stages = [], [], [], []
def consume():
    for line in p.stdout:
        lines.append(line.rstrip())
        if line.startswith('RESTART_SAMPLE:'):
            samples.append(json.loads(line[len('RESTART_SAMPLE:'):]))
thread = threading.Thread(target=consume, daemon=True)
thread.start()
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
d = x.XOpenDisplay(None)
dummy = 0
started = time.monotonic()
held = set()
R, SPACE, ENTER, ESCAPE, F8 = ord('r'), 0x20, 0xff0d, 0xff1b, 0xffc5

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
    physical = {ENTER: 4194309, F8: 4194339, SPACE: 32, R: 82,
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
    assert last()['sceneId'] == ident(scene) and last()['visit'] == visit, label + ': unexpected extra restart'
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
        wait(lambda: actor(301)['position'][axis] >= target-5 if delta > 0 else actor(301)['position'][axis] <= target+5,
             'real player movement to '+str(target), max(3, abs(delta)/180+1.5))
    finally:
        key(symbol, 0)
        time.sleep(.12)
def move(xv, yv):
    move_axis(0, xv)
    move_axis(1, yv)
def assert_reset():
    row = last()
    assert row['state'] == {'score': 0, 'health': 3, 'door_open': False, 'progress': 'checkpoint-7'}, row
    assert all(actor(number)['visible'] for number in [302, 303, 304, 306])
    assert actor(306)['collisionLayer'] != 0
    assert actor(301)['position'] == [140, 380]
    assert actor(301)['velocity'] == [0, 0]
    assert not any(track['playing'] for track in row['audio'].values()), row['audio']
    assert {item['text'] for item in row['hudTexts']} >= {'Score: 0', 'Health: 3'}

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
    wait(lambda: (out/'frames/visit-01-state-0000.png').is_file(), 'first rendered game frame')
    wait(lambda: last()['identities'].get('startArmed') is True, 'initial action starter armed')
    tap(ENTER)
    stage('first-attempt', 31, 2)
    first = last()
    assert first['guiOpen']
    key(R, 1)
    time.sleep(.12)
    key(SPACE, 1)
    time.sleep(.15)
    key(SPACE, 0)
    stage('both-mapped-keys-gui-consumed', 31, 2)
    key(R, 0)
    wait(lambda: last()['guiCount'] >= 2, 'GUI consumed both mapped keys')
    key(R, 1)
    time.sleep(.15)
    tap(F8)
    wait(lambda: not last()['guiOpen'], 'GUI dismissed while restart key held')
    focus(window, False)
    stage('gui-dismissed-unfocused-held', 31, 2)
    focus(window, True)
    stage('gui-dismissed-refocused-held', 31, 2, .4)
    key(R, 0)
    wait(lambda: not last()['actionDown'], 'restart released')
    time.sleep(.2)
    move(300, 380)
    move(300, 240)
    wait(lambda: last()['state']['score'] == 1, 'first collectible')
    wait(lambda: last()['audio'][ident(500)]['playing'], 'real looping collectible audio starts')
    move(300, 480)
    move(570, 480)
    wait(lambda: last()['state']['score'] == 2, 'second collectible')
    move(450, 480)
    move(570, 480)
    assert last()['state']['score'] == 2, 'same crystal collected twice'
    move(800, 480)
    move(800, 200)
    move(900, 200)
    move(900, 240)
    wait(lambda: last()['state']['score'] == 3 and last()['state']['door_open'], 'three collectibles open door')
    wait(lambda: not actor(306)['visible'] and actor(306)['collisionLayer'] == 0, 'actual door opens')
    assert not any(actor(number)['visible'] for number in [302, 303, 304])
    assert last()['audio'][ident(500)]['playing']
    move(800, 240)
    move(800, 380)
    move(600, 380)
    move(600, 300)
    wait(lambda: last()['state']['health'] == 2, 'actual hazard damages before restart')
    time.sleep(.4)
    assert last()['state']['health'] == 2, 'stationary hazard repeated before restart'
    stages.append({'label': 'dirty-game-door-open-live-audio', 'sample': last()})
    key(R, 1)
    stage('same-scene-restarted-held', 31, 3, .65)
    assert_reset()
    focus(window, False)
    stage('restarted-unfocused-held', 31, 3)
    focus(window, True)
    stage('restarted-refocused-held', 31, 3, .45)
    assert_reset()
    key(R, 0)
    wait(lambda: not last()['actionDown'], 'second restart released')
    time.sleep(.2)
    move(300, 380)
    move(300, 240)
    wait(lambda: last()['state']['score'] == 1, 'same crystal collects in new visit')
    move(300, 380)
    move(300, 240)
    assert last()['state']['score'] == 1, 'new visit duplicate crystal collection'
    stages.append({'label': 'same-crystal-recollected-once', 'sample': last()})
    key(R, 1)
    stage('second-explicit-restart-held', 31, 4, .5)
    assert_reset()
    key(R, 0)
    time.sleep(.15)
    tap(ESCAPE)
    assert p.wait(timeout=8) == 0
    thread.join(timeout=2)
    assert not any('SCRIPT ERROR:' in line or 'ERROR:' in line for line in lines), '\n'.join(lines)
    data = {'scope': 'Actual generated Godot window, read-only external observer and synthetic XTest keys in isolated Xvfb/Mesa; no physical-device or installed-app claim.',
            'stages': stages, 'samples': samples, 'actions': actions, 'exitCode': p.returncode}
    (out/'keyboard.json').write_text(json.dumps(data, indent=2)+'\n')
    print(json.dumps({'stages': len(stages), 'samples': len(samples), 'exitCode': p.returncode}))
finally:
    if d:
        for symbol in list(held):
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
