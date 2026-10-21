import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import type { QuestionType, ResponseValue } from "@shared/form-schema";
import { api, errorMessage } from "@/lib/api";
import { shareUrl } from "@/lib/format";
import { queryClient, useSession } from "@/lib/session";
import { isRecord } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { formQueryKey, parseFormDetail, type FormDetail, type FormStatus } from "@/components/editor/useDraft";
import { isQuestionType } from "@/components/editor/question-types";
import { ResponseDetail } from "@/components/responses/ResponseDetail";
import { ResponsesTable, type ResponseColumn, type SubmissionRow } from "@/components/responses/ResponsesTable";
import { StatsTiles, type FormStats } from "@/components/responses/StatsTiles";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS_LABEL: Record<FormStatus, string> = {
  draft: "Draft",
  published: "Live",
  closed: "Closed",
};

interface SubmissionPage {
  submissions: SubmissionRow[];
  nextBefore: string | null;
  columns: ResponseColumn[];
}

function displayTitle(title: string): string {
  return title.trim() === "" ? "Untitled form" : title;
}

function parseStats(value: unknown): FormStats {
  if (
    !isRecord(value) ||
    typeof value.views !== "number" ||
    typeof value.starts !== "number" ||
    typeof value.submissions !== "number" ||
    !(value.completionRate === null || typeof value.completionRate === "number")
  ) {
    throw new Error("The stats were not readable.");
  }
  return {
    views: value.views,
    starts: value.starts,
    submissions: value.submissions,
    completionRate: value.completionRate,
  };
}

function parseResponseValue(value: unknown): ResponseValue {
  if (typeof value === "string" || typeof value === "number") return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  throw new Error("The responses were not readable.");
}

function parseResponses(value: unknown): Record<string, ResponseValue> {
  if (!isRecord(value)) throw new Error("The responses were not readable.");
  const responses: Record<string, ResponseValue> = {};
  for (const [key, item] of Object.entries(value)) responses[key] = parseResponseValue(item);
  return responses;
}

function parseColumnType(value: unknown): QuestionType | null {
  if (value === null) return null;
  if (typeof value === "string" && isQuestionType(value)) return value;
  throw new Error("The responses were not readable.");
}

function parseColumn(value: unknown): ResponseColumn {
  if (!isRecord(value) || typeof value.questionId !== "string" || typeof value.prompt !== "string") {
    throw new Error("The responses were not readable.");
  }
  return { questionId: value.questionId, prompt: value.prompt, type: parseColumnType(value.type) };
}

function parseSubmission(value: unknown): SubmissionRow {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.createdAt !== "string" ||
    !(value.version === null || typeof value.version === "number")
  ) {
    throw new Error("The responses were not readable.");
  }
  return {
    id: value.id,
    createdAt: value.createdAt,
    version: value.version,
    responses: parseResponses(value.responses),
  };
}

function parsePage(value: unknown): SubmissionPage {
  if (!isRecord(value) || !Array.isArray(value.submissions) || !Array.isArray(value.columns)) {
    throw new Error("The responses were not readable.");
  }
  if (!(value.nextBefore === null || typeof value.nextBefore === "string")) {
    throw new Error("The responses were not readable.");
  }
  return {
    submissions: value.submissions.map(parseSubmission),
    nextBefore: value.nextBefore,
    columns: value.columns.map(parseColumn),
  };
}

function submissionsPath(formId: string, before?: string): string {
  const params = new URLSearchParams({ limit: "50" });
  if (before !== undefined) params.set("before", before);
  return `/api/forms/${encodeURIComponent(formId)}/submissions?${params.toString()}`;
}

