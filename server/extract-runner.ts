import { execFile, fork, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ExtractError } from "./extract-error";

export type ChildJob = { kind: "pdf" | "docx"; data: Uint8Array };

export interface ExtractionOptions {
  timeoutMs: number;
  maxRssMb: number;
  heapMb: number;
  pollMs: number;
  childPath?: string;
  onSpawn?: (pid: number) => void;
}

export interface Extractor {
  run(job: ChildJob, signal?: AbortSignal): Promise<string>;
  readonly busy: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RSS_MB = 512;
const DEFAULT_HEAP_MB = 256;
const MAX_TEXT = 40_000;
const EXIT_GRACE_MS = 50;

type Decision = { kind: "text"; text: string } | { kind: "error"; error: ExtractError };

interface Launch {
  scriptPath: string;
  execArgv: string[];
}

function launchOf(childPath: string | undefined, heapMb: number): Launch {
  const heap = `--max-old-space-size=${heapMb}`;
  if (childPath !== undefined) return { scriptPath: childPath, execArgv: [heap] };
  if (import.meta.url.endsWith(".mjs")) {
    return {
      scriptPath: fileURLToPath(new URL("./extract-child.mjs", import.meta.url)),
      execArgv: [heap],
    };
  }
  return {
    scriptPath: fileURLToPath(new URL("./extract-child.ts", import.meta.url)),
    execArgv: ["--import", "tsx", heap],
  };
}

function parseReply(value: unknown): { ok: true; text: string } | { ok: false; code: "unsupported" | "empty" } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("ok" in value)) return undefined;
  if (value.ok === true && "text" in value && typeof value.text === "string") {
    return { ok: true, text: value.text };
  }
  if (value.ok === false && "code" in value && (value.code === "unsupported" || value.code === "empty")) {
    return { ok: false, code: value.code };
  }
  return undefined;
}

function integerKb(text: string): number | undefined {
  const line = text.split("\n")[0]?.trim() ?? "";
  if (line === "") return undefined;
  const value = Number(line);
  if (!Number.isInteger(value) || value < 0) return undefined;
  return value;
}

async function readProcRssKb(pid: number): Promise<number | undefined> {
  try {
    const text = await readFile(`/proc/${pid}/status`, "utf8");
    const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(text);
    const digits = match?.[1];
    if (digits === undefined) return undefined;
    return integerKb(digits);
  } catch {
    return undefined;
  }
}

function readPsRssKb(pid: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8", timeout: 2_000 }, (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }
      resolve(integerKb(typeof stdout === "string" ? stdout : ""));
    });
  });
}

function readRssKb(pid: number): Promise<number | undefined> {
  if (process.platform === "linux") return readProcRssKb(pid);
  return readPsRssKb(pid);
}

interface JobArgs {
  job: ChildJob;
  signal: AbortSignal | undefined;
  timeoutMs: number;
  maxRssMb: number;
  pollMs: number;
  launch: Launch;
  onSpawn: ((pid: number) => void) | undefined;
  claim: (child: ChildProcess) => void;
  release: (child: ChildProcess) => void;
}

