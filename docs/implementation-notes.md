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

## Form editor and responses

The committed server, shared schema, and slice 2a client win where this slice's spec names a shape the code does not use.

Completion rate. `GET /api/forms/:id/stats` returns `completionRate` as a ratio, or null when `views` is 0. The server value is `Math.round(submissions / views * 1000) / 1000`. The tiles show `Math.round(rate * 100)` with a percent sign. A rate of 0.25 is "25%". Null is "No views yet".

Publish label. A form with `publishedVersion === null` always has `hasUnpublishedChanges` true, because the server compares the draft schema with a missing published schema. The button checks `publishedVersion === null` first and says "Publish". After a version exists it says "Publish changes" while `hasUnpublishedChanges` is true, and a disabled "Published" when that flag is false. Title and settings edits do not flip the flag. Only a draft schema that differs from the published schema does.

Webhook signature sentence. The spec asks for one muted sentence on the `X-Friendform-Signature` header when `WEBHOOK_SECRET` is set. `GET /api/auth/session` does not say whether that secret is set, and this slice does not add a server field. The sentence is omitted. The server still sends the header when the secret is set.

Date conditions. `QUESTION_TYPES` includes `date`. The spec's operator lists omit it. Date answers are strings, so the editor offers the text operators: is, is not, contains, doesn't contain, is empty, is answered.

Paste a list. Pasting replaces the current options. Lines are trimmed, blanks and duplicates are dropped, and the list stops at 100. A paste that yields no options leaves the current list.

Thank-you redirect. A blank redirect URL is omitted from settings, so `formSettingsZ` does not reject an empty string. A non-empty value that is not http or https stays in the local draft, the save is not sent, and `invalid` is the schema message. A blank delay omits `redirectDelaySeconds`. A typed delay is rounded and clamped from 0 to 60 on blur.

Rating max. The number input keeps the typed value and clamps it from 2 to 10 on blur.

Close and reopen. Both buttons render only after `publishedVersion` is not null. A draft shows "Publish the form before you can close it." Close, reopen, publish, and the slug save write the form query cache and do not replace the local draft.

Slug button. The visible label is "Save link". It sends `PATCH { slug }` on its own, outside the debounced draft. Status 409 shows "That link is already taken." Status 400 shows "Use lowercase letters, numbers and dashes." `errorMessage` uses different sentences for those codes, and this control does not call it for 409 or 400.

History count. Each version says "1 question" for a count of one and `${questionCount} questions` otherwise, the same wording as the forms list.

useDraft. The hook also returns `adopt(next)`, `status` (`"loading" | "error" | "ready"`), `error`, and `reload()`. Restore uses `adopt`, which replaces the local draft and cancels a pending save, so the restored schema is not patched back. The page uses `status`, `error`, and `reload` for loading and failure, and does not start a second form query.

Question metadata. A type change keeps the prompt, help text, required flag, and `conditionalLogic`, and drops metadata the new type does not use. Switching onto a choice type does not invent options. New and duplicated questions take `newQuestionId` across every id already in the draft.

Dependency. `@radix-ui/react-popover` 1.1.15 is the popover. `bun add` wrote both `package.json` and `bun.lock`. The architect's registry receipt at 22:55 PT 2026-10-20: published 2025-08-13, first release 2020-12-15, maintainers hadihallak, chancestrickland, and mark-workos. This run did not contact the registry again.

Expected value change. `tests/client/FormsPage.test.tsx` "posts a template schema" used to assert `expect(await screen.findByRole("heading", { name: "Edit form" })).toBeInTheDocument()`. The editor title is an input named "Form title", and the page has no "Edit form" heading. The test now mocks `GET /api/forms/form-new` with that template's form detail and asserts `expect(await screen.findByRole("textbox", { name: "Form title" })).toHaveValue(template.title)`. The POST body assertion is unchanged: `{ title: template.title, draftSchema: template.schema }`.

Test sensitivity. Replacing `changedFields` so every save sends `title`, `description`, `draftSchema`, and `settings` makes `tests/client/useDraft.test.tsx` "debounces to one PATCH of only the changed fields" fail. Expected `{ title: "B", description: "More" }`. Received that object plus `draftSchema` and `settings`. The function was restored before the verification run.

## AI features

Both features stay off until `AI_API_KEY` and `AI_MODEL` are set. `AI_BASE_URL` defaults to `https://api.openai.com/v1` and one trailing slash is removed. Any OpenAI-compatible endpoint works, such as OpenAI or a local Ollama. A local server that does not check a key still needs `AI_API_KEY` set to any value, because the client is disabled when the key or the model is missing. There is no AI SDK. `server/ai.ts` posts to `/chat/completions` with `fetch`.

