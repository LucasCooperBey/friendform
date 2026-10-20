// source: server/app.ts GET /api/health

import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { loadConfig } from "../../server/config";
import type { DbHandle } from "../../server/db/index";
import { openTestDb } from "../helpers/test-db";

let handle: DbHandle;
let baseUrl = "";
let closeServer: () => Promise<void> = async () => {};

describe("GET /api/health", () => {
  beforeAll(async () => {
    handle = await openTestDb();
    const app = createApp({
      config: loadConfig({
        NODE_ENV: "test",
        ADMIN_PASSWORD: "p".repeat(12),
        SESSION_SECRET: "s".repeat(32),
      }),
      db: handle,
    });
    const server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a TCP port");
    baseUrl = `http://127.0.0.1:${address.port}`;
    closeServer = () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
  });

  afterAll(async () => {
    await closeServer();
    await handle.close();
  });

  it("returns ok, the driver name, and version 0.1.0", async () => {
    // source: GET /api/health returns 200 { ok: true, db, version: "0.1.0" }
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, db: handle.kind, version: "0.1.0" });
  });

  it("sends nosniff and does not send x-powered-by", async () => {
    // source: GET /api/health carries x-content-type-options nosniff and no x-powered-by
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-powered-by")).toBeNull();
  });
});
