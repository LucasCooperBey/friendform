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
- The hidden field on a public form uses a name and label that password managers do not fill in.
- An owner can turn off document fill when that setting is already on, even while AI is off.
- A webhook can be added before its URL is entered, and a webhook with an empty URL is not sent.
- Send test saves the form first, and a failed save is shown instead of testing an unsaved URL.
- Turning a question condition back on keeps the condition that was already there.
- While a restore is running, every Restore button is disabled.
- A network problem or a server error during a session check keeps the owner signed in.
- The document-fill message counts the answers that were actually applied.
- Leaving the editor saves edits that differ from the last successful save, including after a failed save.
- Previewing the thank-you page stays in the editor and shows where a redirect would go.
- The redirect countdown says how many seconds are left.
- A number that is not a plain number must be corrected before the form can be submitted.
- Deleting a form refreshes the form list and drops that form from the cache.
- A honeypot warning logs a slug that matches the slug pattern, and logs invalid for any other path text.
- The redirect countdown says "1 second" when one second is left.
- A hidden question whose number is still unparsed does not block submit, and "Enter a number." is shown only while that question is visible.
