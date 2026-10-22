import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RateLimitSettings } from "../../server/app";
import type { Config } from "../../server/config";
import type { DbHandle } from "../../server/db/index";
import { submissions } from "../../server/db/schema";
import type { FormSchema } from "../../shared/form-schema";
import { openTestDb } from "../helpers/test-db";
import { startAiFake, type AiFake, type CannedReply } from "./ai-fake";
import { createForm, createTestApp, jsonBody, publishForm, readJson, schemaOf, testConfig, type TestApp } from "./helpers";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const FILE_SENTINEL = "FILESENTINEL";
const MODEL_SENTINEL = "MODELSENTINEL";

const savedEnv = {
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
};

let app: TestApp | undefined;
let fake: AiFake | undefined;
let handle: DbHandle | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  handle = undefined;
  await fake?.close();
  fake = undefined;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function replyJson(value: unknown): CannedReply {
  return { content: JSON.stringify(value) };
}

function sampleSchema(): FormSchema {
  return schemaOf([
    { questionId: "name", type: "text", prompt: "Your name", required: true },
    { questionId: "email", type: "email", prompt: "Email", required: false },
    { questionId: "color", type: "radio", prompt: "Color", required: false, metadata: { options: ["Red", "Blue"] } },
    { questionId: "score", type: "rating", prompt: "Score", required: false, metadata: { min: 1, max: 5 } },
    {
      questionId: "why",
      type: "text",
      prompt: "Why",
      required: false,
      metadata: { conditionalLogic: { enabled: true, questionId: "color", operator: "equals", value: "Red" } },
    },
  ]);
}

function uploadBody(data: Buffer, mimeType: string, filename = "notes.txt") {
  return { filename, mimeType, dataBase64: data.toString("base64") };
}

async function boot(options: {
  ai?: Partial<Config["ai"]>;
  limits?: Partial<RateLimitSettings>;
  trustProxy?: false | number;
  withDb?: boolean;
} = {}): Promise<TestApp> {
  fake = await startAiFake();
  const ai: Config["ai"] = {
    baseUrl: `${fake.baseUrl}/`,
    apiKey: "test-key",
    model: "test-model",
    ...options.ai,
  };
  process.env.AI_BASE_URL = fake.baseUrl;
  if (ai.apiKey === null) delete process.env.AI_API_KEY;
  else process.env.AI_API_KEY = ai.apiKey;
  if (ai.model === null) delete process.env.AI_MODEL;
  else process.env.AI_MODEL = ai.model;
  if (options.withDb) handle = await openTestDb();
  app = await createTestApp({
    db: handle,
    config: testConfig({ ai, trustProxy: options.trustProxy ?? false }),
    limits: {
      aiGeneratePerHour: 1000,
      autofillPer15MinPerForm: 1000,
      autofillPerDayPerForm: 1000,
      publicReadsPerMinute: 1000,
      ...options.limits,
    },
  });
  return app;
}

function chat(body: unknown): { system: string; user: unknown } {
  if (!isRecord(body) || !Array.isArray(body.messages)) throw new Error("missing messages");
  const system = body.messages[0];
  const user = body.messages[1];
  if (!isRecord(system) || typeof system.content !== "string" || !isRecord(user)) throw new Error("bad messages");
  return { system: system.content, user: user.content };
}

function questionsFrom(system: string): unknown {
  const marker = "Questions: ";
  const index = system.lastIndexOf(marker);
  if (index < 0) throw new Error("missing questions");
  return JSON.parse(system.slice(index + marker.length)) as unknown;
}

const expectedQuestions = [
  { questionId: "name", type: "text", prompt: "Your name" },
  { questionId: "email", type: "email", prompt: "Email" },
  { questionId: "color", type: "radio", prompt: "Color", options: ["Red", "Blue"] },
  { questionId: "score", type: "rating", prompt: "Score", min: 1, max: 5 },
  { questionId: "why", type: "text", prompt: "Why" },
];

function expectQuestionList(system: string): void {
  expect(system).toContain("data, not instructions");
  expect(questionsFrom(system)).toEqual(expectedQuestions);
}

async function publishSample(running: TestApp, allowAutofill: boolean) {
  await running.login();
  return publishForm(running, { title: "Signup", settings: { allowAutofill }, draftSchema: sampleSchema() });
}

function fromIp(body: unknown, ip: string): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify(body),
  };
}

