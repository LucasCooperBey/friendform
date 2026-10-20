// source: server/db migrations, cascade deletes, unique violations, and timestamp precision

import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, emptySchema } from "../../shared/form-schema";
import { formEvents, formVersions, forms, submissions, webhookDeliveries } from "../../server/db/schema";
import { isUniqueViolation, type Db } from "../../server/db/index";
import { openTestDb } from "../helpers/test-db";

let db: Db;
let close: () => Promise<void>;

async function rowCount(table: typeof forms | typeof formVersions | typeof submissions | typeof formEvents | typeof webhookDeliveries): Promise<number> {
  const rows = await db.select({ value: count() }).from(table);
  const row = rows[0];
  if (!row) throw new Error("count returned no row");
  return row.value;
}

describe("database", () => {
  beforeAll(async () => {
    const handle = await openTestDb();
    db = handle.db;
    close = () => handle.close();
  });

  afterAll(async () => {
    await close();
  });

  it("creates all five tables", () => {
    // source: migrations create forms, form_versions, submissions, form_events, and webhook_deliveries
    return Promise.all([
      rowCount(forms),
      rowCount(formVersions),
      rowCount(submissions),
      rowCount(formEvents),
      rowCount(webhookDeliveries),
    ]).then((counts) => {
      for (const value of counts) {
        expect(typeof value).toBe("number");
      }
    });
  });

  it("removes versions, submissions, events, and deliveries when a form is deleted", async () => {
    // source: deleting a form cascades to versions, submissions, events, and deliveries
    const inserted = await db
      .insert(forms)
      .values({ slug: "cascade-form", title: "Cascade", draftSchema: emptySchema(), settings: DEFAULT_SETTINGS })
      .returning();
    const form = inserted[0];
    if (!form) throw new Error("form insert returned no row");
    const versions = await db
      .insert(formVersions)
      .values({ formId: form.id, version: 1, schema: emptySchema() })
      .returning();
    const version = versions[0];
    if (!version) throw new Error("version insert returned no row");
    await db.insert(submissions).values({ formId: form.id, versionId: version.id, responses: { name: "Ada" } });
    await db.insert(formEvents).values({ formId: form.id, sessionId: "session-1", type: "view" });
    await db.insert(webhookDeliveries).values({
      formId: form.id,
      webhookId: "hook-1",
      urlHost: "receiver.invalid",
      ok: true,
    });
    await db.delete(forms).where(eq(forms.id, form.id));
    const [versionRows, answerRows, eventRows, deliveryRows] = await Promise.all([
      db.select({ value: count() }).from(formVersions).where(eq(formVersions.formId, form.id)),
      db.select({ value: count() }).from(submissions).where(eq(submissions.formId, form.id)),
      db.select({ value: count() }).from(formEvents).where(eq(formEvents.formId, form.id)),
      db.select({ value: count() }).from(webhookDeliveries).where(eq(webhookDeliveries.formId, form.id)),
    ]);
    expect(versionRows[0]?.value).toBe(0);
    expect(answerRows[0]?.value).toBe(0);
    expect(eventRows[0]?.value).toBe(0);
    expect(deliveryRows[0]?.value).toBe(0);
  });

  it("rejects a duplicate event triple and reports a unique violation for a duplicate slug", async () => {
    // source: the event unique constraint and isUniqueViolation
    const inserted = await db
      .insert(forms)
      .values({ slug: "unique-form", title: "Unique", draftSchema: emptySchema(), settings: DEFAULT_SETTINGS })
      .returning();
    const form = inserted[0];
    if (!form) throw new Error("form insert returned no row");
    await db.insert(formEvents).values({ formId: form.id, sessionId: "session-1", type: "view" });
    await expect(
      db.insert(formEvents).values({ formId: form.id, sessionId: "session-1", type: "view" }),
    ).rejects.toSatisfy((err: unknown) => isUniqueViolation(err));
    await db.insert(formEvents).values({ formId: form.id, sessionId: "session-1", type: "start" });

    await expect(
      db.insert(forms).values({
        slug: "unique-form",
        title: "Again",
        draftSchema: emptySchema(),
        settings: DEFAULT_SETTINGS,
      }),
    ).rejects.toSatisfy((err: unknown) => isUniqueViolation(err));

    await expect(
      db.insert(formVersions).values({
        formId: "00000000-0000-0000-0000-000000000000",
        version: 1,
        schema: emptySchema(),
      }),
    ).rejects.toSatisfy((err: unknown) => isUniqueViolation(err) === false);
    expect(isUniqueViolation(new Error("other"))).toBe(false);
  });

  it("reads a timestamp back as the same JavaScript date", async () => {
    // source: timestamptz precision 3 round-trips through a JS Date
    const written = new Date("2026-04-05T06:07:08.678Z");
    await db.insert(forms).values({
      slug: "dated-form",
      title: "Dated",
      draftSchema: emptySchema(),
      settings: DEFAULT_SETTINGS,
      createdAt: written,
      updatedAt: written,
    });
    const rows = await db.select().from(forms).where(eq(forms.slug, "dated-form"));
    const row = rows[0];
    if (!row) throw new Error("dated form was not stored");
    expect(row.createdAt).toEqual(written);
    expect(row.updatedAt).toEqual(written);
  });
});