function startJob(args: JobArgs): Promise<string> {
  const child = fork(args.launch.scriptPath, [], {
    execArgv: args.launch.execArgv,
    env: { PATH: process.env.PATH ?? "" },
    serialization: "advanced",
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  args.claim(child);

  return new Promise((resolve, reject) => {
    let decision: Decision | undefined;
    let settled = false;
    let readingRss = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    function clearTimers(): void {
      if (pollTimer !== undefined) clearInterval(pollTimer);
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      pollTimer = undefined;
      timeoutTimer = undefined;
      graceTimer = undefined;
    }

    function settle(): void {
      if (settled) return;
      settled = true;
      clearTimers();
      if (args.signal !== undefined) args.signal.removeEventListener("abort", onAbort);
      args.release(child);
      const chosen = decision ?? { kind: "error" as const, error: new ExtractError("too_complex") };
      if (chosen.kind === "text") resolve(chosen.text);
      else reject(chosen.error);
    }

    function kill(): void {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        child.kill("SIGKILL");
      } catch {
        // The process is already gone.
      }
    }

    function finish(next: Decision): void {
      if (decision !== undefined) return;
      decision = next;
      clearTimers();
      if (args.signal !== undefined) args.signal.removeEventListener("abort", onAbort);
      kill();
      if (child.exitCode !== null || child.signalCode !== null) settle();
    }

    function onAbort(): void {
      finish({ kind: "error", error: new ExtractError("aborted") });
    }

    timeoutTimer = setTimeout(() => {
      finish({ kind: "error", error: new ExtractError("too_complex") });
    }, args.timeoutMs);

    pollTimer = setInterval(() => {
      if (readingRss || decision !== undefined || child.exitCode !== null) return;
      const pid = child.pid;
      if (pid === undefined) return;
      readingRss = true;
      void readRssKb(pid).then((rssKb) => {
        readingRss = false;
        if (decision !== undefined || rssKb === undefined) return;
        if (rssKb > args.maxRssMb * 1024) finish({ kind: "error", error: new ExtractError("too_complex") });
      }).catch(() => {
        readingRss = false;
      });
    }, args.pollMs);

    child.on("message", (message: unknown) => {
      const reply = parseReply(message);
      if (reply === undefined) {
        finish({ kind: "error", error: new ExtractError("too_complex") });
        return;
      }
      if (!reply.ok) {
        finish({ kind: "error", error: new ExtractError(reply.code) });
        return;
      }
      finish({ kind: "text", text: reply.text.slice(0, MAX_TEXT) });
    });

    child.once("exit", () => {
      if (pollTimer !== undefined) clearInterval(pollTimer);
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      pollTimer = undefined;
      timeoutTimer = undefined;
      args.release(child);
      if (decision !== undefined) {
        settle();
        return;
      }
      graceTimer = setTimeout(() => {
        if (decision === undefined) decision = { kind: "error", error: new ExtractError("too_complex") };
        settle();
      }, EXIT_GRACE_MS);
    });

    child.once("error", () => {
      if (decision === undefined) decision = { kind: "error", error: new ExtractError("too_complex") };
      kill();
      args.release(child);
      settle();
    });

    if (args.signal !== undefined) {
      args.signal.addEventListener("abort", onAbort, { once: true });
      if (args.signal.aborted) onAbort();
    }
    if (decision === undefined && typeof child.pid === "number") args.onSpawn?.(child.pid);

    try {
      child.send({ kind: args.job.kind, data: args.job.data }, (sendError) => {
        if (sendError === null || decision !== undefined) return;
        finish({ kind: "error", error: new ExtractError("too_complex") });
      });
    } catch {
      finish({ kind: "error", error: new ExtractError("too_complex") });
    }
  });
}

export function createExtractor(opts?: Partial<ExtractionOptions>): Extractor {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRssMb = opts?.maxRssMb ?? DEFAULT_MAX_RSS_MB;
  const heapMb = opts?.heapMb ?? DEFAULT_HEAP_MB;
  const pollMs = opts?.pollMs ?? (process.platform === "linux" ? 50 : 200);
  const childPath = opts?.childPath;
  const onSpawn = opts?.onSpawn;
  const launch = launchOf(childPath, heapMb);
  let active: ChildProcess | undefined;

  return {
    get busy() {
      return active !== undefined;
    },
    run(job, signal) {
      if (active !== undefined) return Promise.reject(new ExtractError("busy"));
      if (signal?.aborted) return Promise.reject(new ExtractError("aborted"));
      return startJob({
        job,
        signal,
        timeoutMs,
        maxRssMb,
        pollMs,
        launch,
        onSpawn,
        claim(child) {
          active = child;
        },
        release(child) {
          if (active === child) active = undefined;
        },
      });
    },
  };
}
