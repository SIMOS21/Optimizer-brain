from pathlib import Path
import os
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from brain.platform.job_process import ManagedProcess

marker = Path(sys.argv[1])
child = Path(__file__).with_name("process_crash_child.py")
env = {
    key: value
    for key, value in os.environ.items()
    if key in ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "LANG")
}
managed = ManagedProcess.launch(
    [sys.executable, str(child), str(marker), str(os.getpid())],
    env,
    512 * 1024**2,
)
deadline = time.monotonic() + 10
while not marker.exists() and time.monotonic() < deadline:
    time.sleep(0.05)
if not marker.exists():
    raise RuntimeError("descendant did not start")
os._exit(0)
