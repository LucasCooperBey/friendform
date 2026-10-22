import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError, createAiClient } from "../../server/ai";
import type { Config } from "../../server/config";
import { formSchemaZ, type FormSchema, type Question } from "../../shared/form-schema";
import { startAiFake, type AiFake, type CannedReply } from "./ai-fake";
import { createTestApp, jsonBody, readJson, testConfig, type TestApp } from "./helpers";

const DESCRIPTION = "purple-workshop-signup-purpose for a Saturday class";
const FORMAT_SENTINEL = "RESPONSE_FORMAT_REJECTED";

const savedEnv = {
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
};

let app: TestApp | undefined;
let fake: AiFake | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  await fake?.close();
  fake = undefined;
  restoreEnv();
});

function restoreEnv(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function replyJson(value: unknown, extra: Partial<CannedReply> = {}): CannedReply {
  return { content: JSON.stringify(value), ...extra };
}

function validDraft(title = "Hello form"): unknown {
  return {
    title,
    description: "A short description",
    schema: {
      sections: [{
        title: "Questions",
        questions: [
          { questionId: "name", type: "text", prompt: "Name", required: true },
          { questionId: "email", type: "email", prompt: "Email", required: true },
          { questionId: "note", type: "textarea", prompt: "Note", required: false },
        ],
      }],
    },
  };
}

function fenced(value: unknown): string {
  return "```json\n" + JSON.stringify(value) + "\n```";
}

function aiConfig(baseUrl: string, patch: Partial<Config["ai"]> = {}): Config["ai"] {
  return { baseUrl: `${baseUrl}/`, apiKey: "test-key", model: "test-model", ...patch };
}

function rememberEnv(baseUrl: string, ai: Config["ai"]): void {
  process.env.AI_BASE_URL = baseUrl;
  if (ai.apiKey === null) delete process.env.AI_API_KEY;
  else process.env.AI_API_KEY = ai.apiKey;
  if (ai.model === null) delete process.env.AI_MODEL;
  else process.env.AI_MODEL = ai.model;
}

async function openApp(patch: Partial<Config["ai"]> = {}, limits?: { aiGeneratePerHour: number }): Promise<TestApp> {
  fake = await startAiFake();
  const ai: Config["ai"] = { baseUrl: `${fake.baseUrl}/`, apiKey: "test-key", model: "test-model", ...patch };
  rememberEnv(fake.baseUrl, ai);
  app = await createTestApp({ config: testConfig({ ai }), limits });
  return app;
}

function messagesOf(body: unknown): Array<{ role: unknown; content: unknown }> {
  if (!isRecord(body) || !Array.isArray(body.messages)) throw new Error("missing messages");
  return body.messages.flatMap((message) => {
    if (!isRecord(message)) return [];
    return [{ role: message.role, content: message.content }];
  });
}

function questionByPrompt(questions: Question[], prompt: string): Question {
  const found = questions.find((question) => question.prompt === prompt);
  if (!found) throw new Error(`missing question ${prompt}`);
  return found;
}

describe("createAiClient", () => {
  // source: enabled is true only when the key and the model are both set. A set model with no key stays disabled.
  it("is disabled unless the key and the model are both set", async () => {
    const missingKey = createAiClient({ baseUrl: "http://127.0.0.1:9/v1", apiKey: null, model: "test-model" });
    expect(missingKey.enabled).toBe(false);
    expect(missingKey.model).toBe("test-model");
    await expect(missingKey.completeJson([{ role: "user", content: "hello there" }])).rejects.toMatchObject({
      name: "AiError",
      code: "disabled",
    });
    expect(createAiClient({ baseUrl: null, apiKey: "test-key", model: null }).enabled).toBe(false);
    expect(createAiClient({ baseUrl: null, apiKey: "test-key", model: "test-model" }).enabled).toBe(true);
  });

  // source: an unset base URL posts to https://api.openai.com/v1/chat/completions. One trailing slash is removed.
  it("uses the default completions URL and strips one trailing slash", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      return new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = createAiClient({ baseUrl: null, apiKey: "test-key", model: "test-model" }, { fetchImpl });
    await expect(client.completeJson([{ role: "user", content: "hello there" }])).resolves.toEqual({ ok: true });
    expect(seen).toEqual(["https://api.openai.com/v1/chat/completions"]);
    seen.length = 0;
    const slashed = createAiClient({ baseUrl: "https://api.openai.com/v1/", apiKey: "test-key", model: "test-model" }, { fetchImpl });
    await slashed.completeJson([{ role: "user", content: "hello there" }]);
    expect(seen).toEqual(["https://api.openai.com/v1/chat/completions"]);
  });

  // source: a timeout is not retried. A short timeout against a slow reply throws AiError timeout after one request.
  // The client's fetch calls are counted, because under load the client can give up before the fake sees the request.
  it("does not retry a timeout", async () => {
    fake = await startAiFake();
    fake.push({ delayMs: 1000, content: "{\"ok\":true}" });
    let calls = 0;
    const fetchImpl: typeof fetch = (input, init) => {
      calls += 1;
      return fetch(input, init);
    };
    const client = createAiClient(aiConfig(fake.baseUrl), { fetchImpl });
    const started = Date.now();
    await expect(client.completeJson([{ role: "user", content: "hello there" }], { timeoutMs: 150 })).rejects.toMatchObject({
      code: "timeout",
    });
    expect(Date.now() - started).toBeLessThan(450);
    expect(calls).toBe(1);
  });

  // source: a 500 is retried once after 500 ms, and the second success is returned.
  it("retries a 500 once after 500 ms", async () => {
    fake = await startAiFake();
    fake.push({ status: 500, rawBody: "upstream blew up" }, replyJson({ ok: true }));
    const client = createAiClient(aiConfig(fake.baseUrl));
    const started = Date.now();
    await expect(client.completeJson([{ role: "user", content: "hello there" }])).resolves.toEqual({ ok: true });
    expect(Date.now() - started).toBeGreaterThanOrEqual(450);
    expect(fake.requests).toHaveLength(2);
  });

  // source: a timeout on the retry after a 500 is AiError timeout, not upstream.
  it("reports a timeout on the retry after a 500", async () => {
    fake = await startAiFake();
    fake.push({ status: 500, rawBody: "upstream blew up" }, { delayMs: 1000, content: "{\"ok\":true}" });
    const client = createAiClient(aiConfig(fake.baseUrl));
    const error = await client.completeJson([{ role: "user", content: "hello there" }], { timeoutMs: 200 }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AiError);
    if (!(error instanceof AiError)) return;
    expect(error.code).toBe("timeout");
    expect(error.code).not.toBe("upstream");
    expect(fake.requests).toHaveLength(2);
  });

  // source: a 401 is upstream, is not retried, and the message names the status only.
  it("does not retry a 401 and hides the body and the key", async () => {
    fake = await startAiFake();
    fake.push({ status: 401, rawBody: "BODY-SENTINEL" });
    const client = createAiClient(aiConfig(fake.baseUrl));
    const error = await client.completeJson([{ role: "user", content: "hello there" }]).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AiError);
    if (!(error instanceof AiError)) return;
    expect(error.code).toBe("upstream");
    expect(error.message).toBe("AI request failed with status 401");
    expect(error.message).not.toContain("BODY-SENTINEL");
    expect(error.message).not.toContain("test-key");
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.authorization).toBe("Bearer test-key");
  });

  // source: a network failure is retried once and the message does not include the endpoint address.
  it("retries a network error and does not name the address", async () => {
    fake = await startAiFake();
    fake.push({ destroy: true }, { destroy: true });
    const client = createAiClient(aiConfig(fake.baseUrl));
    const error = await client.completeJson([{ role: "user", content: "hello there" }]).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AiError);
    if (!(error instanceof AiError)) return;
    expect(error.code).toBe("upstream");
    expect(error.message).toBe("AI request failed");
    expect(error.message).not.toContain("127.0.0.1");
    expect(fake.requests).toHaveLength(2);
  });
});

