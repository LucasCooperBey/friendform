import { isRecord } from "@/lib/utils";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

interface ApiInit {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

function parseBody(text: string): unknown {
  if (text.trim() === "") return null;
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return null;
  }
}

export async function api<T>(path: string, init?: ApiInit): Promise<T> {
  const headers = new Headers();
  if (init?.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    method: init?.method ?? "GET",
    credentials: "same-origin",
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init?.signal,
  });
  if (response.status === 204) return undefined as T;
  const parsed = parseBody(await response.text());
  if (!response.ok) throw new ApiError(response.status, parsed);
  return parsed as T;
}

const ERROR_TEXT: Record<string, string> = {
  unauthorized: "Sign in to continue.",
  too_many_requests: "Too many requests. Try again later.",
  not_found: "That could not be found.",
  invalid_body: "That request was not accepted.",
  invalid_responses: "Some answers need attention.",
  invalid_json: "That request could not be read.",
  invalid_slug: "That link is not valid.",
  slug_taken: "That link is already in use.",
  forbidden_origin: "The request was blocked.",
  unsupported_media_type: "That request was not accepted.",
  payload_too_large: "That request is too large.",
  not_published: "Publish the form first.",
  not_publishable: "This form is not ready to publish.",
  closed: "This form is no longer accepting responses.",
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const code = isRecord(err.body) && typeof err.body.error === "string" ? err.body.error : null;
    if (code !== null && ERROR_TEXT[code] !== undefined) return ERROR_TEXT[code];
    if (err.status >= 500) return "The server had a problem. Try again.";
    return "The request failed. Try again.";
  }
  if (err instanceof TypeError) return "The network request failed. Check your connection and try again.";
  if (err instanceof Error && err.message.trim() !== "") return err.message;
  return "Something went wrong. Try again.";
}
