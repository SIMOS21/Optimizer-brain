"""Apply child resource limits before importing the optimization runtime."""

import os
import runpy


def main() -> None:
    if os.name == "posix":
        import resource

        memory_limit = int(os.environ["BRAIN_JOB_MEMORY_LIMIT_BYTES"])
        cpu_limit = int(os.environ["BRAIN_JOB_CPU_LIMIT_SECONDS"])
        resource.setrlimit(  # type: ignore[attr-defined]
            resource.RLIMIT_AS, (memory_limit, memory_limit)  # type: ignore[attr-defined]
        )
        resource.setrlimit(  # type: ignore[attr-defined]
            resource.RLIMIT_CPU, (cpu_limit, cpu_limit + 1)  # type: ignore[attr-defined]
        )
    runpy.run_module("brain.platform.job_child", run_name="__main__")


if __name__ == "__main__":
    main()
