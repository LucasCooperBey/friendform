// source: LoginPage shows the 401 mismatch copy and refreshes the session after sign-in.
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { App } from "@/App";
import { queryClient, useSession } from "@/lib/session";
import { callsTo, mockRoute } from "./fetch-mock";

function SessionWrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

describe("LoginPage", () => {
  // source: POST /api/auth/login 401 shows the mismatch sentence.
  it("shows the mismatch message on 401", async () => {
    mockRoute("GET", "/api/auth/session", { body: { authenticated: false } });
    mockRoute("POST", "/api/auth/login", { status: 401, body: { error: "invalid_password" } });
    renderAt("/login");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Owner password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("That password didn't match.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your forms" })).not.toBeInTheDocument();
  });

  // source: a successful sign-in refetches GET /api/auth/session.
  it("refreshes the session after a successful sign-in", async () => {
    let signedIn = false;
    mockRoute("GET", "/api/auth/session", () => ({
      body: signedIn
        ? { authenticated: true, publicUrl: null, aiEnabled: false }
        : { authenticated: false },
    }));
    mockRoute("POST", "/api/auth/login", () => {
      signedIn = true;
      return { status: 204 };
    });
    mockRoute("GET", "/api/forms", { body: { forms: [] } });
    renderAt("/login");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Owner password"), "correct-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Your forms" })).toBeInTheDocument();
    expect(callsTo("POST", "/api/auth/login")).toHaveLength(1);
    expect(callsTo("GET", "/api/auth/session").length).toBeGreaterThanOrEqual(2);
  });
});

describe("useSession", () => {
  function authenticated() {
    return { body: { authenticated: true, publicUrl: "https://forms.example", aiEnabled: true } };
  }

  // source: a session refetch that fails with a network error keeps the cached signed-in session
  it("keeps the signed-in session when a refetch fails on the network", async () => {
    let calls = 0;
    mockRoute("GET", "/api/auth/session", () => {
      calls += 1;
      if (calls === 1) return authenticated();
      throw new TypeError("Failed to fetch");
    });
    const { result } = renderHook(() => useSession(), { wrapper: SessionWrapper });
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    vi.useFakeTimers();
    try {
      await act(async () => {
        const pending = result.current.refresh().then(() => undefined, () => undefined);
        await vi.advanceTimersByTimeAsync(10_000);
        await pending;
      });
    } finally {
      vi.useRealTimers();
    }
    expect(result.current.status).toBe("authenticated");
    expect(result.current.publicUrl).toBe("https://forms.example");
    expect(result.current.aiEnabled).toBe(true);
  });

  // source: a session refetch that fails with a 5xx keeps the cached signed-in session
  it("keeps the signed-in session when a refetch returns 500", async () => {
    let calls = 0;
    mockRoute("GET", "/api/auth/session", () => {
      calls += 1;
      if (calls === 1) return authenticated();
      return { status: 500, body: { error: "server_error" } };
    });
    const { result } = renderHook(() => useSession(), { wrapper: SessionWrapper });
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    vi.useFakeTimers();
    try {
      await act(async () => {
        const pending = result.current.refresh().then(() => undefined, () => undefined);
        await vi.advanceTimersByTimeAsync(10_000);
        await pending;
      });
    } finally {
      vi.useRealTimers();
    }
    expect(result.current.status).toBe("authenticated");
    expect(result.current.publicUrl).toBe("https://forms.example");
    expect(result.current.aiEnabled).toBe(true);
  });

  // source: a session refetch that returns 401 becomes anonymous even when a session is cached
  it("becomes anonymous when a refetch returns 401", async () => {
    let calls = 0;
    mockRoute("GET", "/api/auth/session", () => {
      calls += 1;
      if (calls === 1) return authenticated();
      return { status: 401, body: { error: "unauthorized" } };
    });
    const { result } = renderHook(() => useSession(), { wrapper: SessionWrapper });
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    await act(async () => {
      await result.current.refresh().catch(() => undefined);
    });
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    expect(result.current.publicUrl).toBeNull();
    expect(result.current.aiEnabled).toBe(false);
  });

  // source: a session load that fails with no cached session is anonymous
  it("stays anonymous when the first session load fails", async () => {
    mockRoute("GET", "/api/auth/session", { status: 500, body: { error: "server_error" } });
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useSession(), { wrapper: SessionWrapper });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(result.current.status).toBe("anonymous");
    } finally {
      vi.useRealTimers();
    }
  });
});
