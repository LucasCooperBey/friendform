# Security

## Supported versions

Only the latest release is supported.

## Reporting a vulnerability

Report vulnerabilities through GitHub private vulnerability reporting on this repository. Open the Security tab and choose "Report a vulnerability". There is no email address for reports.

## Scope

Reports are in scope when they affect the single-owner sign-in, the public form and autofill routes, or webhooks.

## Protections

The owner session is a signed HttpOnly cookie. Login and the public routes have rate limits. Writes check the request origin. Production responses send a Content-Security-Policy. Uploaded files are never stored. PDF and Word files are read in a child process that gets no secrets and is killed at its time and memory limits. Autofill has quotas per address and per form, and a per-address hourly budget of file-reading time.
