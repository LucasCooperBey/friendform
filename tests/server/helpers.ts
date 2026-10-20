import { createServer } from "node:http";
import { expect } from "vitest";
import { createApp, type AppDeps } from "../../server/app";
import type { Config } from "../../server/config";
import type { FormDetail } from "../../server/forms-service";
import type { FormSchema, Question } from "../../shared/form-schema";
import { openTestDb } from "../helpers/test-db";

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    nodeEnv: "test", host: "127.0.0.1", port: 0, publicUrl: null, dataDir: "unused",
    databaseUrl: null, adminPassword: "correct horse battery", sessionSecret: "s".repeat(48),
    trustProxy: false, webhookSecret: null, ai: { baseUrl: null, apiKey: null, model: null }, ...overrides,
  };
}

export async function createTestApp(overrides: Partial<AppDeps> = {}) {
  const db = overrides.db ?? await openTestDb();
  const tasks: Promise<unknown>[] = [];
  const app = createApp({
    config: testConfig(), ...overrides, db,
    onBackgroundTask: (task) => { tasks.push(task); overrides.onBackgroundTask?.(task); },
  });
  const server = createServer(app);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    await db.close();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server has no port");
  const url = `http://127.0.0.1:${address.port}`;
  let cookie = "";
  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (cookie && !headers.has("cookie")) headers.set("cookie", cookie);
    const response = await fetch(url + path, { ...init, headers });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0] ?? "";
    return response;
  }
  return {
    url, request, tasks,
    login: () => request("/api/auth/login", jsonBody({ password: "correct horse battery" })),
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeIdleConnections();
      });
      await Promise.allSettled(tasks);
      await db.close();
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

export function jsonBody(value: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) };
}

export async function readJson<T>(response: Response, status = 200): Promise<T> {
  expect(response.status).toBe(status);
  return await response.json() as T;
}

export function schemaOf(questions: Question[] = [{ questionId: "name", type: "text", prompt: "Your name", required: true }]): FormSchema {
  return { sections: [{ title: "About you", questions }] };
}

export async function createForm(app: TestApp, values: Record<string, unknown> = {}): Promise<FormDetail> {
  const body = await readJson<{ form: FormDetail }>(await app.request("/api/forms", jsonBody({
    title: "Feedback", draftSchema: schemaOf(), ...values,
  })), 201);
  return body.form;
}

export async function publishForm(app: TestApp, values: Record<string, unknown> = {}): Promise<FormDetail> {
  const form = await createForm(app, values);
  const body = await readJson<{ form: FormDetail }>(await app.request(`/api/forms/${form.id}/publish`, { method: "POST" }));
  return body.form;
}
