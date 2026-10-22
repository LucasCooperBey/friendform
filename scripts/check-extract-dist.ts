import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createExtractor } from "../server/extract-runner";

const childPath = path.resolve(process.cwd(), "dist/extract-child.mjs");
const pdfPath = path.resolve(process.cwd(), "tests/fixtures/sample.pdf");
const docxPath = path.resolve(process.cwd(), "tests/fixtures/sample.docx");

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const child = statSync(childPath);
  if (!child.isFile() || child.size === 0) fail("dist/extract-child.mjs is missing");
  const extractor = createExtractor({ childPath });
  const pdfText = await extractor.run({ kind: "pdf", data: readFileSync(pdfPath) });
  const docxText = await extractor.run({ kind: "docx", data: readFileSync(docxPath) });
  if (!pdfText.includes("Hello")) fail("sample PDF text did not include Hello");
  if (!docxText.includes("document")) fail("sample Word text did not include document");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "extract check failed";
  fail(`check:extract failed: ${message}`);
});
