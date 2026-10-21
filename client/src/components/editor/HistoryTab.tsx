import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { isRecord } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { parseFormDetail, type FormDetail } from "@/components/editor/useDraft";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface VersionRow {
  id: string;
  version: number;
  publishedAt: string;
  questionCount: number;
}

function parseVersions(value: unknown): VersionRow[] {
  if (!isRecord(value) || !Array.isArray(value.versions)) throw new Error("The versions were not readable.");
  return value.versions.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.version !== "number" ||
      typeof item.publishedAt !== "string" ||
      typeof item.questionCount !== "number"
    ) {
      throw new Error("The versions were not readable.");
    }
    return {
      id: item.id,
      version: item.version,
      publishedAt: item.publishedAt,
      questionCount: item.questionCount,
    };
  });
}

export function HistoryTab({ formId, onRestore }: { formId: string; onRestore: (form: FormDetail) => void }) {
  const [restoring, setRestoring] = useState<string | null>(null);
  const versions = useQuery({
    queryKey: ["form", formId, "versions"],
    queryFn: async ({ signal }) =>
      parseVersions(await api<unknown>(`/api/forms/${encodeURIComponent(formId)}/versions`, { signal })),
  });

  async function restore(version: VersionRow) {
    setRestoring(version.id);
    try {
      const form = parseFormDetail(
        await api<unknown>(`/api/forms/${encodeURIComponent(formId)}/versions/${encodeURIComponent(version.id)}/restore`, {
          method: "POST",
        }),
      );
      onRestore(form);
      toast({ title: `Version ${version.version} copied into your draft. Publish to make it live.` });
    } catch (error) {
      toast({ title: errorMessage(error) });
    } finally {
      setRestoring(null);
    }
  }

  if (versions.isPending) return <Skeleton className="h-24 w-full" />;
  if (versions.isError) return <p>{errorMessage(versions.error)}</p>;
  if (versions.data.length === 0) return <p>Nothing published yet.</p>;

  return (
    <ul className="space-y-3">
      {versions.data.map((version) => (
        <li key={version.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
          <div className="space-y-1">
            <p className="font-medium">Version {version.version}</p>
            <p className="text-sm text-muted-foreground">Published {relativeTime(version.publishedAt)}</p>
            <p className="text-sm text-muted-foreground">{version.questionCount === 1 ? "1 question" : `${version.questionCount} questions`}</p>
          </div>
          <Button variant="outline" disabled={restoring === version.id} onClick={() => void restore(version)}>
            Restore to draft
          </Button>
        </li>
      ))}
    </ul>
  );
}
