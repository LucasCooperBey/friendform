// source: server/db/index.ts creates the PGlite directory as mode 0700

import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../../server/db/index";

describe("openDb data directory", () => {
  it("creates the pglite folder with mode 0700", async () => {
    // source: openDb with a temp dataDir leaves pglite at mode 0700, including a folder that already exists
    const dataDir = mkdtempSync(path.join(tmpdir(), "friendform-pglite-"));
    const dir = path.join(dataDir, "pglite");
    try {
      mkdirSync(dir, { recursive: true });
      chmodSync(dir, 0o755);
      const handle = await openDb({
        databaseUrl: null,
        dataDir,
        migrationsFolder: path.resolve("drizzle"),
      });
      try {
        expect(statSync(dir).mode & 0o777).toBe(0o700);
      } finally {
        await handle.close();
      }
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