describe("POST /api/ai/generate-form", () => {
  // source: generate-form repairs unknown types, duplicate ids, later conditions, and unknown operators, and keeps a valid earlier condition.
  it("repairs a draft and keeps the description out of the system prompt", async () => {
    const running = await openApp();
    if (!fake) throw new Error("fake missing");
    fake.push(replyJson({
      title: "Workshop signup",
      description: "Sign up for the workshop",
      schema: {
        sections: [{
          title: "T".repeat(201),
          description: "D".repeat(2001),
          questions: [
            { questionId: "name", type: "text", prompt: "Your name", subtext: "s".repeat(1001), required: true },
            {
              questionId: "name",
              type: "email",
              prompt: "Email",
              required: false,
              metadata: { conditionalLogic: { enabled: true, questionId: "name", operator: "equals", value: "Ada" } },
            },
            {
              questionId: "why",
              type: "text",
              prompt: "Why",
              required: false,
              metadata: { conditionalLogic: { enabled: true, questionId: "color", operator: "equals", value: "Red" } },
            },
            {
              questionId: "color",
              type: "radio",
              prompt: "Color",
              required: false,
              metadata: {
                options: ["Red", "Blue", "R".repeat(201)],
                conditionalLogic: { enabled: true, questionId: "name", operator: "greater_than", value: 1 },
              },
            },
            {
              questionId: "gone",
              type: "text",
              prompt: "Gone",
              required: false,
              metadata: { conditionalLogic: { enabled: true, questionId: "not_a_question", operator: "is_empty" } },
            },
            { questionId: "draw", type: "sketch", prompt: "Draw it", required: false },
          ],
        }],
      },
    }));
    await running.login();
    const body = await readJson<{ title: string; description: string; schema: FormSchema }>(
      await running.request("/api/ai/generate-form", jsonBody({ description: DESCRIPTION })),
    );
    expect(body.title).toBe("Workshop signup");
    expect(body.description).toBe("Sign up for the workshop");
    const schema = formSchemaZ.parse(body.schema);
    const section = schema.sections[0];
    if (!section) throw new Error("missing section");
    expect(section.title).toHaveLength(200);
    expect(section.description).toHaveLength(2000);
    const questions = section.questions;
    expect(questions.map((question) => question.prompt)).not.toContain("Draw it");
    expect(questions.map((question) => question.type)).toEqual(["text", "email", "text", "radio", "text"]);
    const ids = questions.map((question) => question.questionId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("name");
    expect(ids[1]).toMatch(/^q_[a-z0-9]+$/);
    expect(questions[0]?.subtext).toHaveLength(1000);
    const email = questions[1];
    expect(email?.metadata?.conditionalLogic).toEqual({ enabled: true, questionId: "name", operator: "equals", value: "Ada" });
    expect(questionByPrompt(questions, "Why").metadata?.conditionalLogic).toBeUndefined();
    const color = questionByPrompt(questions, "Color");
    expect(color.metadata?.conditionalLogic).toBeUndefined();
    expect(color.metadata?.options?.[2]).toHaveLength(200);
    expect(questionByPrompt(questions, "Gone").metadata?.conditionalLogic).toBeUndefined();

    expect(fake.requests).toHaveLength(1);
    const recorded = fake.requests[0];
    if (!recorded) throw new Error("missing request");
    expect(recorded.authorization).toBe("Bearer test-key");
    expect(isRecord(recorded.body) && recorded.body.model).toBe("test-model");
    expect(isRecord(recorded.body) && recorded.body.temperature).toBe(0.2);
    expect(isRecord(recorded.body) && recorded.body.response_format).toEqual({ type: "json_object" });
    const messages = messagesOf(recorded.body);
    expect(messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(messages[1]?.content).toBe(DESCRIPTION);
    const system = messages[0]?.content;
    expect(typeof system).toBe("string");
    if (typeof system !== "string") return;
    expect(system).not.toContain(DESCRIPTION);
    expect(system).toContain("3 to 15");
    expect(system).toContain("textarea");
    expect(system).toContain("not_equals");
  });

  // source: AiError disabled is 404 ai_disabled and does not call the endpoint when the key is missing.
  it("returns 404 ai_disabled when the key is missing", async () => {
    const running = await openApp({ apiKey: null });
    if (!fake) throw new Error("fake missing");
    await running.login();
    expect(await readJson(await running.request("/api/ai/generate-form", jsonBody({ description: DESCRIPTION })), 404)).toEqual({
      error: "ai_disabled",
    });
    expect(fake.requests).toHaveLength(0);
  });

  // source: a slow reply past the request timeout is 504 ai_timeout and is not retried.
  it("returns 504 ai_timeout when the reply is too slow", async () => {
    const running = await openApp();
    if (!fake) throw new Error("fake missing");
    fake.push({ delayMs: 800, content: JSON.stringify(validDraft()) });
    const original = AbortSignal.timeout;
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => original.call(AbortSignal, Math.min(ms, 200)));
    try {
      await running.login();
      expect(await readJson(await running.request("/api/ai/generate-form", jsonBody({ description: DESCRIPTION })), 504)).toEqual({
        error: "ai_timeout",
      });
      expect(fake.requests).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  // source: unparsable model content and an unrepairable draft are both 502 ai_bad_output.
  it("returns 502 ai_bad_output for unparsable and unrepairable drafts", async () => {
    const running = await openApp();
    if (!fake) throw new Error("fake missing");
    await running.login();
    fake.push({ content: "this is not json" });
    expect(await readJson(await running.request("/api/ai/generate-form", jsonBody({ description: DESCRIPTION })), 502)).toEqual({
      error: "ai_bad_output",
    });
    fake.push(replyJson({
      title: "Nope",
      description: "",
      schema: { sections: [{ title: "S", questions: [{ questionId: "draw", type: "sketch", prompt: "Draw", required: false }] }] },
    }));
    expect(await readJson(await running.request("/api/ai/generate-form", jsonBody({ description: DESCRIPTION })), 502)).toEqual({
      error: "ai_bad_output",
    });
  });

  // source: an upstream failure is 502 ai_upstream.
  it("returns 502 ai_upstream when the endpoint rejects the key", async () => {
    const running = await openApp();
    if (!fake) throw new Error("fake missing");
    fake.push({ status: 401, rawBody: "BODY-SENTINEL" });
    await running.login();
    const response = await running.request("/api/ai/generate-form", jsonBody({ description: DESCRIPTION }));
    const raw = await response.text();
    expect(response.status).toBe(502);
    expect(JSON.parse(raw)).toEqual({ error: "ai_upstream" });
    expect(raw).not.toContain("BODY-SENTINEL");
    expect(raw).not.toContain("test-key");
  });

  // source: generate-form without a session is 401 and does not call the endpoint.
  it("returns 401 without a session", async () => {
    const running = await openApp();
    if (!fake) throw new Error("fake missing");
    expect(await readJson(await running.request("/api/ai/generate-form", jsonBody({ description: DESCRIPTION })), 401)).toEqual({
      error: "unauthorized",
    });
    expect(fake.requests).toHaveLength(0);
  });

  // source: a 400 that rejects response_format is retried once without that field, and a fenced JSON body is accepted.
  it("retries a 400 once without response_format and reads a fenced JSON body", async () => {
    const running = await openApp();
    if (!fake) throw new Error("fake missing");
    const draft = validDraft("Fenced draft");
    fake.push({ status: 400, rawBody: FORMAT_SENTINEL }, { content: fenced(draft) });
    await running.login();
    const response = await running.request("/api/ai/generate-form", jsonBody({ description: DESCRIPTION }));
    const raw = await response.text();
    expect(response.status).toBe(200);
    expect(raw).not.toContain(FORMAT_SENTINEL);
    expect(JSON.parse(raw)).toMatchObject({ title: "Fenced draft" });
    expect(fake.requests).toHaveLength(2);
    expect(isRecord(fake.requests[0]?.body) && "response_format" in fake.requests[0].body).toBe(true);
    expect(isRecord(fake.requests[1]?.body) && "response_format" in fake.requests[1].body).toBe(false);
  });

  // source: the retry after a 400 sends neither response_format nor temperature
  it("retries a 400 without temperature or response_format", async () => {
    const running = await openApp();
    if (!fake) throw new Error("fake missing");
    fake.push({ status: 400, rawBody: FORMAT_SENTINEL }, { content: fenced(validDraft("Bare retry")) });
    await running.login();
    expect((await readJson<{ title: string }>(await running.request("/api/ai/generate-form", jsonBody({ description: DESCRIPTION })))).title).toBe("Bare retry");
    expect(fake.requests).toHaveLength(2);
    const first = fake.requests[0]?.body;
    const second = fake.requests[1]?.body;
    expect(isRecord(first) && first.temperature).toBe(0.2);
    expect(isRecord(first) && first.response_format).toEqual({ type: "json_object" });
    expect(isRecord(second) && Object.hasOwn(second, "temperature")).toBe(false);
    expect(isRecord(second) && Object.hasOwn(second, "response_format")).toBe(false);
  });

  // source: aiGeneratePerHour limits generate-form per IP. The blocked request does not call the endpoint.
  it("rate limits generate-form", async () => {
    const running = await openApp({}, { aiGeneratePerHour: 2 });
    if (!fake) throw new Error("fake missing");
    fake.push(replyJson(validDraft("One")), replyJson(validDraft("Two")), replyJson(validDraft("Three")));
    await running.login();
    expect((await readJson<{ title: string }>(await running.request("/api/ai/generate-form", jsonBody({ description: DESCRIPTION })))).title).toBe("One");
    expect((await readJson<{ title: string }>(await running.request("/api/ai/generate-form", jsonBody({ description: DESCRIPTION })))).title).toBe("Two");
    expect(await readJson(await running.request("/api/ai/generate-form", jsonBody({ description: DESCRIPTION })), 429)).toEqual({
      error: "too_many_requests",
    });
    expect(fake.requests).toHaveLength(2);
  });
});
