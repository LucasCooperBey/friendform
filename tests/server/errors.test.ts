// source: server/app.ts malformed JSON and bodies over 512kb

import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { loadConfig } from "../../server/config";
import { openDb } from "../../server/db/index";

let baseUrl = "";
let closeAll: () => Promise<void> = async () => {};

describe("API errors", () => {
  beforeAll(async () => {
    const db = await openDb({ memory: true });
    const app = createApp({
      config: loadConfig({
        NODE_ENV: "test",
        ADMIN_PASSWORD: "p".repeat(12),
        SESSION_SECRET: "s".repeat(32),
      }),
      db,
    });
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
});
