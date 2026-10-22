// source: SettingsTab shows the slug 409 message, and webhook add, remove, and test send reach the API.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, emptySchema, formSchemaZ, formSettingsZ } from "@shared/form-schema";
import { App } from "@/App";
import type { FormDetail } from "@/components/editor/useDraft";
import { queryClient } from "@/lib/session";
import { isRecord } from "@/lib/utils";
import { callsTo, mockRoute } from "./fetch-mock";

const ISO = "2026-04-01T12:00:00.000Z";
const UUID = "11111111-1111-4111-8111-111111111111";

function detail(patch: Partial<FormDetail> = {}): FormDetail {
  return {
    id: "form-1",
    slug: "hello-form",
    title: "Hello form",
    description: "",
    status: "draft",
    publishedVersion: null,
    submissionCount: 0,
    createdAt: ISO,
    updatedAt: ISO,
    draftSchema: emptySchema(),
    settings: DEFAULT_SETTINGS,
    hasUnpublishedChanges: true,
    ...patch,
  };
}

function signedIn() {
  mockRoute("GET", "/api/auth/session", {
    body: { authenticated: true, publicUrl: "https://forms.example", aiEnabled: false },
  });
}

function renderSettings() {
  signedIn();
  mockRoute("GET", "/api/forms/form-1/webhooks/deliveries", { body: { deliveries: [] } });
  window.history.pushState({}, "", "/forms/form-1/edit");
  return render(<App />);
}

function webhookUrls(body: unknown): string[] {
  if (!isRecord(body) || !isRecord(body.settings) || !Array.isArray(body.settings.webhooks)) return [];
  return body.settings.webhooks.flatMap((hook) => (isRecord(hook) && typeof hook.url === "string" ? [hook.url] : []));
}

