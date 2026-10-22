import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface RecordedRequest {
  authorization: string | undefined;
  body: unknown;
  at: number;
}

export interface CannedReply {
  status?: number;
  content?: string;
  rawBody?: string;
  delayMs?: number;
  destroy?: boolean;
}

export interface AiFake {
  baseUrl: string;
  requests: RecordedRequest[];
  push: (...replies: CannedReply[]) => void;
  close: () => Promise<void>;
}

function completion(content: string): string {
  return JSON.stringify({ choices: [{ message: { content } }] });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function waitFor(ms: number, res: ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      res.off("close", finish);
      resolve();
    }
    res.on("close", finish);
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, requests: RecordedRequest[], queue: CannedReply[]): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method !== "POST" || !url.pathname.startsWith("/v1/chat/completions")) {
    res.writeHead(404);
    res.end();
    return;
  }
  const raw = await readBody(req);
  let body: unknown = raw;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    body = raw;
  }
  const authorization = req.headers.authorization;
  requests.push({
    authorization: typeof authorization === "string" ? authorization : undefined,
    body,
    at: Date.now(),
  });
  const reply = queue.shift() ?? { status: 500, rawBody: "no canned reply" };
  if (reply.destroy) {
    req.socket.destroy();
    return;
  }
  if (reply.delayMs !== undefined && reply.delayMs > 0) await waitFor(reply.delayMs, res);
  if (res.destroyed || res.writableEnded) return;
  const status = reply.status ?? 200;
  const payload = reply.rawBody ?? completion(reply.content ?? "");
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

export async function startAiFake(): Promise<AiFake> {
  const requests: RecordedRequest[] = [];
  const queue: CannedReply[] = [];
  const server = createServer((req, res) => {
    handle(req, res, requests, queue).catch(() => {
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(500);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake AI server has no port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    push: (...replies: CannedReply[]) => {
      queue.push(...replies);
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeIdleConnections();
    }),
  };
}
