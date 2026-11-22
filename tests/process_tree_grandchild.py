import os
import signal
import time

if os.name == "nt":
    signal.signal(signal.SIGBREAK, signal.SIG_IGN)
else:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)

time.sleep(120)
