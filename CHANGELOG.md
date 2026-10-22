# Changelog

## 0.1.0 (unreleased)

- Owner sign-in with a signed session cookie.
- Form builder with templates, question types, conditional questions, and publishing.
- Public links that collect responses, with a thank-you page.
- Response list, stats, and CSV export.
- Webhooks in JSON, Slack, and Discord formats.
- Optional AI drafting and filling a form from a document.
- Embedded database, with Postgres when DATABASE_URL is set.
- Docker image and compose file for a production run.
- The server keeps running when an idle Postgres connection reports an error, and that log line leaves out the connection string.
- Publishing a new version of a closed form keeps the form closed.
- Saving a form writes settings only when the request includes them.
- CSV export leaves a plain negative number as a number.
- An AI request rejected with status 400 is retried without a temperature or a JSON response format.
- A session secret shorter than 32 characters tells you to set a longer value, or to run setup with --force.
- Completion rate never goes above 100%.
- A submission that fills the honeypot field is logged as a warning and is not stored.
- A rating whose answers cannot fall in its range, and a checkbox maximum below 1, cannot be published.
- The Docker health check and the published compose port follow PORT, and 3000 remains the default.
- The README covers per-address rate limits, sessions that last 30 days, webhook hosts, production headers, and the Docker data folder.
