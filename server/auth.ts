import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { DEFAULT_LIMITS, type AppDeps } from "./app";
import { emptyBody, emptyQuery, limiter } from "./security";

const SESSION_SECONDS = 30 * 24 * 60 * 60;
const signingKeys = new WeakMap<AppDeps, Buffer>();
const payloadZ = z.object({ v: z.literal(1), exp: z.number().int() });

function signingKey(deps: AppDeps): Buffer {
  let key = signingKeys.get(deps);
  if (!key) {
    key = createHmac("sha256", deps.config.sessionSecret)
      .update(`friendform-session:${deps.config.adminPassword}`).digest();
    signingKeys.set(deps, key);
  }
  return key;
}

function signedIn(req: Request, key: Buffer, now: () => Date): boolean {
  const cookie = req.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith("ff_session="))?.slice("ff_session=".length);
  if (!cookie) return false;
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(cookie);
  if (!match?.[1] || !match[2]) return false;
  const expected = createHmac("sha256", key).update(match[1]).digest();
  const supplied = Buffer.from(match[2], "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
  try {
    const payload = payloadZ.safeParse(JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")));
    return payload.success && payload.data.exp > now().getTime() / 1000;
  } catch {
    return false;
  }
}

export function requireOwner(deps: AppDeps): RequestHandler {
  const key = signingKey(deps);
  const now = deps.now ?? (() => new Date());
  return (req, res, next) => {
    if (!signedIn(req, key, now)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}

export function authRouter(deps: AppDeps): Router {
  const router = Router();
  const key = signingKey(deps);
  const now = deps.now ?? (() => new Date());
  const passwordHash = createHash("sha256").update(deps.config.adminPassword).digest();
  router.use(emptyQuery);
  router.post("/login", limiter(deps.limits?.loginPer15Min ?? DEFAULT_LIMITS.loginPer15Min, 15 * 60_000), (req, res) => {
    const body = z.object({ password: z.string() }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    if (!timingSafeEqual(createHash("sha256").update(body.data.password).digest(), passwordHash)) {
      res.status(401).json({ error: "invalid_password" });
      return;
    }
    const firstPart = Buffer.from(JSON.stringify({ v: 1, exp: Math.floor(now().getTime() / 1000) + SESSION_SECONDS })).toString("base64url");
    const signature = createHmac("sha256", key).update(firstPart).digest("base64url");
    res.cookie("ff_session", `${firstPart}.${signature}`, {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_SECONDS * 1000, secure: req.secure,
    }).status(204).end();
  });
  router.post("/logout", emptyBody, (req, res) => {
    res.clearCookie("ff_session", { httpOnly: true, sameSite: "lax", path: "/", secure: req.secure }).status(204).end();
  });
  router.get("/session", (req, res) => {
    if (!signedIn(req, key, now)) {
      res.json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      publicUrl: deps.config.publicUrl,
      aiEnabled: Boolean(deps.config.ai.apiKey && deps.config.ai.model),
    });
  });
  return router;
}
