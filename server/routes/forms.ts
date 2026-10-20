import { randomUUID } from "node:crypto";
import { and, count, desc, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  allQuestions, DEFAULT_SETTINGS, emptySchema, formSchemaZ, formSettingsZ, normalizeSchema, publishProblems,
  type Responses,
} from "../../shared/form-schema";
import { SLUG_RE } from "../../shared/slug";
import type { AppDeps } from "../app";
import { requireOwner } from "../auth";
import { isUniqueViolation } from "../db/index";
import { forms, formVersions, formEvents, submissions, webhookDeliveries } from "../db/schema";
import { findForm, formDetail, formSummary, insertForm, uuidZ, versionSummary } from "../forms-service";
import { emptyBody, emptyQuery, issuesOnly } from "../security";
import { deliverWebhook, recordDelivery } from "../webhooks";

const createZ = z.object({
  title: z.string().min(1).max(200).default("Untitled form"),
  description: z.string().max(2000).default(""),
  draftSchema: formSchemaZ.optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});
const patchZ = z.object({
  title: z.string().max(200).optional(), description: z.string().max(2000).optional(),
  slug: z.string().optional(), draftSchema: formSchemaZ.optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export function formsRouter(deps: AppDeps): Router {
  const router = Router();
  const db = deps.db.db;
  const now = deps.now ?? (() => new Date());
  router.use(requireOwner(deps), emptyQuery);

  async function load(req: Request, res: Response) {
    const form = await findForm(db, req.params.id);
    if (!form) res.status(404).json({ error: "not_found" });
    return form;
  }
  function invalid(res: Response, error: z.ZodError, prefix?: string) {
    res.status(400).json({ error: "invalid_body", issues: issuesOnly(error).map((issue) => ({
      ...issue, path: prefix ? [prefix, ...issue.path] : issue.path,
    })) });
  }

  router.get("/", async (_req, res) => {
    const rows = await db.select().from(forms).orderBy(desc(forms.updatedAt), desc(forms.id));
    res.json({ forms: await Promise.all(rows.map((form) => formSummary(db, form))) });
  });
  router.post("/", async (req, res) => {
    const body = createZ.safeParse(req.body);
    if (!body.success) { invalid(res, body.error); return; }
    const settings = formSettingsZ.safeParse({ ...DEFAULT_SETTINGS, ...body.data.settings });
    if (!settings.success) { invalid(res, settings.error, "settings"); return; }
    const form = await insertForm(db, {
      title: body.data.title, description: body.data.description,
      draftSchema: body.data.draftSchema ?? emptySchema(), settings: settings.data,
      createdAt: now(), updatedAt: now(),
    });
    res.status(201).json({ form: await formDetail(db, form) });
  });
  router.get("/:id", async (req, res) => {
    const form = await load(req, res);
    if (form) res.json({ form: await formDetail(db, form) });
  });
  router.patch("/:id", async (req, res) => {
    const current = await load(req, res);
    if (!current) return;
    const body = patchZ.safeParse(req.body);
    if (!body.success) { invalid(res, body.error); return; }
    if (body.data.slug !== undefined && !SLUG_RE.test(body.data.slug)) {
      res.status(400).json({ error: "invalid_slug" }); return;
    }
    const settings = formSettingsZ.safeParse({ ...current.settings, ...body.data.settings });
    if (!settings.success) { invalid(res, settings.error, "settings"); return; }
    try {
      const [updated] = await db.update(forms).set({ ...body.data, settings: settings.data, updatedAt: now() })
        .where(eq(forms.id, current.id)).returning();
      if (!updated) { res.status(404).json({ error: "not_found" }); return; }
      res.json({ form: await formDetail(db, updated) });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      res.status(409).json({ error: "slug_taken" });
    }
  });
  router.delete("/:id", emptyBody, async (req, res) => {
    const form = await load(req, res);
    if (!form) return;
    await db.delete(forms).where(eq(forms.id, form.id));
    res.status(204).end();
  });
  router.post("/:id/duplicate", emptyBody, async (req, res) => {
    const source = await load(req, res);
    if (!source) return;
    const form = await insertForm(db, {
      title: `Copy of ${source.title}`.slice(0, 200), description: source.description,
      draftSchema: source.draftSchema, settings: { ...source.settings, webhooks: [] },
      createdAt: now(), updatedAt: now(),
    });
    res.status(201).json({ form: await formDetail(db, form) });
  });
  router.post("/:id/publish", emptyBody, async (req, res) => {
    const id = uuidZ.safeParse(req.params.id);
    if (!id.success) { res.status(404).json({ error: "not_found" }); return; }
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(forms).where(eq(forms.id, id.data)).for("update");
      if (!current) return undefined;
      const draft = formSchemaZ.parse(current.draftSchema);
      const problems = publishProblems(draft);
      if (!current.title.trim()) problems.push("Give the form a title.");
      if (problems.length) return { problems };
      const [latest] = await tx.select({ version: formVersions.version }).from(formVersions)
        .where(eq(formVersions.formId, current.id)).orderBy(desc(formVersions.version)).limit(1);
      const [version] = await tx.insert(formVersions).values({
        formId: current.id, version: (latest?.version ?? 0) + 1, schema: normalizeSchema(draft), publishedAt: now(),
      }).returning();
      if (!version) throw new Error("Version insert returned no row");
      const [form] = await tx.update(forms).set({ publishedVersionId: version.id, status: "published", updatedAt: now() })
        .where(eq(forms.id, current.id)).returning();
      if (!form) throw new Error("Published form update returned no row");
      return { form, version };
    });
    if (!result) { res.status(404).json({ error: "not_found" }); return; }
    if (result.problems) { res.status(422).json({ error: "not_publishable", problems: result.problems }); return; }
    res.json({ form: await formDetail(db, result.form), version: versionSummary(result.version) });
  });
  for (const action of ["close", "reopen"] as const) {
    router.post(`/:id/${action}`, emptyBody, async (req, res) => {
      const current = await load(req, res);
      if (!current) return;
      if (!current.publishedVersionId) { res.status(409).json({ error: "not_published" }); return; }
      const [form] = await db.update(forms).set({ status: action === "close" ? "closed" : "published", updatedAt: now() })
        .where(eq(forms.id, current.id)).returning();
      if (!form) { res.status(404).json({ error: "not_found" }); return; }
      res.json({ form: await formDetail(db, form) });
    });
  }
  router.get("/:id/versions", async (req, res) => {
    const form = await load(req, res);
    if (!form) return;
    const rows = await db.select().from(formVersions).where(eq(formVersions.formId, form.id))
      .orderBy(desc(formVersions.version));
    res.json({ versions: rows.map(versionSummary) });
  });
  router.post("/:id/versions/:versionId/restore", emptyBody, async (req, res) => {
    const current = await load(req, res);
    if (!current) return;
    const id = uuidZ.safeParse(req.params.versionId);
    if (!id.success) { res.status(404).json({ error: "not_found" }); return; }
    const [version] = await db.select().from(formVersions)
      .where(and(eq(formVersions.id, id.data), eq(formVersions.formId, current.id)));
    if (!version) { res.status(404).json({ error: "not_found" }); return; }
    const [form] = await db.update(forms).set({ draftSchema: version.schema, updatedAt: now() })
      .where(eq(forms.id, current.id)).returning();
    if (!form) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ form: await formDetail(db, form) });
  });
  router.get("/:id/stats", async (req, res) => {
    const form = await load(req, res);
    if (!form) return;
    const events = await db.select({ type: formEvents.type, total: count() }).from(formEvents)
      .where(eq(formEvents.formId, form.id)).groupBy(formEvents.type);
    const [total] = await db.select({ value: count() }).from(submissions).where(eq(submissions.formId, form.id));
    const views = events.find((row) => row.type === "view")?.total ?? 0;
    const starts = events.find((row) => row.type === "start")?.total ?? 0;
    const submitted = total?.value ?? 0;
    res.json({ views, starts, submissions: submitted, completionRate: views === 0 ? null : Math.round(submitted / views * 1000) / 1000 });
  });
  router.post("/:id/webhooks/:webhookId/test", emptyBody, async (req, res) => {
    const form = await load(req, res);
    if (!form) return;
    const hook = form.settings.webhooks.find((entry) => entry.id === req.params.webhookId);
    if (!hook) { res.status(404).json({ error: "not_found" }); return; }
    const responses: Responses = {};
    for (const question of allQuestions(form.draftSchema)) {
      const option = question.metadata?.options?.[0] ?? "Sample answer";
      responses[question.questionId] = question.type === "checkbox" ? [option] :
        question.type === "radio" || question.type === "dropdown" ? option :
        question.type === "rating" ? 3 : question.type === "number" ? 42 :
        question.type === "date" ? "2026-01-01" : "Sample answer";
    }
    const result = await deliverWebhook(hook, {
      form: { slug: form.slug, title: form.title },
      submission: { id: randomUUID(), createdAt: now().toISOString(), version: null },
      schema: form.draftSchema, responses,
      responsesUrl: deps.config.publicUrl ? `${deps.config.publicUrl}/forms/${form.id}/responses` : null,
    }, { secret: deps.config.webhookSecret, fetchImpl: deps.fetchImpl ?? globalThis.fetch });
    await recordDelivery(deps.db, form.id, hook, result);
    res.json(result);
  });
  router.get("/:id/webhooks/deliveries", async (req, res) => {
    const form = await load(req, res);
    if (!form) return;
    const rows = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.formId, form.id))
      .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id)).limit(20);
    res.json({ deliveries: rows.map((row) => ({
      id: row.id, webhookId: row.webhookId, urlHost: row.urlHost, status: row.status, ok: row.ok,
      error: row.error, createdAt: row.createdAt.toISOString(),
    })) });
  });
  return router;
}
