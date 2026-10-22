import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  formSchemaZ,
  formSettingsZ,
  type FormSchema,
  type FormSettings,
} from "@shared/form-schema";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/session";
import { isRecord } from "@/lib/utils";

export type SaveState = "idle" | "saving" | "saved" | "error";

export type FormStatus = "draft" | "published" | "closed";

export interface FormDetail {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: FormStatus;
  publishedVersion: number | null;
  submissionCount: number;
  createdAt: string;
  updatedAt: string;
  draftSchema: FormSchema;
  settings: FormSettings;
  hasUnpublishedChanges: boolean;
}

export interface DraftFields {
  title: string;
  description: string;
  schema: FormSchema;
  settings: FormSettings;
}

interface PatchBody {
  title?: string;
  description?: string;
  draftSchema?: FormSchema;
  settings?: FormSettings;
}

const DEBOUNCE_MS = 800;

const draftFlushers = new Map<string, () => Promise<void>>();

export function flushFormDraft(formId: string): Promise<void> {
  const flush = draftFlushers.get(formId);
  if (!flush) return Promise.reject(new Error("Save the form before sending a test."));
  return flush();
}

function isStatus(value: unknown): value is FormStatus {
  return value === "draft" || value === "published" || value === "closed";
}

function readForm(form: Record<string, unknown>): FormDetail {
  const schema = formSchemaZ.safeParse(form.draftSchema);
  const settings = formSettingsZ.safeParse(form.settings);
  if (
    typeof form.id !== "string" ||
    typeof form.slug !== "string" ||
    typeof form.title !== "string" ||
    typeof form.description !== "string" ||
    !isStatus(form.status) ||
    !(form.publishedVersion === null || typeof form.publishedVersion === "number") ||
    typeof form.submissionCount !== "number" ||
    typeof form.createdAt !== "string" ||
    typeof form.updatedAt !== "string" ||
    typeof form.hasUnpublishedChanges !== "boolean" ||
    !schema.success ||
    !settings.success
  ) {
    throw new Error("The form was not readable.");
  }
  return {
    id: form.id,
    slug: form.slug,
    title: form.title,
    description: form.description,
    status: form.status,
    publishedVersion: form.publishedVersion,
    submissionCount: form.submissionCount,
    createdAt: form.createdAt,
    updatedAt: form.updatedAt,
    draftSchema: schema.data,
    settings: settings.data,
    hasUnpublishedChanges: form.hasUnpublishedChanges,
  };
}

export function parseFormDetail(value: unknown): FormDetail {
  if (!isRecord(value) || !isRecord(value.form)) throw new Error("The form was not readable.");
  return readForm(value.form);
}

export function parsePublishResult(value: unknown): { form: FormDetail; version: number } {
  if (!isRecord(value) || !isRecord(value.version) || typeof value.version.version !== "number") {
    throw new Error("The published form was not readable.");
  }
  return { form: parseFormDetail({ form: value.form }), version: value.version.version };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = stable(value[key]);
  return sorted;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

export function toDraft(form: FormDetail): DraftFields {
  return {
    title: form.title,
    description: form.description,
    schema: structuredClone(form.draftSchema),
    settings: structuredClone(form.settings),
  };
}

function sameDraft(left: DraftFields, right: DraftFields): boolean {
  return (
    left.title === right.title &&
    left.description === right.description &&
    sameJson(left.schema, right.schema) &&
    sameJson(left.settings, right.settings)
  );
}

function changedFields(draft: DraftFields, saved: DraftFields): PatchBody {
  const body: PatchBody = {};
  if (draft.title !== saved.title) body.title = draft.title;
  if (draft.description !== saved.description) body.description = draft.description;
  if (!sameJson(draft.schema, saved.schema)) body.draftSchema = draft.schema;
  if (!sameJson(draft.settings, saved.settings)) body.settings = draft.settings;
  return body;
}

function hasChanges(body: PatchBody): boolean {
  return body.title !== undefined || body.description !== undefined || body.draftSchema !== undefined || body.settings !== undefined;
}

function issueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "This form cannot be saved.";
}

export function invalidReason(draft: DraftFields): string | null {
  const schema = formSchemaZ.safeParse(draft.schema);
  if (!schema.success) return issueMessage(schema.error);
  const settings = formSettingsZ.safeParse(draft.settings);
  if (!settings.success) return issueMessage(settings.error);
  return null;
}

export function formQueryKey(formId: string): readonly ["form", string] {
  return ["form", formId];
}

