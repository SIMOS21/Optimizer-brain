"""Process-tree termination behavior on supported worker platforms."""

import os
from pathlib import Path
import subprocess
import sys
import time

import pytest

from brain.platform.job_process import ManagedProcess


def test_termination_waits_for_descendants(tmp_path):
    marker = tmp_path / "descendant-started"
    fixture = Path(__file__).with_name("process_tree_fixture.py")
    env = {
        key: value
        for key, value in os.environ.items()
        if key in ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "LANG")
    }
    process = ManagedProcess.launch(
        [sys.executable, str(fixture), str(marker)],
        env,
        512 * 1024**2,
        120,
    )
    try:
        deadline = time.monotonic() + 10
        while not marker.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        assert marker.exists()
        assert process.terminate(0.2) is True
        assert process.process.returncode is not None
        assert process.tree_is_running() is False
    finally:
        if process.tree_is_running():
            assert process.terminate(0.2) is True
        else:
            process.close()


@pytest.mark.parametrize("resource_kind", ["cpu", "memory"])
def test_process_enforces_resource_limits(tmp_path, resource_kind):
    marker = tmp_path / "resource-child-result"
    fixture = Path(__file__).with_name("process_cpu_fixture.py")
    env = {
        key: value
        for key, value in os.environ.items()
        if key in ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "LANG")
    }
    env["BRAIN_JOB_MEMORY_LIMIT_BYTES"] = str(128 * 1024**2)
    env["BRAIN_JOB_CPU_LIMIT_SECONDS"] = "2"
    process = ManagedProcess.launch(
        [sys.executable, str(fixture), str(marker), resource_kind],
        env,
        128 * 1024**2,
        2,
    )
    try:
        deadline = time.monotonic() + 15
        while not marker.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        assert marker.exists()
        assert process.wait_for_tree(15) is True
        assert process.process.returncode is not None
        assert process.tree_is_running() is False
        if resource_kind == "memory":
            assert process.process.returncode == 0
            assert marker.read_text(encoding="ascii") == "memory-limit-enforced"
    finally:
        if process.tree_is_running():
            assert process.terminate(0.2) is True
        else:
            process.close()


def test_parent_crash_stops_descendant_tree(tmp_path):
    marker = tmp_path / "crash-descendant-heartbeat"
    parent = Path(__file__).with_name("process_crash_parent.py")
    supervisor = subprocess.Popen(
        [sys.executable, str(parent), str(marker)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        supervisor.wait(timeout=15)
        assert supervisor.returncode == 0
        deadline = time.monotonic() + 10
        while not marker.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        assert marker.exists()
        stopped_value = marker.read_text(encoding="ascii")
        time.sleep(0.5)
        assert marker.read_text(encoding="ascii") == stopped_value
    finally:
        if supervisor.poll() is None:
            supervisor.kill()
            supervisor.wait()
