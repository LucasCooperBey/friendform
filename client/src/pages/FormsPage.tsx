import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ellipsis } from "lucide-react";
import { useLocation } from "wouter";
import { allQuestions, type FormSchema } from "@shared/form-schema";
import { TEMPLATES, type FormTemplate } from "@shared/templates";
import { api, errorMessage } from "@/lib/api";
import { relativeTime, shareUrl } from "@/lib/format";
import { queryClient, useSession } from "@/lib/session";
import { isRecord } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { DescribeFormDialog } from "@/components/DescribeFormDialog";

type FormStatus = "draft" | "published" | "closed";

interface FormListItem {
  id: string;
  slug: string;
  title: string;
  status: FormStatus;
  submissionCount: number;
  updatedAt: string;
}

const STATUS_LABEL: Record<FormStatus, string> = {
  draft: "Draft",
  published: "Live",
  closed: "Closed",
};

function isStatus(value: unknown): value is FormStatus {
  return value === "draft" || value === "published" || value === "closed";
}

function displayTitle(title: string): string {
  return title.trim() === "" ? "Untitled form" : title;
}

function responseCount(count: number): string {
  return count === 1 ? "1 response" : `${count} responses`;
}

function questionCount(schema: FormSchema): string {
  const count = allQuestions(schema).length;
  return count === 1 ? "1 question" : `${count} questions`;
}

function parseForms(value: unknown): FormListItem[] {
  if (!isRecord(value) || !Array.isArray(value.forms)) throw new Error("The form list was not readable.");
  return value.forms.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.slug !== "string" ||
      typeof item.title !== "string" ||
      typeof item.submissionCount !== "number" ||
      typeof item.updatedAt !== "string" ||
      !isStatus(item.status)
    ) {
      throw new Error("The form list was not readable.");
    }
    return {
      id: item.id,
      slug: item.slug,
      title: item.title,
      status: item.status,
      submissionCount: item.submissionCount,
      updatedAt: item.updatedAt,
    };
  });
}

function readCreatedId(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.form) || typeof value.form.id !== "string") {
    throw new Error("The new form was not readable.");
  }
  return value.form.id;
}

function TemplateButton({
  template,
  disabled,
  onChoose,
}: {
  template: FormTemplate;
  disabled: boolean;
  onChoose: (template: FormTemplate) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChoose(template)}
      className="flex min-h-24 flex-col items-start gap-1 rounded-lg border bg-card p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      <span className="font-semibold">{template.name}</span>
      <span className="text-sm text-muted-foreground">{template.description}</span>
      <span className="text-sm text-muted-foreground">{questionCount(template.schema)}</span>
    </button>
  );
}

export function FormsPage() {
  const { publicUrl, aiEnabled } = useSession();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [describeOpen, setDescribeOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FormListItem | null>(null);
  const query = useQuery({
    queryKey: ["forms"],
    queryFn: async ({ signal }) => parseForms(await api<unknown>("/api/forms", { signal })),
  });

  async function createForm(body: { title: string; draftSchema?: FormSchema }) {
    setCreating(true);
    try {
      const created = await api<unknown>("/api/forms", { method: "POST", body });
      setOpen(false);
      setLocation(`/forms/${readCreatedId(created)}/edit`);
    } catch (error) {
      toast({ title: errorMessage(error) });
    } finally {
      setCreating(false);
    }
  }

  function chooseTemplate(template: FormTemplate) {
    void createForm({ title: template.title, draftSchema: template.schema });
  }

  async function copyLink(form: FormListItem) {
    try {
      await navigator.clipboard.writeText(shareUrl(form.slug, publicUrl));
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "The link could not be copied." });
    }
  }

  async function duplicate(form: FormListItem) {
    try {
      await api(`/api/forms/${form.id}/duplicate`, { method: "POST" });
      toast({ title: "Form duplicated" });
      await queryClient.invalidateQueries({ queryKey: ["forms"] });
    } catch (error) {
      toast({ title: errorMessage(error) });
    }
  }

  async function confirmDelete() {
    const form = pendingDelete;
    if (!form) return;
    setPendingDelete(null);
    try {
      await api<void>(`/api/forms/${form.id}`, { method: "DELETE" });
      toast({ title: "Form deleted" });
      await queryClient.invalidateQueries({ queryKey: ["forms"] });
    } catch (error) {
      toast({ title: errorMessage(error) });
    }
  }

  const shortcuts = TEMPLATES.slice(0, 3);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Your forms</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>New form</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New form</DialogTitle>
              <DialogDescription>Start from a blank form or a template.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={creating}
                onClick={() => void createForm({ title: "Untitled form" })}
                className="flex min-h-24 flex-col items-start gap-1 rounded-lg border bg-card p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <span className="font-semibold">Blank form</span>
                <span className="text-sm text-muted-foreground">Start with an empty form.</span>
              </button>
              {aiEnabled ? (
                <button
                  type="button"
                  disabled={creating}
                  onClick={() => {
                    setOpen(false);
                    setDescribeOpen(true);
                  }}
                  className="flex min-h-24 flex-col items-start gap-1 rounded-lg border bg-card p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <span className="font-semibold">Describe it</span>
                  <span className="text-sm text-muted-foreground">Tell us what the form is for and get a draft to edit.</span>
                </button>
              ) : null}
              {TEMPLATES.map((template) => (
                <TemplateButton key={template.id} template={template} disabled={creating} onChoose={chooseTemplate} />
              ))}
            </div>
          </DialogContent>
        </Dialog>
        <DescribeFormDialog open={describeOpen} onOpenChange={setDescribeOpen} />
      </div>

      {query.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      {query.isError ? (
        <Card>
          <CardHeader className="space-y-3">
            <p>{errorMessage(query.error)}</p>
            <Button type="button" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </CardHeader>
        </Card>
      ) : null}

      {query.data && query.data.length === 0 ? (
        <div className="space-y-4">
          <p>You have no forms yet.</p>
          <Button type="button" onClick={() => setOpen(true)}>
            Create your first form
          </Button>
          <div className="grid gap-3 sm:grid-cols-3">
            {shortcuts.map((template) => (
              <TemplateButton key={template.id} template={template} disabled={creating} onChoose={chooseTemplate} />
            ))}
          </div>
        </div>
      ) : null}

      {query.data && query.data.length > 0 ? (
        <ul className="space-y-3">
          {query.data.map((form) => {
            const title = displayTitle(form.title);
            const shareable = form.status === "published" || form.status === "closed";
            return (
              <li key={form.id}>
                <Card>
                  <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold">{title}</h2>
                        <Badge variant={form.status === "published" ? "default" : "secondary"}>
                          {STATUS_LABEL[form.status]}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {responseCount(form.submissionCount)}. Edited {relativeTime(form.updatedAt)}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" aria-label={`Actions for ${title}`}>
                          <Ellipsis />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setLocation(`/forms/${form.id}/edit`)}>Edit</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setLocation(`/forms/${form.id}/responses`)}>
                          Responses
                        </DropdownMenuItem>
                        {shareable ? (
                          <DropdownMenuItem onSelect={() => void copyLink(form)}>Copy link</DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          onSelect={() => {
                            window.open(shareUrl(form.slug, publicUrl), "_blank", "noopener");
                          }}
                        >
                          Open form
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void duplicate(form)}>Duplicate</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setPendingDelete(form)}>Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardHeader>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : null}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(next) => { if (!next) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete ? displayTitle(pendingDelete.title) : "this form"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes {pendingDelete ? displayTitle(pendingDelete.title) : "this form"} and its responses.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
