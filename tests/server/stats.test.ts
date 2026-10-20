import { afterEach, expect, it } from "vitest";
import { createForm, createTestApp, jsonBody, publishForm, readJson, type TestApp } from "./helpers";

let app: TestApp | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

it("dedupes view and start events and computes completion from submissions over views", async () => {
  // source: duplicate events are ignored, and completionRate is submissions divided by views, null when views are 0.
  app = await createTestApp();
  await app.login();
  const form = await publishForm(app, { title: "Stats" });
  const events = `/api/public/forms/${form.slug}/events`;
  expect(await readJson(await app.request(events, jsonBody({ type: "submit", sessionId: "session-a" })), 400)).toEqual({ error: "invalid_body" });
  expect(await readJson(await app.request(events, jsonBody({ type: "view", sessionId: "short" })), 400)).toEqual({ error: "invalid_body" });
  expect(await readJson(await app.request("/api/public/forms/missing-slug/events", jsonBody({
    type: "view", sessionId: "session-a",
  })), 404)).toEqual({ error: "not_found" });
  const draft = await createForm(app, { title: "Unpublished" });
  expect(await readJson(await app.request(`/api/public/forms/${draft.slug}/events`, jsonBody({
    type: "view", sessionId: "session-a",
  })), 404)).toEqual({ error: "not_found" });

  const quiet = await publishForm(app, { title: "Quiet" });
  expect(await readJson(await app.request(`/api/forms/${quiet.id}/stats`))).toEqual({
    views: 0, starts: 0, submissions: 0, completionRate: null,
  });
  expect((await app.request(`/api/public/forms/${quiet.slug}/events`, jsonBody({ type: "start", sessionId: "session-z" }))).status).toBe(204);
  expect((await app.request(`/api/public/forms/${quiet.slug}/submissions`, jsonBody({ responses: { name: "Bea" } }))).status).toBe(201);
  expect(await readJson(await app.request(`/api/forms/${quiet.id}/stats`))).toEqual({
    views: 0, starts: 1, submissions: 1, completionRate: null,
  });

  for (const sessionId of ["session-a", "session-a", "session-b", "session-c"]) {
    expect((await app.request(events, jsonBody({ type: "view", sessionId }))).status).toBe(204);
  }
  expect((await app.request(events, jsonBody({ type: "start", sessionId: "session-a" }))).status).toBe(204);
  expect((await app.request(events, jsonBody({ type: "start", sessionId: "session-a" }))).status).toBe(204);
  expect((await app.request(`/api/public/forms/${form.slug}/submissions`, jsonBody({
    responses: { name: "Ada" }, sessionId: "session-a",
  }))).status).toBe(201);
  expect(await readJson(await app.request(`/api/forms/${form.id}/stats`))).toEqual({
    views: 3, starts: 1, submissions: 1, completionRate: 0.333,
  });

  expect((await app.request(`/api/forms/${form.id}/close`, { method: "POST" })).status).toBe(200);
  expect(await readJson(await app.request(events, jsonBody({ type: "view", sessionId: "session-d" })), 404)).toEqual({ error: "not_found" });
});

it("limits public events per address", async () => {
  // source: eventsPerMinute returns 429 once the per-address budget is spent.
  app = await createTestApp({ limits: { eventsPerMinute: 2 } });
  await app.login();
  const form = await publishForm(app);
  const send = (sessionId: string) => app?.request(`/api/public/forms/${form.slug}/events`, jsonBody({ type: "view", sessionId }));
  expect((await send("session-a"))?.status).toBe(204);
  expect((await send("session-b"))?.status).toBe(204);
  expect(await readJson(await app.request(`/api/public/forms/${form.slug}/events`, jsonBody({
    type: "view", sessionId: "session-c",
  })), 429)).toEqual({ error: "too_many_requests" });
});
