import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  allQuestions, formSchemaZ, normalizeSchema,
  type FormSchema, type FormSettings, type QuestionType, type Responses, type ResponseValue,
} from "../shared/form-schema";
import { newSlug } from "../shared/slug";
import { isUniqueViolation, type Db } from "./db/index";
import { forms, formVersions, submissions, type Form, type FormInsert, type FormVersion } from "./db/schema";

export type FormStatus = "draft" | "published" | "closed";
export type FormSummary = {
  id: string; slug: string; title: string; description: string; status: FormStatus;
  publishedVersion: number | null; submissionCount: number; createdAt: string; updatedAt: string;
};
export type FormDetail = FormSummary & {
  draftSchema: FormSchema; settings: FormSettings; hasUnpublishedChanges: boolean;
};
export type VersionSummary = { id: string; version: number; publishedAt: string; questionCount: number };
export type SubmissionDto = { id: string; createdAt: string; version: number | null; responses: Responses };
export type ResponseColumn = { questionId: string; prompt: string; type: QuestionType | null };

export const uuidZ = z.uuid();

export async function findForm(db: Db, id: unknown): Promise<Form | undefined> {
  const parsed = uuidZ.safeParse(id);
  if (!parsed.success) return undefined;
  return (await db.select().from(forms).where(eq(forms.id, parsed.data)).limit(1))[0];
}

export async function publishedVersion(db: Db, form: Form): Promise<FormVersion | undefined> {
  if (!form.publishedVersionId) return undefined;
  return (await db.select().from(formVersions).where(and(
    eq(formVersions.id, form.publishedVersionId), eq(formVersions.formId, form.id),
  )).limit(1))[0];
}

export async function formSummary(db: Db, form: Form): Promise<FormSummary> {
  const version = await publishedVersion(db, form);
  const [total] = await db.select({ value: count() }).from(submissions).where(eq(submissions.formId, form.id));
  return {
    id: form.id, slug: form.slug, title: form.title, description: form.description, status: form.status,
    publishedVersion: version?.version ?? null, submissionCount: total?.value ?? 0,
    createdAt: form.createdAt.toISOString(), updatedAt: form.updatedAt.toISOString(),
  };
}

export async function formDetail(db: Db, form: Form): Promise<FormDetail> {
  const version = await publishedVersion(db, form);
  const canonical = (schema: FormSchema) => JSON.stringify(normalizeSchema(formSchemaZ.parse(schema)));
  return {
    ...await formSummary(db, form), draftSchema: form.draftSchema, settings: form.settings,
    hasUnpublishedChanges: !version || canonical(form.draftSchema) !== canonical(version.schema),
  };
}

export function versionSummary(version: FormVersion): VersionSummary {
  return {
    id: version.id, version: version.version, publishedAt: version.publishedAt.toISOString(),
    questionCount: allQuestions(version.schema).length,
  };
}

export async function insertForm(db: Db, values: Omit<FormInsert, "slug">): Promise<Form> {
  for (let attempt = 0; ; attempt++) {
    try {
      const [form] = await db.insert(forms).values({ ...values, slug: newSlug(values.title) }).returning();
      if (!form) throw new Error("Form insert returned no row");
      return form;
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= 5) throw error;
    }
  }
}

// Both the inbox and CSV use this ordering and the newest published prompt for each id.
export async function responseColumns(db: Db, form: Form, includeStoredOnly = false): Promise<ResponseColumn[]> {
  const versions = await db.select().from(formVersions).where(eq(formVersions.formId, form.id))
    .orderBy(desc(formVersions.version));
  const current = versions.find((version) => version.id === form.publishedVersionId);
  const schemas = [current?.schema ?? form.draftSchema, ...versions.map((version) => version.schema)];
  const newest = new Map<string, ResponseColumn>();
  for (const schema of schemas) {
    for (const question of allQuestions(schema)) {
      if (!newest.has(question.questionId)) {
        newest.set(question.questionId, { questionId: question.questionId, prompt: question.prompt, type: question.type });
      }
    }
  }
  if (includeStoredOnly) {
    const rows = await db.select({ responses: submissions.responses }).from(submissions)
      .where(eq(submissions.formId, form.id)).orderBy(desc(submissions.createdAt), desc(submissions.id));
    for (const row of rows) {
      for (const id of Object.keys(row.responses).sort()) {
        if (!newest.has(id)) newest.set(id, { questionId: id, prompt: id, type: null });
      }
    }
  }
  return [...newest.values()];
}

export function answerText(value: ResponseValue | undefined): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "string") return value;
  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  const [coefficient = "", exponent = "0"] = text.split(/[eE]/);
  const sign = coefficient.startsWith("-") ? "-" : "";
  const absolute = coefficient.replace(/^-/, "");
  const digits = absolute.replace(".", "");
  const point = (absolute.includes(".") ? absolute.indexOf(".") : absolute.length) + Number(exponent);
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return sign + digits + "0".repeat(point - digits.length);
  return sign + digits.slice(0, point) + "." + digits.slice(point);
}
