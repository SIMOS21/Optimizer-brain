"""Cross-platform process-tree supervision for optimization children."""

import ctypes
import os
import signal
import subprocess
import sys
import time
from ctypes import wintypes


if os.name == "nt":

    class _BasicLimitInformation(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong),
            ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class _IoCounters(ctypes.Structure):
        _fields_ = [
            (name, ctypes.c_ulonglong)
            for name in (
                "ReadOperationCount",
                "WriteOperationCount",
                "OtherOperationCount",
                "ReadTransferCount",
                "WriteTransferCount",
                "OtherTransferCount",
            )
        ]

    class _ExtendedLimitInformation(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", _BasicLimitInformation),
            ("IoInfo", _IoCounters),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    class _BasicAccountingInformation(ctypes.Structure):
        _fields_ = [
            ("TotalUserTime", ctypes.c_longlong),
            ("TotalKernelTime", ctypes.c_longlong),
            ("ThisPeriodTotalUserTime", ctypes.c_longlong),
            ("ThisPeriodTotalKernelTime", ctypes.c_longlong),
            ("TotalPageFaultCount", wintypes.DWORD),
            ("TotalProcesses", wintypes.DWORD),
            ("ActiveProcesses", wintypes.DWORD),
            ("TotalTerminatedProcesses", wintypes.DWORD),
        ]


def enable_child_subreaper() -> None:
    if sys.platform != "linux":
        return
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


class ManagedProcess:
    def __init__(self, process: subprocess.Popen[bytes], job_handle: int | None):
        self.process = process
        self.job_handle = job_handle
        self.process_group_id = process.pid
        self.windows = os.name == "nt"

    @classmethod
    def launch(
        cls, command: list[str], env: dict[str, str], memory_limit_bytes: int
    ) -> "ManagedProcess":
        if os.name == "nt":
            return cls._launch_windows(command, env, memory_limit_bytes)
        if sys.platform != "linux":
            raise RuntimeError(
                "Les workers d'optimisation sont pris en charge sous Linux et Windows"
            )
        enable_child_subreaper()
        process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=env,
            close_fds=True,
            start_new_session=True,
        )
        managed = cls(process, None)
        try:
            cls._release_start_gate(process)
        except BaseException:
            while not managed.terminate(1.0):
                time.sleep(0.1)
            raise
        return managed

    @classmethod
    def _launch_windows(
        cls, command: list[str], env: dict[str, str], memory_limit_bytes: int
    ) -> "ManagedProcess":
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
        kernel.CreateJobObjectW.restype = wintypes.HANDLE
        kernel.SetInformationJobObject.argtypes = [
            wintypes.HANDLE,
            ctypes.c_int,
            wintypes.LPVOID,
            wintypes.DWORD,
        ]
        kernel.SetInformationJobObject.restype = wintypes.BOOL
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel.AssignProcessToJobObject.restype = wintypes.BOOL
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]

        job = kernel.CreateJobObjectW(None, None)
        if not job:
            raise ctypes.WinError(ctypes.get_last_error())
        process = None
        managed = None
        try:
            limits = _ExtendedLimitInformation()
            limits.BasicLimitInformation.LimitFlags = 0x2000 | 0x200
            limits.JobMemoryLimit = memory_limit_bytes
            if not kernel.SetInformationJobObject(
                job, 9, ctypes.byref(limits), ctypes.sizeof(limits)
            ):
                raise ctypes.WinError(ctypes.get_last_error())
            process = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env=env,
                close_fds=True,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
            )
            process_handle = kernel.OpenProcess(0x0100 | 0x0001 | 0x1000, False, process.pid)
            if not process_handle:
                raise ctypes.WinError(ctypes.get_last_error())
            try:
                if not kernel.AssignProcessToJobObject(job, process_handle):
                    raise ctypes.WinError(ctypes.get_last_error())
            finally:
                kernel.CloseHandle(process_handle)
            managed = cls(process, job)
            cls._release_start_gate(process)
            return managed
        except BaseException:
            if process is not None:
                if managed is None:
                    process.kill()
                    process.wait()
                    kernel.CloseHandle(job)
                else:
                    while not managed.terminate(1.0):
                        time.sleep(0.1)
            else:
                kernel.CloseHandle(job)
            raise

    @staticmethod
    def _release_start_gate(process: subprocess.Popen[bytes]) -> None:
        if process.stdin is None:
            raise RuntimeError("Canal de démarrage du processus indisponible")
        process.stdin.write(b"START\n")
        process.stdin.flush()
        process.stdin.close()

    def tree_is_running(self) -> bool:
        if self.windows and self.job_handle is None:
            return self.process.poll() is None
        if self.job_handle is not None:
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.QueryInformationJobObject.argtypes = [
                wintypes.HANDLE,
                ctypes.c_int,
                wintypes.LPVOID,
                wintypes.DWORD,
                ctypes.POINTER(wintypes.DWORD),
            ]
            kernel.QueryInformationJobObject.restype = wintypes.BOOL
            accounting = _BasicAccountingInformation()
            if not kernel.QueryInformationJobObject(
                self.job_handle, 1, ctypes.byref(accounting), ctypes.sizeof(accounting), None
            ):
                raise ctypes.WinError(ctypes.get_last_error())
            return bool(accounting.ActiveProcesses > 0)
        try:
            os.killpg(self.process_group_id, 0)  # type: ignore[attr-defined]
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True

    def wait_for_tree(self, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        while True:
            self.process.poll()
            if self.process.returncode is not None and self.job_handle is None:
                self._reap_adopted_children()
            if not self.tree_is_running():
                self.process.wait()
                return True
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.05)

    def terminate(self, grace_seconds: float) -> bool:
        if self.tree_is_running():
            try:
                if self.job_handle is not None:
                    self.process.send_signal(signal.CTRL_BREAK_EVENT)
                else:
                    os.killpg(self.process_group_id, signal.SIGTERM)  # type: ignore[attr-defined]
            except (OSError, ValueError):
                pass
        if self.wait_for_tree(grace_seconds):
            self.close()
            return True

        if self.job_handle is not None:
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
            kernel.TerminateJobObject.restype = wintypes.BOOL
            if not kernel.TerminateJobObject(self.job_handle, 1):
                raise ctypes.WinError(ctypes.get_last_error())
        else:
            try:
                os.killpg(self.process_group_id, signal.SIGKILL)  # type: ignore[attr-defined]
            except ProcessLookupError:
                pass
        if not self.wait_for_tree(max(grace_seconds, 1.0)):
            return False
        self.close()
        return True

    def close(self) -> None:
        if self.job_handle is not None:
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            if not kernel.CloseHandle(self.job_handle):
                raise ctypes.WinError(ctypes.get_last_error())
            self.job_handle = None

    def _reap_adopted_children(self) -> None:
        while True:
            try:
                child_pid, _ = os.waitpid(-self.process_group_id, getattr(os, "WNOHANG", 1))
            except ChildProcessError:
                return
            if child_pid == 0:
                return