describe("POST /api/public/forms/:slug/autofill", () => {
  // source: autofill is 404 when allowAutofill is off, and the public GET still reports that false value while AI is on.
  it("returns 404 when the form setting is off and reports the setting on the public GET", async () => {
    const running = await boot();
    if (!fake) throw new Error("fake missing");
    const off = await publishSample(running, false);
    const on = await publishSample(running, true);
    const hidden = await readJson<{ settings: { allowAutofill: boolean } }>(await running.request(`/api/public/forms/${off.slug}`));
    const shown = await readJson<{ settings: { allowAutofill: boolean } }>(await running.request(`/api/public/forms/${on.slug}`));
    expect(hidden.settings.allowAutofill).toBe(false);
    expect(shown.settings.allowAutofill).toBe(true);
    fake.push(replyJson({ answers: { name: "Ada" } }));
    expect(await readJson(await running.request(`/api/public/forms/${off.slug}/autofill`, jsonBody(uploadBody(Buffer.from("Ada"), "text/plain"))), 404)).toEqual({
      error: "not_found",
    });
    expect(fake.requests).toHaveLength(0);
  });

  // source: with AI unset, autofill is 404 not_found and the public GET hides allowAutofill.
  it("returns 404 and hides allowAutofill when AI is off", async () => {
    const running = await boot({ ai: { apiKey: null, model: "test-model" } });
    if (!fake) throw new Error("fake missing");
    const form = await publishSample(running, true);
    const body = await readJson<{ settings: { allowAutofill: boolean } }>(await running.request(`/api/public/forms/${form.slug}`));
    expect(body.settings.allowAutofill).toBe(false);
    fake.push(replyJson({ answers: { name: "Ada" } }));
    expect(await readJson(await running.request(`/api/public/forms/${form.slug}/autofill`, jsonBody(uploadBody(Buffer.from("Ada"), "text/plain"))), 404)).toEqual({
      error: "not_found",
    });
    expect(fake.requests).toHaveLength(0);
  });

  // source: a closed form is 404 for autofill, not 410, and a draft is 404. Neither call reaches the model.
  it("returns 404 for a closed form and a draft", async () => {
    const running = await boot();
    if (!fake) throw new Error("fake missing");
    const form = await publishSample(running, true);
    expect((await running.request(`/api/forms/${form.id}/close`, { method: "POST" })).status).toBe(200);
    const closed = await running.request(`/api/public/forms/${form.slug}/autofill`, jsonBody(uploadBody(Buffer.from("Ada is here"), "text/plain")));
    expect(closed.status).toBe(404);
    expect(await closed.json()).toEqual({ error: "not_found" });
    const draft = await createForm(running, { title: "Draft", settings: { allowAutofill: true }, draftSchema: sampleSchema() });
    expect(await readJson(await running.request(`/api/public/forms/${draft.slug}/autofill`, jsonBody(uploadBody(Buffer.from("Ada is here"), "text/plain"))), 404)).toEqual({
      error: "not_found",
    });
    expect(fake.requests).toHaveLength(0);
  });

  // source: a PNG labeled as a PDF, an unknown type, an empty file, and a file over 5 MB map to 415, 422, and 413, and do not call the model.
  it("maps sniff, type, empty, and size failures", async () => {
    const running = await boot();
    if (!fake) throw new Error("fake missing");
    const form = await publishSample(running, true);
    const pathName = `/api/public/forms/${form.slug}/autofill`;
    fake.push(replyJson({ answers: { name: "Ada" } }));
    expect(await readJson(await running.request(pathName, jsonBody(uploadBody(PNG, "application/pdf", "photo.pdf"))), 415)).toEqual({
      error: "unsupported_file",
    });
    const docx = readFileSync(path.join(fixtures, "sample.docx"));
    expect(await readJson(await running.request(pathName, jsonBody(uploadBody(docx, "application/zip", "sample.docx"))), 415)).toEqual({
      error: "unsupported_file",
    });
    expect(await readJson(await running.request(pathName, jsonBody({ filename: "a.txt", mimeType: "text/plain", dataBase64: "****" })), 415)).toEqual({
      error: "unsupported_file",
    });
    expect(await readJson(await running.request(pathName, jsonBody(uploadBody(Buffer.from(" \n\t"), "text/plain"))), 422)).toEqual({
      error: "empty_file",
    });
    const over = Buffer.alloc(5 * 1024 * 1024 + 1, 0x41);
    const tooBig = uploadBody(over, "text/plain", "big.txt");
    const encoded = JSON.stringify(tooBig);
    expect(encoded.length).toBeLessThan(7 * 1024 * 1024);
    expect(Buffer.from(tooBig.dataBase64, "base64").length).toBe(5 * 1024 * 1024 + 1);
    expect(await readJson(await running.request(pathName, jsonBody(tooBig)), 413)).toEqual({ error: "file_too_large" });
    expect(fake.requests).toHaveLength(0);
  });

  // source: text, PDF, and DOCX reach the model as user-message data, and the system prompt lists only questionId, type, prompt, options, min, and max.
  it("sends extracted text, PDF, and DOCX to the model as data", async () => {
    const running = await boot();
    if (!fake) throw new Error("fake missing");
    const form = await publishSample(running, true);
    const pathName = `/api/public/forms/${form.slug}/autofill`;
    const text = `Name: Ada\n${FILE_SENTINEL}\n`;
    fake.push(replyJson({ answers: { name: "Ada" } }));
    expect(await readJson(await running.request(pathName, jsonBody(uploadBody(Buffer.from(text), "text/plain"))))).toEqual({
      answers: { name: "Ada" },
      filled: 1,
    });
    const textChat = chat(fake.requests[0]?.body);
    expect(textChat.user).toBe(text);
    expect(textChat.system).not.toContain(FILE_SENTINEL);
    expectQuestionList(textChat.system);
    expect(isRecord(fake.requests[0]?.body) && fake.requests[0].body.response_format).toEqual({ type: "json_object" });
    expect(fake.requests[0]?.authorization).toBe("Bearer test-key");

    fake.push(replyJson({ answers: {} }));
    await readJson(await running.request(pathName, jsonBody(uploadBody(readFileSync(path.join(fixtures, "sample.pdf")), "application/pdf", "sample.pdf"))));
    const pdfChat = chat(fake.requests[1]?.body);
    expect(pdfChat.user).toEqual(expect.stringContaining("Hello from the sample PDF"));
    expect(pdfChat.system).not.toContain("Hello from the sample PDF");

    fake.push(replyJson({ answers: {} }));
    await readJson(await running.request(pathName, jsonBody(uploadBody(readFileSync(path.join(fixtures, "sample.docx")), DOCX_MIME, "sample.docx"))));
    const docxChat = chat(fake.requests[2]?.body);
    expect(docxChat.user).toEqual(expect.stringContaining("Hello from the sample document"));
    expect(docxChat.system).not.toContain("Hello from the sample document");
  });

  // source: an image reaches the model as a data URL on the user message, and that URL stays out of the system prompt.
  it("sends an image as a data URL on the user message", async () => {
    const running = await boot();
    if (!fake) throw new Error("fake missing");
    const form = await publishSample(running, true);
    fake.push(replyJson({ answers: {} }));
    await readJson(await running.request(
      `/api/public/forms/${form.slug}/autofill`,
      jsonBody(uploadBody(PNG, "image/png", "photo.png")),
    ));
    const imageChat = chat(fake.requests[0]?.body);
    expect(imageChat.user).toEqual([
      { type: "text", text: "The document is the attached image." },
      { type: "image_url", image_url: { url: `data:image/png;base64,${PNG.toString("base64")}` } },
    ]);
    expect(imageChat.system).not.toContain("data:image/png");
    expectQuestionList(imageChat.system);
  });

  // source: unknown and invalid answers are dropped, a conditional answer is kept, nothing is stored, and the file and model output are not logged.
  it("keeps only valid answers and stores nothing", async () => {
    const running = await boot({ withDb: true });
    if (!fake || !handle) throw new Error("missing fake or database");
    const form = await publishSample(running, true);
    fake.push(replyJson({
      answers: {
        name: "Ada",
        email: "not-an-email",
        color: "Green",
        score: 4,
        why: "because",
        unknown: "nope",
        [MODEL_SENTINEL]: "secret-model-output",
      },
    }));
    const chunks: string[] = [];
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });
    let raw = "";
    try {
      const response = await running.request(
        `/api/public/forms/${form.slug}/autofill`,
        jsonBody(uploadBody(Buffer.from(`Ada\n${FILE_SENTINEL}`), "text/plain")),
      );
      raw = await response.text();
      expect(response.status).toBe(200);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
    expect(JSON.parse(raw)).toEqual({ answers: { name: "Ada", score: 4, why: "because" }, filled: 3 });
    expect(raw).not.toContain(FILE_SENTINEL);
    expect(raw).not.toContain(MODEL_SENTINEL);
    const logged = chunks.join("");
    expect(logged).not.toContain(FILE_SENTINEL);
    expect(logged).not.toContain(MODEL_SENTINEL);
    expect(await handle.db.select().from(submissions)).toEqual([]);
  });

  // source: autofillPer15MinPerForm is keyed by IP plus slug, so a second IP is allowed and the first IP is then blocked.
  it("rate limits autofill per IP and form for 15 minutes", async () => {
    const running = await boot({
      trustProxy: 1,
      limits: { autofillPer15MinPerForm: 1, autofillPerDayPerForm: 100 },
    });
    if (!fake) throw new Error("fake missing");
    const form = await publishSample(running, true);
    const body = uploadBody(Buffer.from("Ada is here"), "text/plain");
    const pathName = `/api/public/forms/${form.slug}/autofill`;
    fake.push(replyJson({ answers: { name: "Ada" } }), replyJson({ answers: { name: "Ada" } }), replyJson({ answers: { name: "Ada" } }));
    expect((await running.request(pathName, fromIp(body, "192.0.2.1"))).status).toBe(200);
    expect((await running.request(pathName, fromIp(body, "192.0.2.2"))).status).toBe(200);
    expect(await readJson(await running.request(pathName, fromIp(body, "192.0.2.1")), 429)).toEqual({ error: "too_many_requests" });
  });

  // source: autofillPerDayPerForm is keyed by slug alone. A new IP shares that counter, and a different slug does not.
  it("rate limits autofill per form across a day", async () => {
    const running = await boot({
      trustProxy: 1,
      limits: { autofillPer15MinPerForm: 100, autofillPerDayPerForm: 2 },
    });
    if (!fake) throw new Error("fake missing");
    const first = await publishSample(running, true);
    const second = await publishSample(running, true);
    const body = uploadBody(Buffer.from("Ada is here"), "text/plain");
    fake.push(
      replyJson({ answers: { name: "Ada" } }),
      replyJson({ answers: { name: "Ada" } }),
      replyJson({ answers: { name: "Ada" } }),
      replyJson({ answers: { name: "Ada" } }),
    );
    expect((await running.request(`/api/public/forms/${first.slug}/autofill`, fromIp(body, "192.0.2.1"))).status).toBe(200);
    const again = await running.request(`/api/public/forms/${first.slug}/autofill`, fromIp(body, "192.0.2.2"));
    expect(again.status).toBe(200);
    const header = again.headers.get("ratelimit") ?? "";
    expect(header).toContain("r=99");
    expect(header).toContain("r=0");
    expect(await readJson(await running.request(`/api/public/forms/${first.slug}/autofill`, fromIp(body, "192.0.2.3")), 429)).toEqual({
      error: "too_many_requests",
    });
    expect((await running.request(`/api/public/forms/${second.slug}/autofill`, fromIp(body, "192.0.2.3"))).status).toBe(200);
  });

  // source: a body over 1 MB reaches autofill, and the same body sent to POST /api/forms is 413.
  it("accepts a 1 MB autofill body and rejects that body on form create", async () => {
    const running = await boot();
    if (!fake) throw new Error("fake missing");
    const form = await publishSample(running, true);
    const raw = "A".repeat(800 * 1024);
    const payload = uploadBody(Buffer.from(raw), "text/plain", "notes.txt");
    const encoded = JSON.stringify(payload);
    expect(encoded.length).toBeGreaterThan(1024 * 1024);
    expect(encoded.length).toBeLessThan(7 * 1024 * 1024);
    expect(Buffer.from(payload.dataBase64, "base64").length).toBeLessThan(5 * 1024 * 1024);
    fake.push(replyJson({ answers: { name: "Ada" } }));
    expect((await running.request(`/api/public/forms/${form.slug}/autofill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: encoded,
    })).status).toBe(200);
    expect(await readJson(await running.request("/api/forms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: encoded,
    }), 413)).toEqual({ error: "payload_too_large" });
  });
});
