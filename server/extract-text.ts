import { ExtractError } from "./extract-error";
import { createExtractor, type Extractor } from "./extract-runner";

export type Upload = { filename: string; mimeType: string; data: Buffer };

export type Extracted = { kind: "text"; text: string } | { kind: "image"; dataUrl: string };

export { ExtractError } from "./extract-error";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TEXT = 40_000;

const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/csv"]);

let sharedExtractor: Extractor | undefined;

function defaultExtractor(): Extractor {
  sharedExtractor ??= createExtractor();
  return sharedExtractor;
}

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

export async function extractUpload(u: Upload, extractor?: Extractor, signal?: AbortSignal): Promise<Extracted> {
  if (signal?.aborted) throw new ExtractError("aborted");
  if (u.data.length > MAX_BYTES) throw new ExtractError("too_large");
  const mimeType = baseMime(u.mimeType);
  try {
    if (mimeType === "application/pdf") {
      if (!isPdf(u.data)) throw new ExtractError("unsupported");
      const text = await (extractor ?? defaultExtractor()).run({ kind: "pdf", data: u.data }, signal);
      return textResult(text);
    }
    if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      if (!isZip(u.data)) throw new ExtractError("unsupported");
      const text = await (extractor ?? defaultExtractor()).run({ kind: "docx", data: u.data }, signal);
      return textResult(text);
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
