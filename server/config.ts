import { existsSync } from "node:fs";
import { isIP } from "node:net";

export interface Config {
  nodeEnv: "development" | "production" | "test";
  host: string;
  port: number;
  publicUrl: string | null;
  dataDir: string;
  databaseUrl: string | null;
  adminPassword: string;
  sessionSecret: string;
  trustProxy: false | number | string;
  webhookSecret: string | null;
  ai: {
    baseUrl: string | null;
    apiKey: string | null;
    model: string | null;
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const PROXY_NAMES = new Set(["loopback", "linklocal", "uniquelocal"]);

function optional(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  return value;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isTrustToken(token: string): boolean {
  if (PROXY_NAMES.has(token)) return true;
  const slash = token.lastIndexOf("/");
  if (slash === -1) return isIP(token) !== 0;
  const addr = token.slice(0, slash);
  const prefixText = token.slice(slash + 1);
  if (!/^\d+$/.test(prefixText)) return false;
  const bits = Number(prefixText);
  const kind = isIP(addr);
  if (kind === 4) return bits >= 0 && bits <= 32;
  if (kind === 6) return bits >= 0 && bits <= 128;
  return false;
}

function readTrustProxy(raw: string | undefined, problems: string[]): false | number | string {
  if (raw === undefined || raw === "" || raw === "false") return false;
  if (raw === "true") {
    problems.push(
      'TRUST_PROXY cannot be "true" because trusting every hop lets any visitor fake their address. Use 1 for a single reverse proxy or tunnel.',
    );
    return false;
  }
  if (/^[1-9]\d*$/.test(raw)) {
    const hops = Number(raw);
    if (hops >= 1 && hops <= 10) return hops;
  }
  const parts = raw.split(",");
  if (parts.length > 0 && parts.every((part) => isTrustToken(part.trim()))) return raw;
  problems.push(
    "TRUST_PROXY must be unset, false, a whole number from 1 to 10, or a comma-separated list of IP addresses, CIDR ranges, or the names loopback, linklocal, and uniquelocal.",
  );
  return false;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = [];
  const nodeEnvRaw = env.NODE_ENV;
  let nodeEnv: Config["nodeEnv"] = "development";
  if (nodeEnvRaw !== undefined && nodeEnvRaw !== "") {
    if (nodeEnvRaw === "development" || nodeEnvRaw === "production" || nodeEnvRaw === "test") {
      nodeEnv = nodeEnvRaw;
    } else {
      problems.push("NODE_ENV must be development, production, or test.");
    }
  }

  const host =
    env.HOST === undefined || env.HOST === ""
      ? nodeEnv === "production"
        ? "0.0.0.0"
        : "127.0.0.1"
      : env.HOST;

  let port = 3000;
  if (env.PORT !== undefined && env.PORT !== "") {
    if (!/^\d+$/.test(env.PORT)) {
      problems.push("PORT must be a whole number from 1 to 65535.");
    } else {
      const parsed = Number(env.PORT);
      if (parsed < 1 || parsed > 65535) {
        problems.push("PORT must be a whole number from 1 to 65535.");
      } else {
        port = parsed;
      }
    }
  }

  let publicUrl: string | null = null;
  if (env.PUBLIC_URL !== undefined && env.PUBLIC_URL !== "") {
    if (env.PUBLIC_URL.endsWith("/") || !isHttpUrl(env.PUBLIC_URL)) {
      problems.push("PUBLIC_URL must be an http or https URL without a trailing slash.");
    } else {
      publicUrl = env.PUBLIC_URL;
    }
  }

  const dataDir = env.DATA_DIR === undefined || env.DATA_DIR === "" ? "./data" : env.DATA_DIR;

  let databaseUrl: string | null = null;
  if (env.DATABASE_URL !== undefined && env.DATABASE_URL !== "") {
    if (!env.DATABASE_URL.startsWith("postgres://") && !env.DATABASE_URL.startsWith("postgresql://")) {
      problems.push("DATABASE_URL must start with postgres:// or postgresql://.");
    } else {
      databaseUrl = env.DATABASE_URL;
    }
  }

  const adminPassword = env.ADMIN_PASSWORD ?? "";
  if (adminPassword === "") {
    problems.push("ADMIN_PASSWORD is missing. Set it to at least 12 characters, or run bun run setup.");
  } else if (adminPassword.length < 12) {
    problems.push(
      "ADMIN_PASSWORD must be at least 12 characters. Set a longer value, or run bun run setup --force to replace the password and the session secret.",
    );
  }

  const sessionSecret = env.SESSION_SECRET ?? "";
  if (sessionSecret === "") {
    problems.push("SESSION_SECRET is missing. Set it to at least 32 characters, or run bun run setup.");
  } else if (sessionSecret.length < 32) {
    problems.push("SESSION_SECRET must be at least 32 characters. Run bun run setup.");
  }

  const trustProxy = readTrustProxy(env.TRUST_PROXY, problems);

  if (problems.length > 0) {
    throw new ConfigError(`${problems.join("\n")}\nRun bun run setup.`);
  }

  return {
    nodeEnv,
    host,
    port,
    publicUrl,
    dataDir,
    databaseUrl,
    adminPassword,
    sessionSecret,
    trustProxy,
    webhookSecret: optional(env.WEBHOOK_SECRET),
    ai: {
      baseUrl: optional(env.AI_BASE_URL),
      apiKey: optional(env.AI_API_KEY),
      model: optional(env.AI_MODEL),
    },
  };
}

export function loadDotEnv(filePath?: string): void {
  const target = filePath ?? ".env";
  if (existsSync(target)) {
    process.loadEnvFile(target);
  }
}
