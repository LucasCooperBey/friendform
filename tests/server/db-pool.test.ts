// source: server/db/index.ts attaches a Pool error listener

import { afterEach, expect, it, vi } from "vitest";
import { createPostgresPool } from "../../server/db/index";

const pools: Array<{ end(): Promise<void> }> = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const pool of pools.splice(0)) await pool.end();
});

it("logs an idle pool error without the connection string and stays up", async () => {
  // source: an idle-client error is logged through the app logger and does not crash the process
  const connectionString = "postgres://owner:pool-secret-value@127.0.0.1:1/friendform";
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const pool = createPostgresPool(connectionString);
  pools.push(pool);
  const err = new Error("idle client disconnected");
  Object.assign(err, { connectionString });
  expect(pool.listenerCount("error")).toBe(1);
  expect(() => {
    pool.emit("error", err, { connectionString });
  }).not.toThrow();
  const written = spy.mock.calls.map((call) => String(call[0])).join("");
  expect(written).toContain("error postgres_pool_error");
  expect(written).toContain("idle client disconnected");
  expect(written).not.toContain("pool-secret-value");
  expect(written).not.toContain(connectionString);
});
