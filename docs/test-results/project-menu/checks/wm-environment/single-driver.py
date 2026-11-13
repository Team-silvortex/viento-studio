import pathlib,ctypes as c,subprocess,threading,time,json,hashlib,os,sys
root=pathlib.Path('/tmp/viento-wm-stock-comparison-matrix')/sys.argv[1];root.mkdir(parents=True,exist_ok=True)
project=root/'project';project.mkdir(exist_ok=True)
(project/'project.godot').write_text('''config_version=5
[application]
config/name="WM stock comparison"
run/main_scene="res://main.tscn"
[display]
window/size/viewport_width=400
window/size/viewport_height=240
[rendering]
renderer/rendering_method="gl_compatibility"
''')
(project/'main.tscn').write_text('''[gd_scene load_steps=2 format=3]
[ext_resource type="Script" path="res://main.gd" id="1"]
[node name="Main" type="Node"]
script = ExtResource("1")
''')
(project/'main.gd').write_text('''extends Node
func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	get_tree().auto_accept_quit = false
	get_window().title = "VientoStockWMProbe"
	get_window().close_requested.connect(_on_close)
	if "--paused" in OS.get_cmdline_user_args():
		get_tree().paused = true
	print("PROBE_READY:" + JSON.stringify({"paused":get_tree().paused,"pid":OS.get_process_id()}))
func _on_close() -> void:
	print("PROBE_WINDOW_CLOSE_SIGNAL:" + str(get_tree().paused))
	get_tree().quit()
func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		print("PROBE_NODE_CLOSE_NOTIFICATION:" + str(get_tree().paused))
''')
x=c.CDLL('libX11.so.6')
x.XOpenDisplay.argtypes=[c.c_char_p];x.XOpenDisplay.restype=c.c_void_p
x.XDefaultRootWindow.argtypes=[c.c_void_p];x.XDefaultRootWindow.restype=c.c_ulong
x.XQueryTree.argtypes=[c.c_void_p,c.c_ulong,c.POINTER(c.c_ulong),c.POINTER(c.c_ulong),c.POINTER(c.POINTER(c.c_ulong)),c.POINTER(c.c_uint)]
x.XFetchName.argtypes=[c.c_void_p,c.c_ulong,c.POINTER(c.c_char_p)]
x.XFree.argtypes=[c.c_void_p]
x.XInternAtom.argtypes=[c.c_void_p,c.c_char_p,c.c_int];x.XInternAtom.restype=c.c_ulong
x.XSendEvent.argtypes=[c.c_void_p,c.c_ulong,c.c_int,c.c_long,c.c_void_p]
x.XFlush.argtypes=[c.c_void_p];x.XSync.argtypes=[c.c_void_p,c.c_int]
x.XGetWMProtocols.argtypes=[c.c_void_p,c.c_ulong,c.POINTER(c.POINTER(c.c_ulong)),c.POINTER(c.c_int)]
x.XGetAtomName.argtypes=[c.c_void_p,c.c_ulong];x.XGetAtomName.restype=c.c_void_p
class Data(c.Union):_fields_=[('b',c.c_char*20),('s',c.c_short*10),('l',c.c_long*5)]
class Client(c.Structure):_fields_=[('type',c.c_int),('serial',c.c_ulong),('send_event',c.c_int),('display',c.c_void_p),('window',c.c_ulong),('message_type',c.c_ulong),('format',c.c_int),('data',Data)]
class Event(c.Union):_fields_=[('client',Client),('pad',c.c_long*24)]
d=x.XOpenDisplay(None);assert d
base=x.XDefaultRootWindow(d)
initial_atoms={name:x.XInternAtom(d,name.encode(),1) for name in ['WM_PROTOCOLS','WM_DELETE_WINDOW']}
if 'seeded' in sys.argv[1]:
 for atom in ['WM_PROTOCOLS','WM_DELETE_WINDOW']:x.XInternAtom(d,atom.encode(),0)
 x.XSync(d,0)
def children(window):
 r,p,arr,n=c.c_ulong(),c.c_ulong(),c.POINTER(c.c_ulong)(),c.c_uint()
 assert x.XQueryTree(d,window,c.byref(r),c.byref(p),c.byref(arr),c.byref(n))
 result=[arr[i] for i in range(n.value)]
 if arr:x.XFree(arr)
 return result
