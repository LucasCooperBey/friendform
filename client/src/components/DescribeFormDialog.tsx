import { useState } from "react";
import { useLocation } from "wouter";
import { formSchemaZ, type FormSchema } from "@shared/form-schema";
import { ApiError, api, errorMessage } from "@/lib/api";
import { isRecord } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface DraftForm {
  title: string;
  description: string;
  schema: FormSchema;
}

function parseDraft(value: unknown): DraftForm {
  if (!isRecord(value) || typeof value.title !== "string" || typeof value.description !== "string") {
    throw new Error("The draft was not readable.");
  }
  const schema = formSchemaZ.safeParse(value.schema);
  if (!schema.success) throw new Error("The draft was not readable.");
  return { title: value.title, description: value.description, schema: schema.data };
}

function readCreatedId(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.form) || typeof value.form.id !== "string") {
    throw new Error("The new form was not readable.");
  }
  return value.form.id;
}

function draftError(error: unknown): string {
  if (error instanceof ApiError && isRecord(error.body) && error.body.error === "ai_timeout") {
    return "That took too long. Try a shorter description.";
  }
  return errorMessage(error);
}

export function DescribeFormDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [, setLocation] = useLocation();
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<DraftForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [creating, setCreating] = useState(false);
  const trimmed = description.trim();
  const canDraft = trimmed.length >= 10 && trimmed.length <= 4000 && !drafting;

  async function draftForm() {
    setDrafting(true);
    setError(null);
    try {
      const next = parseDraft(await api<unknown>("/api/ai/generate-form", { method: "POST", body: { description } }));
      setDraft(next);
    } catch (caught) {
      setError(draftError(caught));
    } finally {
      setDrafting(false);
    }
  }

  async function useDraft() {
    if (!draft) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api<unknown>("/api/forms", {
        method: "POST",
        body: { title: draft.title, description: draft.description, draftSchema: draft.schema },
      });
      onOpenChange(false);
      setLocation(`/forms/${readCreatedId(created)}/edit`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Describe your form</DialogTitle>
          <DialogDescription>Tell us what the form is for and we will draft the questions.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {draft ? (
          <div className="space-y-4">
            <div className="space-y-3">
              <h2 className="text-base font-semibold">{draft.title}</h2>
              {draft.schema.sections.map((section, index) => (
                <section key={`${section.title}-${index}`} className="space-y-1">
                  <h3 className="text-sm font-semibold">{section.title}</h3>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {section.questions.map((question) => (
                      <li key={question.questionId}>{question.prompt}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void useDraft()} disabled={creating}>
                {creating ? "Creating..." : "Use this draft"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={creating}
                onClick={() => {
                  setDraft(null);
                  setError(null);
                }}
              >
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="describe-form">What is this form for?</Label>
              <Textarea
                id="describe-form"
                value={description}
                placeholder="Example: a workshop signup that asks for a name, an email, and what people hope to learn."
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <Button type="button" onClick={() => void draftForm()} disabled={!canDraft}>
              {drafting ? "Drafting..." : "Draft it"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
