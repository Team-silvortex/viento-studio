import os, threading
_original_read = os.read
def faulty_read(fd, n):
    if threading.current_thread().name != "MainThread": raise OSError("injected tee read failure")
    return _original_read(fd, n)
os.read = faulty_read
