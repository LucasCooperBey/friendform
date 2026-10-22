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

interface QuestionHint {
  questionId: string;
  type: string;
  options: string[];
  min: number | undefined;
  max: number | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function questionsFromBody(body: unknown): QuestionHint[] {
  if (!isRecord(body) || !Array.isArray(body.messages)) return [];
  for (const message of body.messages) {
    if (!isRecord(message) || message.role !== "system" || typeof message.content !== "string") continue;
    const marker = "Questions: ";
    const index = message.content.indexOf(marker);
    if (index === -1) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.content.slice(index + marker.length)) as unknown;
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    const questions: QuestionHint[] = [];
    for (const item of parsed) {
      if (!isRecord(item) || typeof item.questionId !== "string" || item.questionId === "") continue;
      const options = Array.isArray(item.options)
        ? item.options.filter((option): option is string => typeof option === "string" && option.trim() !== "")
        : [];
      questions.push({
        questionId: item.questionId,
        type: typeof item.type === "string" ? item.type : "text",
        options,
        min: typeof item.min === "number" ? item.min : undefined,
        max: typeof item.max === "number" ? item.max : undefined,
      });
    }
    return questions;
  }
  return [];
}

function answerFor(question: QuestionHint): string | number | string[] {
  if (question.type === "email") return "avery.example@example.com";
  if (question.type === "phone") return "555-0100";
  if (question.type === "number") {
    const min = question.min ?? 1;
    const max = question.max ?? min;
    return min <= max ? min : max;
  }
  if (question.type === "rating") {
    const min = question.min ?? 1;
    const max = question.max ?? 5;
    const chosen = min <= max ? min : max;
    return Number.isInteger(chosen) ? chosen : Math.ceil(chosen);
  }
  if (question.type === "date") return "2026-10-21";
  if (question.type === "checkbox") return question.options.slice(0, 1);
  if (question.type === "radio" || question.type === "dropdown") return question.options[0] ?? "";
  if (question.type === "textarea") return "Example message from the document.";
  return "Avery Example";
}

function defaultAutofillReply(body: unknown): CannedReply {
  const answers: Record<string, string | number | string[]> = {};
  for (const question of questionsFromBody(body)) {
    const value = answerFor(question);
    if (value === "" || (Array.isArray(value) && value.length === 0)) continue;
    answers[question.questionId] = value;
  }
  return { content: JSON.stringify({ answers }) };
}

function writeJson(res: ServerResponse, status: number, payload: string): void {
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

async function handle(req: IncomingMessage, res: ServerResponse, requests: RecordedRequest[], queue: CannedReply[]): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  // Browser tests run in another process and read this log over HTTP.
  if (url.pathname === "/e2e/requests" && req.method === "GET") {
    writeJson(res, 200, JSON.stringify({ requests }));
    return;
  }
  if (url.pathname === "/e2e/requests" && req.method === "DELETE") {
    requests.length = 0;
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== "POST" || !url.pathname.startsWith("/v1/chat/completions")) {
    res.writeHead(404);
    res.end();
    return;
  }
  // Count the request before reading the body. A client can give up while the body is still unread.
  const authorization = req.headers.authorization;
  const recorded: RecordedRequest = {
    authorization: typeof authorization === "string" ? authorization : undefined,
    body: undefined,
    at: Date.now(),
  };
  requests.push(recorded);
  const raw = await readBody(req);
  let body: unknown = raw;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    body = raw;
  }
  recorded.body = body;
  const reply = queue.shift() ?? defaultAutofillReply(body);
  if (reply.destroy) {
    req.socket.destroy();
    return;
  }
  if (reply.delayMs !== undefined && reply.delayMs > 0) await waitFor(reply.delayMs, res);
  if (res.destroyed || res.writableEnded) return;
  const status = reply.status ?? 200;
  const payload = reply.rawBody ?? completion(reply.content ?? "");
  writeJson(res, status, payload);
}

export async function startAiFake(port = 0): Promise<AiFake> {
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
    server.listen(port, "127.0.0.1", () => resolve());
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
