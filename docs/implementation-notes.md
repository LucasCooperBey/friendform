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

## Slice 3c: reading time per address

One child reads one PDF or Word file at a time. That slot bounds memory on a small server. The time a request spends inside `extractUpload` is charged to the address that sent it.

`RateLimitSettings.extractionMsPerHourPerIp` defaults to 30_000. `autofillHandlers` merges limits the same way `publicRouter` does, `{ ...DEFAULT_LIMITS, ...deps.limits }`, and calls `createExtractionBudget(limits.extractionMsPerHourPerIp)` once per call. The key is `ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? "unknown")`, the same expression `limiter` uses.

`prepare` checks that budget after the body and base64 checks and before `extractUpload`. When the address is out of time, the response is 429 `{ error: "too_many_requests" }` and `Retry-After` is `retryAfterSeconds(key)`. That value is the whole seconds until the address's window ends, rounded up, and at least 1. The busy 503, the per-form daily quota, the per-address daily cap, and the autofill middleware order in `server/routes/public.ts` are unchanged.

The charge is `Date.now()` around the `extractUpload` call, taken in a `finally` block, so a call that resolves, rejects, or is aborted still counts. A key's window starts at its first charge and stays open until `windowMs` has passed (`3_600_000` by default). `allows` is false once the charged total in that window reaches the limit. A charge at or after the end starts a new window and a new total. Negative or non-finite milliseconds add 0.

The map holds at most 10,000 keys. A charge that would add a key at that size first deletes every key whose window has ended. If 10,000 remain, it deletes the key whose window ends soonest.

The child timeout default is now 10 seconds (`DEFAULT_TIMEOUT_MS` is `10_000`).

The autofill test helper sets `extractionMsPerHourPerIp` to `3_600_000` unless a test passes its own value, the same way it sets `autofillPerDayPerIp` to 1000.

Tests. `tests/server/extract-budget.test.ts` uses an injected clock for the limit, the new window, independent keys, `retryAfterSeconds`, and the 10,000 key cap. `tests/server/autofill.test.ts` "charges PDF reading time to the address and answers 429 when that time is used" boots `tests/fixtures/children/hang.mjs` with `timeoutMs: 300` and `extractionMsPerHourPerIp: 500`, with the per-form and per-address caps high enough to stay out of the way. Two PDF uploads from one address are 422 `file_too_complex`, the third is 429 `too_many_requests` with `Retry-After`, and a PDF from another address is 422.

No new dependencies.

Test sensitivity, each mutation restored before the next:

- `allows` returning true made `allows a key until its charged time reaches the limit` fail (`true` instead of `false`) and `charges PDF reading time to the address and answers 429 when that time is used` fail (422 instead of 429).
- `charge` returning immediately made all seven tests in `tests/server/extract-budget.test.ts` fail.
- Skipping the prune made `holds at most 10000 keys after 10001 distinct charges` fail (size 10001) and `drops ended windows before the window that ends soonest` fail (size 10001).
- Removing the `prepare` budget check made the autofill test fail (422 instead of 429).
- Removing the `finally` charge made the same autofill test fail (422 instead of 429).

## Slice 4: Docker, CI, browser tests, and docs

### Fake AI request recording

`tests/server/ai-fake.ts` records a chat request when it arrives, before `readBody`, and sets `body` after the body is parsed. A 300 ms wait was inserted before `readBody` only for the proof below, then removed. No assertion in `tests/server/ai.test.ts` was changed.

Command, with the wait and the original record-after-read order:

`bunx vitest run --project node tests/server/ai.test.ts -t "does not retry a timeout"`

Exit 1:

```
 RUN  v4.1.8 /Users/lucascooper-bey/Developer/lucface/oss/friendform

 ❯ |node| tests/server/ai.test.ts (15 tests | 1 failed | 14 skipped) 190ms
     × does not retry a timeout 187ms

 FAIL  |node| tests/server/ai.test.ts > createAiClient > does not retry a timeout
AssertionError: expected [] to have a length of 1 but got +0

- Expected
+ Received

- 1
+ 0

 ❯ tests/server/ai.test.ts:141:27

 Test Files  1 failed (1)
      Tests  1 failed | 14 skipped (15)
   Start at  23:48:44
   Duration  4.93s (transform 927ms, setup 0ms, import 3.81s, tests 190ms, environment 0ms)
```

Same command after recording on arrival, with the same 300 ms wait still in place. Exit 0:

