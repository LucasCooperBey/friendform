import os from "node:os";
import pg from "pg";
import { openDb, type DbHandle } from "../../server/db/index";

function databaseName(url: string): string {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (name === "") throw new Error("TEST_DATABASE_URL is missing a database name");
  return name;
}

export async function openTestDb(): Promise<DbHandle> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return openDb({ memory: true });

  const name = databaseName(url);
  if (!name.endsWith("_test")) {
    throw new Error(`TEST_DATABASE_URL database name must end in _test, got ${name}`);
  }

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
