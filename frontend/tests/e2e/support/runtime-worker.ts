import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

/** Runtime-only worker; migration credentials never reach a child process. */
export function startRuntimeWorker(): ChildProcess {
  if (!process.env.BRAIN_DATABASE_URL)
    throw new Error("Runtime database required");
  const allowed = new Set([
    "PATH",
    "Path",
    "SYSTEMROOT",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "HOME",
    "LANG",
    "APPDATA",
    "LOCALAPPDATA",
    "USERPROFILE",
    "PYTHONPATH",
    "VIRTUAL_ENV",
    "BRAIN_DATABASE_URL",
  ]);
  return spawn(
    process.env.STUDIO_PYTHON || "python",
    ["-m", "brain.platform.worker"],
    {
      cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => allowed.has(key)),
      ),
      stdio: "ignore",
      windowsHide: true,
    },
  );
}
export async function stopRuntimeWorker(worker: ChildProcess) {
  if (worker.exitCode !== null || worker.signalCode !== null) return;
  const stopped = once(worker, "exit");
  worker.kill("SIGTERM");
  await stopped;
}
