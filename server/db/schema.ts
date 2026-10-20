import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { FormSchema, FormSettings, Responses } from "../../shared/form-schema";

export interface SubmissionMeta {
  userAgent?: string;
  referrer?: string;
}

const timestamp3 = (name: string) =>
  timestamp(name, { withTimezone: true, precision: 3, mode: "date" });

export const forms = pgTable("forms", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("draft"),
  draftSchema: jsonb("draft_schema").$type<FormSchema>().notNull(),
  settings: jsonb("settings").$type<FormSettings>().notNull(),
  publishedVersionId: uuid("published_version_id"),
  createdAt: timestamp3("created_at").notNull().defaultNow(),
  updatedAt: timestamp3("updated_at").notNull().defaultNow(),
});

export const formVersions = pgTable(
  "form_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    schema: jsonb("schema").$type<FormSchema>().notNull(),
    publishedAt: timestamp3("published_at").notNull().defaultNow(),
  },
  (table) => [unique("form_versions_form_id_version_unique").on(table.formId, table.version)],
);

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(() => formVersions.id, { onDelete: "set null" }),
    responses: jsonb("responses").$type<Responses>().notNull(),
    meta: jsonb("meta").$type<SubmissionMeta>().notNull().default({}),
    createdAt: timestamp3("created_at").notNull().defaultNow(),
  },
  (table) => [index("submissions_form_id_created_at_idx").on(table.formId, table.createdAt)],
);

export const formEvents = pgTable(
  "form_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    type: text("type").notNull(),
    createdAt: timestamp3("created_at").notNull().defaultNow(),
  },
  (table) => [
    unique("form_events_form_id_session_id_type_unique").on(table.formId, table.sessionId, table.type),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    webhookId: text("webhook_id").notNull(),
    urlHost: text("url_host").notNull(),
    status: integer("status"),
    ok: boolean("ok").notNull(),
    error: text("error"),
    createdAt: timestamp3("created_at").notNull().defaultNow(),
  },
  (table) => [index("webhook_deliveries_form_id_created_at_idx").on(table.formId, table.createdAt)],
);

export type Form = typeof forms.$inferSelect;
export type FormInsert = typeof forms.$inferInsert;
export type FormVersion = typeof formVersions.$inferSelect;
export type FormVersionInsert = typeof formVersions.$inferInsert;
export type Submission = typeof submissions.$inferSelect;
export type SubmissionInsert = typeof submissions.$inferInsert;
export type FormEvent = typeof formEvents.$inferSelect;
export type FormEventInsert = typeof formEvents.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type WebhookDeliveryInsert = typeof webhookDeliveries.$inferInsert;
