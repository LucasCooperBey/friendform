import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { eq } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import type { DbHandle } from "../../server/db/index";
import { submissions } from "../../server/db/schema";
import type { FormDetail, SubmissionDto } from "../../server/forms-service";
import type { FormSchema } from "../../shared/form-schema";
import { openTestDb } from "../helpers/test-db";
import { createForm, createTestApp, jsonBody, publishForm, readJson, schemaOf, type TestApp } from "./helpers";

let app: TestApp | undefined;
let handle: DbHandle | undefined;
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await app?.close();
  app = undefined;
  handle = undefined;
  for (const close of closers.splice(0)) await close();
});

interface PublicForm {
  slug: string;
  title: string;
  description: string;
  version: number;
  schema: FormSchema;
  settings: { theme: string; showProgress: boolean; thankYou: { title: string; message: string }; allowAutofill: boolean };
}

async function listenSink(): Promise<{ url: string; requests: number; close: () => Promise<void> }> {
  let requests = 0;
  const server = createServer((_req, res) => {
    requests += 1;
    res.writeHead(204);
    res.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("sink has no port");
  const sink = {
    url: `http://127.0.0.1:${address.port}/hook-secret-path`,
    get requests() { return requests; },
    close: () => new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); }),
  };
  closers.push(sink.close);
  return sink;
}

it("returns only the public field set, 404 before publish, and 410 after close", async () => {
  // source: public read exposes the published schema and four settings keys, never webhooks or the draft.
  const sink = await listenSink();
  handle = await openTestDb();
  app = await createTestApp({ db: handle });
  await app.login();
  const form = await publishForm(app, {
    title: "Feedback",
    description: "Tell us more",
    settings: {
      theme: "dark", showProgress: false, allowAutofill: true, closedMessage: "Closed for the season",
      thankYou: { title: "Thanks", message: "Saved" },
      webhooks: [{ id: "hook", url: sink.url, format: "json", enabled: true }],
    },
  });
  expect((await app.request(`/api/forms/${form.id}`, jsonBody({
    draftSchema: schemaOf([{ questionId: "name", type: "text", prompt: "DRAFT SECRET PROMPT", required: true }]),
  }, "PATCH"))).status).toBe(200);

  const response = await app.request(`/api/public/forms/${form.slug}`);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await readJson<PublicForm>(response);
  expect(body).toEqual({
    slug: form.slug, title: "Feedback", description: "Tell us more", version: 1, schema: schemaOf(),
    settings: { theme: "dark", showProgress: false, thankYou: { title: "Thanks", message: "Saved" }, allowAutofill: false },
  });
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain("hook-secret-path");
  expect(serialized).not.toContain("DRAFT SECRET PROMPT");
  expect(serialized).not.toContain("Closed for the season");
  expect(Object.keys(body.settings).sort()).toEqual(["allowAutofill", "showProgress", "thankYou", "theme"]);

  expect(await readJson(await app.request("/api/public/forms/missing-slug"), 404)).toEqual({ error: "not_found" });
  const unpublished = await createForm(app, { title: "Still drafting" });
  expect(await readJson(await app.request(`/api/public/forms/${unpublished.slug}`), 404)).toEqual({ error: "not_found" });

  expect((await app.request(`/api/forms/${form.id}`, jsonBody({ title: "" }, "PATCH"))).status).toBe(200);
  expect((await readJson<PublicForm>(await app.request(`/api/public/forms/${form.slug}`))).title).toBe("Untitled form");
  expect((await app.request(`/api/forms/${form.id}`, jsonBody({ title: "Feedback" }, "PATCH"))).status).toBe(200);

  const bait = await readJson<{ id: string }>(await app.request(`/api/public/forms/${form.slug}/submissions`, jsonBody({
    responses: { name: "Ada" }, website: "https://spam.example",
  })), 201);
  expect(app.tasks).toHaveLength(0);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(sink.requests).toBe(0);
  expect(await handle.db.select().from(submissions).where(eq(submissions.id, bait.id))).toEqual([]);
  expect(await handle.db.select().from(submissions).where(eq(submissions.formId, form.id))).toEqual([]);

  expect((await readJson<{ form: FormDetail }>(await app.request(`/api/forms/${form.id}/close`, { method: "POST" }))).form.status).toBe("closed");
  const closedBody = { error: "closed", title: "Feedback", closedMessage: "Closed for the season" };
  expect(await readJson(await app.request(`/api/public/forms/${form.slug}`), 410)).toEqual(closedBody);
  expect(await readJson(await app.request(`/api/public/forms/${form.slug}/submissions`, jsonBody({ responses: { name: "Ada" } })), 410)).toEqual(closedBody);
  expect(await readJson(await app.request(`/api/public/forms/${form.slug}/events`, jsonBody({
    type: "view", sessionId: "session-a",
  })), 404)).toEqual({ error: "not_found" });
  const closedBait = await readJson<{ id: string }>(await app.request(`/api/public/forms/${form.slug}/submissions`, jsonBody({
    responses: { name: "Ada" }, website: "filled",
  })), 201);
  expect(await handle.db.select().from(submissions).where(eq(submissions.id, closedBait.id))).toEqual([]);

  expect((await readJson<{ form: FormDetail }>(await app.request(`/api/forms/${form.id}/reopen`, { method: "POST" }))).form.status).toBe("published");
  const reopened = await app.request(`/api/public/forms/${form.slug}`);
  expect(reopened.headers.get("cache-control")).toBe("no-store");
  expect((await readJson<PublicForm>(reopened)).title).toBe("Feedback");
});