describe("SettingsTab", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(UUID);
  });

  // source: PATCH slug 409 says the link is already taken.
  it("shows the taken message when the slug returns 409", async () => {
    const user = userEvent.setup();
    mockRoute("GET", "/api/forms/form-1", { body: { form: detail() } });
    mockRoute("PATCH", "/api/forms/form-1", { status: 409, body: { error: "slug_taken" } });
    renderSettings();
    await user.click(await screen.findByRole("tab", { name: "Settings" }));
    const link = screen.getByRole("textbox", { name: "Link" });
    await user.clear(link);
    await user.type(link, "taken-name");
    await user.click(screen.getByRole("button", { name: "Save link" }));
    expect(await screen.findByText("That link is already taken.")).toBeInTheDocument();
    expect(callsTo("PATCH", "/api/forms/form-1")[0]?.body).toEqual({ slug: "taken-name" });
  });

  // source: PATCH slug 400 says to use lowercase letters, numbers, and dashes.
  it("shows the slug format message when the slug returns 400", async () => {
    const user = userEvent.setup();
    mockRoute("GET", "/api/forms/form-1", { body: { form: detail() } });
    mockRoute("PATCH", "/api/forms/form-1", { status: 400, body: { error: "invalid_slug" } });
    renderSettings();
    await user.click(await screen.findByRole("tab", { name: "Settings" }));
    const link = screen.getByRole("textbox", { name: "Link" });
    await user.clear(link);
    await user.type(link, "Bad Slug");
    await user.click(screen.getByRole("button", { name: "Save link" }));
    expect(await screen.findByText("Use lowercase letters, numbers and dashes.")).toBeInTheDocument();
  });

  // source: adding and removing a webhook both reach the settings PATCH, and Send test shows the status.
  it("adds and removes a webhook and shows the test status", async () => {
    const user = userEvent.setup();
    let current = detail();
    mockRoute("GET", "/api/forms/form-1", () => ({ body: { form: current } }));
    mockRoute("PATCH", "/api/forms/form-1", (call) => {
      if (!isRecord(call.body)) return { status: 400, body: { error: "invalid_body" } };
      const next = { ...current };
      if (call.body.settings !== undefined) {
        const parsed = formSettingsZ.safeParse(call.body.settings);
        if (!parsed.success) return { status: 400, body: { error: "invalid_body" } };
        next.settings = parsed.data;
      }
      if (call.body.draftSchema !== undefined) {
        const parsed = formSchemaZ.safeParse(call.body.draftSchema);
        if (!parsed.success) return { status: 400, body: { error: "invalid_body" } };
        next.draftSchema = parsed.data;
      }
      current = next;
      return { body: { form: current } };
    });
    mockRoute("POST", `/api/forms/form-1/webhooks/${UUID}/test`, {
      body: { ok: true, status: 204, error: null },
    });
    renderSettings();
    await user.click(await screen.findByRole("tab", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Add webhook" }));
    await user.type(screen.getByRole("textbox", { name: "Webhook URL 1" }), "https://example.com/hook");
    await waitFor(() => expect(webhookUrls(callsTo("PATCH", "/api/forms/form-1").at(-1)?.body)).toEqual(["https://example.com/hook"]));
    await user.click(screen.getByRole("button", { name: "Send test" }));
    expect(await screen.findByText("Test sent: 204")).toBeInTheDocument();
    expect(callsTo("POST", `/api/forms/form-1/webhooks/${UUID}/test`)).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Remove webhook 1" }));
    await waitFor(() => expect(webhookUrls(callsTo("PATCH", "/api/forms/form-1").at(-1)?.body)).toEqual([]));
  });

  // source: Send test stays disabled until the webhook has a URL
  it("asks for a URL before a webhook can be tested", async () => {
    const user = userEvent.setup();
    mockRoute("GET", "/api/forms/form-1", { body: { form: detail() } });
    mockRoute("PATCH", "/api/forms/form-1", { body: { form: detail() } });
    renderSettings();
    await user.click(await screen.findByRole("tab", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Add webhook" }));
    expect(screen.getByRole("button", { name: "Send test" })).toBeDisabled();
    expect(screen.getByText("Add a URL to send this webhook.")).toBeInTheDocument();
  });

  // source: Send test saves the draft first and shows the save error instead of posting when the save fails
  it("does not send a test when the save fails", async () => {
    const user = userEvent.setup();
    mockRoute("GET", "/api/forms/form-1", { body: { form: detail() } });
    mockRoute("PATCH", "/api/forms/form-1", { status: 500, body: { error: "server_error" } });
    mockRoute("POST", `/api/forms/form-1/webhooks/${UUID}/test`, {
      body: { ok: true, status: 204, error: null },
    });
    renderSettings();
    await user.click(await screen.findByRole("tab", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Add webhook" }));
    await user.click(screen.getByRole("textbox", { name: "Webhook URL 1" }));
    await user.paste("https://example.com/hook");
    await user.click(screen.getByRole("button", { name: "Send test" }));
    expect(await screen.findByText("The server had a problem. Try again.")).toBeInTheDocument();
    expect(callsTo("POST", `/api/forms/form-1/webhooks/${UUID}/test`)).toHaveLength(0);
    expect(webhookUrls(callsTo("PATCH", "/api/forms/form-1").at(-1)?.body)).toEqual(["https://example.com/hook"]);
  });

  // source: deleting a form invalidates the forms query and removes that form's query
  it("drops the form list and the deleted form after delete", async () => {
    const user = userEvent.setup();
    mockRoute("GET", "/api/forms/form-1", { body: { form: detail() } });
    mockRoute("DELETE", "/api/forms/form-1", { status: 204 });
    mockRoute("GET", "/api/forms", { body: { forms: [] } });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const remove = vi.spyOn(queryClient, "removeQueries");
    try {
      renderSettings();
      await user.click(await screen.findByRole("tab", { name: "Settings" }));
      await user.click(screen.getByRole("button", { name: "Delete form" }));
      await user.click(await screen.findByRole("button", { name: "Delete" }));
      expect(await screen.findByText("Form deleted")).toBeInTheDocument();
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["forms"] });
      expect(remove).toHaveBeenCalledWith({ queryKey: ["form", "form-1"] });
    } finally {
      invalidate.mockRestore();
      remove.mockRestore();
    }
  });
});
