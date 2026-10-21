import { useState } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PreviewDialog } from "@/components/editor/PreviewDialog";
import { SharePopover } from "@/components/editor/SharePopover";
import type { DraftFields, FormDetail, FormStatus, SaveState } from "@/components/editor/useDraft";

const STATUS_LABEL: Record<FormStatus, string> = {
  draft: "Draft",
  published: "Live",
  closed: "Closed",
};

export function publishState(form: FormDetail): { label: string; disabled: boolean } {
  if (form.publishedVersion === null) return { label: "Publish", disabled: false };
  if (form.hasUnpublishedChanges) return { label: "Publish changes", disabled: false };
  return { label: "Published", disabled: true };
}

export function EditorTopBar({
  form,
  draft,
  publicUrl,
  saveState,
  invalid,
  shareOpen,
  publishing,
  onTitle,
  onRetry,
  onShareOpenChange,
  onPublish,
}: {
  form: FormDetail;
  draft: DraftFields;
  publicUrl: string | null;
  saveState: SaveState;
  invalid: string | null;
  shareOpen: boolean;
  publishing: boolean;
  onTitle: (title: string) => void;
  onRetry: () => void;
  onShareOpenChange: (open: boolean) => void;
  onPublish: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const publish = publishState(form);

  return (
    <div className="sticky top-0 z-20 -mx-4 border-b bg-background px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Forms
        </Link>
        <Input
          aria-label="Form title"
          value={draft.title}
          maxLength={200}
          onChange={(event) => onTitle(event.target.value)}
          className="max-w-sm"
        />
        <Badge variant={form.status === "published" ? "default" : "secondary"}>{STATUS_LABEL[form.status]}</Badge>
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          {saveState === "saving" ? <span>Saving{"\u2026"}</span> : null}
          {saveState === "saved" ? <span>Saved</span> : null}
          {saveState === "error" ? (
            <>
              <span>Couldn&apos;t save</span>
              <Button variant="outline" size="sm" onClick={onRetry}>
                Retry
              </Button>
            </>
          ) : null}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setPreview(true)}>
            Preview
          </Button>
          <SharePopover form={form} publicUrl={publicUrl} open={shareOpen} onOpenChange={onShareOpenChange} />
          <Button onClick={onPublish} disabled={publishing || publish.disabled}>
            {publish.label}
          </Button>
        </div>
      </div>
      {invalid ? <p className="mt-2 text-sm text-destructive">{invalid}</p> : null}
      <PreviewDialog open={preview} onOpenChange={setPreview} draft={draft} />
    </div>
  );
}
