import { useRef, useState, type ChangeEvent } from "react";
import type { Responses, ResponseValue } from "@shared/form-schema";
import { api, errorMessage } from "@/lib/api";
import { isRecord } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

const MAX_BYTES = 5 * 1024 * 1024;

const ACCEPT = [
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".csv",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
].join(",");

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const ALLOWED_MIME = new Set(Object.values(MIME_BY_EXTENSION));

function fileMime(file: File): string {
  const declared = file.type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (ALLOWED_MIME.has(declared)) return declared;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? (declared === "" ? "application/octet-stream" : declared);
}

function isResponseValue(value: unknown): value is ResponseValue {
  if (typeof value === "string" || typeof value === "number") return true;
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseFill(value: unknown): { answers: Responses; filled: number } {
  if (!isRecord(value) || !isRecord(value.answers) || typeof value.filled !== "number") {
    throw new Error("The answers were not readable.");
  }
  const answers: Responses = {};
  for (const [key, item] of Object.entries(value.answers)) {
    if (isResponseValue(item)) answers[key] = item;
  }
  return { answers, filled: value.filled };
}

function filledToast(filled: number): string {
  if (filled === 0) return "Nothing in that file matched these questions.";
  if (filled === 1) return "Filled 1 answer. Check it before you submit.";
  return `Filled ${filled} answers. Check them before you submit.`;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("The file could not be read."));
        return;
      }
      const marker = "base64,";
      const index = reader.result.indexOf(marker);
      resolve(index === -1 ? reader.result : reader.result.slice(index + marker.length));
    };
    reader.onerror = () => {
      reject(reader.error instanceof Error ? reader.error : new Error("The file could not be read."));
    };
    reader.readAsDataURL(file);
  });
}

export function AutofillButton({ slug, onFill }: { slug: string; onFill: (answers: Responses) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onFillRef = useRef(onFill);
  onFillRef.current = onFill;
  const [busy, setBusy] = useState(false);
  const [sizeError, setSizeError] = useState<string | null>(null);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setSizeError("That file is over 5 MB.");
      return;
    }
    setSizeError(null);
    setBusy(true);
    try {
      const dataBase64 = await readBase64(file);
      const filename = file.name === "" ? "upload" : file.name.slice(0, 200);
      const result = parseFill(await api<unknown>(`/api/public/forms/${encodeURIComponent(slug)}/autofill`, {
        method: "POST",
        body: { filename, mimeType: fileMime(file), dataBase64 },
      }));
      onFillRef.current(result.answers);
      toast({ title: filledToast(result.filled) });
    } catch (error) {
      toast({ title: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
        Fill from a document
      </Button>
      <input
        ref={inputRef}
        type="file"
        aria-label="Document"
        accept={ACCEPT}
        className="absolute left-[-10000px]"
        onChange={(event) => void onFile(event)}
      />
      {sizeError ? (
        <p role="alert" className="text-sm text-destructive">
          {sizeError}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Your file goes to this form's AI service once to fill the answers. Friendform does not save it.
      </p>
    </div>
  );
}
