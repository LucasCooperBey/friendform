// source: server/config.ts defaults, required variables, and TRUST_PROXY

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, loadConfig, loadDotEnv } from "../../server/config";

const password = "p".repeat(12);
const secret = "s".repeat(32);

function validEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ADMIN_PASSWORD: password, SESSION_SECRET: secret, ...extra };
}

function messageOf(env: NodeJS.ProcessEnv): string {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    if (err instanceof ConfigError) return err.message;
  }
  throw new Error("expected ConfigError");
}

describe("loadConfig", () => {
  it("uses development defaults when only the required secrets are set", () => {
    // source: NODE_ENV, HOST, PORT, and optional values have documented defaults
    expect(loadConfig(validEnv())).toEqual({
      nodeEnv: "development",
      host: "127.0.0.1",
      port: 3000,
      publicUrl: null,
      dataDir: "./data",
      databaseUrl: null,
      adminPassword: password,
      sessionSecret: secret,
      trustProxy: false,
      webhookSecret: null,
      ai: { baseUrl: null, apiKey: null, model: null },
    });
    expect(loadConfig(validEnv({ NODE_ENV: "test" })).host).toBe("127.0.0.1");
    expect(loadConfig(validEnv({ NODE_ENV: "production" })).host).toBe("0.0.0.0");
    expect(loadConfig(validEnv({ NODE_ENV: "production", HOST: "127.0.0.1" })).host).toBe("127.0.0.1");
  });

  it("names every missing or invalid variable and tells you to run setup", () => {
    // source: ConfigError names ADMIN_PASSWORD, SESSION_SECRET, and the other invalid variables
    const message = messageOf({
      NODE_ENV: "staging",
      PORT: "nope",
      PUBLIC_URL: "http://127.0.0.1:3000/",
      DATABASE_URL: "mysql://localhost/friendform",
      ADMIN_PASSWORD: "short",
      SESSION_SECRET: "tiny",
    });
    expect(message).toContain("NODE_ENV");
    expect(message).toContain("PORT");
    expect(message).toContain("PUBLIC_URL");
    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("ADMIN_PASSWORD");
    expect(message).toContain("SESSION_SECRET");
    expect(message).toContain("Run bun run setup.");
  });

  it("accepts each TRUST_PROXY form and rejects true", () => {
    // source: TRUST_PROXY is false, a hop count from 1 to 10, or a trusted address list
    expect(loadConfig(validEnv()).trustProxy).toBe(false);
    expect(loadConfig(validEnv({ TRUST_PROXY: "false" })).trustProxy).toBe(false);
    expect(loadConfig(validEnv({ TRUST_PROXY: "1" })).trustProxy).toBe(1);
    expect(loadConfig(validEnv({ TRUST_PROXY: "10" })).trustProxy).toBe(10);
    expect(loadConfig(validEnv({ TRUST_PROXY: "loopback" })).trustProxy).toBe("loopback");
    expect(loadConfig(validEnv({ TRUST_PROXY: "127.0.0.1" })).trustProxy).toBe("127.0.0.1");
    expect(loadConfig(validEnv({ TRUST_PROXY: "10.0.0.0/8" })).trustProxy).toBe("10.0.0.0/8");
    expect(loadConfig(validEnv({ TRUST_PROXY: "::1" })).trustProxy).toBe("::1");
    expect(loadConfig(validEnv({ TRUST_PROXY: "linklocal,uniquelocal" })).trustProxy).toBe("linklocal,uniquelocal");
    const rejected = messageOf(validEnv({ TRUST_PROXY: "true" }));
    expect(rejected).toContain("TRUST_PROXY");
    expect(rejected).toContain("1");
    expect(messageOf(validEnv({ TRUST_PROXY: "11" }))).toContain("TRUST_PROXY");
    expect(messageOf(validEnv({ TRUST_PROXY: "0" }))).toContain("TRUST_PROXY");
    expect(messageOf(validEnv({ TRUST_PROXY: "not-a-host" }))).toContain("TRUST_PROXY");
  });

  it("keeps optional AI settings and a postgres URL", () => {
    // source: DATABASE_URL, PUBLIC_URL, and AI variables are optional when valid
    const config = loadConfig(
      validEnv({
        PORT: "4000",
        PUBLIC_URL: "https://forms.invalid",
        DATABASE_URL: "postgresql://localhost:5432/friendform_test",
        WEBHOOK_SECRET: "hook",
        AI_BASE_URL: "https://api.invalid/v1",
        AI_API_KEY: "key",
        AI_MODEL: "small",
      }),
    );
    expect(config.port).toBe(4000);
    expect(config.publicUrl).toBe("https://forms.invalid");
    expect(config.databaseUrl).toBe("postgresql://localhost:5432/friendform_test");
    expect(config.webhookSecret).toBe("hook");
    expect(config.ai).toEqual({
      baseUrl: "https://api.invalid/v1",
      apiKey: "key",
      model: "small",
    });
  });
});

describe("loadDotEnv", () => {
  const key = "FRIENDFORM_LOAD_DOTENV_PROBE";
  const previous = process.env[key];

  afterEach(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });

  it("loads an existing file and skips a missing one", () => {
    // source: loadDotEnv calls loadEnvFile only when the file exists
    delete process.env[key];
    const dir = mkdtempSync(path.join(tmpdir(), "friendform-dotenv-"));
    const missing = path.join(dir, "missing.env");
    loadDotEnv(missing);
    expect(process.env[key]).toBeUndefined();
    const file = path.join(dir, "present.env");
    writeFileSync(file, `${key}=loaded\n`);
    loadDotEnv(file);
    expect(process.env[key]).toBe("loaded");
  });
});
