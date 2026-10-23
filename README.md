# Friendform

[![CI](https://github.com/LucasCooperBey/friendform/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/LucasCooperBey/friendform/actions/workflows/ci.yml)

Friendform is a self-hosted form builder. You build a form, share a link, and collect and export the answers.

## Screenshots

![Forms list](docs/screenshots/forms.png)

![Project intake editor](docs/screenshots/editor.png)

![Potluck sign-up public form](docs/screenshots/public.png)

![Potluck sign-up responses](docs/screenshots/responses.png)

## Features

One owner signs in with a password. A new form can be blank, started from a template (Project intake, Contact, Event RSVP, Feedback survey, Job application, Workshop interest, or Potluck sign-up), or drafted from a description when AI is configured.

Questions can be short text, long text, email, phone, number, date, multiple choice, checkboxes, dropdown, or rating. A question can be required, can include help text and options, and can be shown only when an earlier answer matches a condition.

Publishing makes a share link. A published form can be closed and reopened. The public page can show a progress bar and ends on a thank-you message, with an optional redirect. The owner can list responses, open one, see views, starts, responses, and completion rate, and download CSV.

Each form can send webhooks when someone submits. The public page and the editor can use a light theme, a dark theme, or the device theme. When AI is on, a respondent can fill the form from a document.

## Quick start

Install dependencies, create `.env`, and start the development server:

```bash
bun install
bun run setup
bun run dev
```

`bun run setup` writes `.env` (mode 0600) and prints the owner password when it creates one. `bun run dev` prints a line like `info listening {"url":"http://127.0.0.1:3000"}`. Open that address and sign in with the owner password.

The development server requires Node.js 22 or newer and Bun 1.3.5.

## Production

Build the client and the server bundle, then start it:

```bash
bun run build
bun run start
```

`bun run start` sets `NODE_ENV=production`. With `HOST` unset, the process listens on `0.0.0.0` and port 3000. It reads `.env` from the working directory when that file exists.

The Content-Security-Policy and frame protection are sent only when `NODE_ENV` is production, which `bun run start` and the Docker image set.

Docker Compose builds the image, publishes the port from `PORT` (3000 when `PORT` is unset), and stores the database on the named volume `friendform-data` mounted at `/data`:

```bash
docker compose up --build
```

The image sets `HOST=0.0.0.0`. A `HOST` value in `.env` replaces that, so leave `HOST` unset, or set it to `0.0.0.0`, when you run the container. `docker-compose.yml` includes a commented Postgres service for people who set `DATABASE_URL` instead of the embedded database.

The image runs as the node user (uid 1000). The named volume works as is. A host folder mounted at `/data` must be writable by uid 1000 (for example `chown 1000:1000` on the folder).

## Configuration

`bun run setup` fills `ADMIN_PASSWORD` and `SESSION_SECRET` when they are blank. Other variables come from the environment or from `.env`. An empty value is treated as unset.

| Variable | Default |
| --- | --- |
| `NODE_ENV` | `development` when unset. `production` and `test` are the other accepted values. |
| `HOST` | `127.0.0.1` in development and test. `0.0.0.0` in production. |
| `PORT` | `3000` |
| `PUBLIC_URL` | Unset. An http or https URL with no trailing slash. |
| `DATA_DIR` | `./data` |
| `DATABASE_URL` | Unset, which selects the embedded database. A Postgres URL must start with `postgres://` or `postgresql://`. |
| `ADMIN_PASSWORD` | Unset until `bun run setup`. At least 12 characters. |
| `SESSION_SECRET` | Unset until `bun run setup`. At least 32 characters. |
| `TRUST_PROXY` | Unset, which does not trust forwarded addresses. |
| `WEBHOOK_SECRET` | Unset, which sends webhooks without a signature. |
| `AI_BASE_URL` | Unset. When AI is on and this is unset, requests go to `https://api.openai.com/v1`. |
| `AI_API_KEY` | Unset. AI stays off until this and `AI_MODEL` are both set. |
| `AI_MODEL` | Unset. AI stays off until this and `AI_API_KEY` are both set. |

Sign-in sessions are signed cookies that last 30 days. Signing out clears the cookie in that browser only. Changing `SESSION_SECRET` or `ADMIN_PASSWORD` signs every browser out.

## AI

AI stays off until `AI_API_KEY` and `AI_MODEL` are set. The app talks to any OpenAI-compatible endpoint, such as OpenAI or a local Ollama. A local server that does not check a key still needs `AI_API_KEY` set to some value, because the features stay disabled when the key or the model is missing. One trailing slash on `AI_BASE_URL` is removed. There is no separate AI SDK: the server posts to `/chat/completions`.

Describe your form sends the owner's description as the user message. The system message asks for a JSON form of 3 to 15 questions. Fill from a document sends the published questions and the text extracted from the file. For a PNG, JPEG, or WEBP image it sends the image instead of text. Uploaded files are never stored.

Limits, from `server/app.ts` and `server/extract-runner.ts`:

- 5 fills per address and form every 15 minutes
- 20 fills per address a day
- 200 fills per form a day
- 20 form drafts per address an hour
- 5 MB file cap
- PDF and Word files are read in a separate process, one file at a time, and that process is stopped after 10 seconds or 512 MB
- 30 seconds of that file-reading time per address each hour

Text files are read in the server process. A second PDF or Word file while one is already being read gets a busy response.

## Webhooks

A webhook runs when someone submits a published form. The request is JSON. The `X-Friendform-Event` header is `submission.created`. When `WEBHOOK_SECRET` is set, `X-Friendform-Signature` is `sha256=<hex HMAC of the body>`.

Webhook URLs can point at any host the server can reach, including private addresses. Only the signed-in owner can set them.

The JSON format looks like this:

```json
{
  "event": "submission.created",
  "form": { "slug": "contact", "title": "Contact" },
  "submission": {
    "id": "submission-id",
    "createdAt": "2026-10-21T00:00:00.000Z",
    "version": 1,
    "answers": [
      { "questionId": "name", "prompt": "What is your name?", "type": "text", "value": "Avery Example" }
    ]
  },
  "responsesUrl": null
}
```

`responsesUrl` is `${PUBLIC_URL}/forms/<id>/responses` when `PUBLIC_URL` is set, and `null` otherwise.

The Slack format is a short text line, a header, and section blocks, one per answer. The Discord format is a content line plus an embed whose fields are the answers, and it disables mentions.

## Data and backups

With `DATABASE_URL` unset, the embedded database lives under `DATA_DIR` (by default `./data`). Stop the app and copy that folder to take a backup. To use Postgres instead, set `DATABASE_URL` to a `postgres://` or `postgresql://` URL. The server applies the SQL files in `drizzle/` on startup.

## Running behind a proxy

Leave `TRUST_PROXY` unset, or set it to `false`, when the app is reached directly. For one reverse proxy, set `TRUST_PROXY=1`. You can also set a whole number from 1 to 10, or a comma-separated list of IP addresses, CIDR ranges, or the names `loopback`, `linklocal`, and `uniquelocal`. The value `true` is rejected, because trusting every hop lets a visitor pick their own address.

Rate limits are per address. Behind a reverse proxy with `TRUST_PROXY` unset, every visitor shares the proxy's address and therefore one set of limits. The server logs a warning when a forwarded address arrives and `TRUST_PROXY` is unset. Set `TRUST_PROXY` as this section describes.

Set `PUBLIC_URL` to the public http or https origin, with no trailing slash, so share links and webhook response links use that origin. Origin checks on writes allow that origin in addition to the host the request arrived on.

## Development

```bash
bun run test
```

That runs the unit and integration tests on the embedded database. To run them against Postgres, set `TEST_DATABASE_URL` to a `postgres://` or `postgresql://` URL whose database name ends in `_test` and which has no query string. The test run drops the schemas in that database before it migrates.

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/friendform_test bun run test
```

Browser tests build the production bundle and drive it through Chromium:

```bash
bunx playwright install chromium
bun run test:e2e
```

`bun run screenshots` rebuilds, starts a temporary server, and writes the PNGs in `docs/screenshots/`.

## Origin

Friendform began in October 2025 as a form for friends to submit information through a shareable link. It grew inside TwentyFive, the CRM Lucas Cooper-Bey is building, and was rebuilt as this standalone app in October 2026.

## License

MIT
