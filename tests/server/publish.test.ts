import { afterEach, expect, it } from "vitest";
import { normalizeSchema, type FormSchema } from "../../shared/form-schema";
import type { FormDetail, VersionSummary } from "../../server/forms-service";
import { createForm, createTestApp, jsonBody, publishForm, readJson, schemaOf, type TestApp } from "./helpers";

let app: TestApp | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

const spacedDraft: FormSchema = {
  sections: [{
    title: "  About you  ",
    questions: [
      { questionId: "name", type: "text", prompt: "  Your name  ", required: true },
      { questionId: "color", type: "radio", prompt: " Color ", required: true, metadata: { options: ["  red  ", "blue"] } },
    ],
  }],
};

it("blocks publish for an empty title and an empty option, and writes no version", async () => {
  // source: publish returns not_publishable for a title that trims to empty and for an empty choice option.
  app = await createTestApp();
  await app.login();
  const blankTitle = await createForm(app);
  expect((await app.request(`/api/forms/${blankTitle.id}`, jsonBody({ title: "   " }, "PATCH"))).status).toBe(200);
  expect(await readJson(await app.request(`/api/forms/${blankTitle.id}/publish`, { method: "POST" }), 422)).toEqual({
    error: "not_publishable", problems: ["Give the form a title."],
  });
  expect(await readJson(await app.request(`/api/forms/${blankTitle.id}/versions`))).toEqual({ versions: [] });
  expect((await readJson<{ form: FormDetail }>(await app.request(`/api/forms/${blankTitle.id}`))).form.status).toBe("draft");

  const emptyOption = await createForm(app, {
    title: "Colors",
    draftSchema: schemaOf([{
      questionId: "color", type: "radio", prompt: "Color", required: true, metadata: { options: ["red", " "] },
    }]),
  });
  expect(await readJson(await app.request(`/api/forms/${emptyOption.id}/publish`, { method: "POST" }), 422)).toEqual({
    error: "not_publishable", problems: ['Question 1 in section 1 ("Color") has an empty option.'],
  });
  expect((await readJson<{ form: FormDetail }>(await app.request(`/api/forms/${emptyOption.id}`))).form.publishedVersion).toBeNull();
});

it("publishes a normalized schema, then version 2, and restore does not cross forms", async () => {
  // source: publish stores normalizeSchema output, versions are newest first, restore copies that form's schema only.
  app = await createTestApp({ config: (await import("./helpers")).testConfig({ publicUrl: "https://forms.example" }) });
  await app.login();
  const created = await createForm(app, { title: "Feedback", draftSchema: spacedDraft });
  const first = await readJson<{ form: FormDetail; version: VersionSummary }>(
    await app.request(`/api/forms/${created.id}/publish`, { method: "POST" }),
  );
  const normalized = normalizeSchema(spacedDraft);
  expect(first.version.version).toBe(1);
  expect(first.version.questionCount).toBe(2);
  expect(first.version.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(first.form).toMatchObject({ status: "published", publishedVersion: 1, hasUnpublishedChanges: false });
  expect(first.form.draftSchema).toEqual(spacedDraft);
  const publicForm = await readJson<{ schema: FormSchema }>(await app.request(`/api/public/forms/${created.slug}`));
  expect(publicForm.schema).toEqual(normalized);

  const replacement = schemaOf([{ questionId: "city", type: "text", prompt: "City", required: true }]);
  expect((await app.request(`/api/forms/${created.id}`, jsonBody({ draftSchema: replacement }, "PATCH"))).status).toBe(200);
  expect((await readJson<{ form: FormDetail }>(await app.request(`/api/forms/${created.id}`))).form.hasUnpublishedChanges).toBe(true);
  const second = await readJson<{ form: FormDetail; version: VersionSummary }>(
    await app.request(`/api/forms/${created.id}/publish`, { method: "POST" }),
  );
  expect(second.version).toMatchObject({ version: 2, questionCount: 1 });
  expect(second.form).toMatchObject({ publishedVersion: 2, hasUnpublishedChanges: false, draftSchema: replacement });
  const listed = await readJson<{ versions: VersionSummary[] }>(await app.request(`/api/forms/${created.id}/versions`));
  expect(listed.versions.map((version) => version.version)).toEqual([2, 1]);

  const versionOne = listed.versions.find((version) => version.version === 1);
  const restored = await readJson<{ form: FormDetail }>(
    await app.request(`/api/forms/${created.id}/versions/${versionOne?.id}/restore`, { method: "POST" }),
  );
  expect(restored.form.draftSchema).toEqual(normalized);
  expect(restored.form.hasUnpublishedChanges).toBe(true);
  expect((await readJson<{ schema: FormSchema }>(await app.request(`/api/public/forms/${created.slug}`))).schema).toEqual(replacement);

  const other = await publishForm(app, { title: "Other form" });
  expect(await readJson(
    await app.request(`/api/forms/${other.id}/versions/${versionOne?.id}/restore`, { method: "POST" }), 404,
  )).toEqual({ error: "not_found" });
  expect((await readJson<{ form: FormDetail }>(await app.request(`/api/forms/${other.id}`))).form.draftSchema).toEqual(other.draftSchema);
});

it("closes and reopens only a form that has a published version", async () => {
  // source: close and reopen return 409 not_published until a version exists, then they set status.
  app = await createTestApp();
  await app.login();
  const draft = await createForm(app);
  expect(await readJson(await app.request(`/api/forms/${draft.id}/close`, { method: "POST" }), 409)).toEqual({ error: "not_published" });
  expect(await readJson(await app.request(`/api/forms/${draft.id}/reopen`, { method: "POST" }), 409)).toEqual({ error: "not_published" });
  expect((await readJson<{ form: FormDetail }>(await app.request(`/api/forms/${draft.id}`))).form.status).toBe("draft");

  const live = await publishForm(app, { title: "Open form" });
  const closed = await readJson<{ form: FormDetail }>(await app.request(`/api/forms/${live.id}/close`, { method: "POST" }));
  expect(closed.form).toMatchObject({ status: "closed", publishedVersion: 1 });
  const reopened = await readJson<{ form: FormDetail }>(await app.request(`/api/forms/${live.id}/reopen`, { method: "POST" }));
  expect(reopened.form.status).toBe("published");
});
