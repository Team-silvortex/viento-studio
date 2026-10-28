import ctypes as c,time
x=c.CDLL('libX11.so.6'); xt=c.CDLL('libXtst.so.6')
x.XOpenDisplay.argtypes=[c.c_char_p];x.XOpenDisplay.restype=c.c_void_p
x.XDefaultRootWindow.argtypes=[c.c_void_p];x.XDefaultRootWindow.restype=c.c_ulong
x.XQueryTree.argtypes=[c.c_void_p,c.c_ulong,c.POINTER(c.c_ulong),c.POINTER(c.c_ulong),c.POINTER(c.POINTER(c.c_ulong)),c.POINTER(c.c_uint)]
x.XFetchName.argtypes=[c.c_void_p,c.c_ulong,c.POINTER(c.c_char_p)];x.XSetInputFocus.argtypes=[c.c_void_p,c.c_ulong,c.c_int,c.c_ulong];x.XKeysymToKeycode.argtypes=[c.c_void_p,c.c_ulong];x.XKeysymToKeycode.restype=c.c_ubyte
x.XFlush.argtypes=[c.c_void_p];x.XSync.argtypes=[c.c_void_p,c.c_int];x.XGetInputFocus.argtypes=[c.c_void_p,c.POINTER(c.c_ulong),c.POINTER(c.c_int)];x.XFree.argtypes=[c.c_void_p];xt.XTestFakeKeyEvent.argtypes=[c.c_void_p,c.c_uint,c.c_int,c.c_ulong]
d=x.XOpenDisplay(None)
assert d, 'cannot open isolated X display'
root=x.XDefaultRootWindow(d); window=0
for _ in range(100):
 r=c.c_ulong();p=c.c_ulong();children=c.POINTER(c.c_ulong)();n=c.c_uint()
 assert x.XQueryTree(d,root,c.byref(r),c.byref(p),c.byref(children),c.byref(n))
 for i in range(n.value):
  name=c.c_char_p()
  if x.XFetchName(d,children[i],c.byref(name)) and name.value:
   title=name.value.decode(errors='replace');x.XFree(name)
   if 'viento' in title.lower() or 'godot' in title.lower():window=children[i];print('WINDOW',title,flush=True);break
 if children:x.XFree(children)
 if window:break
 time.sleep(.1)
assert window, 'no Godot window in isolated X display'
x.XSetInputFocus(d,window,1,0);x.XSync(d,0);focus=c.c_ulong();revert=c.c_int();x.XGetInputFocus(d,c.byref(focus),c.byref(revert));assert focus.value==window, "window did not acquire X focus";start=time.monotonic();print("FOCUS",window,"at",round(start,3),flush=True);time.sleep(1)
def key(sym,down):
 code=x.XKeysymToKeycode(d,sym);assert code;assert xt.XTestFakeKeyEvent(d,code,down,0);x.XFlush(d);print("KEY",hex(sym),"down" if down else "up",round(time.monotonic()-start,3),flush=True)
def tap_hold(sym,t):key(sym,1);time.sleep(t);key(sym,0)
tap_hold(0xff53,.8);time.sleep(.3);tap_hold(0xff51,.8);time.sleep(.8);tap_hold(0x20,.2);print('KEYS Right Left Space',flush=True)
