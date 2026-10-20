import os from "node:os";
import pg from "pg";
import { openDb, type DbHandle } from "../../server/db/index";

function assertTestDatabaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("TEST_DATABASE_URL protocol must be postgres: or postgresql:");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("TEST_DATABASE_URL protocol must be postgres: or postgresql:");
  }
  if (parsed.search !== "") {
    throw new Error("TEST_DATABASE_URL must not include a query string");
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (name === "") throw new Error("TEST_DATABASE_URL is missing a database name");
  if (!name.endsWith("_test")) {
    throw new Error(`TEST_DATABASE_URL database name must end in _test, got ${name}`);
  }
}

export async function openTestDb(): Promise<DbHandle> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return openDb({ memory: true });
  assertTestDatabaseUrl(url);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }

  return openDb({ databaseUrl: url, dataDir: os.tmpdir() });
}