def name(window):
 out=c.c_char_p()
 if not x.XFetchName(d,window,c.byref(out)):return ''
 result=out.value.decode(errors='replace') if out.value else ''
 if out:x.XFree(out)
 return result
def protocols(window):
 arr,n=c.POINTER(c.c_ulong)(),c.c_int()
 ok=x.XGetWMProtocols(d,window,c.byref(arr),c.byref(n));result=[]
 if ok:
  for i in range(n.value):
   if arr[i]==0:result.append({'atom':0,'name':None});continue
   atomname=x.XGetAtomName(d,arr[i]);result.append({'atom':arr[i],'name':c.string_at(atomname).decode() if atomname else None})
   if atomname:x.XFree(atomname)
 if arr:x.XFree(arr)
 return {'ok':bool(ok),'values':result}
stock='/home/chiharukiryu/.cache/io.viento.studio/toolchains/godot/4.7.2-stable/linux-x86_64/Godot_v4.7.2-stable_linux.x86_64'
custom='/home/chiharukiryu/.cache/io.viento.studio/toolchains/godot/4.7.2-viento-audiofix1/linux-x86_64/Godot_v4.7.2-viento-audiofix1_linux.x86_64'
results=[]
for label,binary in [(sys.argv[1],stock if sys.argv[1].startswith('stock') else custom)]:
 for paused in ['paused' in sys.argv[1]]:
  rows=[];window=None
  command=[binary,'--path',str(project),'--audio-driver','Dummy','--display-driver','x11','--rendering-method','gl_compatibility']+(['--','--paused'] if paused else [])
  p=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1,cwd=project,env={**os.environ,'LIBGL_ALWAYS_SOFTWARE':'1'})
  def collect():
   for line in p.stdout:rows.append(line.rstrip())
  t=threading.Thread(target=collect,daemon=True);t.start()
  deadline=time.monotonic()+10
  while time.monotonic()<deadline and p.poll() is None:
   for w in children(base):
    if 'VientoStockWMProbe' in name(w):window=w;break
   if window and any(s.startswith('PROBE_READY:') for s in rows):break
   time.sleep(.05)
  if window:
   time.sleep(.6);before=protocols(window)
   xprop=subprocess.run(['xprop','-id',str(window),'WM_PROTOCOLS','WM_COLORMAP_WINDOWS','_NET_WM_PID','WM_NAME'],capture_output=True,text=True).stdout
   protocol=x.XInternAtom(d,b'WM_PROTOCOLS',0);delete=x.XInternAtom(d,b'WM_DELETE_WINDOW',0)
   event=Event();event.client.type=33;event.client.display=d;event.client.window=window;event.client.message_type=protocol;event.client.format=32;event.client.data.l[0]=delete;event.client.data.l[1]=0
   sent=x.XSendEvent(d,window,0,0,c.byref(event));x.XSync(d,0)
   deadline=time.monotonic()+2
   while time.monotonic()<deadline and p.poll() is None:time.sleep(.025)
   exited=p.poll() is not None
  else:before=None;xprop='';sent=0;exited=p.poll() is not None;protocol=None;delete=None
  exitcode=p.poll()
  if p.poll() is None:p.terminate();p.wait(timeout=3)
  t.join(timeout=1)
  output=root/(label+('-paused' if paused else '-running')+'.log');output.write_text('\n'.join(rows)+'\n')
  result={'label':label,'initialAtoms':initial_atoms,'windowNames':[name(w) for w in children(base)],'binary':binary,'binarySha256':hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest(),'paused':paused,'command':command,'window':window,'wmProtocols':before,'xprop':xprop,'sent':bool(sent),'wmProtocolsAtom':protocol,'wmDeleteWindowAtom':delete,'closedByRealDelete':exited and any(s.startswith('PROBE_WINDOW_CLOSE_SIGNAL:') for s in rows),'exitAfterDelete':exitcode,'closeSignal':[s for s in rows if 'CLOSE' in s],'output':str(output),'lines':rows}
  results.append(result);print(json.dumps(result,ensure_ascii=False),flush=True)
report={'ok':True,'display':os.environ.get('DISPLAY'),'clientMessageSize':c.sizeof(Client),'eventSize':c.sizeof(Event),'results':results}
(root/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
