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
p = subprocess.Popen([executable, '--path', directory, 'res://project-pause-observer.tscn'], cwd=directory,
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
lines, samples, actions, stages = [], [], [], []
def consume():
    for line in p.stdout:
        lines.append(line.rstrip())
        if line.startswith('PAUSE_SAMPLE:'):
            samples.append(json.loads(line[len('PAUSE_SAMPLE:'):]))
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
P, SPACE, ENTER, ESCAPE, F8 = ord('p'), 0x20, 0xff0d, 0xff1b, 0xffc5

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
    physical = {ENTER: 4194309, F8: 4194339, SPACE: 32, P: 80,
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
        wait(lambda: actor(301)['position'][axis] >= target-5 if delta > 0 else actor(301)['position'][axis] <= target+5,
             'real player movement to '+str(target), max(3, abs(delta)/180+1.5))
    finally:
        key(symbol, 0)
        time.sleep(.12)
def move(xv, yv):
    move_axis(0, xv)
    move_axis(1, yv)
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
    wait(lambda: last()['identities'].get('startArmed') is True, 'start action armed')
    tap(ENTER)
    stage('game', 31, 2)
    phase('running', 'game running')
    wait(lambda: last()['guiOpen'], 'test GUI open')
    tap(P)
    tap(SPACE)
    assert last()['phase'] == 'running'
    wait(lambda: last()['guiCount'] >= 2, 'GUI consumed both mapped pause keys')
    key(P, 1)
    tap(F8)
    wait(lambda: not last()['guiOpen'], 'GUI dismissed with held pause action')
    time.sleep(.4)
    assert last()['phase'] == 'running', 'GUI consumed press later toggled pause'
    key(P, 0)
    move(300, 380)
    move(300, 240)
    wait(lambda: last()['state']['score'] == 1, 'actual collectible state change')
    wait(lambda: last()['audio'][ident(500)]['playing'], 'actual looping PCM playback')
    running = last()
    assert running['animation']['time'] > 0 and running['ticks']
    stages.append({'label': 'running-with-live-audio', 'sample': running})
    key(P, 1)
    phase('paused', 'pause action accepted')
    stable('held-key-and-echo-stay-paused')
    key(P, 0)
    frozen = stable('native-gameplay-and-media-frozen')
    key(0xff53, 1)
    stable('movement-held-during-pause')
    key(P, 1)
    phase('waiting-for-release', 'resume waiting for all mapped actions')
    key(P, 0)
    stable('other-action-keeps-release-barrier')
    focus(window, False)
    phase('paused', 'focus loss cancels waiting')
    focus(window, True)
    stable('focus-return-does-not-resume')
    key(0xff53, 0)
    time.sleep(.1)
    assert last()['phase'] == 'paused'
    tap(P)
    phase('running', 'explicit resume after release')
    wait(lambda: last()['ticks'] != frozen['ticks'] and last()['elapsedSeconds'] > frozen['elapsedSeconds'], 'ordinary callbacks and game clock resume')
    resumed = last()
    assert resumed['visit'] == frozen['visit'] and resumed['identities'] == frozen['identities']
    assert resumed['state'] == frozen['state']
    assert resumed['elapsedSeconds'] - frozen['elapsedSeconds'] < 1.0, 'paused wall time was added to game clock'
    assert resumed['actors'][ident(301)]['position'] == frozen['actors'][ident(301)]['position'], 'held movement replayed after release barrier'
    assert not resumed['audio'][ident(500)]['streamPaused'] and resumed['audio'][ident(500)]['playing']
    stages.append({'label': 'same-visit-resumed', 'sample': resumed})
    move(300, 380)
    assert actor(301)['position'] != frozen['actors'][ident(301)]['position']
    focus(window, False)
    phase('paused', 'running focus loss auto-pauses')
    focus(window, True)
    stable('automatic-focus-pause-persists-after-refocus')
    tap(SPACE)
    phase('running', 'second mapped key resumes')
    tap(P)
    phase('paused', 'pause before Escape')
    stable('paused-before-Escape', .3)
    # Escape is an explicit lifecycle command and may exit before a sample edge.
    code = x.XKeysymToKeycode(d, ESCAPE)
    assert xt.XTestFakeKeyEvent(d, code, 1, 0)
    x.XFlush(d)
    assert p.wait(timeout=8) == 0
    thread.join(timeout=2)
    assert not any('SCRIPT ERROR:' in line or 'ERROR:' in line for line in lines), '\n'.join(lines)
    data = {'scope': 'Actual generated Godot window, independent read-only ALWAYS observer and XTest keys in isolated Xvfb/Mesa; no physical-device or installed-app claim.', 'stages': stages, 'samples': samples, 'actions': actions, 'exitCode': p.returncode}
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
