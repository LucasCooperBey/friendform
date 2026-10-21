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

## Server API slice, incomplete because localhost listen is blocked

The implementation adds session authentication, API origin and media-type checks, rate limiters, owner and public routers, CSV export, and webhook payload/delivery code. This is an unverified draft. No foundation file, dependency, migration, or existing test was changed. No commit or push was run.

Implementation decisions:
- The session signing key is cached per AppDeps object and initialized while createApp constructs the auth router. It combines SESSION_SECRET and ADMIN_PASSWORD as specified.
- Publication locks the form row inside a transaction before calculating the next version. Both schemas are parsed and normalized when comparing draft and published content.
- Submission pagination uses both created_at and id. One column builder supplies historical question columns to the submissions list and CSV, with response-only keys included only for CSV.
- Webhook delivery races fetch against AbortSignal.timeout so an injected fetch that ignores its signal still terminates. Delivery recording locks the form row while inserting and pruning to 100 rows. Background recording errors log identifiers only.
- The installed express-rate-limit package is 8.5.2; its declarations export ipKeyGenerator, which the limiters use. The architect supplied the registry receipt: maintainers nfriedly and gamemaker1, first release 1.0.0 on 2014-12-11, latest 8.7.1 on 2026-10-06, pinned 8.5.2 published 2026-05-14. No registry request was made.

Verification attempted:

```text
$ bunx tsc --noEmit --extendedDiagnostics >| node_modules/.tsc-own.out 2>&1; rg 'error TS|^Check time' node_modules/.tsc-own.out | rg -v '^node_modules/'
Check time:                  4.48s
```

The filtering command exited 0 with no source diagnostics. This ran after the server implementation and before the new test files, so it does not verify the final test code. The underlying full compiler run still includes the previously documented dependency declaration errors; this was not a clean full typecheck.

```text
$ bun run test -- tests/server/auth.test.ts
$ vitest run tests/server/auth.test.ts

 RUN  v4.1.8 /Users/lucascooper-bey/Developer/lucface/oss/friendform

 Test Files  1 failed (1)
      Tests  6 failed (6)
   Start at  14:37:14
   Duration  25.66s (transform 1.98s, setup 0ms, import 7.92s, tests 15.14s, environment 0ms)

Error: listen EPERM: operation not permitted 127.0.0.1
error: script "test" exited with code 1
```

All six authentication tests failed while creating the local HTTP server, before exercising a route. The helper closes its database when listen fails. No server was left listening. The sandbox contract requires stopping on this block; no alternate host, transport, or permission workaround was attempted.

Outstanding work: create publish.test.ts, public.test.ts, submissions.test.ts, csv.test.ts, webhooks.test.ts and stats.test.ts; verify the existing new auth, security and forms tests; prove test sensitivity; review the implementation against the full interfaces; and run every VERIFICATION step. The full PGlite suite, Postgres suite, build, boot check, final compiler filter and migration-generation check were not run after the block. No existing test assertion was changed.

GAPS: sandbox denies local HTTP listen with EPERM; implementation and integration coverage are incomplete and unverified.

## Server API slice, finished

The section above records the draft that could not listen. This section records the finish of the same slice.

Content-Security-Policy. Helmet sets the production policy, with `useDefaults: false` and `frameguard` off. Express `finalhandler`, `send`, and `serve-static` then replace that header with `default-src 'none'` on their own 404 and error documents. `/f/example` has no route inside `createApp`, so a production request for it was reading that replacement. A terminal 404 registered in `createApp` would run before `server/index.ts` mounts the client, and the boot check requires `/` and `/forms/anything` to serve the SPA. `securityHeaders` wraps `res.setHeader` and drops a later write of exactly `default-src 'none'` when a policy is already present. In development and test it drops that value even when no policy is present, so the header stays absent. Other CSP values, including helmet's own policy, are written through. Unmatched paths still fall through to the client mount.

Webhook delivery errors. A non-2xx response is recorded as `http_<status>`. An abort is `timeout`. Any other thrown error is `delivery_failed`. The spec asks for a short error and names `timeout` for an abort.

