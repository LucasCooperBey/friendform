// source: server/log.ts writes one log entry per line

import { describe, expect, it, vi } from "vitest";
import { log } from "../../server/log";

describe("log", () => {
  it("replaces carriage returns and line feeds in the message", () => {
    // source: log replaces every carriage return and line feed in the message with the two characters \\n
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let written = "";
    try {
      log.error("line1\r\nline2\nline3", { ok: true });
      written = spy.mock.calls.map((call) => String(call[0])).join("");
    } finally {
      spy.mockRestore();
    }
    expect(written).toBe('error line1\\n\\nline2\\nline3 {"ok":true}\n');
  });
});
