from pathlib import Path
import sys
import time

marker = Path(sys.argv[1])
counter = 0
while True:
    marker.write_text(str(counter), encoding="ascii")
    counter += 1
    time.sleep(0.1)
