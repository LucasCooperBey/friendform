import path from "node:path";
import express from "express";
import { ConfigError, loadConfig, loadDotEnv } from "./config";
import { createApp } from "./app";
import { openDb } from "./db/index";
import { log } from "./log";

async function mountClient(app: express.Express, nodeEnv: "development" | "production" | "test"): Promise<void> {
  if (nodeEnv === "development") {
    const vite = await import("vite");
    const devServer = await vite.createServer({
      configFile: path.resolve(process.cwd(), "vite.config.ts"),
      root: path.resolve(process.cwd(), "client"),
      appType: "spa",
      server: { middlewareMode: true },
    });
    app.use(devServer.middlewares);
    return;
  }

  const publicDir = path.resolve(process.cwd(), "dist/public");
  app.use(express.static(publicDir));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (req.path === "/api" || req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(path.join(publicDir, "index.html"), (err) => {
      if (!err || res.headersSent) return;
      res.status(500).json({ error: "internal_error" });
    });
  });
}

async function main(): Promise<void> {
  loadDotEnv();
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const db = await openDb({
    databaseUrl: config.databaseUrl,
    dataDir: config.dataDir,
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });
  const app = createApp({ config, db });
  await mountClient(app, config.nodeEnv);

  const server = app.listen(config.port, config.host, () => {
    log.info("listening", { url: `http://${config.host}:${config.port}` });
  });

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    server.close();
    try {
      await db.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "server failed to start";
  log.error(message);
  process.exit(1);
});
