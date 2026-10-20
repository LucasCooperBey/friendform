import { createHmac } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { count, eq } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";
import type { DbHandle } from "../../server/db/index";
import { webhookDeliveries } from "../../server/db/schema";
import { buildPayload, deliverWebhook, recordDelivery, type WebhookContext } from "../../server/webhooks";
import type { WebhookConfig } from "../../shared/form-schema";
import type { Question } from "../../shared/form-schema";
import { openTestDb } from "../helpers/test-db";
import { createForm, createTestApp, jsonBody, publishForm, readJson, schemaOf, testConfig, type TestApp } from "./helpers";

let app: TestApp | undefined;
let handle: DbHandle | undefined;
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await app?.close();
  app = undefined;
  handle = undefined;
  for (const close of closers.splice(0)) await close();
});

interface Captured { method: string; headers: IncomingHttpHeaders; body: string }

async function listenSink(): Promise<{ url: string; requests: Captured[]; close: () => Promise<void> }> {
  const requests: Captured[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({ method: req.method ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("sink has no port");
  const sink = {
    url: `http://127.0.0.1:${address.port}/hooks/secret?token=1`,
    requests,
    close: () => new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); }),
  };
  closers.push(sink.close);
  return sink;
}

function expectSigned(captured: Captured, secret: string): unknown {
  expect(captured.method).toBe("POST");
  expect(captured.headers["content-type"]).toBe("application/json");
  expect(captured.headers["user-agent"]).toBe("Friendform-Webhooks/0.1");
  expect(captured.headers["x-friendform-event"]).toBe("submission.created");
  expect(captured.headers["x-friendform-signature"]).toBe(
    `sha256=${createHmac("sha256", secret).update(captured.body).digest("hex")}`,
  );
  return JSON.parse(captured.body) as unknown;
}

const secret = "hook-secret";
const sampleContext = (): WebhookContext => ({
  form: { slug: "feedback", title: "Feedback" },
  submission: { id: "11111111-1111-4111-8111-111111111111", createdAt: "2026-01-01T00:00:00.000Z", version: 1 },
  schema: schemaOf(),
  responses: { name: "" },
  responsesUrl: null,
});

it("times out a fetch that never resolves, records thrown errors, and builds an empty discord field", async () => {
  // source: deliverWebhook uses redirect manual, signs only with a secret, and returns timeout or delivery_failed.
  const hook: WebhookConfig = { id: "h", url: "https://hooks.example/slow", format: "json", enabled: true };
  const timed = await deliverWebhook(hook, sampleContext(), {
    secret: null, fetchImpl: () => new Promise<Response>(() => {}), timeoutMs: 50,
  });
  expect(timed).toEqual({ ok: false, status: null, error: "timeout" });
  const thrown = await deliverWebhook(hook, sampleContext(), {
    secret, fetchImpl: async () => { throw new Error("socket down"); },
  });
  expect(thrown).toEqual({ ok: false, status: null, error: "delivery_failed" });

  let init: RequestInit | undefined;
  const ok = await deliverWebhook(hook, sampleContext(), {
    secret: null,
    fetchImpl: async (_input, next) => { init = next; return new Response(null, { status: 204 }); },
  });
  expect(ok).toEqual({ ok: true, status: 204, error: null });
  expect(init?.redirect).toBe("manual");
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  expect(new Headers(init?.headers).get("x-friendform-signature")).toBeNull();
  expect(new Headers(init?.headers).get("x-friendform-event")).toBe("submission.created");

  expect(buildPayload("discord", sampleContext())).toMatchObject({
    allowed_mentions: { parse: [] },
    embeds: [{ fields: [{ name: "Your name", value: "(empty)" }] }],
  });
});

