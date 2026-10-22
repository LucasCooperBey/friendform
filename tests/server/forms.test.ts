import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, emptySchema } from "../../shared/form-schema";
import * as slugs from "../../shared/slug";
import type { Db } from "../../server/db/index";
import type { FormDetail, FormSummary } from "../../server/forms-service";
import { openTestDb } from "../helpers/test-db";
import { createTestApp, createForm, jsonBody, publishForm, readJson, schemaOf, type TestApp } from "./helpers";

let app: TestApp | undefined;
afterEach(async () => { await app?.close(); app = undefined; vi.restoreAllMocks(); });

it("creates defaults, edits draft content, lists summaries in update order and deletes", async () => {
  // source: owner CRUD DTOs, default schema/settings and descending updated_at ordering.
  let now = new Date("2026-01-01T00:00:00Z");
  app = await createTestApp({ now: () => now }); await app.login();
  const { form } = await readJson<{ form: FormDetail }>(await app.request("/api/forms", jsonBody({})), 201);
  expect(form).toEqual({
    id: expect.any(String), slug: expect.stringMatching(slugs.SLUG_RE), title: "Untitled form", description: "",
    status: "draft", publishedVersion: null, submissionCount: 0,
    createdAt: now.toISOString(), updatedAt: now.toISOString(), draftSchema: emptySchema(), settings: DEFAULT_SETTINGS,
    hasUnpublishedChanges: true,
  });
  now = new Date("2026-01-02T00:00:00Z");
  const second = await createForm(app, { settings: { theme: "dark" } });
  now = new Date("2026-01-03T00:00:00Z");
  const edited = await readJson<{ form: FormDetail }>(await app.request(`/api/forms/${form.id}`, jsonBody({
    title: "", description: "Edited", draftSchema: schemaOf(), settings: { allowAutofill: true },
  }, "PATCH")));
  expect(edited.form).toMatchObject({ title: "", description: "Edited", draftSchema: schemaOf(), updatedAt: now.toISOString(), settings: { ...DEFAULT_SETTINGS, allowAutofill: true } });
  expect(await readJson(await app.request(`/api/forms/${form.id}`))).toEqual(edited);
  const list = await readJson<{ forms: FormSummary[] }>(await app.request("/api/forms"));
  expect(list.forms.map((row) => row.id)).toEqual([form.id, second.id]);
  expect(Object.keys(list.forms[0] ?? {}).sort()).toEqual(["id", "slug", "title", "description", "status", "publishedVersion", "submissionCount", "createdAt", "updatedAt"].sort());
  expect((await app.request(`/api/forms/${form.id}`, { method: "DELETE" })).status).toBe(204);
  expect(await readJson(await app.request(`/api/forms/${form.id}`), 404)).toEqual({ error: "not_found" });
});

it("reports only zod issue paths and messages for invalid bodies", async () => {
  // source: form body failures return invalid_body with paths and messages only.
  app = await createTestApp(); await app.login();
  const form = await createForm(app);
  for (const [path, method, body, issuePath] of [
    ["/api/forms", "POST", { title: "" }, ["title"]],
    ["/api/forms", "POST", { description: "x".repeat(2001) }, ["description"]],
    [`/api/forms/${form.id}`, "PATCH", { draftSchema: { sections: "bad" } }, ["draftSchema", "sections"]],
    [`/api/forms/${form.id}`, "PATCH", { settings: { theme: "neon" } }, ["settings", "theme"]],
    ["/api/forms", "POST", { settings: { webhooks: [{ url: "file:///tmp/private" }] } }, ["settings", "webhooks", 0, "id"]],
  ] as const) {
    const result = await readJson<{ error: string; issues: Array<{ path: unknown[]; message: string }> }>(
      await app.request(path, jsonBody(body, method)), 400);
    expect(result.error).toBe("invalid_body");
    expect(result.issues[0]?.path).toEqual(issuePath);
    for (const issue of result.issues) {
      expect(Object.keys(issue).sort()).toEqual(["message", "path"]);
      expect(issue.message.length).toBeGreaterThan(0);
    }
  }
});

it("checks slug syntax and uniqueness, retains settings and retries generated collisions", async () => {
  // source: invalid_slug, slug_taken and up to five generated slug retries.
  app = await createTestApp(); await app.login();
  const first = await createForm(app);
  const second = await createForm(app);
  const update = (slug: string) => app!.request(`/api/forms/${first.id}`, jsonBody({ slug }, "PATCH"));
  expect(await readJson(await update("Invalid slug"), 400)).toEqual({ error: "invalid_slug" });
  expect(await readJson(await update(second.slug), 409)).toEqual({ error: "slug_taken" });
  expect((await readJson<{ form: FormDetail }>(await update("renamed-form"))).form.slug).toBe("renamed-form");
  const generate = vi.spyOn(slugs, "newSlug").mockReturnValueOnce(second.slug).mockReturnValueOnce("unique-retry");
  expect((await createForm(app)).slug).toBe("unique-retry");
  expect(generate).toHaveBeenCalledTimes(2);
});

