import type { Config } from "./config";

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = { role: "system" | "user"; content: string | ChatContentPart[] };

export interface AiClient {
  enabled: boolean;
  model: string | null;
  completeJson(messages: ChatMessage[], opts?: { timeoutMs?: number }): Promise<unknown>;
}

export class AiError extends Error {
  readonly code: "disabled" | "timeout" | "bad_output" | "upstream";

  constructor(code: AiError["code"], message?: string) {
    super(message ?? code);
    this.name = "AiError";
    this.code = code;
  }
}

const DEFAULT_BASE = "https://api.openai.com/v1";

function chatUrl(baseUrl: string | null): string {
  const raw = baseUrl === null || baseUrl === "" ? DEFAULT_BASE : baseUrl;
  const trimmed = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  return `${trimmed}/chat/completions`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimeout(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    if ("name" in current && current.name === "TimeoutError") return true;
    if (!("cause" in current)) return false;
    current = current.cause;
  }
  return false;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function stripFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```json") || !trimmed.endsWith("```")) return trimmed;
  return trimmed.slice("```json".length, -3).trim();
}

function readContent(payload: unknown): string | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return undefined;
  const choice: unknown = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return undefined;
  return typeof choice.message.content === "string" ? choice.message.content : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

type Attempt =
  | { kind: "timeout" }
  | { kind: "network" }
  | { kind: "http"; status: number; payload: unknown };

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function createAiClient(config: Config["ai"], deps?: { fetchImpl?: typeof fetch }): AiClient {
  const apiKey = config.apiKey;
  const modelName = config.model;
  const enabled = Boolean(apiKey && modelName);
  const fetchImpl = deps?.fetchImpl ?? globalThis.fetch;
  const url = chatUrl(config.baseUrl);

  async function attempt(messages: ChatMessage[], includeFormat: boolean, timeoutMs: number): Promise<Attempt> {
    if (apiKey === null || modelName === null) return { kind: "network" };
    const body: {
      model: string;
      messages: ChatMessage[];
      temperature: number;
      response_format?: { type: "json_object" };
    } = { model: modelName, messages, temperature: 0.2 };
    if (includeFormat) body.response_format = { type: "json_object" };
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        await response.arrayBuffer().catch(() => undefined);
        return { kind: "http", status: response.status, payload: undefined };
      }
      const text = await response.text();
      return { kind: "http", status: response.status, payload: parseJson(text) };
    } catch (error) {
      if (isTimeout(error)) return { kind: "timeout" };
      return { kind: "network" };
    }
  }

  function unpack(result: Attempt): unknown {
    if (result.kind === "timeout") throw new AiError("timeout");
    if (result.kind === "network") throw new AiError("upstream", "AI request failed");
    if (result.status < 200 || result.status >= 300) {
      throw new AiError("upstream", `AI request failed with status ${result.status}`);
    }
    const content = readContent(result.payload);
    if (content === undefined) throw new AiError("bad_output");
    const parsed = parseJson(stripFence(content));
    if (parsed === undefined) throw new AiError("bad_output");
    return parsed;
  }

  return {
    enabled,
    model: modelName,
    async completeJson(messages, opts) {
      if (!enabled || apiKey === null || modelName === null) throw new AiError("disabled");
      const timeoutMs = opts?.timeoutMs ?? 60_000;
      const first = await attempt(messages, true, timeoutMs);
      if (first.kind === "timeout") throw new AiError("timeout");
      if (first.kind === "network" || (first.kind === "http" && retryableStatus(first.status))) {
        await delay(500);
        return unpack(await attempt(messages, true, timeoutMs));
      }
      if (first.kind === "http" && first.status === 400) {
        return unpack(await attempt(messages, false, timeoutMs));
      }
      return unpack(first);
    },
  };
}