it("posts the json submission payload, verifies the HMAC over the received body, and stores only the host", async () => {
  // source: enabled json webhooks send submission.created, signed over the exact body, and log url host only.
  const sink = await listenSink();
  app = await createTestApp({ config: testConfig({ publicUrl: "https://forms.example", webhookSecret: secret }) });
  await app.login();
  const form = await publishForm(app, {
    draftSchema: schemaOf([
      { questionId: "name", type: "text", prompt: "Your name", required: true },
      { questionId: "color", type: "radio", prompt: "Color", required: false, metadata: { options: ["red", "blue"] } },
      { questionId: "extra", type: "text", prompt: "Extra", required: false },
    ]),
    settings: {
      webhooks: [
        { id: "json-hook", url: sink.url, format: "json", enabled: true },
        { id: "off-hook", url: sink.url, format: "slack", enabled: false },
      ],
    },
  });
  expect((await app.request(`/api/forms/${form.id}`, jsonBody({
    draftSchema: schemaOf([{ questionId: "draftonly", type: "text", prompt: "Draft only", required: true }]),
  }, "PATCH"))).status).toBe(200);
  const created = await readJson<{ id: string }>(await app.request(`/api/public/forms/${form.slug}/submissions`, jsonBody({
    responses: { name: "Ada", color: "red" },
  })), 201);
  await Promise.all(app.tasks);
  expect(sink.requests).toHaveLength(1);
  const captured = sink.requests[0];
  expect(captured).toBeDefined();
  const payload = expectSigned(captured ?? { method: "", headers: {}, body: "" }, secret) as {
    event: string; form: { slug: string; title: string }; responsesUrl: string | null;
    submission: { id: string; createdAt: string; version: number | null; answers: Array<{ questionId: string; prompt: string; type: string; value: unknown }> };
  };
  const stored = await readJson<{ submission: { createdAt: string } }>(await app.request(`/api/forms/${form.id}/submissions/${created.id}`));
  expect(payload).toEqual({
    event: "submission.created",
    form: { slug: form.slug, title: "Feedback" },
    submission: {
      id: created.id, createdAt: stored.submission.createdAt, version: 1,
      answers: [
        { questionId: "name", prompt: "Your name", type: "text", value: "Ada" },
        { questionId: "color", prompt: "Color", type: "radio", value: "red" },
      ],
    },
    responsesUrl: `https://forms.example/forms/${form.id}/responses`,
  });
  const deliveries = await readJson<{ deliveries: Array<{ webhookId: string; urlHost: string; status: number | null; ok: boolean; error: string | null }> }>(
    await app.request(`/api/forms/${form.id}/webhooks/deliveries`),
  );
  expect(deliveries.deliveries).toEqual([expect.objectContaining({
    webhookId: "json-hook", urlHost: new URL(sink.url).host, status: 204, ok: true, error: null,
  })]);
  expect(deliveries.deliveries[0]?.urlHost).not.toContain("/");
  expect(JSON.stringify(deliveries)).not.toContain("secret");
  expect(JSON.stringify(deliveries)).not.toContain("token");
});

it("escapes Slack section text after cutting it, and leaves the 150 character header plain", async () => {
  // source: Slack header text is cut to 150 characters without escaping; section text is cut, then escaped.
  const sink = await listenSink();
  app = await createTestApp({ config: testConfig({ webhookSecret: secret }) });
  await app.login();
  const title = "<".repeat(200);
  const form = await publishForm(app, {
    title,
    draftSchema: schemaOf([{ questionId: "note", type: "text", prompt: "Cost <a> & more", required: true }]),
    settings: { webhooks: [{ id: "slack-hook", url: sink.url, format: "slack", enabled: true }] },
  });
  expect((await app.request(`/api/public/forms/${form.slug}/submissions`, jsonBody({
    responses: { note: `${"x".repeat(299)}<>` },
  }))).status).toBe(201);
  await Promise.all(app.tasks);
  const captured = sink.requests[0];
  const payload = expectSigned(captured ?? { method: "", headers: {}, body: "" }, secret) as {
    text: string; blocks: Array<{ type: string; text: { type: string; text: string } }>;
  };
  expect(payload.text).toBe(`New response to ${"&lt;".repeat(200)}`);
  expect(payload.blocks[0]).toEqual({
    type: "header", text: { type: "plain_text", text: `New response to ${title}`.slice(0, 150) },
  });
  expect(payload.blocks[0]?.text.text).toHaveLength(150);
  expect(payload.blocks[0]?.text.text).not.toContain("&lt;");
  expect(payload.blocks[1]).toEqual({
    type: "section",
    text: { type: "mrkdwn", text: `*Cost &lt;a&gt; &amp; more*\n${"x".repeat(299)}&lt;` },
  });
});

