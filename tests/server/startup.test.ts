// source: server/index.ts logs listen failures and connection failures, then exits 1

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

function childEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    ADMIN_PASSWORD: "p".repeat(12),
    SESSION_SECRET: "s".repeat(32),
    DATABASE_URL: "",
    AI_BASE_URL: "",
    AI_API_KEY: "",
    AI_MODEL: "",
    TEST_DATABASE_URL: "",
    TRUST_PROXY: "",
    PUBLIC_URL: "",
    WEBHOOK_SECRET: "",
    ...extra,
  };
}

function runServer(env: NodeJS.ProcessEnv): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("node", ["--import", "tsx", path.resolve("server/index.ts")], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
    timeout: 25000,
    killSignal: "SIGKILL",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("server startup", () => {
  it("logs ECONNREFUSED when postgres refuses the connection", () => {
    // source: main().catch logs the message and code when postgres refuses the connection
    const result = runServer(
      childEnv({
        DATABASE_URL: "postgresql://127.0.0.1:1/friendform_test",
        PORT: "3999",
      }),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ECONNREFUSED");
    expect(`${result.stdout}${result.stderr}`).not.toContain("listening");
  });

  it("logs listen_failed and does not log listening when the port is taken", async () => {
    // source: a failed bind logs listen_failed with the error code, closes, and exits 1
    const blocker = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", () => resolve());
    });
    const address = blocker.address();
    if (address === null || typeof address === "string") throw new Error("expected a TCP port");
    const dataDir = mkdtempSync(path.join(tmpdir(), "friendform-listen-"));
    try {
      const result = runServer(
        childEnv({
          PORT: String(address.port),
          DATA_DIR: dataDir,
        }),
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("listen_failed");
      expect(result.stderr).toContain("EADDRINUSE");
      expect(`${result.stdout}${result.stderr}`).not.toContain("listening");
    } finally {
      await new Promise<void>((resolve, reject) => {
        blocker.close((err) => (err ? reject(err) : resolve()));
      });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
