import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

const SESSION_SECRET = "a".repeat(48);

function hasStaticViteImport(source: string): boolean {
  const withoutDynamic = source.replace(/import\s*\(\s*["']vite["']\s*\)/g, "");
  return (
    /\bfrom\s+["']vite["']/.test(withoutDynamic) ||
    /\bimport\s+["']vite["']/.test(withoutDynamic) ||
    /\brequire\s*\(\s*["']vite["']\s*\)/.test(withoutDynamic)
  );
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("could not bind a port"));
        return;
      }
      const { port } = address;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function waitForExit(child: ChildProcess, ms: number): Promise<number | null | "timeout"> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), ms);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function main(): Promise<void> {
  const bundlePath = path.resolve(process.cwd(), "dist/server.mjs");
  const source = readFileSync(bundlePath, "utf8");
  if (hasStaticViteImport(source)) {
    throw new Error("dist/server.mjs contains a static import of vite");
  }

  const port = await freePort();
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "friendform-boot-"));
  const output: Buffer[] = [];
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.DATABASE_URL = "";
  env.AI_BASE_URL = "";
  env.AI_API_KEY = "";
  env.AI_MODEL = "";
  env.TEST_DATABASE_URL = "";
  env.TRUST_PROXY = "";
  env.PUBLIC_URL = "";
  env.WEBHOOK_SECRET = "";
  env.NODE_ENV = "production";
  env.HOST = "127.0.0.1";
  env.PORT = String(port);
  env.DATA_DIR = dataDir;
  env.ADMIN_PASSWORD = "boot-check-password";
  env.SESSION_SECRET = SESSION_SECRET;

  const child = spawn("node", [bundlePath], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    output.push(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output.push(chunk);
  });

  let failed: unknown;
  try {
    const deadline = Date.now() + 20_000;
    let last = "no response";
    let healthy = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`server exited early with code ${child.exitCode}`);
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        const body = await readBody(response);
        if (response.status === 200 && isRecord(body) && body.ok === true && body.db === "pglite") {
          healthy = true;
          break;
        }
        last = `${response.status} ${JSON.stringify(body)}`;
      } catch (err) {
        last = err instanceof Error ? err.message : "fetch failed";
      }
      await delay(200);
    }
    if (!healthy) throw new Error(`health check timed out: ${last}`);

    for (const route of ["/", "/forms/anything"]) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`);
      const type = response.headers.get("content-type") ?? "";
      const html = await response.text();
      if (response.status !== 200 || !type.includes("text/html") || !html.includes("<title>Friendform</title>")) {
        throw new Error(`${route} returned ${response.status} ${type}`);
      }
    }

    const missing = await fetch(`http://127.0.0.1:${port}/api/nope`);
    const missingBody = await readBody(missing);
    if (missing.status !== 404 || !isRecord(missingBody) || missingBody.error !== "not_found") {
      throw new Error(`/api/nope returned ${missing.status} ${JSON.stringify(missingBody)}`);
    }

    child.kill("SIGTERM");
    const code = await waitForExit(child, 5000);
    if (code === "timeout") throw new Error("server did not exit within 5 seconds of SIGTERM");
    if (code !== 0) throw new Error(`server exited with code ${code}`);
  } catch (err) {
    failed = err;
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child, 2000);
    }
    rmSync(dataDir, { recursive: true, force: true });
  }

  if (failed) {
    const message = failed instanceof Error ? failed.message : "boot check failed";
    process.stderr.write(`${message}\n`);
    const written = Buffer.concat(output).toString("utf8");
    if (written !== "") process.stderr.write(written);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "boot check failed";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
