// source: LoginPage shows the 401 mismatch copy and refreshes the session after sign-in.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "@/App";
import { callsTo, mockRoute } from "./fetch-mock";

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
