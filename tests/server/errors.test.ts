// source: server/app.ts malformed JSON, oversized bodies, charset, and error handling

import { createServer, request as httpRequest } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../server/app";
import { loadConfig } from "../../server/config";
import type { DbHandle } from "../../server/db/index";
import { openTestDb } from "../helpers/test-db";

const SECRET = "do-not-log-slice-1a";
const AFTER_HEADERS_SECRET = "do-not-log-after-headers";

let baseUrl = "";
let closeAll: () => Promise<void> = async () => {};

function installProbes(app: ReturnType<typeof createApp>): void {
  const stack = app.router.stack;
  const errorIndex = stack.findIndex((layer) => layer.handle.length >= 4);
  if (errorIndex < 0) throw new Error("error handler is missing");
  const kept = stack.splice(errorIndex);
  app.use((req, res, next) => {
    if (req.path === "/probe-error") {
      next(new Error(SECRET));
      return;
    }
    if (req.path === "/probe-after-headers") {
      res.write("partial");
      next(new Error(AFTER_HEADERS_SECRET));
      return;
    }
    next();
  });
  stack.push(...kept);
}

function connectionCloses(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let req: ReturnType<typeof httpRequest> | undefined;
    const timer = setTimeout(() => {
      settled = true;
      req?.destroy();
      reject(new Error("connection stayed open"));
    }, 2000);
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    req = httpRequest(url, (res) => {
      res.on("data", () => {});
      res.on("close", finish);
      res.on("aborted", finish);
      res.on("error", finish);
    });
    req.on("error", finish);
    req.on("close", finish);
    req.end();
  });
}

describe("API errors", () => {
  beforeAll(async () => {
    const db: DbHandle = await openTestDb();
    const app = createApp({
      config: loadConfig({
        NODE_ENV: "test",
        ADMIN_PASSWORD: "p".repeat(12),
        SESSION_SECRET: "s".repeat(32),
      }),
      db,
    });
    app.set("env", "production");
    installProbes(app);
    const server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a TCP port");
    baseUrl = `http://127.0.0.1:${address.port}`;
    closeAll = async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await db.close();
    };
  });

  afterAll(async () => {
    await closeAll();
  });

  it("returns invalid_json for malformed JSON on any API path", async () => {
    // source: malformed JSON is 400 { error: "invalid_json" }
    for (const path of ["/api/health", "/api/nope"]) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_json" });
    }
  });

  it("returns payload_too_large when the body is over 512kb", async () => {
    // source: a body over 512kb is 413 { error: "payload_too_large" }
    const response = await fetch(`${baseUrl}/api/health`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blob: "x".repeat(600 * 1024) }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload_too_large" });
  });

  it("returns unsupported_media_type for a latin1 JSON charset", async () => {
    // source: Content-Type application/json; charset=latin1 is 415 { error: "unsupported_media_type" }
    const response = await fetch(`${baseUrl}/api/health`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=latin1" },
      body: '{"a":1}',
    });
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: "unsupported_media_type" });
  });

  it("closes the connection when an error follows sent headers", async () => {
    // source: an error thrown after headers were sent ends the response instead of hanging
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let written = "";
    try {
      await connectionCloses(`${baseUrl}/probe-after-headers`);
      written = spy.mock.calls.map((call) => String(call[0])).join("");
    } finally {
      spy.mockRestore();
    }
    expect(written).not.toContain(AFTER_HEADERS_SECRET);
  });

  it("writes one request_failed line and hides the error message", async () => {
    // source: a 500 writes exactly one stderr line containing request_failed and not the error message
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let written = "";
    try {
      const response = await fetch(`${baseUrl}/probe-error`);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "internal_error" });
      written = spy.mock.calls.map((call) => String(call[0])).join("");
    } finally {
      spy.mockRestore();
    }
    const lines = written.split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("request_failed");
    expect(written).not.toContain(SECRET);
  });
});
