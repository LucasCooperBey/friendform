import express from "express";
import helmet from "helmet";
import type { Config } from "./config";
import type { DbHandle } from "./db/index";
import { log } from "./log";

export interface AppDeps {
  config: Config;
  db: DbHandle;
}

const VERSION = "0.1.0";

function errorType(err: unknown): string | null {
  if (typeof err !== "object" || err === null || !("type" in err)) return null;
  return typeof err.type === "string" ? err.type : null;
}

function readCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("code" in value)) return undefined;
  return typeof value.code === "string" ? value.code : undefined;
}

function readCauseCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("cause" in value)) return undefined;
  return readCode(value.cause);
}

function requestFailureFields(err: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  if (err instanceof Error) fields.name = err.name;
  const code = readCode(err);
  const causeCode = readCauseCode(err);
  if (code !== undefined) fields.code = code;
  if (causeCode !== undefined) fields.causeCode = causeCode;
  return fields;
}

function clientStatus(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  if ("status" in err) {
    const status = integerStatus(err.status);
    if (status !== null) return status;
  }
  if ("statusCode" in err) return integerStatus(err.statusCode);
  return null;
}

function integerStatus(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 400 || value > 499) return null;
  return value;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "512kb" }));

  app.get("/api/health", (_req, res) => {
    res.status(200).json({
      ok: true,
      db: deps.db.kind,
      version: VERSION,
    });
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const type = errorType(err);
    if (type === "entity.parse.failed") {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
    if (type === "entity.too.large") {
      res.status(413).json({ error: "payload_too_large" });
      return;
    }
    if (type === "charset.unsupported" || type === "encoding.unsupported") {
      res.status(415).json({ error: "unsupported_media_type" });
      return;
    }
    const status = clientStatus(err);
    if (status !== null) {
      res.status(status).json({ error: "bad_request" });
      return;
    }
    log.error("request_failed", requestFailureFields(err));
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
