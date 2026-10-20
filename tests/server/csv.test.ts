import { afterEach, expect, it } from "vitest";
import { csvCell, toCsv } from "../../server/csv";
import type { SubmissionDto } from "../../server/forms-service";
import type { Question } from "../../shared/form-schema";
import { createTestApp, jsonBody, publishForm, readJson, schemaOf, type TestApp } from "./helpers";

let app: TestApp | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

it("guards formula prefixes and quotes cells with the RFC 4180 rules", async () => {
  // source: csvCell prefixes a leading formula character, then quotes commas, quotes, and line breaks.
  expect(csvCell("hello")).toBe("hello");
  expect(csvCell("=1+1")).toBe("'=1+1");
  expect(csvCell("+1")).toBe("'+1");
  expect(csvCell("-1")).toBe("'-1");
  expect(csvCell("@cmd")).toBe("'@cmd");
  expect(csvCell("\t=1")).toBe("'\t=1");
  expect(csvCell("\r=1")).toBe("\"'\r=1\"");
  expect(csvCell("=a,b")).toBe("\"'=a,b\"");
  expect(csvCell("hello, \"world\"")).toBe("\"hello, \"\"world\"\"\"");
  expect(csvCell("a\r\nb")).toBe("\"a\r\nb\"");
  expect(toCsv([["a", "=1"], ["b", "c,d"]])).toBe("\uFEFFa,'=1\r\nb,\"c,d\"\r\n");
});

function parseRow(row: string): string[] {
  const cells: string[] = [];
  let index = 0;
  while (index <= row.length) {
    if (index === row.length) {
      cells.push("");
      break;
    }
    if (row[index] === "\"") {
      let value = "";
      index += 1;
      while (index < row.length) {
        if (row[index] === "\"") {
          if (row[index + 1] === "\"") { value += "\""; index += 2; continue; }
          index += 1;
          break;
        }
        value += row[index];
        index += 1;
      }
      cells.push(value);
      if (row[index] === ",") index += 1;
      else break;
    } else {
      const comma = row.indexOf(",", index);
      if (comma === -1) { cells.push(row.slice(index)); break; }
      cells.push(row.slice(index, comma));
      index = comma + 1;
      if (index === row.length) { cells.push(""); break; }
    }
  }
  return cells;
}

it("exports a BOM CSV with quoting, a formula guard, joined checkboxes, and a removed question", async () => {
  // source: export.csv column order, RFC 4180 cells, checkbox join, plain numbers, and older-version columns. The BOM is checked on the raw bytes because Response.text strips U+FEFF.
  let millis = Date.parse("2026-05-01T00:00:00.000Z");
  app = await createTestApp({ now: () => new Date(millis++) });
  await app.login();
  const versionOne: Question[] = [
    { questionId: "formula", type: "text", prompt: "Formula", required: true },
    { questionId: "note", type: "text", prompt: "Note", required: true },
    { questionId: "colors", type: "checkbox", prompt: "Colors", required: true, metadata: { options: ["red", "blue"] } },
    { questionId: "qty", type: "number", prompt: "Quantity", required: true },
    { questionId: "legacy", type: "text", prompt: "Legacy", required: false },
  ];
  const form = await publishForm(app, { title: "Export", draftSchema: schemaOf(versionOne) });
  expect((await app.request(`/api/public/forms/${form.slug}/submissions`, jsonBody({
    responses: { formula: "=1+1", note: "hello, \"world\"", colors: ["red", "blue"], qty: 1e21, legacy: "old" },
  }))).status).toBe(201);
  const versionTwo: Question[] = [
    { questionId: "formula", type: "text", prompt: "Expression", required: true },
    { questionId: "note", type: "text", prompt: "Note", required: true },
    { questionId: "colors", type: "checkbox", prompt: "Colors", required: true, metadata: { options: ["red", "blue"] } },
    { questionId: "qty", type: "number", prompt: "Quantity", required: true },
  ];
  expect((await app.request(`/api/forms/${form.id}`, jsonBody({ draftSchema: schemaOf(versionTwo) }, "PATCH"))).status).toBe(200);
  expect((await app.request(`/api/forms/${form.id}/publish`, { method: "POST" })).status).toBe(200);
  expect((await app.request(`/api/public/forms/${form.slug}/submissions`, jsonBody({
    responses: { formula: "safe", note: "plain", colors: ["blue"], qty: 2 },
  }))).status).toBe(201);

  const response = await app.request(`/api/forms/${form.id}/export.csv`);
  expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  expect(response.headers.get("content-disposition")).toBe(`attachment; filename="${form.slug}-responses.csv"`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  const text = new TextDecoder("utf-8").decode(bytes.subarray(3));
  expect(text.endsWith("\r\n")).toBe(true);
  expect(text.replace(/\r\n/g, "")).not.toContain("\n");
  const lines = text.slice(0, -2).split("\r\n").map(parseRow);
  expect(lines[0]).toEqual(["Submitted at", "Version", "Expression", "Note", "Colors", "Quantity", "Legacy"]);
  const listed = await readJson<{ submissions: SubmissionDto[] }>(await app.request(`/api/forms/${form.id}/submissions`));
  const byVersion = new Map(listed.submissions.map((row) => [String(row.version), row]));
  const current = lines.find((row) => row[1] === "2");
  const previous = lines.find((row) => row[1] === "1");
  expect(current).toEqual([byVersion.get("2")?.createdAt, "2", "safe", "plain", "blue", "2", ""]);
  expect(previous).toEqual([
    byVersion.get("1")?.createdAt, "1", "'=1+1", "hello, \"world\"", "red; blue", "1000000000000000000000", "old",
  ]);
  expect(text).toContain("\"hello, \"\"world\"\"\"");
  expect(text).toContain("'=1+1");
});
