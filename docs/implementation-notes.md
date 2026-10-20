# Implementation notes

## Database type

`Db` is `PgDatabase<PgQueryResultHKT, typeof schema>` from `drizzle-orm/pg-core`, the type named in the spec. `PgliteDatabase<typeof schema>` and `NodePgDatabase<typeof schema>` are both assignable to it. `asDb` in `server/db/index.ts` returns the driver database as `Db` and uses no assertion. `tsc --noEmit --skipLibCheck` accepts that assignment.

`count()` from `drizzle-orm` is a number on both drivers. A unique violation is Postgres code `23505` on the error, or on `cause` when Drizzle wraps the driver error in `DrizzleQueryError`.

## Migrations

`bunx drizzle-kit generate --name init` wrote `drizzle/0000_init.sql` and `drizzle/meta/`. `server/index.ts` passes `path.resolve(process.cwd(), "drizzle")` into `openDb`. The folder is not derived from `import.meta.url`, because the server is bundled to `dist/server.mjs`. PGlite uses `drizzle-orm/pglite/migrator`. Postgres uses `drizzle-orm/node-postgres/migrator`. `{ memory: true }` opens `new PGlite("memory://")`. A missing `databaseUrl` opens a directory at `<dataDir>/pglite`.

## Postgres 15

`TEST_DATABASE_URL=postgresql://localhost:5432/friendform_test bun run test` against PostgreSQL 15.15 (Homebrew) exited 0: 10 files, 45 tests. The same suite without `TEST_DATABASE_URL` (embedded PGlite) also exited 0: 10 files, 45 tests. No driver difference required a code change. Precision-3 timestamps round-tripped to the written `Date` on both drivers. Cascade deletes, the event unique constraint, and `isUniqueViolation` matched. `fileParallelism` is false when `TEST_DATABASE_URL` is set, because that database is shared.

## Typecheck

`bun run typecheck` (`tsc --noEmit`) exits 2 with 76 errors. Every error is under `node_modules`. None are in this repository's source. `tsc --noEmit --skipLibCheck` exits 0.

The errors are in `drizzle-orm` 0.45.2 and `@electric-sql/pglite` 0.5.8 when checked by TypeScript 5.9.3. `drizzle-orm/column-builder.d.ts` imports every dialect, so checking `pg-core` also checks the gel, mysql, singlestore, and sqlite declaration files. Those files report missing modules (`gel`, `mysql2`) and incorrect class implementations. `pg-core/query-builders/query.d.ts` itself reports TS2420. PGlite's generated declarations refer to the `Emscripten` namespace.

Counts: TS2515 33, TS2344 18, TS2307 11, TS2420 5, TS2503 4, TS2559 2, TS2693 1, TS2416 1, TS2304 1.

`skipLibCheck` is the compiler option that skips those declaration files. Writing it into `tsconfig.json` is blocked by the local config-protection hook (`Cannot relax TypeScript strict settings`). The spec's tsconfig list does not include it, and the pinned versions cannot be changed.

## express-rate-limit

`express-rate-limit` 8.5.2 is installed because the spec lists it. This slice does not mount a limiter. Authentication and form routes are out of scope.

## Client CSS

`client/index.html` links `/src/index.css`. `main.tsx` does not import the stylesheet. A `declare module "*.css"` inside that module file is TS2664, and a separate declaration file is not in the file list.

## Boot check secret

`scripts/boot-check.ts` sets `SESSION_SECRET` to 48 `a` characters. That is a fixed 48-character secret. A hex literal was rejected by the secret scanner.

## Visibility input

`validateResponses` copies the raw object into a `Responses` map before `visibleQuestionIds`. Only strings, finite numbers, and arrays of strings are kept. Other values are not `ResponseValue`, so they do not affect visibility.

## Other

`tsconfig.json` also sets `baseUrl`, `esModuleInterop`, `forceConsistentCasingInFileNames`, `resolveJsonModule`, and `noEmit`. `baseUrl` is what the path aliases need. The typecheck script is still `tsc --noEmit`.

Vite 8 prints a deprecation from `@vitejs/plugin-react` 4.7.0 about the `esbuild` option. The spec pins that plugin, so the warning stays. The build still writes `dist/public` and `dist/server.mjs`. The bundle contains `await import("vite")` and no static import of `vite`.

`bun install` warns that `vite@8.1.3` does not match the peer range of `@vitejs/plugin-react` 4.7.0. The versions stay pinned.
