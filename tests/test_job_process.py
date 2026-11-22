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


def test_windows_job_enforces_cpu_time_limit(tmp_path):
    if os.name != "nt":
        pytest.skip("La limite CPU du Job Object est spécifique à Windows")
    marker = tmp_path / "cpu-child-started"
    fixture = Path(__file__).with_name("process_cpu_fixture.py")
    env = {
        key: value
        for key, value in os.environ.items()
        if key in ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "LANG")
    }
    process = ManagedProcess.launch(
        [sys.executable, str(fixture), str(marker)],
        env,
        512 * 1024**2,
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
