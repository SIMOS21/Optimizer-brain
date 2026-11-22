"""Apply child resource limits before importing the optimization runtime."""

import os
import runpy


def main() -> None:
    if os.name == "posix":
        import resource

        memory_limit = int(os.environ["BRAIN_JOB_MEMORY_LIMIT_BYTES"])
        cpu_limit = int(os.environ["BRAIN_JOB_CPU_LIMIT_SECONDS"])
        setrlimit = getattr(resource, "setrlimit")
        setrlimit(
            getattr(resource, "RLIMIT_AS"),
            (memory_limit, memory_limit),
        )
        setrlimit(
            getattr(resource, "RLIMIT_CPU"),
            (cpu_limit, cpu_limit + 1),
        )
    runpy.run_module("brain.platform.job_child", run_name="__main__")


if __name__ == "__main__":
    main()