export function ResponsesPage() {
  const params = useParams<{ id?: string }>();
  const formId = params.id ?? "";
  const { publicUrl } = useSession();
  const [extra, setExtra] = useState<SubmissionPage[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<SubmissionRow | null>(null);

  const formQuery = useQuery({
    queryKey: formQueryKey(formId),
    enabled: formId !== "",
    queryFn: async ({ signal }) => parseFormDetail(await api<unknown>(`/api/forms/${encodeURIComponent(formId)}`, { signal })),
  });
  const statsQuery = useQuery({
    queryKey: ["form", formId, "stats"],
    enabled: formId !== "",
    queryFn: async ({ signal }) => parseStats(await api<unknown>(`/api/forms/${encodeURIComponent(formId)}/stats`, { signal })),
  });
  const submissionsQuery = useQuery({
    queryKey: ["form", formId, "submissions"],
    enabled: formId !== "",
    queryFn: async ({ signal }) => parsePage(await api<unknown>(submissionsPath(formId), { signal })),
  });

  useEffect(() => {
    setExtra([]);
  }, [submissionsQuery.dataUpdatedAt]);

  const form: FormDetail | undefined = formQuery.data;
  const rows = [...(submissionsQuery.data?.submissions ?? []), ...extra.flatMap((page) => page.submissions)];
  const columns = submissionsQuery.data?.columns ?? [];
  const nextBefore = extra.length > 0 ? (extra[extra.length - 1]?.nextBefore ?? null) : (submissionsQuery.data?.nextBefore ?? null);
  const published = form !== undefined && form.publishedVersion !== null;
  const url = form ? shareUrl(form.slug, publicUrl) : "";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "The link could not be copied." });
    }
  }

  async function loadMore() {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = parsePage(await api<unknown>(submissionsPath(formId, nextBefore)));
      setExtra((current) => [...current, page]);
    } catch (error) {
      toast({ title: errorMessage(error) });
    } finally {
      setLoadingMore(false);
    }
  }

  async function deleteResponse(id: string) {
    await api<void>(`/api/forms/${encodeURIComponent(formId)}/submissions/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast({ title: "Response deleted" });
    setSelected(null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["form", formId, "submissions"] }),
      queryClient.invalidateQueries({ queryKey: ["form", formId, "stats"] }),
    ]);
  }

  if (formId === "") return <p>That form could not be found.</p>;

  if (formQuery.isError) {
    return (
      <Card>
        <CardHeader className="space-y-3">
          <p>{errorMessage(formQuery.error)}</p>
          <Button onClick={() => void formQuery.refetch()}>Retry</Button>
        </CardHeader>
      </Card>
    );
  }

  if (!form) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const title = displayTitle(form.title);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <Badge variant={form.status === "published" ? "default" : "secondary"}>{STATUS_LABEL[form.status]}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/forms/${form.id}/edit`} className={buttonVariants({ variant: "outline" })}>
            Edit form
          </Link>
          {published ? (
            <a href={url} target="_blank" rel="noopener" className={buttonVariants({ variant: "outline" })}>
              Open form
            </a>
          ) : null}
          <Button variant="outline" onClick={() => void copyLink()}>
            Copy link
          </Button>
          <a href={`/api/forms/${form.id}/export.csv`} download className={buttonVariants({ variant: "outline" })}>
            Export CSV
          </a>
        </div>
      </div>

      {statsQuery.isError ? <p>{errorMessage(statsQuery.error)}</p> : null}
      {statsQuery.isPending ? <Skeleton className="h-24 w-full" /> : null}
      {statsQuery.data ? <StatsTiles stats={statsQuery.data} /> : null}

      {submissionsQuery.isError ? (
        <Card>
          <CardHeader className="space-y-3">
            <p>{errorMessage(submissionsQuery.error)}</p>
            <Button onClick={() => void submissionsQuery.refetch()}>Retry</Button>
          </CardHeader>
        </Card>
      ) : null}
      {submissionsQuery.isPending ? <Skeleton className="h-40 w-full" /> : null}
      {submissionsQuery.data && rows.length === 0 ? (
        <div className="space-y-3">
          <p>No responses yet.</p>
          {published ? (
            <>
              <p className="break-all text-sm">{url}</p>
              <Button variant="outline" onClick={() => void copyLink()}>
                Copy
              </Button>
            </>
          ) : (
            <Link href={`/forms/${form.id}/edit`} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              Publish the form to start collecting responses.
            </Link>
          )}
        </div>
      ) : null}
      {submissionsQuery.data && rows.length > 0 ? (
        <ResponsesTable
          columns={columns}
          rows={rows}
          nextBefore={nextBefore}
          loadingMore={loadingMore}
          onOpen={setSelected}
          onLoadMore={() => void loadMore()}
        />
      ) : null}
      <ResponseDetail submission={selected} columns={columns} onOpenChange={(open) => { if (!open) setSelected(null); }} onDelete={deleteResponse} />
    </div>
  );
}
