import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import pg from "pg";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  kind: "pglite" | "postgres";
  close(): Promise<void>;
}

type OpenDbOptions = ({ databaseUrl: string | null; dataDir: string } | { memory: true }) & {
  migrationsFolder?: string;
};

function migrationsFolderOf(opts: OpenDbOptions): string {
  return opts.migrationsFolder ?? path.resolve(process.cwd(), "drizzle");
}

function errorCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null || !("code" in err)) return null;
  return typeof err.code === "string" ? err.code : null;
}

export function isUniqueViolation(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    if (errorCode(current) === "23505") return true;
    if (!("cause" in current)) return false;
    current = current.cause;
  }
  return false;
}

async function openPglite(dataDir: string | undefined, migrationsFolder: string): Promise<DbHandle> {
  const client = dataDir === undefined ? new PGlite("memory://") : new PGlite(dataDir);
  await client.waitReady;
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return {
    db: asDb(db),
    kind: "pglite",
    close: () => client.close(),
  };
}

function asDb(db: PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>): Db {
  return db;
}

export async function openDb(opts: OpenDbOptions): Promise<DbHandle> {
  const migrationsFolder = migrationsFolderOf(opts);
  if ("memory" in opts) return openPglite(undefined, migrationsFolder);

  if (opts.databaseUrl) {
    const pool = new pg.Pool({ connectionString: opts.databaseUrl });
    const db = drizzlePg(pool, { schema });
    await migratePg(db, { migrationsFolder });
    return {
      db: asDb(db),
      kind: "postgres",
      close: () => pool.end(),
    };
  }

  const dir = path.resolve(opts.dataDir, "pglite");
  mkdirSync(dir, { recursive: true });
  return openPglite(dir, migrationsFolder);
}
