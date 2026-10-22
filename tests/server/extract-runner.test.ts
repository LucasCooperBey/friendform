import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createExtractor, type ChildJob } from "../../server/extract-runner";
import { pdfBomb } from "./pdf-bomb";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const children = path.join(fixtures, "children");
const hangPath = path.join(children, "hang.mjs");
const growPath = path.join(children, "grow.mjs");
const crashPath = path.join(children, "crash.mjs");

const pdfJob: ChildJob = { kind: "pdf", data: readFileSync(path.join(fixtures, "sample.pdf")) };
const docxJob: ChildJob = { kind: "docx", data: readFileSync(path.join(fixtures, "sample.docx")) };
const tinyPdf: ChildJob = { kind: "pdf", data: new Uint8Array([0x25, 0x50, 0x44, 0x46]) };

const live: number[] = [];

afterEach(() => {
  for (const pid of live.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The child has already exited.
    }
  }
});

function track(pid: number): void {
  live.push(pid);
}

function expectGone(pid: number): void {
  expect(pid).toBeGreaterThan(0);
  expect(() => {
    process.kill(pid, 0);
  }).toThrow();
}

describe("createExtractor", () => {
  // source: PDF and Word bytes are decompressed in a child, not in the server process.
  it("reads the sample PDF and the sample Word file", async () => {
    const extractor = createExtractor({ onSpawn: track });
    await expect(extractor.run(pdfJob)).resolves.toContain("Hello from the sample PDF");
    await expect(extractor.run(docxJob)).resolves.toContain("Hello from the sample document");
  });

  // source: a child that never replies is killed when the timeout fires.
  it("kills a child that does not reply before the timeout", async () => {
    let pid = 0;
    const extractor = createExtractor({
      childPath: hangPath,
      timeoutMs: 500,
      onSpawn(next) {
        pid = next;
        track(next);
      },
    });
    const started = Date.now();
    await expect(extractor.run(tinyPdf)).rejects.toMatchObject({ name: "ExtractError", code: "too_complex" });
    expect(Date.now() - started).toBeLessThan(3_000);
    expectGone(pid);
  });

  // source: a child whose resident memory passes the cap is killed before the timeout.
  it("kills a child that grows past the memory cap", async () => {
    let pid = 0;
    const extractor = createExtractor({
      childPath: growPath,
      maxRssMb: 96,
      timeoutMs: 20_000,
      heapMb: 8192,
      pollMs: 50,
      onSpawn(next) {
        pid = next;
        track(next);
      },
    });
    const started = Date.now();
    await expect(extractor.run(tinyPdf)).rejects.toMatchObject({ name: "ExtractError", code: "too_complex" });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(pid).toBeGreaterThan(0);
  }, 30_000);

  // source: a child that exits without a reply is too complex, including a heap crash.
  it("rejects when the child exits before it replies", async () => {
    const extractor = createExtractor({ childPath: crashPath, onSpawn: track });
    await expect(extractor.run(tinyPdf)).rejects.toMatchObject({ name: "ExtractError", code: "too_complex" });
  });

  // source: one extraction runs at a time, and the same extractor accepts a job after that child exits.
  it("rejects a second job while one is running and accepts a job after it ends", async () => {
    let seen = 0;
    let opened: () => void = () => {};
    let openedGate = new Promise<void>((resolve) => {
      opened = resolve;
    });
    const extractor = createExtractor({
      childPath: hangPath,
      timeoutMs: 20_000,
      onSpawn(pid) {
        track(pid);
        seen += 1;
        opened();
      },
    });
    const firstController = new AbortController();
    const first = extractor.run(tinyPdf, firstController.signal);
    await openedGate;
    await expect(extractor.run(tinyPdf)).rejects.toMatchObject({ name: "ExtractError", code: "busy" });
    expect(extractor.busy).toBe(true);
    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: "ExtractError", code: "aborted" });
    expect(extractor.busy).toBe(false);
    openedGate = new Promise<void>((resolve) => {
      opened = resolve;
    });
    const secondController = new AbortController();
    const second = extractor.run(tinyPdf, secondController.signal);
    await openedGate;
    expect(seen).toBe(2);
    expect(extractor.busy).toBe(true);
    secondController.abort();
    await expect(second).rejects.toMatchObject({ name: "ExtractError", code: "aborted" });
  });

  // source: aborting the caller kills the child and rejects aborted.
  it("kills the child when the signal aborts", async () => {
    let opened: (pid: number) => void = () => {};
    const spawned = new Promise<number>((resolve) => {
      opened = resolve;
    });
    const extractor = createExtractor({
      childPath: hangPath,
      timeoutMs: 20_000,
      onSpawn(pid) {
        track(pid);
        opened(pid);
      },
    });
    const controller = new AbortController();
    const pending = extractor.run(tinyPdf, controller.signal);
    const pid = await spawned;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "ExtractError", code: "aborted" });
    expectGone(pid);
  });

  // source: a PDF whose compressed stream inflates past the memory cap is killed in the child.
  it("kills a PDF that inflates past the memory cap", async () => {
    const bomb = await pdfBomb(400 * 1024 * 1024);
    let pid = 0;
    const extractor = createExtractor({
      maxRssMb: 128,
      timeoutMs: 20_000,
      heapMb: 4096,
      pollMs: 50,
      onSpawn(next) {
        pid = next;
        track(next);
      },
    });
    const started = Date.now();
    await expect(extractor.run({ kind: "pdf", data: bomb })).rejects.toMatchObject({
      name: "ExtractError",
      code: "too_complex",
    });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(pid).toBeGreaterThan(0);
  }, 30_000);
});
