from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from brain.platform import job_bootstrap


def consume_resources(module_name, *, run_name):
    if sys.stdin.buffer.readline(64) != b"START\n":
        raise SystemExit(2)
    marker = Path(sys.argv[1])
    if sys.argv[2] == "memory":
        chunks = []
        try:
            # At most 256 MiB even if the tested 128 MiB limit is broken.
            for _ in range(32):
                chunks.append(bytearray(8 * 1024**2))
        except MemoryError:
            marker.write_text("memory-limit-enforced", encoding="ascii")
            return
        marker.write_text("memory-limit-not-enforced", encoding="ascii")
    else:
        marker.write_text("started", encoding="ascii")
        value = 0
        while True:
            value += 1


# Exercise the production bootstrap limits without accessing a database/solver.
job_bootstrap.runpy.run_module = consume_resources
job_bootstrap.main()
