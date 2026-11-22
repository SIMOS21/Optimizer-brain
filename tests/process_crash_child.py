import ctypes
import os
import signal
import subprocess
from pathlib import Path
import sys
import time

marker = Path(sys.argv[1])
parent_pid = int(sys.argv[2])
grandchild = Path(__file__).with_name("process_crash_grandchild.py")


def parent_died(signum, frame):
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    try:
        os.killpg(os.getpgrp(), signal.SIGTERM)
        time.sleep(0.2)
        os.killpg(os.getpgrp(), signal.SIGKILL)
    except ProcessLookupError:
        pass
    os._exit(128 + signum)


if sys.platform == "linux":
    signal.signal(signal.SIGUSR1, parent_died)
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, signal.SIGUSR1, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "prctl failed")
    if os.getppid() != parent_pid:
        parent_died(signal.SIGUSR1, None)
if sys.stdin.buffer.readline(64) != b"START\n":
    raise SystemExit(2)
subprocess.Popen([sys.executable, str(grandchild), str(marker)])
while True:
    time.sleep(1)