Describe your form is `POST /api/ai/generate-form` for an owner session. The description is the user message. The system prompt names the JSON shape, asks for 3 to 15 questions, and limits conditions to earlier questions and operators from `CONDITION_OPERATORS`. Repair drops unknown question types, replaces missing, invalid, or duplicate ids with `newQuestionId`, drops conditions that point at a missing or later question or use an unknown operator, cuts strings to the schema limits, and then runs `formSchemaZ`. Fill from a document is `POST /api/public/forms/:slug/autofill`. It runs only when the form is published, not closed, `settings.allowAutofill` is true, and AI is enabled. Otherwise the route is 404 `{ error: "not_found" }`, including when AI is off. The file is extracted in memory and is not written to disk or the database. The model output is not logged. Each answer is kept only when its question id is in the published schema and `validateResponses` accepts it on a one-question copy with `required` false and no `conditionalLogic`.

Text extraction uses the installed declarations only. unpdf 1.8.1: `getDocumentProxy` and `extractText` with `{ mergePages: true }`. mammoth 1.13.0: `extractRawText({ buffer })`. `@napi-rs/canvas` is not installed. Bytes over 5 MB are rejected before parsing. The declared type must match the PDF, zip, PNG, JPEG, or WEBP signature. Text types are not signature-checked. Text is cut to 40000 characters.

The autofill path is the only route with `express.json({ limit: "7mb" })`, mounted in `createApp` before the app-wide 512kb parser. A body of about 1 MB reaches autofill. The same body sent to `POST /api/forms` is 413 `payload_too_large`. A decoded file over 5 MB is 413 `file_too_large`, which is separate from the JSON limit. Rate limits: `aiGeneratePerHour` 20 per IP, `autofillPer15MinPerForm` 5 keyed by IP plus slug, and `autofillPerDayPerForm` 200 over 24 hours keyed by slug alone. The day limiter does not read `req.ip`, so express-rate-limit does not reject the key generator.

`aiEnabled` comes from `GET /api/auth/session`. The New form dialog shows "Describe it" only when that flag is true. The settings switch "Let people fill this form from a document" is disabled, with the hint "Set AI_BASE_URL, AI_API_KEY and AI_MODEL to turn this on.", when the flag is false. On a live form with the setting on, "Fill from a document" sits above the first section. A file over 5 MB is refused in the browser. Answers the respondent already typed are replaced only after a confirm dialog. A fill that changes an answer counts as the first input for the start event.

Fixtures. `tests/fixtures/sample.pdf` is a 600 byte PDF 1.4 written by hand: catalog, pages, one page, Helvetica, and a content stream `BT /F1 12 Tf 72 720 Td (Hello from the sample PDF) Tj ET`. `tests/fixtures/sample.docx` was built with `zip` from three XML parts:

```
mkdir -p /tmp/friendform-docx/word /tmp/friendform-docx/_rels
```

`[Content_Types].xml` has Defaults for `rels` and `xml`, and an Override for `/word/document.xml` with the wordprocessingml main content type. `_rels/.rels` has Relationship `rId1` of type officeDocument targeting `word/document.xml`. `word/document.xml` is a `w:document` / `w:body` / `w:p` / `w:r` / `w:t` whose text is `Hello from the sample document`. Then:

```
(cd /tmp/friendform-docx && zip -X -r /Users/lucascooper-bey/Developer/lucface/oss/friendform/tests/fixtures/sample.docx "[Content_Types].xml" _rels word)
```

`zip -r` also stored the `_rels/` and `word/` directory entries. unpdf reads the PDF as `Hello from the sample PDF`. mammoth reads the docx as `Hello from the sample document` followed by newlines.

Expected value change. `tests/server/public.test.ts` "returns only the public field set..." still publishes the form with `allowAutofill: true`. The public GET now returns `settings.allowAutofill && aiEnabled`. `createTestApp` leaves AI unset, so the expected `settings.allowAutofill` changed from `true` to `false`. The assertion was not removed. A separate test covers AI on: the public GET returns true when the setting is on and false when it is off.

Test sensitivity. Removing `if (type === undefined) continue;` from the generate-form repair made `tests/server/ai.test.ts` "repairs a draft and keeps the description out of the system prompt" fail: expected status 200, received 502. The line was restored before verification.

## Slice 3b: bounded extraction and autofill quotas

PDF and Word extraction run in one child process. The server still checks the 5 MB limit and the file signature before a child starts. Text files and images stay in the server process. unpdf and mammoth are imported only by `server/extract-child.ts`.

The parent forks with `serialization: "advanced"` and an environment that contains only `PATH`, so the database URL and the AI key are not copied. The child is killed with SIGKILL on a 15 second timeout, when resident memory goes over 512 MB, on a crash, and when the respondent disconnects. The busy flag clears when that child has exited. A second extraction gets 503 `{ error: "busy" }` and `Retry-After: 5`. On Linux the child writes `1000` to `/proc/self/oom_score_adj` inside try/catch.

