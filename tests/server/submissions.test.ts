import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";
import type { DbHandle } from "../../server/db/index";
import { submissions } from "../../server/db/schema";
import type { ResponseColumn, SubmissionDto } from "../../server/forms-service";
import { openTestDb } from "../helpers/test-db";
import { createTestApp, jsonBody, publishForm, readJson, schemaOf, type TestApp } from "./helpers";

let app: TestApp | undefined;
let handle: DbHandle | undefined;
afterEach(async () => { await app?.close(); app = undefined; handle = undefined; });

interface Page { submissions: SubmissionDto[]; nextBefore: string | null; columns: ResponseColumn[] }

it("pages rows that share one created_at exactly once and rejects a bad cursor", async () => {
  // source: the before cursor is createdAt plus id, so equal timestamps are not skipped or repeated.
  const now = new Date("2026-04-01T12:00:00.000Z");
  app = await createTestApp({ now: () => now });
  await app.login();
  const form = await publishForm(app);
  const submit = `/api/public/forms/${form.slug}/submissions`;
  for (let index = 0; index < 5; index += 1) {
    expect((await app.request(submit, jsonBody({ responses: { name: `row-${index}` } }))).status).toBe(201);
  }
  const full = await readJson<Page>(await app.request(`/api/forms/${form.id}/submissions?limit=10`));
  expect(full.submissions).toHaveLength(5);
  expect(full.nextBefore).toBeNull();
  expect(new Set(full.submissions.map((row) => row.createdAt)).size).toBe(1);

  const seen: string[] = [];
  let before: string | null = null;
  for (let guard = 0; guard < 6; guard += 1) {
    const path: string = `/api/forms/${form.id}/submissions?limit=2${before ? `&before=${encodeURIComponent(before)}` : ""}`;
    const page: Page = await readJson<Page>(await app.request(path));
    seen.push(...page.submissions.map((row) => row.id));
    if (page.submissions.length === 2) {
      const last = page.submissions[1];
      expect(page.nextBefore).toBe(`${last?.createdAt}_${last?.id}`);
      before = page.nextBefore;
    } else {
      expect(page.nextBefore).toBeNull();
      break;
    }
  }
  expect(seen).toEqual(full.submissions.map((row) => row.id));
  expect(new Set(seen).size).toBe(5);

  expect(await readJson(await app.request(`/api/forms/${form.id}/submissions?before=nope`), 400)).toEqual({ error: "invalid_cursor" });
  expect(await readJson(await app.request(
    `/api/forms/${form.id}/submissions?before=${encodeURIComponent(`2026-01-01T00:00:00Z_${randomUUID()}`)}`,
  ), 400)).toEqual({ error: "invalid_cursor" });
  const badLimit = await readJson<{ error: string; issues: Array<{ path: PropertyKey[]; message: string }> }>(
    await app.request(`/api/forms/${form.id}/submissions?limit=0`), 400,
  );
  expect(badLimit.error).toBe("invalid_body");
  expect(badLimit.issues[0]?.path).toBeInstanceOf(Array);
  expect(typeof badLimit.issues[0]?.message).toBe("string");

  const target = full.submissions[0];
  expect(target).toBeDefined();
  expect(await readJson(await app.request(`/api/forms/${form.id}/submissions/${target?.id}`))).toEqual({ submission: target });
  expect((await app.request(`/api/forms/${form.id}/submissions/${target?.id}`, { method: "DELETE" })).status).toBe(204);
  expect(await readJson(await app.request(`/api/forms/${form.id}/submissions/${target?.id}`), 404)).toEqual({ error: "not_found" });
  expect((await readJson<Page>(await app.request(`/api/forms/${form.id}/submissions`))).submissions).toHaveLength(4);
});

it("matches submission columns to the CSV header and omits keys that exist only in stored answers", async () => {
  // source: list columns follow published then older questions, while CSV also appends response-only ids.
  handle = await openTestDb();
  app = await createTestApp({ db: handle });
  await app.login();
  const form = await publishForm(app, {
    draftSchema: schemaOf([
      { questionId: "name", type: "text", prompt: "Your name", required: true },
      { questionId: "legacy", type: "text", prompt: "Legacy note", required: false },
    ]),
  });
  expect((await app.request(`/api/public/forms/${form.slug}/submissions`, jsonBody({
    responses: { name: "Ada", legacy: "old" },
  }))).status).toBe(201);
  expect((await app.request(`/api/forms/${form.id}`, jsonBody({
    draftSchema: schemaOf([{ questionId: "name", type: "text", prompt: "Full name", required: true }]),
  }, "PATCH"))).status).toBe(200);
  expect((await app.request(`/api/forms/${form.id}/publish`, { method: "POST" })).status).toBe(200);
  const second = await readJson<{ id: string }>(await app.request(`/api/public/forms/${form.slug}/submissions`, jsonBody({
    responses: { name: "Bea" },
  })), 201);
  await handle.db.update(submissions).set({ responses: { name: "Bea", orphan: "kept" } }).where(eq(submissions.id, second.id));

  const page = await readJson<Page>(await app.request(`/api/forms/${form.id}/submissions`));
  expect(page.columns).toEqual([
    { questionId: "name", prompt: "Full name", type: "text" },
    { questionId: "legacy", prompt: "Legacy note", type: "text" },
  ]);
  const csv = await app.request(`/api/forms/${form.id}/export.csv`);
  const header = (await csv.text()).replace(/^\uFEFF/, "").split("\r\n")[0];
  expect(header?.split(",")).toEqual(["Submitted at", "Version", "Full name", "Legacy note", "orphan"]);
});
