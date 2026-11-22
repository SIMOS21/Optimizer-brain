from pathlib import Path
import subprocess
import sys
import time

marker = Path(sys.argv[1])
grandchild = Path(__file__).with_name("process_tree_grandchild.py")
if sys.stdin.buffer.readline(64) != b"START\n":
    raise SystemExit(2)
subprocess.Popen([sys.executable, str(grandchild)])
marker.write_text("started", encoding="ascii")
while True:
    time.sleep(1)
