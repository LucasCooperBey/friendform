import { useState } from "react";
import { useParams } from "wouter";
import { ApiError, api, errorMessage } from "@/lib/api";
import { queryClient, useSession } from "@/lib/session";
import { isRecord } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { EditorTopBar } from "@/components/editor/EditorTopBar";
import { HistoryTab } from "@/components/editor/HistoryTab";
import { QuestionsTab } from "@/components/editor/QuestionsTab";
import { SettingsTab } from "@/components/editor/SettingsTab";
import { formQueryKey, parsePublishResult, useDraft } from "@/components/editor/useDraft";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function problemsFrom(error: unknown): string[] | null {
  if (!(error instanceof ApiError) || error.status !== 422 || !isRecord(error.body)) return null;
  if (error.body.error !== "not_publishable" || !isStringArray(error.body.problems)) return null;
  return error.body.problems;
}

export function EditorPage() {
  const params = useParams<{ id?: string }>();
  const formId = params.id ?? "";
  const session = useSession();
  const { form, draft, update, saveState, invalid, flush, retry, adopt, status, error, reload } = useDraft(formId);
  const [shareOpen, setShareOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [problems, setProblems] = useState<string[] | null>(null);

  async function publish() {
    if (!form || publishing) return;
    setPublishing(true);
    try {
      await flush();
      const result = parsePublishResult(await api<unknown>(`/api/forms/${encodeURIComponent(form.id)}/publish`, { method: "POST" }));
      queryClient.setQueryData(formQueryKey(form.id), result.form);
      toast({ title: `Version ${result.version} is live` });
      setShareOpen(true);
    } catch (caught) {
      const listed = problemsFrom(caught);
      if (listed) {
        setProblems(listed);
        return;
      }
      toast({ title: errorMessage(caught) });
    } finally {
      setPublishing(false);
    }
  }

  if (formId === "") return <p>That form could not be found.</p>;

  if (status === "error") {
    return (
      <Card>
        <CardHeader className="space-y-3">
          <p>{errorMessage(error)}</p>
          <Button onClick={() => reload()}>Retry</Button>
        </CardHeader>
      </Card>
    );
  }

  if (status !== "ready" || !form || !draft) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <EditorTopBar
        form={form}
        draft={draft}
        publicUrl={session.publicUrl}
        saveState={saveState}
        invalid={invalid}
        shareOpen={shareOpen}
        publishing={publishing}
        onTitle={(title) => update({ title })}
        onRetry={retry}
        onShareOpenChange={setShareOpen}
        onPublish={() => void publish()}
      />
      <Tabs defaultValue="questions">
        <TabsList>
          <TabsTrigger value="questions">Questions</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="questions">
          <QuestionsTab
            description={draft.description}
            schema={draft.schema}
            onDescription={(description) => update({ description })}
            onSchema={(schema) => update({ schema })}
          />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab form={form} settings={draft.settings} onSettings={(settings) => update({ settings })} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab formId={form.id} onRestore={adopt} />
        </TabsContent>
      </Tabs>
      <Dialog
        open={problems !== null}
        onOpenChange={(open) => {
          if (!open) setProblems(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>This form is not ready to publish</DialogTitle>
            <DialogDescription>Fix these before publishing.</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {problems?.map((problem, index) => (
              <li key={`${problem}-${index}`}>{problem}</li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
