import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { rateLimit } from "express-rate-limit";
import express, { Router, type Request, type Response } from "express";
import { z } from "zod";
import { formSettingsZ } from "../../shared/form-schema";
import { validateResponses } from "../../shared/validate";
import { DEFAULT_LIMITS, type AppDeps } from "../app";
import { forms, formEvents, submissions, type SubmissionMeta } from "../db/schema";
import { publishedVersion } from "../forms-service";
import { log } from "../log";
import { autofillHandlers } from "./ai";
import { emptyQuery, limiter } from "../security";
import { deliverWebhook, recordDelivery } from "../webhooks";

const sessionZ = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const submissionZ = z.object({
  responses: z.unknown(), website: z.string().optional(), sessionId: z.string().optional(), referrer: z.string().optional(),
});
const eventZ = z.object({ type: z.enum(["view", "start"]), sessionId: sessionZ });

export function publicRouter(deps: AppDeps): Router {
  const router = Router();
  const db = deps.db.db;
  const now = deps.now ?? (() => new Date());
  const limits = { ...DEFAULT_LIMITS, ...deps.limits };
  const aiOn = Boolean(deps.config.ai.apiKey && deps.config.ai.model);
  const autofillPerDay = rateLimit({
    limit: limits.autofillPerDayPerForm,
    windowMs: 24 * 60 * 60 * 1000,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "too_many_requests" },
    keyGenerator: (req) => {
      const slug = req.params.slug;
      return typeof slug === "string" ? slug : "";
    },
  });
  router.use(emptyQuery);
  async function load(req: Request, res: Response, event = false) {
    const slug = z.string().safeParse(req.params.slug);
    const form = slug.success ? (await db.select().from(forms).where(eq(forms.slug, slug.data)).limit(1))[0] : undefined;
    const version = form ? await publishedVersion(db, form) : undefined;
    if (!form || !version || (event && form.status === "closed")) {
      res.status(404).json({ error: "not_found" }); return undefined;
    }
    if (form.status === "closed") {
      res.status(410).json({ error: "closed", title: form.title, closedMessage: form.settings.closedMessage });
      return undefined;
    }
    return { form, version };
  }
  router.get("/:slug", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); },
    limiter(limits.publicReadsPerMinute, 60_000), async (req, res) => {
      const loaded = await load(req, res);
      if (!loaded) return;
      const { form, version } = loaded;
      const settings = formSettingsZ.parse(form.settings);
      res.json({
        slug: form.slug, title: form.title || "Untitled form", description: form.description,
        version: version.version, schema: version.schema,
        settings: {
          theme: settings.theme, showProgress: settings.showProgress,
          thankYou: settings.thankYou, allowAutofill: settings.allowAutofill && aiOn,
        },
      });
    });
  const { prepare, answer } = autofillHandlers(deps);
  router.post(
    "/:slug/autofill",
    limiter(limits.autofillPer15MinPerForm, 15 * 60_000, true),
    limiter(limits.autofillPerDayPerIp, 24 * 60 * 60 * 1000),
    express.json({ limit: "7mb" }),
    prepare,
    autofillPerDay,
    answer,
  );
  router.post("/:slug/submissions", limiter(limits.submitPer15MinPerForm, 15 * 60_000, true), async (req, res) => {
    const body = submissionZ.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: "invalid_body" }); return; }
    if (body.data.website) {
      const slug = req.params.slug;
      log.warn("submission_honeypot", { slug: typeof slug === "string" ? slug : "" });
      res.status(201).json({ id: randomUUID() });
      return;
    }
    const loaded = await load(req, res);
    if (!loaded) return;
    const { form, version } = loaded;
    const validated = validateResponses(version.schema, body.data.responses);
    if (!validated.ok) { res.status(400).json({ error: "invalid_responses", errors: validated.errors }); return; }
    const meta: SubmissionMeta = {};
    const userAgent = req.get("user-agent");
    if (userAgent !== undefined) meta.userAgent = userAgent.slice(0, 300);
    if (body.data.referrer) {
      try {
        const url = new URL(body.data.referrer);
        if (url.protocol === "http:" || url.protocol === "https:") meta.referrer = url.origin;
      } catch { /* Invalid referrers are omitted. */ }
    }
    const submission = await db.transaction(async (tx) => {
      const [row] = await tx.insert(submissions).values({
        formId: form.id, versionId: version.id, responses: validated.responses, meta, createdAt: now(),
      }).returning();
      if (!row) throw new Error("Submission insert returned no row");
      const session = sessionZ.safeParse(body.data.sessionId);
      if (session.success) await tx.insert(formEvents).values({
        formId: form.id, sessionId: session.data, type: "submit", createdAt: now(),
      }).onConflictDoNothing();
      return row;
    });
    res.status(201).json({ id: submission.id });
    for (const hook of form.settings.webhooks.filter((entry) => entry.enabled)) {
      const task = (async () => {
        const result = await deliverWebhook(hook, {
          form: { slug: form.slug, title: form.title },
          submission: { id: submission.id, createdAt: submission.createdAt.toISOString(), version: version.version },
          schema: version.schema, responses: validated.responses,
          responsesUrl: deps.config.publicUrl ? `${deps.config.publicUrl}/forms/${form.id}/responses` : null,
        }, { secret: deps.config.webhookSecret, fetchImpl: deps.fetchImpl ?? globalThis.fetch });
        await recordDelivery(deps.db, form.id, hook, result);
      })().catch(() => { log.error("webhook_delivery_record_failed", { formId: form.id, webhookId: hook.id }); });
      deps.onBackgroundTask?.(task);
    }
  });
  router.post("/:slug/events", limiter(limits.eventsPerMinute, 60_000), async (req, res) => {
    const body = eventZ.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: "invalid_body" }); return; }
    const loaded = await load(req, res, true);
    if (!loaded) return;
    await db.insert(formEvents).values({ formId: loaded.form.id, ...body.data, createdAt: now() }).onConflictDoNothing();
    res.status(204).end();
  });
  return router;
}
