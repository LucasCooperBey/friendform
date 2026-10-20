// source: scripts/setup.ts fillEnv and the on-disk mode of .env

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fillEnv } from "../../scripts/setup";

function randomBytes(n: number): Buffer {
  return Buffer.alloc(n, 0);
}

function rejectingThenZero(): (n: number) => Buffer {
  let calls = 0;
  return (n: number) => {
    calls += 1;
    return Buffer.alloc(n, calls === 1 ? 255 : 0);
  };
}

describe("fillEnv", () => {
  it("writes a new file with a password, a session secret, and commented optional variables", () => {
    // source: a missing file gets ADMIN_PASSWORD, SESSION_SECRET, and a comment for each optional variable
    const random = rejectingThenZero();
    const result = fillEnv(null, { random });
    expect(result.changed).toBe(true);
    expect(result.password).toBe("A".repeat(24));
    expect(result.text).toContain(`ADMIN_PASSWORD=${"A".repeat(24)}`);
    expect(result.text).toContain(`SESSION_SECRET=${"00".repeat(24)}`);
    for (const name of [
      "NODE_ENV",
      "HOST",
      "PORT",
      "PUBLIC_URL",
      "DATA_DIR",
      "DATABASE_URL",
      "TRUST_PROXY",
      "WEBHOOK_SECRET",
      "AI_BASE_URL",
      "AI_API_KEY",
      "AI_MODEL",
    ]) {
      expect(result.text).toMatch(new RegExp(`^# ${name}=`, "m"));
    }
  });

  it("fills blank secrets in a copy of .env.example and keeps every other line", () => {
    // source: an existing file keeps comments and values, and fills only blank secrets
    const example = readFileSync(path.resolve(".env.example"), "utf8");
    const result = fillEnv(example, { random: randomBytes });
    expect(result.changed).toBe(true);
    expect(result.password).toBe("A".repeat(24));
    const originalLines = example.split("\n").filter((line) => line !== "");
    const nextLines = result.text.split("\n").filter((line) => line !== "");
    const keep = (line: string) => !line.startsWith("ADMIN_PASSWORD=") && !line.startsWith("SESSION_SECRET=");
    expect(nextLines.filter(keep)).toEqual(originalLines.filter(keep));
    expect(result.text).toContain("# Owner password, at least 12 characters. bun run setup fills this in.");
  });

  it("leaves a complete file unchanged and replaces both secrets when forced", () => {
    // source: a complete file is unchanged, and force replaces the password and session secret
    const complete = `HOST=127.0.0.1\nADMIN_PASSWORD=${"p".repeat(12)}\nSESSION_SECRET=${"s".repeat(32)}\n`;
    const unchanged = fillEnv(complete, {
      random: () => {
        throw new Error("random should not be called");
      },
    });
    expect(unchanged).toEqual({ text: complete, password: null, changed: false });
    const forced = fillEnv(complete, { force: true, random: randomBytes });
    expect(forced.changed).toBe(true);
    expect(forced.password).toBe("A".repeat(24));
    expect(forced.text).toContain("HOST=127.0.0.1");
    expect(forced.text).toContain(`ADMIN_PASSWORD=${"A".repeat(24)}`);
    expect(forced.text).not.toContain(`ADMIN_PASSWORD=${"p".repeat(12)}`);
  });
});

function runSetup(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(path.resolve("node_modules/.bin/tsx"), [path.resolve("scripts/setup.ts"), ...args], {
    cwd,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("setup script", () => {
  it("writes .env with mode 0600 and prints the generated password", () => {
    // source: setup writes .env as mode 0600 and prints the owner password when it generates one
    const dir = mkdtempSync(path.join(tmpdir(), "friendform-setup-"));
    const result = runSetup(dir, []);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^Owner password: [A-Za-z0-9]{24} \(saved in \.env\)\n$/);
    expect(statSync(path.join(dir, ".env")).mode & 0o777).toBe(0o600);
  });

  it("prints nothing with --ensure when the file already has both secrets, and still sets mode 0600", () => {
    // source: --ensure is silent when there is nothing to do, and an existing file is chmodded to 0600
    const dir = mkdtempSync(path.join(tmpdir(), "friendform-setup-"));
    const envPath = path.join(dir, ".env");
    const text = `HOST=127.0.0.1\nADMIN_PASSWORD=${"p".repeat(12)}\nSESSION_SECRET=${"s".repeat(32)}\n`;
    writeFileSync(envPath, text, { mode: 0o644 });
    const result = runSetup(dir, ["--ensure"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(readFileSync(envPath, "utf8")).toBe(text);
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
  });
});
