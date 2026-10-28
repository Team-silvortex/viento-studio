import pathlib, subprocess, sys, time
child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"], start_new_session=True)
pathlib.Path(sys.argv[1]).write_text(str(child.pid))
print("before timeout", flush=True)
time.sleep(30)
