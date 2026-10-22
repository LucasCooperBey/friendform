import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export type Upload = { filename: string; mimeType: string; data: Buffer };

export type Extracted = { kind: "text"; text: string } | { kind: "image"; dataUrl: string };

export class ExtractError extends Error {
  readonly code: "unsupported" | "empty" | "too_large";

  constructor(code: ExtractError["code"]) {
    super(code);
    this.name = "ExtractError";
    this.code = code;
  }
}

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TEXT = 40_000;

const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/csv"]);

function baseMime(mimeType: string): string {
  return mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function startsWith(data: Buffer, bytes: readonly number[]): boolean {
  if (data.length < bytes.length) return false;
  return bytes.every((byte, index) => data[index] === byte);
}

function isPdf(data: Buffer): boolean {
  return startsWith(data, [0x25, 0x50, 0x44, 0x46]);
}

function isZip(data: Buffer): boolean {
  return startsWith(data, [0x50, 0x4b, 0x03, 0x04]);
}

function isPng(data: Buffer): boolean {
  return startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function isJpeg(data: Buffer): boolean {
  return startsWith(data, [0xff, 0xd8, 0xff]);
}

function isWebp(data: Buffer): boolean {
  return data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP";
}

function imageMatches(mimeType: string, data: Buffer): boolean {
  if (mimeType === "image/png") return isPng(data);
  if (mimeType === "image/jpeg") return isJpeg(data);
  if (mimeType === "image/webp") return isWebp(data);
  return false;
}

function textResult(text: string): Extracted {
  const cut = text.slice(0, MAX_TEXT);
  if (cut.trim() === "") throw new ExtractError("empty");
  return { kind: "text", text: cut };
}

function isDestroyable(value: object): value is { destroy(): Promise<void> | void } {
  if (!("destroy" in value)) return false;
  const destroy: unknown = value.destroy;
  return typeof destroy === "function";
}

async function releasePdf(pdf: object): Promise<void> {
  if (!isDestroyable(pdf)) return;
  try {
    await pdf.destroy();
  } catch {
    // Closing the document is best effort.
  }
}

async function pdfText(data: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  try {
    const extracted = await extractText(pdf, { mergePages: true });
    if (typeof extracted.text !== "string") throw new ExtractError("unsupported");
    return extracted.text;
  } finally {
    await releasePdf(pdf);
  }
}

async function docxText(data: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: data });
  return result.value;
}

export async function extractUpload(u: Upload): Promise<Extracted> {
  if (u.data.length > MAX_BYTES) throw new ExtractError("too_large");
  const mimeType = baseMime(u.mimeType);
  try {
    if (mimeType === "application/pdf") {
      if (!isPdf(u.data)) throw new ExtractError("unsupported");
      return textResult(await pdfText(u.data));
    }
    if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      if (!isZip(u.data)) throw new ExtractError("unsupported");
      return textResult(await docxText(u.data));
    }
    if (TEXT_TYPES.has(mimeType)) return textResult(u.data.toString("utf8"));
    if (mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp") {
      if (!imageMatches(mimeType, u.data)) throw new ExtractError("unsupported");
      return { kind: "image", dataUrl: `data:${mimeType};base64,${u.data.toString("base64")}` };
    }
    throw new ExtractError("unsupported");
  } catch (error) {
    if (error instanceof ExtractError) throw error;
    throw new ExtractError("unsupported");
  }
}
