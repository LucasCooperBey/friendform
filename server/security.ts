import type { IncomingMessage } from "node:http";
import type { Response, RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import type { Config } from "./config";
import { log } from "./log";

let warnedAboutProxy = false;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

const LIBRARY_CSP_FALLBACK = "default-src 'none'";

function requestPath(req: IncomingMessage): string {
  if ("originalUrl" in req && typeof req.originalUrl === "string" && req.originalUrl.length > 0) {
    return req.originalUrl;
  }
  return req.url ?? "";
}

// Express finalhandler, send, and serve-static call setHeader with exactly this
// value on their own 404 and error documents, after helmet has already run.
// A terminal 404 inside createApp would also run before server/index.ts mounts
// the client, so unmatched paths must keep falling through.
function keepHelmetContentSecurityPolicy(res: Response, nodeEnv: Config["nodeEnv"]): void {
  const original = res.setHeader.bind(res);
  res.setHeader = ((name: string, value: number | string | readonly string[]) => {
    if (typeof name === "string" && name.toLowerCase() === "content-security-policy") {
      const text = typeof value === "string" ? value : Array.isArray(value) ? value.map(String).join("; ") : "";
      const libraryFallback = text === LIBRARY_CSP_FALLBACK;
      if (libraryFallback && (nodeEnv !== "production" || res.getHeader(name) !== undefined)) return res;
    }
    return original(name, value);
  }) as typeof res.setHeader;
}

export function securityHeaders(config: Config): RequestHandler {
  const headers = helmet({
    frameguard: false,
    contentSecurityPolicy: config.nodeEnv === "production" ? {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: [(req) => requestPath(req).startsWith("/f/") ? "*" : "'none'"],
      },
    } : false,
  });
  return (req, res, next) => {
    keepHelmetContentSecurityPolicy(res, config.nodeEnv);
    headers(req, res, next);
  };
}

export function apiSecurity(config: Config): RequestHandler {
  return (req, res, next) => {
    if (!config.trustProxy && req.get("x-forwarded-for") && !warnedAboutProxy) {
      warnedAboutProxy = true;
      log.warn("Requests arrive through a proxy but TRUST_PROXY is not set, so rate limits see one address for every visitor. Set TRUST_PROXY=1 for one proxy hop.");
    }
    if (WRITE_METHODS.has(req.method)) {
      const site = req.get("sec-fetch-site");
      const origin = req.get("origin");
      const allowed = [originOf(`${req.protocol}://${req.host}`)];
      if (config.publicUrl) allowed.push(originOf(config.publicUrl));
      const normalized = origin === undefined ? undefined : originOf(origin);
      if (site === "cross-site" || site === "same-site" ||
          (normalized !== undefined && (normalized === null || !allowed.includes(normalized)))) {
        res.status(403).json({ error: "forbidden_origin" });
        return;
      }
      const hasBody = Number(req.get("content-length") ?? 0) > 0 || req.get("transfer-encoding") !== undefined;
      if (hasBody && !req.is("application/json")) {
        res.status(415).json({ error: "unsupported_media_type" });
        return;
      }
    }
    next();
  };
}

export function limiter(limit: number, windowMs: number, perForm = false): RequestHandler {
  return rateLimit({
    limit,
    windowMs,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "too_many_requests" },
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? "unknown") +
      (perForm ? `:${String(req.params.slug)}` : ""),
  });
}

export function issuesOnly(error: z.ZodError): Array<{ path: PropertyKey[]; message: string }> {
  return error.issues.map(({ path, message }) => ({ path, message }));
}

export const emptyQuery: RequestHandler = (req, res, next) => {
  const result = z.object({}).safeParse(req.query);
  if (!result.success) {
    res.status(400).json({ error: "invalid_body", issues: issuesOnly(result.error) });
    return;
  }
  next();
};

export const emptyBody: RequestHandler = (req, res, next) => {
  const result = z.object({}).optional().safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: "invalid_body", issues: issuesOnly(result.error) });
    return;
  }
  next();
};