it("accepts a valid submission, reports per-question errors, and drops hidden and unknown answers", async () => {
  // source: validateResponses errors are per question, hidden required questions are skipped, unknown keys are not stored.
  app = await createTestApp();
  await app.login();
  const form = await publishForm(app, {
    draftSchema: schemaOf([
      { questionId: "name", type: "text", prompt: "Your name", required: true },
      { questionId: "gate", type: "radio", prompt: "Gate", required: true, metadata: { options: ["yes", "no"] } },
      {
        questionId: "secret", type: "text", prompt: "Secret", required: true,
        metadata: { conditionalLogic: { enabled: true, questionId: "gate", operator: "equals", value: "yes" } },
      },
    ]),
  });
  const submit = `/api/public/forms/${form.slug}/submissions`;
  expect(await readJson(await app.request(submit, jsonBody({ responses: [] })), 400)).toEqual({
    error: "invalid_responses", errors: { _form: "Send responses as an object." },
  });
  expect(await readJson(await app.request(submit, jsonBody({ responses: {} })), 400)).toEqual({
    error: "invalid_responses",
    errors: { name: "This question is required.", gate: "This question is required." },
  });
  expect(await readJson(await app.request(submit, jsonBody({ responses: { name: "Ada", gate: "yes" } })), 400)).toEqual({
    error: "invalid_responses", errors: { secret: "This question is required." },
  });

  const hidden = await readJson<{ id: string }>(await app.request(submit, jsonBody({
    responses: { name: "Ada", gate: "no", secret: "should drop", extra: "nope" },
  })), 201);
  expect(await readJson<{ submission: SubmissionDto }>(await app.request(`/api/forms/${form.id}/submissions/${hidden.id}`)))
    .toEqual({ submission: { id: hidden.id, createdAt: expect.any(String), version: 1, responses: { name: "Ada", gate: "no" } } });

  const shown = await readJson<{ id: string }>(await app.request(submit, jsonBody({
    responses: { name: "Bea", gate: "yes", secret: "visible" }, sessionId: "session-ok",
  })), 201);
  expect((await readJson<{ submission: SubmissionDto }>(
    await app.request(`/api/forms/${form.id}/submissions/${shown.id}`),
  )).submission.responses).toEqual({ name: "Bea", gate: "yes", secret: "visible" });
});