CSV. `csvCell` prefixes a leading `=`, `+`, `-`, `@`, tab, or carriage return, then quotes the cell when it still contains a comma, a double quote, a carriage return, or a line feed. A value that starts with a carriage return is therefore both prefixed and quoted. `toCsv` starts with U+FEFF. `Response.text()` strips that character, so `tests/server/csv.test.ts` checks the raw bytes `EF BB BF`.

Test sensitivity. Replacing `csvCell` with `return value` makes `tests/server/csv.test.ts` "guards formula prefixes and quotes cells with the RFC 4180 rules" fail: expected `'=1+1`, received `=1+1`. The function was restored before the verification run.

express-rate-limit. The registry receipt in the previous section stands. This run did not contact a registry. The installed 8.5.2 declarations export `ipKeyGenerator`.

Expected value changes: none. The production CSP test in `tests/server/security.test.ts` was already the correct policy. Two type annotations were added so `tsc` reports no errors outside `node_modules`, and no expected value changed. In `tests/server/security.test.ts`, the blocked header list is `Array<Record<string, string>>`, because the inferred union was not assignable to `HeadersInit`. In `tests/server/submissions.test.ts`, the pagination `path` and `page` locals are annotated `string` and `Page`, because the cursor loop otherwise inferred `any`.

## Client foundation, slice 2a

The committed server wins where the client spec names a shape the routes do not use. The client adapts. No server file changed.

Session. `GET /api/auth/session` for an anonymous visitor is `{ authenticated: false }` and omits `publicUrl` and `aiEnabled`. The client treats those missing fields as `null` and `false`. A signed-in session includes both. `publicUrl` is `null` when `PUBLIC_URL` is unset. `POST /api/auth/login` returns 204 with no body, 401 `{ error: "invalid_password" }`, or 429 `{ error: "too_many_requests" }`. The sign-in page owns the 401 sentence "That password didn't match." and the 429 sentence "Too many attempts. Try again in 15 minutes." `POST /api/auth/logout` is 204.

Forms. `GET /api/forms` returns `{ forms: FormSummary[] }`. Status on the wire is `draft`, `published`, or `closed`. The list badge says Live for `published`. `POST /api/forms` returns 201 `{ form: FormDetail }`. A blank form posts `{ title: "Untitled form" }` and omits `draftSchema`, which the server defaults. A template posts `{ title, draftSchema }`. `POST /api/forms/:id/duplicate` has an empty body and returns 201 `{ form }`. `DELETE /api/forms/:id` returns 204.

Public form. `GET /api/public/forms/:slug` returns 200 with `slug`, `title`, `description`, `version`, `schema`, and `settings`. Settings also include `allowAutofill`, which this slice ignores. 404 is `{ error: "not_found" }` for a missing or unpublished form. 410 is `{ error: "closed", title, closedMessage }` and does not include a theme, so a closed form does not override the owner theme. `POST .../submissions` returns 201 `{ id }`. The view's `onSubmit` adapts that to `{ ok: true }`. A 400 body is `{ error: "invalid_responses", errors }` or `{ error: "invalid_body" }`. The string entries in `errors` are shown on the matching questions. 429 uses the page sentence "Too many submissions from your network. Try again in a few minutes." `POST .../events` returns 204. `referrer` is omitted when `document.referrer` is empty. The honeypot does not count as the first input, so a start event is the first question change. The submitted responses are the object returned by `validateResponses`, which drops hidden questions. Preview mode does not call `onSubmit`.

Vitest. The client project is happy-dom with `tests/client/setup.ts`. The node project also includes `tests/helpers/**/*.test.ts`, and both projects keep `testTimeout: 20000` and the existing `fileParallelism` rule, so the database helper test still runs and PGlite does not fall back to a five second timeout. `bun.lock` changed because `bun add` records the pinned packages. No existing test assertion was edited.

Test sensitivity. Replacing the 401 sentence in `LoginPage` with "Password rejected." makes `tests/client/LoginPage.test.tsx` "shows the mismatch message on 401" fail: it waits for "That password didn't match." and the alert shows "Password rejected." The sentence was restored before the verification run.

Expected value changes: none.
