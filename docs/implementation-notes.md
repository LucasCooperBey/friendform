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

## Slice 1a fixes

1. Visibility uses the stored values. `validateResponses` trims every string answer, and every string inside an array answer, before `visibleQuestionIds`. Hidden answers still stay out of that calculation in `visibleQuestionIds`. Test: `tests/shared/validate.test.ts` "decides visibility from trimmed answers". The same rule for a later hidden answer is still covered by `tests/shared/logic.test.ts` "reveals a later question only from an answer on a question that is already visible".

2. Own properties only. `shared/validate.ts` and `shared/logic.ts` call `Object.hasOwn` before reading an answer by question id. Tests: `tests/shared/validate.test.ts` "treats prototype property names as unanswered when they are not own properties"; `tests/shared/logic.test.ts` "treats an unanswered constructor question as empty".

3. Error handler in `server/app.ts`. `tests/server/errors.test.ts` covers charset `latin1` (`415` `{ error: "unsupported_media_type" }`), an error after headers are sent (the client connection closes within 2 seconds, and stderr does not contain the error message), and a 500 (exactly one stderr line containing `request_failed` and not the error message). The existing malformed JSON and oversized body cases in that file still pass.

4. One log entry per line. `server/log.ts` replaces each carriage return and line feed in the message with the two characters `\n`. Test: `tests/server/log.test.ts` "replaces carriage returns and line feeds in the message".

5. Startup failures. `tests/server/startup.test.ts` "logs ECONNREFUSED when postgres refuses the connection" expects exit code 1, `ECONNREFUSED` on stderr, and no `listening` line. "logs listen_failed and does not log listening when the port is taken" expects `listen_failed`, `EADDRINUSE`, exit code 1, and no `listening` line.

6. Config message. The short-password problem text is now `ADMIN_PASSWORD must be at least 12 characters. Set a longer value, or run bun run setup --force to replace the password and the session secret.` Test: `tests/server/config.test.ts` "names every missing or invalid variable and tells you to run setup". Expected value change: that test previously asserted the message contains `ADMIN_PASSWORD` and `Run bun run setup.` Those two assertions remain. It now also asserts the full new sentence. The old problem sentence was `ADMIN_PASSWORD must be at least 12 characters. Run bun run setup.`

7. Boot check env. `scripts/boot-check.ts` sets `DATABASE_URL`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `TEST_DATABASE_URL`, `TRUST_PROXY`, `PUBLIC_URL`, and `WEBHOOK_SECRET` to `""`. `loadConfig` already treats `""` as unset for every one of those it reads (`DATABASE_URL`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `TRUST_PROXY`, `PUBLIC_URL`, `WEBHOOK_SECRET`). `TEST_DATABASE_URL` is not a `loadConfig` field. Test: `tests/server/config.test.ts` "treats an empty string as unset for the boot-check variables". No further config change was required.

8. Private data folder. `openDb` creates `<dataDir>/pglite` with `mkdirSync` mode `0o700` and then `chmodSync` `0o700`. Test: `tests/server/data-dir.test.ts` "creates the pglite folder with mode 0700". The test first sets that folder to mode `0755`, so the assertion fails if `chmodSync` is removed.

9. Typed enum columns. `server/db/schema.ts` exports `FORM_STATUSES` and `FORM_EVENT_TYPES` and passes them to `text(..., { enum })` on `forms.status` and `form_events.type`, keeping `notNull` and the `draft` default. `bun run db:generate` reported `No schema changes, nothing to migrate` and wrote nothing under `drizzle/`.

10. Browser-safe slugs. `shared/slug.ts` takes 4 bytes from `globalThis.crypto.getRandomValues` and no longer imports `node:crypto`. `newSlug` keeps the same signature, alphabet, and shape. Test: `tests/shared/slug.test.ts` "adds four random characters and always matches SLUG_RE" calls `newSlug("Café")` without a stub.

11. Test database guard. `openTestDb` throws, before connecting, when the protocol is not `postgres:` or `postgresql:`, when the URL has a query string, and when the database name does not end in `_test`. Tests: `tests/helpers/test-db.test.ts` (all three cases). Each test sets and restores `process.env.TEST_DATABASE_URL` and uses `127.0.0.1:1`, so it does not need a database.

12. Setup through a symlink. `scripts/setup.ts` compares `realpathSync` of each existing argv entry with `realpathSync` of its own file. Test: `tests/server/setup.test.ts` "writes .env when invoked through a symlink" (`node --import tsx <symlink>`, cwd in a temp folder, `.env` mode `0600`).

13. Example env. `.env.example` now has `# NODE_ENV=development` and `# HOST=127.0.0.1`. The production bind explanation on the `HOST` comment is unchanged. Every other line is unchanged. `tests/server/setup.test.ts` "fills blank secrets in a copy of .env.example and keeps every other line" reads the example file, so its expected lines follow the file. No hand-written expected value in that test was replaced.

14. `tests/server/errors.test.ts` opens the database with `openTestDb` from `tests/helpers/test-db.ts`.

15. Other tests required by this slice:
- trimmed visibility and own-property reads: the tests named in fixes 1 and 2
- spaced choice option: `tests/shared/validate.test.ts` "matches a trimmed answer to an option that still has surrounding spaces"
- later question: `tests/shared/form-schema.test.ts` "refuses a condition that references a later question" (`publishProblems`)
- `TRUST_PROXY=true` exact text: `tests/server/config.test.ts` "rejects TRUST_PROXY=true with its dedicated message"
- checkbox `minSelections`: `tests/shared/validate.test.ts` "refuses a checkbox answer with fewer selections than minSelections"
- whole milliseconds: `tests/server/db.test.ts` "stores a default created_at in whole milliseconds"
- phone letters: `tests/shared/validate.test.ts` "refuses a phone answer that contains letters"
- webhook URL: `tests/shared/form-schema.test.ts` "refuses a webhook URL that is not http or https"
- health headers: `tests/server/health.test.ts` "sends nosniff and does not send x-powered-by"
- latin1 body, headers-sent close, and the single 500 log line: the tests named in fix 3
- data folder mode and the test database guard: the tests named in fixes 8 and 11

Expected value changes: only the admin password sentence in `tests/server/config.test.ts` "names every missing or invalid variable and tells you to run setup", described in fix 6. No other test expectation was replaced.