it("limits public reads per address and submissions per address and form", async () => {
  // source: publicReadsPerMinute and submitPer15MinPerForm, with the submit key including the slug.
  app = await createTestApp({ limits: { publicReadsPerMinute: 2, submitPer15MinPerForm: 2 } });
  await app.login();
  const first = await publishForm(app, { title: "First" });
  const second = await publishForm(app, { title: "Second" });
  const read = (slug: string) => app?.request(`/api/public/forms/${slug}`);
  expect((await read(first.slug))?.status).toBe(200);
  expect((await read(first.slug))?.status).toBe(200);
  expect(await readJson(await app.request(`/api/public/forms/${first.slug}`), 429)).toEqual({ error: "too_many_requests" });

  const send = (slug: string) => app?.request(`/api/public/forms/${slug}/submissions`, jsonBody({ responses: { name: "Ada" } }));
  expect((await send(first.slug))?.status).toBe(201);
  expect((await send(first.slug))?.status).toBe(201);
  expect(await readJson(await app.request(`/api/public/forms/${first.slug}/submissions`, jsonBody({ responses: { name: "Ada" } })), 429))
    .toEqual({ error: "too_many_requests" });
  expect((await send(second.slug))?.status).toBe(201);
});

function rawPost(url: string, body: unknown, headers: Record<string, string> = {}): Promise<number> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...headers },
    }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    req.end(payload);
  });
}

it("stores only an http referrer origin and cuts the user agent to 300 characters", async () => {
  // source: submission meta keeps the referrer origin and omits a missing or non-http referrer and user agent.
  handle = await openTestDb();
  app = await createTestApp({ db: handle });
  await app.login();
  const form = await publishForm(app);
  const submit = `/api/public/forms/${form.slug}/submissions`;
  const linked = await readJson<{ id: string }>(await app.request(submit, jsonBody({
    responses: { name: "Ada" }, referrer: "https://www.linkedin.com:443/in/someone?trk=public",
  }, )), 201);
  const [linkedRow] = await handle.db.select().from(submissions).where(eq(submissions.id, linked.id));
  expect(linkedRow?.meta.referrer).toBe("https://www.linkedin.com");
  expect(linkedRow?.meta.userAgent).not.toBe("");

  const ftp = await readJson<{ id: string }>(await app.request(submit, {
    ...jsonBody({ responses: { name: "Bea" }, referrer: "ftp://files.example/a" }),
    headers: { "Content-Type": "application/json", "User-Agent": "FriendformTest/1" },
  }), 201);
  const [ftpRow] = await handle.db.select().from(submissions).where(eq(submissions.id, ftp.id));
  expect(ftpRow?.meta).toEqual({ userAgent: "FriendformTest/1" });

  const longAgent = "u".repeat(350);
  const clipped = await readJson<{ id: string }>(await app.request(submit, {
    ...jsonBody({ responses: { name: "Cy" } }),
    headers: { "Content-Type": "application/json", "User-Agent": longAgent },
  }), 201);
  const [clippedRow] = await handle.db.select().from(submissions).where(eq(submissions.id, clipped.id));
  expect(clippedRow?.meta.userAgent).toBe("u".repeat(300));
  expect(clippedRow?.meta.referrer).toBeUndefined();

  expect(await rawPost(`${app.url}${submit}`, { responses: { name: "Dee" } })).toBe(201);
  const rows = await handle.db.select().from(submissions).where(eq(submissions.formId, form.id));
  const bare = rows.find((row) => row.responses.name === "Dee");
  expect(bare?.meta).toEqual({});
});

it("logs one warning for a honeypot submission and stores nothing", async () => {
  // source: a filled honeypot answers 201, stores nothing, and logs the slug without the answers or the honeypot value
  handle = await openTestDb();
  app = await createTestApp({ db: handle });
  await app.login();
  const form = await publishForm(app);
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    const bait = await readJson<{ id: string }>(await app.request(`/api/public/forms/${form.slug}/submissions`, jsonBody({
      responses: { name: "answer-secret-value" }, website: "honeypot-secret-value",
    })), 201);
    const lines = spy.mock.calls.map((call) => String(call[0])).join("").split("\n")
      .filter((line) => line.includes("submission_honeypot"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("warn submission_honeypot");
    expect(lines[0]).toContain(form.slug);
    expect(lines[0]).not.toContain("honeypot-secret-value");
    expect(lines[0]).not.toContain("answer-secret-value");
    expect(await handle.db.select().from(submissions).where(eq(submissions.id, bait.id))).toEqual([]);
    expect(await handle.db.select().from(submissions).where(eq(submissions.formId, form.id))).toEqual([]);
  } finally {
    spy.mockRestore();
  }
});
