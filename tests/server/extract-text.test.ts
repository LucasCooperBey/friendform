import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createExtractor, type Extractor } from "../../server/extract-runner";
import { ExtractError, extractUpload } from "../../server/extract-text";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// PDF parsing runs in a child process, so a test counts the PDF jobs handed to a real extractor.
function countingExtractor(): { extractor: Extractor; pdfJobs: () => number } {
  const real = createExtractor();
  let jobs = 0;
  return {
    extractor: {
      get busy() {
        return real.busy;
      },
      run(job, signal) {
        if (job.kind === "pdf") jobs += 1;
        return real.run(job, signal);
      },
    },
    pdfJobs: () => jobs,
  };
}

describe("extractUpload", () => {
  // source: a PNG labeled as a PDF is rejected before the PDF parser runs.
  it("rejects a PNG labeled as a PDF without calling the PDF parser", async () => {
    const counted = countingExtractor();
    await expect(extractUpload({ filename: "photo.pdf", mimeType: "application/pdf", data: PNG }, counted.extractor)).rejects.toMatchObject({
      name: "ExtractError",
      code: "unsupported",
    });
    expect(counted.pdfJobs()).toBe(0);
  });

  // source: a real PDF is parsed, and a malformed PDF that passes the signature becomes unsupported.
  it("reads a PDF and turns a malformed PDF into unsupported", async () => {
    const pdf = readFileSync(path.join(fixtures, "sample.pdf"));
    const counted = countingExtractor();
    const extracted = await extractUpload({ filename: "sample.pdf", mimeType: "application/pdf", data: pdf }, counted.extractor);
    expect(extracted).toEqual({ kind: "text", text: expect.stringContaining("Hello from the sample PDF") });
    expect(counted.pdfJobs()).toBe(1);
    const malformed = countingExtractor();
    await expect(extractUpload({
      filename: "bad.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("%PDF-1.4 this is not a real document"),
    }, malformed.extractor)).rejects.toBeInstanceOf(ExtractError);
    await expect(extractUpload({
      filename: "bad.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("%PDF-1.4 this is not a real document"),
    }, malformed.extractor)).rejects.toMatchObject({ code: "unsupported" });
    expect(malformed.pdfJobs()).toBe(2);
  });

  // source: a docx is read, and the same zip labeled as a generic zip is unsupported.
  it("reads a docx and rejects a zip that is not a word document", async () => {
    const docx = readFileSync(path.join(fixtures, "sample.docx"));
    const extracted = await extractUpload({ filename: "sample.docx", mimeType: DOCX_MIME, data: docx });
    expect(extracted.kind).toBe("text");
    if (extracted.kind === "text") expect(extracted.text).toContain("Hello from the sample document");
    await expect(extractUpload({ filename: "sample.docx", mimeType: "application/zip", data: docx })).rejects.toMatchObject({
      code: "unsupported",
    });
  });

  // source: text types are decoded as UTF-8, including a charset parameter, and are not rejected for a PDF signature.
  it("reads plain text, markdown, and csv without sniffing them as binaries", async () => {
    const counted = countingExtractor();
    expect(await extractUpload({
      filename: "a.txt",
      mimeType: "text/plain",
      data: Buffer.from("%PDF this is plain text"),
    }, counted.extractor)).toEqual({ kind: "text", text: "%PDF this is plain text" });
    expect(counted.pdfJobs()).toBe(0);
    expect(await extractUpload({
      filename: "a.txt",
      mimeType: "text/plain; charset=utf-8",
      data: Buffer.from("hello text"),
    })).toEqual({ kind: "text", text: "hello text" });
    expect(await extractUpload({
      filename: "a.md",
      mimeType: "text/markdown",
      data: Buffer.from("# Title"),
    })).toEqual({ kind: "text", text: "# Title" });
    expect(await extractUpload({
      filename: "a.csv",
      mimeType: "text/csv",
      data: Buffer.from("name,Ada"),
    })).toEqual({ kind: "text", text: "name,Ada" });
  });

  // source: whitespace-only text is empty, and an unknown type is unsupported.
  it("rejects empty text and an unsupported type", async () => {
    await expect(extractUpload({
      filename: "blank.txt",
      mimeType: "text/plain",
      data: Buffer.from(" \n\t"),
    })).rejects.toMatchObject({ code: "empty" });
    await expect(extractUpload({
      filename: "a.gif",
      mimeType: "image/gif",
      data: Buffer.from("GIF89a"),
    })).rejects.toMatchObject({ code: "unsupported" });
  });

  // source: data over 5 MB is too_large before parsing, and exactly 5 MB of text is cut to 40000 characters.
  it("rejects data over 5 MB and cuts exactly 5 MB of text", async () => {
    const over = Buffer.alloc(5 * 1024 * 1024 + 1, 0x41);
    const counted = countingExtractor();
    await expect(extractUpload({ filename: "big.pdf", mimeType: "application/pdf", data: over }, counted.extractor)).rejects.toMatchObject({
      code: "too_large",
    });
    expect(counted.pdfJobs()).toBe(0);
    const exact = Buffer.alloc(5 * 1024 * 1024, 0x41);
    expect(await extractUpload({ filename: "exact.txt", mimeType: "text/plain", data: exact })).toEqual({
      kind: "text",
      text: "A".repeat(40_000),
    });
  });

  // source: png, jpeg, and webp with matching signatures become data URLs. A mismatched signature is unsupported.
  it("returns a data URL for a matching image and rejects a mismatched signature", async () => {
    expect(await extractUpload({ filename: "a.png", mimeType: "image/png", data: PNG })).toEqual({
      kind: "image",
      dataUrl: `data:image/png;base64,${PNG.toString("base64")}`,
    });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    const jpegResult = await extractUpload({ filename: "a.jpg", mimeType: "image/jpeg", data: jpeg });
    expect(jpegResult).toEqual({ kind: "image", dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}` });
    const webp = Buffer.alloc(12);
    webp.write("RIFF", 0);
    webp.write("WEBP", 8);
    expect(await extractUpload({ filename: "a.webp", mimeType: "image/webp", data: webp })).toEqual({
      kind: "image",
      dataUrl: `data:image/webp;base64,${webp.toString("base64")}`,
    });
    await expect(extractUpload({ filename: "a.png", mimeType: "image/png", data: jpeg })).rejects.toMatchObject({
      code: "unsupported",
    });
  });

  // source: a PNG labeled as a PDF, and a non-zip labeled as a Word document, are rejected before a child starts.
  it("rejects a mislabeled PDF and Word upload before starting a child", async () => {
    let calls = 0;
    const spy = {
      get busy() {
        return false;
      },
      run() {
        calls += 1;
        return Promise.resolve("unused");
      },
    };
    await expect(extractUpload({ filename: "photo.pdf", mimeType: "application/pdf", data: PNG }, spy)).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(extractUpload({
      filename: "notes.docx",
      mimeType: DOCX_MIME,
      data: Buffer.from("this is not a zip"),
    }, spy)).rejects.toMatchObject({ code: "unsupported" });
    expect(calls).toBe(0);
  });
});