```
 RUN  v4.1.8 /Users/lucascooper-bey/Developer/lucface/oss/friendform

 Test Files  1 passed (1)
      Tests  1 passed | 14 skipped (15)
   Start at  23:49:52
   Duration  2.01s (transform 355ms, setup 0ms, import 1.39s, tests 171ms, environment 0ms)
```

The wait is gone in the committed-ready file. `startAiFake` still defaults to port 0. An empty reply queue now returns answers for the `questionId`s after the `Questions: ` marker in the system message. A canned reply still wins, because `queue.shift()` runs first. `GET /e2e/requests` and `DELETE /e2e/requests` let the Playwright worker read that log. The worker is a different process, so it cannot see the in-memory array.

### Browser tests

`playwright.config.ts` deletes `.e2e-data` in the main process only (workers load the config too, and must not delete the running server's data) and starts `bun run build && node dist/server.mjs` on `127.0.0.1:4173` with the fixed e2e password and session secret. `globalSetup` spawns `bun tests/e2e/global-setup.ts` with `FRIENDFORM_E2E_FAKE=1`, which listens on `127.0.0.1:4180`. `globalTeardown` kills that pid. `vitest.config.ts` was not changed. Its include globs do not match `tests/e2e`.

`scripts/screenshots.ts` uses its own temp data directory and port 4174. The Project intake `reach` condition is added only in that script's cloned schema. The editor PNGs scroll so the comparison value sits in the frame, which shows the condition: controlling question, operator, and value.

### CI action pins

`git ls-remote` on 2026-10-22 returned one SHA per tag, so each pin is the commit:

- `actions/checkout` v6.1.0 `d23441a48e516b6c34aea4fa41551a30e30af803`
- `actions/setup-node` v6.5.0 `249970729cb0ef3589644e2896645e5dc5ba9c38`
- `actions/upload-artifact` v6.0.0 `b7c566a772e6b6bfb58ed0dc250532a479d7789f`
- `oven-sh/setup-bun` has no v4, v5, or v6 tag. The newest tag found is v2.2.0 `0c5077e51419868618aeaa5fe8019c62421857d6`, with `bun-version: 1.3.5`.

`bun.lock` lists `@playwright/test` 1.63.0 because `bun install --frozen-lockfile` is what CI and the image run.

### Docker

`docker` is not on PATH (`zsh: command not found: docker`), and it is not at `/usr/local/bin/docker`, `/opt/homebrew/bin/docker`, or the Docker Desktop path. No image was built here, so there is no `ls -a /app` listing. The Dockerfile, `.dockerignore`, and `docker-compose.yml` are in the tree. The verification command below does not build the image.

### Application code

Nothing under `server/`, `client/`, or `shared/` was changed.

One autofill run, started together with `tests/server/ai.test.ts` while the machine was busy, failed `charges PDF reading time to the address and answers 429 when that time is used`: the first request was 429 and the test expected 422. The same test then passed alone (3.59s). The autofill file passed (16 tests). The full suite below passed. No assertion and no server code was changed for that failure.

### Verification

The verification command exited 0. Node: 28 files, 160 tests. Client: 12 files, 63 tests. `check:boot` and `check:extract` passed. `tsc` reached `Check time: 9.92s` and had 0 `error TS` lines outside `node_modules/`. Playwright: 2 passed.

### Architect changes after the lane

`does not retry a timeout` failed again in a full parallel run at 00:35 PT on 10-22 (213 ms, load about 60 rising), with recording on arrival already in place. The fake runs in the same process as the client, so under load the 150 ms timeout can fire before the fake has seen the request at all, and no server-side recording point can count it. The test now counts the client's fetch calls through `createAiClient`'s `fetchImpl`, which is what "not retried" means, and keeps the elapsed-time bound. With a 300 ms wait at the top of the fake's handler it passed 4 of 4; making the client retry a timeout turns it red (the retry resolves instead of rejecting).

The lane's config wrote a new `.e2e-data/<uuid>` folder on every config load, so the delete before each run never matched an old folder and each run left about 39 MB behind (116 MB after three runs). The config now uses `.e2e-data/server` and clears `.e2e-data` only when `TEST_WORKER_INDEX` is unset. Two runs passed afterwards, and the folder held only `server` and `ai-fake.log` (39 MB).

The architect's full runs at load 270 to 350 failed in a different file each time on 10 and 20 second timeouts (`startup.test.ts`, the `errors.test.ts` setup hook); each passes on a quieter machine. Those are machine load, not code.

## Slice 4b: review fixes, server and docs

### Idle Postgres errors

`createPostgresPool(connectionString)` in `server/db/index.ts` builds the `pg.Pool` and attaches an `error` listener. The listener logs `postgres_pool_error` through `server/log.ts` with the error message only, so the connection string is not written. `openDb` uses that helper when `databaseUrl` is set. The pool does not connect until a query runs. Test: `tests/server/db-pool.test.ts` "logs an idle pool error without the connection string and stays up". Removing the listener made `pool.listenerCount("error")` return 0. Expected 1.

### Publishing a closed form

Publish sets `status` to `closed` when the form is already closed. A draft or published form still becomes `published`. Test: `tests/server/forms.test.ts` "keeps a closed form closed when publishing another version". With status always `"published"`, the closed publish returned `published`.

### Settings writes

A PATCH writes `settings` only when the body includes `settings`. Other fields are still written when they are present. Test: `tests/server/forms.test.ts` "writes settings only when the patch body includes them". It records the object passed to `set()`. A title-only patch must not have a `settings` key. With the old always-write, `Object.hasOwn` on that key was true.

### CSV numbers

`csvCell` still prefixes a cell that starts with `=`, `+`, `-`, `@`, tab, or carriage return, except a plain decimal number matching `/^-?\d+(\.\d+)?$/`. `tests/server/csv.test.ts` line 15 was `expect(csvCell("-1")).toBe("'-1")` and is now `expect(csvCell("-1")).toBe("-1")`. The same test also expects `"-1.5"` unprefixed, and `"-1+1"`, `"+16195550100"`, and `"+1"` prefixed. Without the number exception, `csvCell("-1")` was `'-1`.

### AI retry after 400

The first attempt still sends `temperature` 0.2 and `response_format`. The retry after status 400 sends neither. Other retries are unchanged. Test: `tests/server/ai.test.ts` "retries a 400 without temperature or response_format". With temperature still sent on that retry, `Object.hasOwn(second, "temperature")` was true. The existing assertion at `tests/server/ai.test.ts` line 296 (`temperature` 0.2 on the first call) was not changed.

### Short session secret

The short-secret sentence now matches the short-password sentence: `SESSION_SECRET must be at least 32 characters. Set a longer value, or run bun run setup --force to replace the password and the session secret.` `loadConfig` still appends a final line `Run bun run setup.` to every `ConfigError`, so `tests/server/config.test.ts` line 66 (`toContain("Run bun run setup.")`) was left unchanged and still passes. A 4-character secret throws:

`SESSION_SECRET must be at least 32 characters. Set a longer value, or run bun run setup --force to replace the password and the session secret.\nRun bun run setup.`

`tests/server/config.test.ts` is not in the file list, so no new assertion was added there. Reverting only this sentence would not fail that test, because the footer still contains `Run bun run setup.`

### Completion rate

`completionRate` is `Math.min(1, submissions / views)` after the existing 3-decimal rounding, and still `null` when views are 0. Test: `tests/server/stats.test.ts` "caps completionRate at 1 when submissions exceed views" (2 submissions, 1 view, expects 1). Without the cap the rate was 2. The earlier assertions in that file were not changed.

### Honeypot log

A submission whose `website` field is non-empty still answers 201 with a random id and stores nothing. That branch now logs one `warn submission_honeypot` line with the form slug. The answers and the honeypot value are not logged. Test: `tests/server/public.test.ts` "logs one warning for a honeypot submission and stores nothing". Without the log call, the filtered stderr lines had length 0. The older public test hits the same branch twice and now prints those two warning lines. Its assertions were not changed.

### Publish checks

A rating compares `(min ?? 1)` with `(max ?? 5)`, the same defaults `shared/validate.ts` uses. A checkbox with `maxSelections` below 1 reports `has a maximum selection count below 1.` Test: `tests/shared/form-schema.test.ts` "rejects a rating whose effective range is empty and a checkbox maximum below 1". A rating with only `min: 7`, a rating with only `max: 1`, and a checkbox with `maxSelections: 0` are reported. A rating with no bounds, and a checkbox maximum of 1, are not. Without the two checks the result was `[]`.

### Docker

The image health check fetches `http://127.0.0.1:` plus `process.env.PORT`, and uses 3000 when `PORT` is unset. `docker-compose.yml` publishes `${PORT:-3000}:${PORT:-3000}`. No test runs Docker. `docker` was not invoked.

### Docs

`README.md` now says rate limits are per address, sessions are signed cookies that last 30 days, webhook URLs may be any host the server can reach, the Content-Security-Policy and frame protection are production-only, and the image runs as uid 1000. `CHANGELOG.md` has one line per user-visible fix under 0.1.0.

### Mutation

The eight code fixes above were removed together (the session-secret sentence was left in place) and this command was run:

`bunx vitest run --project node tests/server/db-pool.test.ts tests/server/forms.test.ts tests/server/csv.test.ts tests/server/ai.test.ts tests/server/stats.test.ts tests/server/public.test.ts tests/shared/form-schema.test.ts tests/server/config.test.ts`

Exit 1. 7 files failed, 1 passed (`tests/server/config.test.ts`). 8 tests failed, 45 passed. The failures were `listenerCount` 0, `csvCell("-1")` returned `'-1`, title patch `settings` was present, closed publish status was `published`, honeypot log lines length 0, `completionRate` 2, publish problems `[]`, and the 400 retry still had `temperature`. The fixes were restored. The same command then exited 0: 8 files, 53 tests.

## Slice 4c: review fixes, client and screenshots

### Honeypot

The hidden input is `id` and `name` `ff-leave-blank`, with the label "Leave blank". It still has `autoComplete="off"`, `tabIndex={-1}`, and an `aria-hidden` wrapper, and now also `data-1p-ignore`, `data-lpignore`, and `data-bwignore`, each `"true"`. The React state and the submission JSON key stay `website`. The existing test `tests/client/PublicFormPage.test.tsx` "renders an empty honeypot" is the one existing test whose selector changed, from `input[name='website']` to `input[name='ff-leave-blank']`. Its assertions are unchanged, and it now also checks `data-1p-ignore` and `data-lpignore`. New test: "hides the honeypot from password managers". Putting the name and label back to `website` failed that test.

### Document fill switch

The switch is disabled only when AI is off and document fill is already off (`disabled={!aiEnabled && !settings.allowAutofill}`). "disables document fill when AI is off" was not edited. New test: "lets the owner turn document fill off when AI is off and it is already on". Restoring `disabled={!aiEnabled}` failed that test.

### Empty webhook URL

`webhookZ` accepts `""` or an http(s) URL. Whitespace-only still fails. Dispatch skips a hook whose trimmed URL is empty. The editor disables Send test while the URL is empty and shows "Add a URL to send this webhook." Tests: "accepts an empty webhook URL", "does not deliver an enabled webhook whose URL is empty" (the recorded fetch URL list was `['']` plus the real sink when the trim check was removed), and "asks for a URL before a webhook can be tested".

### Send test saves first

`useDraft` registers `flushFormDraft(formId)`. Send test awaits that flush and posts only after it resolves. A failed save toasts the save error and does not post. EditorPage is not in the file list, so the flusher lives on the mounted `useDraft`. Test: "does not send a test when the save fails". Removing the `flushFormDraft` call left the test unable to find "The server had a problem. Try again." "adds and removes a webhook and shows the test status" was not edited and passed in the full suite.

### Condition toggle

Turning a condition back on, when one is already stored, sets `enabled: true` on that same object. Test: "restores the condition that was turned off". Removing that branch failed the test.

### Restore buttons

Every Restore button uses `disabled={restoring !== null}`. A ref returns early if a second click arrives before the next paint. Test: "disables every restore button while one restore runs". Limiting `disabled` to the clicked row failed that test.

### Session refetch

A refetch that fails with a `TypeError` or an `ApiError` whose status is 500 or higher keeps a cached authenticated session. A 401, any other error, or a failure with no cached session is anonymous. TanStack Query keeps the previous data and sets status to `error`, and the observer notifies on a timeout, so the 401 test waits for the hook to update. Tests: "keeps the signed-in session when a refetch fails on the network", "keeps the signed-in session when a refetch returns 500", "becomes anonymous when a refetch returns 401", and "stays anonymous when the first session load fails". Making `transientSessionError` return false made both keep tests expect `anonymous` and receive that, so they failed.

### Document fill count

When the fill has no conflicts, the toast still uses the server `filled` count, so "toasts the server filled count" and the e2e line that expects "Filled 1 answer. Check it before you submit." stay as they were. When some answers conflict, nothing is toasted until the dialog closes. Replace counts the answers written immediately plus the conflicting ones that were written. Cancel counts only the ones written immediately. Tests: "counts a conflicting answer only after Replace" and "counts only the answers kept when Replace is cancelled". Toasting `result.filled` before the dialog failed the first. Removing the toast after the dialog failed both.

### Unmount save

On unmount, a pending timer is cleared and the draft is saved through the queue whenever it differs from the last saved baseline, including after a failed save. Tests: "saves on unmount after a failed save" (reverting to "only when a timer is pending" left the PATCH count at 1) and "queues an unmount save behind the save already in flight" (calling `persistRef` directly made the second PATCH start before the first finished, so the count was 2).

### Thank-you preview

`ThankYou` takes `mode`. Preview does not call `window.location.assign`. It shows "People would be sent to {redirect}". Live copy is "Redirecting in {left} seconds." Tests: "shows where a preview would redirect without leaving the page" (dropping the preview guard navigated to `https://example.com/next`) and "counts a live redirect down in seconds" (the old "Taking you onward" sentence was not found).

### Number text

Text that is not a plain number clears the stored number, marks the question unparsed, and shows "Enter a number." Submit is blocked while any question is unparsed, with the banner "Some answers need attention." Test: "rejects number text that is not a plain number". Returning early and keeping the last number failed that test because "Enter a number." was missing.

### Delete form

After a successful delete, the client invalidates `["forms"]` and removes `["form", id]`, then toasts and goes home. Test: "drops the form list and the deleted form after delete". Removing those two calls failed `invalidateQueries` with `{ queryKey: ["forms"] }`.

### Screenshots

Each demo respondent posts `view` and `start` to `/api/public/forms/<slug>/events` with one session id matching `/^[A-Za-z0-9_-]{8,64}$/`, then submits with that same id. Each form also gets one view-only session. `bun run screenshots` exited 0 and rewrote all seven PNGs at 09:23. Git records byte changes for `responses.png`, `forms.png`, and `editor-dark.png`. `editor.png`, `public.png`, `public-mobile.png`, and `public-dark.png` were rewritten with the same bytes as before.

`responses.png` is the Potluck sign-up responses page, Live, with Views 6, Started 3, Responses 3, and Completion rate 50%. Starts equal responses, and the completion rate is under 100%. The table lists Avery Example, Blair Example, and Casey Example. The note under the tiles says "Views and starts count browser sessions."

`editor.png` is the Project intake editor, Live and Published, scrolled to the multiple-choice question "What is the best way to reach you?" Options are Text, Email, and Call. The condition is on: controlling question "What is your name?", operator "is", value "Avery Example".

No server was left listening on port 4174 or 3000.

### Mutation

Each fix was removed on its own, the guarding test was run, and the file was restored from the bytes taken before the edit. All 17 runs exited 1. The restored files matched those bytes. The full `bun run test` then exited 0: node 29 files, 169 tests; client 13 files, 83 tests.

## Slice 4d: three follow-up fixes

### Honeypot slug log

The honeypot branch of `POST /:slug/submissions` still answers 201 and stores nothing. It logs `{ slug }` only when `req.params.slug` is a string that matches `SLUG_RE` from `shared/slug.ts`. Any other path text is logged as `{ slug: "invalid" }`. Test: "logs an invalid honeypot slug as invalid", a honeypot post to 200 `a` characters followed by `-`. "logs one warning for a honeypot submission and stores nothing" was not edited. Removing the `SLUG_RE` check logged the posted slug, and the new test failed because that line did not contain `invalid`. Exit 1.

### Redirect countdown

`ThankYou` says "Redirecting in 1 second." when `left` is 1, and "Redirecting in N seconds." otherwise. Test: "says second when one second is left". It starts at 2 seconds and waits for the real countdown to reach 1. `window.setTimeout` in this environment is not the global timer `vi.useFakeTimers` replaces, so the test uses the real timer and stubs `location.assign`. "counts a live redirect down in seconds" was not edited and still expects "Redirecting in 4 seconds." Putting the sentence back to "Redirecting in {left} seconds." made the new test unable to find "Redirecting in 1 second." Exit 1.

### Hidden unparsed number

Submit counts an unparsed question only when its id is in the `visible` set, and it uses that same check when choosing the question to focus. "Enter a number." is passed only for a visible question. Test: "submits when an unparsed number is on a hidden question". A choice question shows a number question for one choice. Typing "5,5", then choosing the other choice, then submitting posts `{ responses: { choice: "No" }, website: "" }` with no `count` answer. Counting every unparsed id again left the banner "Some answers need attention." and the test could not find "Saved". Exit 1. Showing "Enter a number." for a hidden question again left that sentence in the page text. Exit 1.

`bun run test` then exited 0: node 29 files, 170 tests; client 13 files, 85 tests.
