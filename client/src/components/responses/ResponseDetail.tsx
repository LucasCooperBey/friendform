import { useState } from "react";
import type { ResponseValue } from "@shared/form-schema";
import { errorMessage } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import type { ResponseColumn, SubmissionRow } from "@/components/responses/ResponsesTable";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function plain(value: ResponseValue | undefined): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function readAnswer(row: SubmissionRow, questionId: string): ResponseValue | undefined {
  if (!Object.hasOwn(row.responses, questionId)) return undefined;
  return row.responses[questionId];
}

function AnswerValue({ column, value }: { column: ResponseColumn; value: ResponseValue | undefined }) {
  if (Array.isArray(value) && (column.type === "checkbox" || column.type === null)) {
    return (
      <ul className="flex flex-wrap gap-2">
        {value.map((item, index) => (
          <li key={`${item}-${index}`}>
            <Badge variant="secondary">{item}</Badge>
          </li>
        ))}
      </ul>
    );
  }
  return <p className="whitespace-pre-wrap">{plain(value)}</p>;
}

export function ResponseDetail({
  submission,
  columns,
  onOpenChange,
  onDelete,
}: {
  submission: SubmissionRow | null;
  columns: ResponseColumn[];
  onOpenChange: (open: boolean) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const known = new Set(columns.map((column) => column.questionId));
  const others = submission ? Object.keys(submission.responses).filter((key) => !known.has(key)) : [];

  async function confirmDelete() {
    if (!submission) return;
    setDeleting(true);
    try {
      await onDelete(submission.id);
      setConfirming(false);
    } catch (error) {
      toast({ title: errorMessage(error) });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Dialog
        open={submission !== null}
        onOpenChange={(open) => {
          if (!open) onOpenChange(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Response</DialogTitle>
            <DialogDescription>{submission ? relativeTime(submission.createdAt) : ""}</DialogDescription>
          </DialogHeader>
          {submission ? (
            <div className="space-y-4">
              {columns.map((column) => (
                <div key={column.questionId} className="space-y-1">
                  <p className="font-medium">{column.prompt}</p>
                  <AnswerValue column={column} value={readAnswer(submission, column.questionId)} />
                </div>
              ))}
              {others.length > 0 ? (
                <div className="space-y-3">
                  <h3 className="font-medium">Other answers</h3>
                  {others.map((key) => (
                    <div key={key} className="space-y-1">
                      <p className="font-medium">{key}</p>
                      <p className="whitespace-pre-wrap">{plain(readAnswer(submission, key))}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              <Button variant="destructive" onClick={() => setConfirming(true)}>
                Delete response
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this response?</AlertDialogTitle>
            <AlertDialogDescription>This removes the response from the form.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={() => void confirmDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
