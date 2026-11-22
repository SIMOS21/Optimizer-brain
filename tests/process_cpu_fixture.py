from pathlib import Path
import sys

Path(sys.argv[1]).write_text("started", encoding="ascii")
value = 0
while True:
    value += 1