export function useDraft(formId: string): {
  form: FormDetail | undefined;
  draft: DraftFields | undefined;
  update(patch: Partial<DraftFields>): void;
  saveState: SaveState;
  invalid: string | null;
  flush(): Promise<void>;
  retry(): void;
  adopt(next: FormDetail): void;
  status: "loading" | "error" | "ready";
  error: unknown;
  reload(): void;
} {
  const query = useQuery({
    queryKey: formQueryKey(formId),
    enabled: formId !== "",
    queryFn: async ({ signal }) => parseFormDetail(await api<unknown>(`/api/forms/${encodeURIComponent(formId)}`, { signal })),
  });
  const [draft, setDraft] = useState<DraftFields | undefined>(undefined);
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [invalid, setInvalid] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const draftRef = useRef<DraftFields | undefined>(undefined);
  const savedRef = useRef<DraftFields | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tail = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const persistRef = useRef<(throwOnInvalid: boolean) => Promise<void>>(async () => undefined);
  const enqueueRef = useRef<(throwOnInvalid: boolean) => Promise<void>>(async () => undefined);
  const flushRef = useRef<() => Promise<void>>(async () => undefined);

  if (seededFor !== null && seededFor !== formId) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    draftRef.current = undefined;
    savedRef.current = undefined;
    setSeededFor(null);
    setDraft(undefined);
    setDirty(false);
    setInvalid(null);
    setSaveState("idle");
  } else if (query.data && query.data.id === formId && seededFor !== formId) {
    const incoming = toDraft(query.data);
    draftRef.current = incoming;
    savedRef.current = toDraft(query.data);
    setSeededFor(formId);
    setDraft(incoming);
    setDirty(false);
    setInvalid(null);
    setSaveState("idle");
  }

  function remember(form: FormDetail) {
    queryClient.setQueryData(formQueryKey(form.id), form);
  }

  async function persistBody(throwOnInvalid: boolean): Promise<void> {
    const snapshot = draftRef.current;
    const baseline = savedRef.current;
    if (!snapshot || !baseline) return;
    const problem = invalidReason(snapshot);
    if (problem) {
      if (mounted.current) setInvalid(problem);
      if (throwOnInvalid) throw new Error(problem);
      return;
    }
    if (mounted.current) setInvalid(null);
    const body = changedFields(snapshot, baseline);
    if (!hasChanges(body)) {
      if (mounted.current) setDirty(false);
      return;
    }
    if (mounted.current) setSaveState("saving");
    try {
      const form = parseFormDetail(await api<unknown>(`/api/forms/${encodeURIComponent(formId)}`, { method: "PATCH", body }));
      const returned = toDraft(form);
      savedRef.current = returned;
      remember(form);
      const latest = draftRef.current;
      if (!mounted.current) return;
      if (latest && sameDraft(latest, snapshot)) {
        draftRef.current = returned;
        setDraft(returned);
        setDirty(false);
        setInvalid(null);
        setSaveState("saved");
        return;
      }
      setDirty(true);
      setSaveState("idle");
    } catch (error) {
      if (mounted.current) setSaveState("error");
      if (throwOnInvalid) throw error;
    }
  }

  function enqueue(throwOnInvalid: boolean): Promise<void> {
    const next = tail.current.then(() => persistRef.current(throwOnInvalid), () => persistRef.current(throwOnInvalid));
    tail.current = next.then(() => undefined, () => undefined);
    return next;
  }

  persistRef.current = persistBody;

  function schedule() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void enqueue(false);
    }, DEBOUNCE_MS);
  }

  function update(patch: Partial<DraftFields>) {
    const current = draftRef.current;
    if (!current) return;
    const next = { ...current, ...patch };
    draftRef.current = next;
    setDraft(next);
    setInvalid(invalidReason(next));
    setDirty(true);
    setSaveState("idle");
    schedule();
  }

  function flush(): Promise<void> {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    return enqueue(true);
  }

  enqueueRef.current = enqueue;
  flushRef.current = flush;

  function retry() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    void enqueue(false);
  }

  function adopt(next: FormDetail) {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const incoming = toDraft(next);
    draftRef.current = incoming;
    savedRef.current = toDraft(next);
    setDraft(incoming);
    setSeededFor(next.id);
    setDirty(false);
    setInvalid(null);
    setSaveState("idle");
    remember(next);
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const snapshot = draftRef.current;
      const baseline = savedRef.current;
      if (snapshot && baseline && !sameDraft(snapshot, baseline)) {
        void enqueueRef.current(false);
      }
    };
  }, []);

  useEffect(() => {
    const run = () => flushRef.current();
    draftFlushers.set(formId, run);
    return () => {
      if (draftFlushers.get(formId) === run) draftFlushers.delete(formId);
    };
  }, [formId]);

  useEffect(() => {
    if (!dirty && saveState !== "saving" && saveState !== "error") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, saveState]);

  const status = query.isError ? "error" : draft && query.data ? "ready" : "loading";

  return {
    form: query.data,
    draft,
    update,
    saveState,
    invalid,
    flush,
    retry,
    adopt,
    status,
    error: query.error,
    reload() {
      void query.refetch();
    },
  };
}
