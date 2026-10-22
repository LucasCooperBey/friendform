import { writeFileSync } from "node:fs";
import mammoth from "mammoth";
import { getDocumentProxy } from "unpdf";

const MAX_TEXT = 40_000;
const MAX_PAGES = 30;

type ChildReply = { ok: true; text: string } | { ok: false; code: "unsupported" | "empty" };

try {
  writeFileSync("/proc/self/oom_score_adj", "1000");
} catch {
  // Only Linux publishes this file. A failed write leaves the child at the default score.
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJob(value: unknown): value is { kind: "pdf" | "docx"; data: Uint8Array } {
  if (!isRecord(value)) return false;
  const kind = value.kind;
  if (kind !== "pdf" && kind !== "docx") return false;
  return value.data instanceof Uint8Array;
}

function normalizeMergedText(texts: readonly string[]): string {
  return texts.join("\n").replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n");
}

function itemText(item: object): string | undefined {
  if (!("str" in item) || typeof item.str !== "string") return undefined;
  const hasEOL = "hasEOL" in item && item.hasEOL === true;
  return item.str + (hasEOL ? "\n" : "");
}

async function pdfText(data: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  try {
    const pageCount = Math.min(pdf.numPages, MAX_PAGES);
    const pages: string[] = [];
    let raw = "";
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        const line = itemText(item);
        if (line === undefined) continue;
        text += line;
      }
      raw = pages.length === 0 ? text : `${raw}\n${text}`;
      pages.push(text);
      if (raw.length > MAX_TEXT) break;
    }
    return normalizeMergedText(pages).slice(0, MAX_TEXT);
  } finally {
    try {
      await pdf.loadingTask.destroy();
    } catch {
      // Closing the document is best effort.
    }
  }
}

async function docxText(data: Uint8Array): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: Buffer.from(data) });
  return result.value.slice(0, MAX_TEXT);
}

function reply(message: ChildReply): void {
  if (typeof process.send !== "function") {
    process.exit(1);
    return;
  }
  process.send(message, () => {
    process.exit(0);
  });
}

let started = false;

process.on("message", (message) => {
  if (started) return;
  started = true;
  void readJob(message);
});

async function readJob(message: unknown): Promise<void> {
  try {
    if (!isJob(message)) {
      reply({ ok: false, code: "unsupported" });
      return;
    }
    const text = message.kind === "pdf" ? await pdfText(message.data) : await docxText(message.data);
    if (text.trim() === "") {
      reply({ ok: false, code: "empty" });
      return;
    }
    reply({ ok: true, text });
  } catch {
    reply({ ok: false, code: "unsupported" });
  }
}
