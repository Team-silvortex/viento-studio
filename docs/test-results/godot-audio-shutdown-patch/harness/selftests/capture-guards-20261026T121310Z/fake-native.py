#!/usr/bin/python3
import os, signal, sys
print("controlled output", flush=True)
print("controlled diagnostic", file=sys.stderr, flush=True)
mode = os.environ.get("FAKE_EXIT", "0")
if mode == "signal": os.kill(os.getpid(), signal.SIGTERM)
sys.exit(int(mode))
