import { vi } from "vitest";

export interface FetchCall {
  method: string;
  path: string;
  body: unknown;
}

export interface MockResponse {
  status?: number;
  body?: unknown;
}

type RouteHandler = (call: FetchCall) => MockResponse | Promise<MockResponse>;

const routes = new Map<string, RouteHandler>();

export const calls: FetchCall[] = [];

function isHandler(route: RouteHandler | MockResponse): route is RouteHandler {
  return typeof route === "function";
}

export function installFetchMock(): void {
  routes.clear();
  calls.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = raw.startsWith("http") ? new URL(raw).pathname : (raw.split("?")[0] ?? raw);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    if (typeof init?.body === "string" && init.body !== "") {
      try {
        body = JSON.parse(init.body) as unknown;
      } catch {
        body = init.body;
      }
    }
    const call: FetchCall = { method, path, body };
    calls.push(call);
    const route = routes.get(`${method} ${path}`);
    const result = route ? await route(call) : { status: 500, body: { error: "unmocked", method, path } };
    if (result.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(result.body ?? null), {
      status: result.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
}

export function mockRoute(method: string, path: string, route: RouteHandler | MockResponse): void {
  routes.set(`${method.toUpperCase()} ${path}`, isHandler(route) ? route : () => route);
}

export function callsTo(method: string, path: string): FetchCall[] {
  return calls.filter((call) => call.method === method && call.path === path);
}