it("duplicates as a draft with a new slug, no versions and no webhooks", async () => {
  // source: duplicate copies draft/settings while clearing webhooks and publication state.
  app = await createTestApp(); await app.login();
  const original = await createForm(app, {
    title: "x".repeat(200), description: "Original", settings: { theme: "dark", webhooks: [
      { id: "hook", url: "https://hooks.example/private", format: "json", enabled: true },
    ] },
  });
  expect((await app.request(`/api/forms/${original.id}/publish`, { method: "POST" })).status).toBe(200);
  const { form } = await readJson<{ form: FormDetail }>(await app.request(`/api/forms/${original.id}/duplicate`, { method: "POST" }), 201);
  expect(form).toMatchObject({ title: `Copy of ${original.title}`.slice(0, 200), description: original.description,
    status: "draft", publishedVersion: null, draftSchema: original.draftSchema, settings: { ...original.settings, webhooks: [] }, hasUnpublishedChanges: true });
  expect(form.slug).not.toBe(original.slug);
  expect(await readJson(await app.request(`/api/forms/${form.id}/versions`))).toEqual({ versions: [] });
});

it("returns not_found for invalid and unknown ids on all owner resource routes", async () => {
  // source: non-UUID and unknown form ids are 404, including nested routes.
  app = await createTestApp(); await app.login();
  for (const id of ["not-a-uuid", randomUUID()]) {
    for (const [method, suffix] of [
      ["GET", ""], ["PATCH", ""], ["DELETE", ""], ["POST", "/duplicate"], ["POST", "/publish"],
      ["POST", "/close"], ["POST", "/reopen"], ["GET", "/versions"], ["POST", `/versions/${randomUUID()}/restore`],
      ["GET", "/submissions"], ["GET", `/submissions/${randomUUID()}`], ["DELETE", `/submissions/${randomUUID()}`],
      ["GET", "/export.csv"], ["GET", "/stats"], ["POST", "/webhooks/hook/test"], ["GET", "/webhooks/deliveries"],
    ]) {
      expect(await readJson(await app.request(`/api/forms/${id}${suffix}`, { method }), 404)).toEqual({ error: "not_found" });
    }
  }
});

function plainRecord(values: object): Record<string, unknown> {
  const recorded: Record<string, unknown> = {};
  for (const key of Object.keys(values)) {
    const read: unknown = Reflect.get(values, key);
    recorded[key] = read;
  }
  return recorded;
}

function recordFormUpdates(inner: Db, writes: Array<Record<string, unknown>>): Db {
  const update: Db["update"] = (table) => {
    const builder = inner.update(table);
    const set = builder.set.bind(builder);
    return new Proxy(builder, {
      get(builderTarget, builderProp, builderReceiver) {
        if (builderProp !== "set") return Reflect.get(builderTarget, builderProp, builderReceiver);
        return (values: Parameters<typeof set>[0]) => {
          writes.push(plainRecord(values));
          return set(values);
        };
      },
    });
  };
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "update") return update;
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

it("writes settings only when the patch body includes them", async () => {
  // source: a PATCH with no settings must not write the settings column, so a later settings change is not undone
  const handle = await openTestDb();
  const writes: Array<Record<string, unknown>> = [];
  app = await createTestApp({ db: { ...handle, db: recordFormUpdates(handle.db, writes) } });
  await app.login();
  const form = await createForm(app, { settings: { allowAutofill: true, closedMessage: "Stay closed" } });
  writes.length = 0;
  const saved = await readJson<{ form: FormDetail }>(await app.request(`/api/forms/${form.id}`, jsonBody({ title: "Autosaved" }, "PATCH")));
  expect(saved.form.title).toBe("Autosaved");
  expect(saved.form.settings.allowAutofill).toBe(true);
  expect(saved.form.settings.closedMessage).toBe("Stay closed");
  const titleWrites = writes.filter((values) => values.title === "Autosaved");
  expect(titleWrites).toHaveLength(1);
  expect(Object.hasOwn(titleWrites[0] ?? {}, "settings")).toBe(false);
  writes.length = 0;
  const themed = await readJson<{ form: FormDetail }>(await app.request(`/api/forms/${form.id}`, jsonBody({ settings: { theme: "dark" } }, "PATCH")));
  expect(themed.form.settings.theme).toBe("dark");
  expect(themed.form.settings.allowAutofill).toBe(true);
  expect(themed.form.settings.closedMessage).toBe("Stay closed");
  expect(writes.filter((values) => Object.hasOwn(values, "settings"))).toHaveLength(1);
});

it("keeps a closed form closed when publishing another version", async () => {
  // source: publishing a closed form keeps status closed, and a draft or published form becomes published
  app = await createTestApp();
  await app.login();
  const form = await publishForm(app);
  expect(form.status).toBe("published");
  const again = await readJson<{ form: FormDetail }>(await app.request(`/api/forms/${form.id}/publish`, { method: "POST" }));
  expect(again.form.status).toBe("published");
  expect(again.form.publishedVersion).toBe(2);
  expect((await readJson<{ form: FormDetail }>(await app.request(`/api/forms/${form.id}/close`, { method: "POST" }))).form.status).toBe("closed");
  const closed = await readJson<{ form: FormDetail; version: { version: number } }>(await app.request(`/api/forms/${form.id}/publish`, { method: "POST" }));
  expect(closed.form.status).toBe("closed");
  expect(closed.version.version).toBe(3);
  expect((await app.request(`/api/public/forms/${form.slug}`)).status).toBe(410);
});
