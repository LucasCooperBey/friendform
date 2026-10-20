import { afterEach, expect, it, vi } from "vitest";
import { log } from "../../server/log";
import { createTestApp, jsonBody, readJson, testConfig, type TestApp } from "./helpers";

let app: TestApp | undefined;
afterEach(async () => { await app?.close(); app = undefined; vi.restoreAllMocks(); });

it("blocks foreign origins and cross-site and same-site fetches before parsing a body", async () => {
  // source: mutating API requests reject foreign Origin and both disallowed Sec-Fetch-Site values.
  app = await createTestApp();
  const blockedHeaders: Array<Record<string, string>> = [
    { Origin: "https://foreign.example" }, { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" },
  ];
  for (const headers of blockedHeaders) {
    const response = await app.request("/api/auth/login", {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{broken",
    });
    expect(await readJson(response, 403)).toEqual({ error: "forbidden_origin" });
  }
  expect((await app.request("/api/auth/login", {
    ...jsonBody({ password: "correct horse battery" }),
    headers: { Origin: app.url, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
  })).status).toBe(204);
});

it("accepts the normalized PUBLIC_URL origin and keeps the incoming host port", async () => {
  // source: normalized allowed origins include PUBLIC_URL and req.host including its port.
  app = await createTestApp({ config: testConfig({ publicUrl: "https://forms.example/path" }) });
  const send = (origin: string) => app!.request("/api/auth/login", {
    ...jsonBody({ password: "correct horse battery" }), headers: { "Content-Type": "application/json", Origin: origin },
  });
  expect((await send("HTTPS://FORMS.EXAMPLE:443")).status).toBe(204);
  expect((await send(app.url)).status).toBe(204);
  expect(await readJson(await send("http://127.0.0.1"), 403)).toEqual({ error: "forbidden_origin" });
});

it.each([false, 1] as const)("trustProxy=%s controls forwarded origin and Secure cookies", async (trustProxy) => {
  // source: forwarded protocol and host are trusted only when configured.
  app = await createTestApp({ config: testConfig({ trustProxy }) });
  const response = await app.request("/api/auth/login", {
    ...jsonBody({ password: "correct horse battery" }), headers: {
      "Content-Type": "application/json", "X-Forwarded-Host": "proxy.example:8443",
      "X-Forwarded-Proto": "https", Origin: "https://proxy.example:8443",
    },
  });
  if (trustProxy) {
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Secure");
  } else expect(await readJson(response, 403)).toEqual({ error: "forbidden_origin" });
});

it("warns once across apps when an untrusted proxy sends X-Forwarded-For", async () => {
  // source: the TRUST_PROXY diagnostic is emitted once per process, never per request.
  const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
  const expected = "Requests arrive through a proxy but TRUST_PROXY is not set, so rate limits see one address for every visitor. Set TRUST_PROXY=1 for one proxy hop.";
  app = await createTestApp();
  for (let index = 0; index < 2; index++) {
    expect((await app.request("/api/health", { headers: { "X-Forwarded-For": "192.0.2.1" } })).status).toBe(200);
  }
  await app.close(); app = undefined;
  app = await createTestApp();
  expect((await app.request("/api/health", { headers: { "X-Forwarded-For": "192.0.2.2" } })).status).toBe(200);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith(expected);
});

it("rejects non-JSON bodies but permits bodyless mutation requests", async () => {
  // source: Content-Length or Transfer-Encoding requires application/json on mutating API requests.
  app = await createTestApp();
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    expect(await readJson(await app.request("/api/auth/logout", {
      method, headers: { "Content-Type": "text/plain" }, body: "payload",
    }), 415)).toEqual({ error: "unsupported_media_type" });
  }
  expect((await app.request("/api/auth/logout", { method: "POST" })).status).toBe(204);
});

it.each(["test", "development", "production"] as const)("sets the exact framing and CSP policy in %s", async (nodeEnv) => {
  // source: only production emits CSP; /f/ can be framed; defaults must not add upgrade-insecure-requests.
  app = await createTestApp({ config: testConfig({ nodeEnv }) });
  for (const path of ["/api/health", "/f/example"]) {
    const response = await app.request(path);
    expect(response.headers.get("x-frame-options")).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    if (nodeEnv === "production") {
      expect(response.headers.get("content-security-policy")?.split(";").sort()).toEqual([
        "default-src 'self'", "img-src 'self' data: blob:", "style-src 'self' 'unsafe-inline'",
        "script-src 'self'", "connect-src 'self'", "font-src 'self'", "base-uri 'self'", "form-action 'self'",
        "object-src 'none'", `frame-ancestors ${path.startsWith("/f/") ? "*" : "'none'"}`,
      ].sort());
    } else expect(response.headers.get("content-security-policy")).toBeNull();
  }
});
