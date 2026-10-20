import express from "express";
import helmet from "helmet";
import type { Config } from "./config";
import type { DbHandle } from "./db/index";

export interface AppDeps {
  config: Config;
  db: DbHandle;
}

const VERSION = "0.1.0";

function errorType(err: unknown): string | null {
  if (typeof err !== "object" || err === null || !("type" in err)) return null;
  return typeof err.type === "string" ? err.type : null;
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
    if (res.headersSent) return;
    const type = errorType(err);
    if (type === "entity.parse.failed") {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
    if (type === "entity.too.large") {
      res.status(413).json({ error: "payload_too_large" });
      return;
    }
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
