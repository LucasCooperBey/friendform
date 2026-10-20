import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, jsonBody, readJson, testConfig, type TestApp } from "./helpers";

const apps: TestApp[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
async function start(...args: Parameters<typeof createTestApp>) {
  const app = await createTestApp(...args); apps.push(app); return app;
}

describe("owner authentication", () => {
  it("signs the specified payload, sets cookie attributes, exposes session fields and logs out", async () => {
    // source: auth cookie wire format and authenticated session response.
    const now = new Date("2026-01-01T00:00:00Z");
    const config = testConfig({ publicUrl: "https://forms.example", ai: { baseUrl: null, apiKey: "test-key", model: "test-model" } });
    const app = await start({ config, now: () => now });
    expect(await readJson(await app.request("/api/auth/session"))).toEqual({ authenticated: false });
    const login = await app.login();
    expect(login.status).toBe(204);
    const cookie = login.headers.get("set-cookie") ?? "";
    for (const attr of ["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=2592000"]) expect(cookie).toContain(attr);
    expect(cookie).not.toContain("Secure");
    const token = cookie.split(";")[0]?.slice("ff_session=".length) ?? "";
    const [payload = "", signature] = token.split(".");
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({ v: 1, exp: now.getTime() / 1000 + 2592000 });
    const key = createHmac("sha256", config.sessionSecret).update(`friendform-session:${config.adminPassword}`).digest();
    expect(signature).toBe(createHmac("sha256", key).update(payload).digest("base64url"));
    expect(await readJson(await app.request("/api/auth/session"))).toEqual({ authenticated: true, publicUrl: config.publicUrl, aiEnabled: true });
    const logout = await app.request("/api/auth/logout", { method: "POST" });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Expires=Thu, 01 Jan 1970");
    expect(await readJson(await app.request("/api/auth/session"))).toEqual({ authenticated: false });
  });

  it("rejects malformed bodies and passwords and limits the fourth login attempt", async () => {
    // source: login validation and loginPer15Min override.
    const app = await start({ limits: { loginPer15Min: 3 } });
    for (const body of [{}, { password: 3 }]) {
      expect(await readJson(await app.request("/api/auth/login", jsonBody(body)), 400)).toEqual({ error: "invalid_body" });
    }
    expect(await readJson(await app.request("/api/auth/login", jsonBody({ password: "wrong" })), 401)).toEqual({ error: "invalid_password" });
    const limited = await app.login();
    expect(await readJson(limited, 429)).toEqual({ error: "too_many_requests" });
    expect(limited.headers.get("ratelimit")).toBeTruthy();
    expect(limited.headers.get("x-ratelimit-limit")).toBeNull();
  });

  it("rejects tampering and an expired session", async () => {
    // source: session HMAC and exp are both required.
    let now = new Date("2026-01-01T00:00:00Z");
    const app = await start({ now: () => now });
    const cookie = (await app.login()).headers.get("set-cookie")?.split(";")[0] ?? "";
    const dot = cookie.indexOf(".");
    const tampered = cookie.slice(0, dot + 1) + (cookie[dot + 1] === "a" ? "b" : "a") + cookie.slice(dot + 2);
    expect(await readJson(await app.request("/api/auth/session", { headers: { Cookie: tampered } }))).toEqual({ authenticated: false });
    expect(await readJson(await app.request("/api/auth/session"))).toEqual({ authenticated: true, publicUrl: null, aiEnabled: false });
    now = new Date("2026-02-01T00:00:00Z");
    expect(await readJson(await app.request("/api/auth/session"))).toEqual({ authenticated: false });
    expect(await readJson(await app.request("/api/forms"), 401)).toEqual({ error: "unauthorized" });
  });

  it.each(["adminPassword", "sessionSecret"] as const)("invalidates existing cookies when %s changes", async (field) => {
    // source: both credentials participate in the derived signing key.
    const original = await start();
    const cookie = (await original.login()).headers.get("set-cookie")?.split(";")[0] ?? "";
    await original.close(); apps.splice(apps.indexOf(original), 1);
    const changed = await start({ config: testConfig({ [field]: "replacement".repeat(5) }) });
    expect(await readJson(await changed.request("/api/auth/session", { headers: { cookie } }))).toEqual({ authenticated: false });
  });

  it("requires a session on every owner route", async () => {
    // source: all forms, versions, submissions, exports, stats and webhook routes are owner-only.
    const app = await start();
    const base = "/api/forms/00000000-0000-4000-8000-000000000001";
    const routes = [
      ["GET", "/api/forms"], ["POST", "/api/forms"], ["GET", base], ["PATCH", base], ["DELETE", base],
      ...["duplicate", "publish", "close", "reopen", "versions/00000000-0000-4000-8000-000000000002/restore", "webhooks/test/test"].map((path) => ["POST", `${base}/${path}`]),
      ...["versions", "submissions", "submissions/00000000-0000-4000-8000-000000000002", "export.csv", "stats", "webhooks/deliveries"].map((path) => ["GET", `${base}/${path}`]),
      ["DELETE", `${base}/submissions/00000000-0000-4000-8000-000000000002`],
    ];
    for (const [method, path] of routes) {
      expect(await readJson(await app.request(path ?? "", { method }), 401)).toEqual({ error: "unauthorized" });
    }
  });
});
