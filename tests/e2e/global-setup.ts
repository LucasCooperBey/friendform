import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const dataRoot = path.resolve(process.cwd(), ".e2e-data");
const pidFile = path.join(dataRoot, "ai-fake.pid");
const logFile = path.join(dataRoot, "ai-fake.log");
const scriptPath = path.resolve(process.cwd(), "tests/e2e/global-setup.ts");

async function serve(): Promise<void> {
  const loaded: { startAiFake: (port?: number) => Promise<unknown> } = await import("../server/ai-fake");
  await loaded.startAiFake(4180);
  await new Promise<void>(() => undefined);
}

if (process.env.FRIENDFORM_E2E_FAKE === "1") {
  const keepAlive = setInterval(() => undefined, 60_000);
  void serve().catch((error: unknown) => {
    clearInterval(keepAlive);
    const message = error instanceof Error ? error.stack ?? error.message : "fake AI server failed";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}

function readPid(): number | undefined {
  try {
    const pid = Number(readFileSync(pidFile, "utf8"));
    if (Number.isInteger(pid) && pid > 0) return pid;
  } catch {
    return undefined;
  }
  return undefined;
}

function stopPid(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // The fake already exited.
  }
}

async function waitUntilGone(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export async function stopFakeFromPidFile(): Promise<void> {
  const pid = readPid();
  if (pid !== undefined) {
    stopPid(pid);
    await waitUntilGone(pid);
  }
  rmSync(pidFile, { force: true });
}

async function waitUntilListening(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 10_000;
  let last = "not started";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const log = readFileSync(logFile, "utf8");
      throw new Error(`fake AI server exited ${child.exitCode}: ${log}`);
    }
    try {
      const response = await fetch("http://127.0.0.1:4180/e2e/requests");
      if (response.ok) return;
      last = String(response.status);
    } catch (error) {
      last = error instanceof Error ? error.message : "fetch failed";
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const log = readFileSync(logFile, "utf8");
  throw new Error(`fake AI server did not listen: ${last}\n${log}`);
}

export default async function globalSetup(): Promise<void> {
  const stale = readPid();
  if (stale !== undefined) {
    stopPid(stale);
    await waitUntilGone(stale);
  }
  mkdirSync(dataRoot, { recursive: true });
  const logFd = openSync(logFile, "w");
  const child = spawn("bun", [scriptPath], {
    env: { ...process.env, FRIENDFORM_E2E_FAKE: "1" },
    stdio: ["ignore", "ignore", logFd],
    detached: false,
  });
  closeSync(logFd);
  if (child.pid === undefined) throw new Error("fake AI server did not start");
  writeFileSync(pidFile, String(child.pid));
  try {
    await waitUntilListening(child);
  } catch (error) {
    stopPid(child.pid);
    rmSync(pidFile, { force: true });
    throw error;
  }
}
