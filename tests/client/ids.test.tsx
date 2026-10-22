// source: push review REJECT of cd3ac7e (05:16 PT 2026-10-22): crypto.randomUUID is undefined on plain-http hosts and the public form crashed.
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomId } from "@/lib/ids";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("randomId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses crypto.randomUUID when the browser offers it", () => {
    const randomUUID = vi.fn(() => "11111111-2222-4333-8444-555555555555");
    vi.stubGlobal("crypto", { randomUUID, getRandomValues: () => { throw new Error("not expected"); } });
    expect(randomId()).toBe("11111111-2222-4333-8444-555555555555");
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("still returns a v4 UUID when crypto.randomUUID is missing, as on a plain-http host", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => real.getRandomValues(a) });
    expect(typeof globalThis.crypto.randomUUID).toBe("undefined");
    const a = randomId();
    const b = randomId();
    expect(a).toMatch(V4);
    expect(b).toMatch(V4);
    expect(a).not.toBe(b);
  });
});