it("keeps a Discord embed within 6000 characters and disables mentions", async () => {
  // source: Discord fields stop before title plus names plus values exceed 6000, with allowed_mentions parse empty.
  const sink = await listenSink();
  app = await createTestApp({ config: testConfig({ webhookSecret: secret }) });
  await app.login();
  const questions: Question[] = Array.from({ length: 6 }, (_, index) => ({
    questionId: `q${index + 1}`, type: "textarea", prompt: "P".repeat(400), required: true,
  }));
  const title = "T".repeat(100);
  const form = await publishForm(app, {
    title, draftSchema: schemaOf(questions),
    settings: { webhooks: [{ id: "discord-hook", url: sink.url, format: "discord", enabled: true }] },
  });
  const responses = Object.fromEntries(questions.map((question) => [question.questionId, "V".repeat(900)]));
  expect((await app.request(`/api/public/forms/${form.slug}/submissions`, jsonBody({ responses }))).status).toBe(201);
  await Promise.all(app.tasks);
  const payload = expectSigned(sink.requests[0] ?? { method: "", headers: {}, body: "" }, secret) as {
    content: string; allowed_mentions: { parse: string[] };
    embeds: Array<{ title: string; fields: Array<{ name: string; value: string }>; timestamp: string }>;
  };
  expect(Object.keys(payload).sort()).toEqual(["allowed_mentions", "content", "embeds"]);
  expect(payload.allowed_mentions).toEqual({ parse: [] });
  expect(payload.content).toBe(`New response to **${title}**`);
  const embed = payload.embeds[0];
  expect(embed?.title).toBe(title);
  expect(embed?.fields).toHaveLength(5);
  expect(embed?.fields.map((field) => field.name)).toEqual(Array.from({ length: 5 }, () => "P".repeat(256)));
  expect(embed?.fields.map((field) => field.value)).toEqual(Array.from({ length: 5 }, () => "V".repeat(900)));
  const total = (embed?.title.length ?? 0) + (embed?.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  expect(total).toBe(5880);
});

it("sends draft placeholder answers for a webhook test and records the delivery", async () => {
  // source: the webhook test route posts sample answers for every draft question and stores the delivery.
  const sink = await listenSink();
  app = await createTestApp({ config: testConfig({ publicUrl: "https://forms.example", webhookSecret: secret }) });
  await app.login();
  const form = await createForm(app, {
    draftSchema: {
      sections: [{
        title: "Sample",
        questions: [
          { questionId: "name", type: "text", prompt: "Name", required: true },
          { questionId: "color", type: "radio", prompt: "Color", required: true, metadata: { options: ["red", "blue"] } },
          { questionId: "tags", type: "checkbox", prompt: "Tags", required: false, metadata: { options: ["a", "b"] } },
          { questionId: "score", type: "rating", prompt: "Score", required: true },
          { questionId: "count", type: "number", prompt: "Count", required: true },
          { questionId: "when", type: "date", prompt: "When", required: true },
        ],
      }],
    },
    settings: { webhooks: [{ id: "sample", url: sink.url, format: "json", enabled: true }] },
  });
  expect(await readJson(await app.request(`/api/forms/${form.id}/webhooks/missing/test`, { method: "POST" }), 404)).toEqual({ error: "not_found" });
  expect(await readJson(await app.request(`/api/forms/${form.id}/webhooks/sample/test`, { method: "POST" }))).toEqual({
    ok: true, status: 204, error: null,
  });
  const payload = expectSigned(sink.requests[0] ?? { method: "", headers: {}, body: "" }, secret) as {
    submission: { version: number | null; answers: Array<{ questionId: string; value: unknown }> }; responsesUrl: string;
  };
  expect(payload.submission.version).toBeNull();
  expect(payload.responsesUrl).toBe(`https://forms.example/forms/${form.id}/responses`);
  expect(Object.fromEntries(payload.submission.answers.map((answer) => [answer.questionId, answer.value]))).toEqual({
    name: "Sample answer", color: "red", tags: ["a"], score: 3, count: 42, when: "2026-01-01",
  });
});

it("prunes webhook delivery rows to the newest 100 and keeps the host only", async () => {
  // source: recordDelivery stores URL host only and deletes that form's rows beyond the newest 100.
  handle = await openTestDb();
  app = await createTestApp({ db: handle });
  await app.login();
  const form = await createForm(app);
  const hook: WebhookConfig = {
    id: "prune", url: "https://user:pass@hooks.example:8443/private/path?token=secret", format: "json", enabled: true,
  };
  for (let index = 0; index < 101; index += 1) {
    await recordDelivery(handle, form.id, hook, { ok: true, status: 204, error: null });
  }
  const [row] = await handle.db.select({ value: count() }).from(webhookDeliveries).where(eq(webhookDeliveries.formId, form.id));
  expect(row?.value).toBe(100);
  const ids = (await handle.db.select({ id: webhookDeliveries.id }).from(webhookDeliveries)).map((item) => item.id).sort((a, b) => a - b);
  expect(ids[0]).toBe(2);
  expect(ids.at(-1)).toBe(101);
  const listed = await readJson<{ deliveries: Array<{ id: number; webhookId: string; urlHost: string; status: number | null; ok: boolean; error: string | null; createdAt: string }> }>(
    await app.request(`/api/forms/${form.id}/webhooks/deliveries`),
  );
  expect(listed.deliveries).toHaveLength(20);
  expect(listed.deliveries[0]).toMatchObject({ id: 101, webhookId: "prune", urlHost: "hooks.example:8443", status: 204, ok: true, error: null });
  expect(listed.deliveries[19]?.id).toBe(82);
  expect(listed.deliveries[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const raw = JSON.stringify(listed);
  expect(raw).not.toContain("user:pass");
  expect(raw).not.toContain("private");
  expect(raw).not.toContain("token");
});