PDF text matches unpdf 1.8.1 `extractText` with `mergePages`. Each item contributes `item.str` plus a newline when `hasEOL` is set. Pages join with a newline, then `normalizeMergedText` runs its three replacements: collapse spaces, trim spaces around newlines, and collapse three or more newlines to two. Reading stops once that raw joined text passes 40,000 characters, and the normalized text is cut to 40,000. At most 30 pages are read. pdf.js inside unpdf 1.8.1 rejects a Node `Buffer` (`Please provide binary data as Uint8Array, rather than Buffer`), so the child copies the bytes with `new Uint8Array(data)` before `getDocumentProxy`. The installed `PDFDocumentProxy` type has no `destroy` method. The child closes the document with `loadingTask.destroy()`, the same call unpdf's `withDocument` uses. Word text is `mammoth.extractRawText`, cut to 40,000 characters.

`process.send` has to be called as a method. Copying it off `process` and calling the bare function throws `Cannot read properties of undefined (reading 'connected')`. The child then exits without a reply, and the parent reports `too_complex`.

Four existing tests in `tests/server/extract-text.test.ts` counted calls to unpdf's `getDocumentProxy` through a `vi.mock` in the server process. PDF parsing moved to the child on purpose, so those counts read 0 whatever the code did, and "reads a PDF and turns a malformed PDF into unsupported" failed. The architect replaced the mock with a counting wrapper around a real extractor and asserts the PDF jobs handed to the child: 0 for a PNG labeled as a PDF, 1 for the sample PDF, 2 for the two malformed PDFs, 0 for a text file that starts with %PDF, and 0 for a PDF over 5 MB. The expected numbers are unchanged; only what is counted changed.

The per-form daily autofill quota runs after prepare. A file rejected before the model does not use it. A request that reaches the model still uses it when the reply is not JSON. `autofillPerDayPerIp` defaults to 20 and is the second autofill middleware, before the body is read. The 7 MB JSON parser sits on the autofill route after the two per-address limiters. The app-wide 512kb parser calls `next()` without reading a POST whose path matches `/^\/api\/public\/forms\/[^/]+\/autofill$/`. Every other request still uses that 512kb parser.

esbuild 0.25.12 accepts the `name=path` entry form. The build writes `dist/server.mjs` and `dist/extract-child.mjs`. `start` is still `node dist/server.mjs`. `check:extract` requires `dist/extract-child.mjs` and runs `tests/fixtures/sample.pdf` and `tests/fixtures/sample.docx` through `createExtractor({ childPath })`. It exits 1 unless the PDF text contains `Hello` and the Word text contains `document`, words the extract-text tests already expect from those fixtures.

The autofill test helper sets `autofillPerDayPerIp` to 1000 unless a test passes its own value. Existing cases stay under the new default of 20 either way. The explicit 1000 keeps the helper from depending on that default.

No new dependencies. Receipts from `registry.npmjs.org` on 2026-10-21:

- unpdf, maintainer johannschopplich. First release 0.1.0 on 2023-08-11. Latest 1.9.1 on 2026-10-19. Pinned 1.8.1 published 2026-08-13.
- mammoth, maintainer mwilliamson. First release 0.1.0 on 2013-05-06. Latest and pinned 1.13.0 published 2026-09-26.
- esbuild, maintainer esbuild. First release 0.0.0 on 2017-11-26. Latest 0.28.2 on 2026-08-08. Pinned 0.25.12 published 2025-11-01.

Verification on 2026-10-21 at 21:02 by the architect, after that test change: node 27 files and 152 tests, client 12 files and 63 tests, twice on PGlite and once on Postgres, all passing. `bun run build` wrote `dist/server.mjs` and `dist/extract-child.mjs`; `check:boot` and `check:extract` passed; the own-code typecheck finished with no error outside `node_modules/`; `db:generate` found no schema changes; the scrub check found nothing. The lane's earlier run stopped at the failing count test described above.

Test sensitivity, each mutation restored before the next:

- Removing the RSS kill made `kills a child that grows past the memory cap` fail (20085ms, not under 10s) and `kills a PDF that inflates past the memory cap` fail (`empty` instead of `too_complex`).
- Removing the timeout kill made `kills a child that does not reply before the timeout` time out at 20000ms.
- Moving the per-form daily limiter in front of prepare made `keeps the daily form quota when an upload is rejected before the model` fail (429 instead of 200).
- Removing the per-address daily limiter made `rate limits autofill per address across a day` fail (502 instead of 429).
- Putting the 7 MB parser back at app level made `rejects a second oversized autofill body with 429 before reading it` fail (413 instead of 429).
- Removing the busy check made `returns busy while another file is being read` fail (422 instead of 503) and `rejects a second job while one is running and accepts a job after it ends` time out.
- Removing the PDF signature check made `rejects a mislabeled PDF and Word upload before starting a child` fail (the spy resolved text instead of rejecting).
