import { and, desc, eq, lt, or } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { AppDeps } from "../app";
import { requireOwner } from "../auth";
import { toCsv } from "../csv";
import { formVersions, submissions } from "../db/schema";
import { answerText, findForm, responseColumns, uuidZ, type SubmissionDto } from "../forms-service";
import { emptyBody, emptyQuery, issuesOnly } from "../security";

const pageZ = z.object({
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(200)).optional().default(50),
  before: z.string().optional(),
});
const cursorZ = z.string().transform((value, ctx) => {
  const split = value.lastIndexOf("_");
  const createdAt = value.slice(0, split);
  const id = value.slice(split + 1);
  const timestamp = z.iso.datetime({ precision: 3 }).safeParse(createdAt);
  if (split < 0 || !timestamp.success || !uuidZ.safeParse(id).success || !Number.isFinite(Date.parse(createdAt))) {
    ctx.addIssue({ code: "custom", message: "Invalid cursor" });
    return z.NEVER;
  }
  return { createdAt: new Date(createdAt), id };
});

export function submissionsRouter(deps: AppDeps): Router {
  const router = Router();
  const db = deps.db.db;
  router.use(requireOwner(deps), emptyQuery);
  async function load(req: Request, res: Response) {
    const form = await findForm(db, req.params.id);
    if (!form) res.status(404).json({ error: "not_found" });
    return form;
  }
  const selection = {
    id: submissions.id, createdAt: submissions.createdAt, version: formVersions.version, responses: submissions.responses,
  };
  const dto = (row: {
    id: string; createdAt: Date; version: number | null; responses: SubmissionDto["responses"];
  }): SubmissionDto => ({ ...row, createdAt: row.createdAt.toISOString() });

  router.get("/:id/submissions", async (req, res) => {
    const form = await load(req, res);
    if (!form) return;
    if (req.query.before !== undefined && !cursorZ.safeParse(req.query.before).success) {
      res.status(400).json({ error: "invalid_cursor" }); return;
    }
    const page = pageZ.safeParse(req.query);
    if (!page.success) { res.status(400).json({ error: "invalid_body", issues: issuesOnly(page.error) }); return; }
    const cursor = page.data.before === undefined ? undefined : cursorZ.parse(page.data.before);
    const rows = await db.select(selection).from(submissions)
      .leftJoin(formVersions, eq(submissions.versionId, formVersions.id))
      .where(and(eq(submissions.formId, form.id), cursor ? or(
        lt(submissions.createdAt, cursor.createdAt),
        and(eq(submissions.createdAt, cursor.createdAt), lt(submissions.id, cursor.id)),
      ) : undefined))
      .orderBy(desc(submissions.createdAt), desc(submissions.id)).limit(page.data.limit);
    const last = rows.at(-1);
    res.json({
      submissions: rows.map(dto),
      nextBefore: rows.length === page.data.limit && last ? `${last.createdAt.toISOString()}_${last.id}` : null,
      columns: await responseColumns(db, form),
    });
  });
  router.get("/:id/submissions/:submissionId", async (req, res) => {
    const form = await load(req, res);
    if (!form) return;
    const id = uuidZ.safeParse(req.params.submissionId);
    if (!id.success) { res.status(404).json({ error: "not_found" }); return; }
    const [row] = await db.select(selection).from(submissions)
      .leftJoin(formVersions, eq(submissions.versionId, formVersions.id))
      .where(and(eq(submissions.formId, form.id), eq(submissions.id, id.data)));
    if (!row) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ submission: dto(row) });
  });
  router.delete("/:id/submissions/:submissionId", emptyBody, async (req, res) => {
    const form = await load(req, res);
    if (!form) return;
    const id = uuidZ.safeParse(req.params.submissionId);
    if (!id.success) { res.status(404).json({ error: "not_found" }); return; }
    const deleted = await db.delete(submissions).where(and(eq(submissions.formId, form.id), eq(submissions.id, id.data)))
      .returning({ id: submissions.id });
    if (!deleted.length) { res.status(404).json({ error: "not_found" }); return; }
    res.status(204).end();
  });
  router.get("/:id/export.csv", async (req, res) => {
    const form = await load(req, res);
    if (!form) return;
    const columns = await responseColumns(db, form, true);
    const rows = await db.select(selection).from(submissions)
      .leftJoin(formVersions, eq(submissions.versionId, formVersions.id))
      .where(eq(submissions.formId, form.id)).orderBy(desc(submissions.createdAt), desc(submissions.id));
    const csv = toCsv([
      ["Submitted at", "Version", ...columns.map((column) => column.prompt)],
      ...rows.map((row) => [row.createdAt.toISOString(), row.version === null ? "" : String(row.version),
        ...columns.map((column) => answerText(Object.hasOwn(row.responses, column.questionId) ? row.responses[column.questionId] : undefined)),
      ]),
    ]);
    res.set("Content-Type", "text/csv; charset=utf-8")
      .set("Content-Disposition", `attachment; filename="${form.slug}-responses.csv"`).send(csv);
  });
  return router;
}
