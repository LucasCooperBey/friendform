// source: ResponsesPage renders stats and column cells, other answers, delete, load more, and the CSV link.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, emptySchema } from "@shared/form-schema";
import { App } from "@/App";
import type { FormDetail } from "@/components/editor/useDraft";
import { StatsTiles } from "@/components/responses/StatsTiles";
import { callsTo, mockRoute } from "./fetch-mock";

const ISO = "2026-04-01T12:00:00.000Z";
const submissionId = "11111111-1111-4111-8111-111111111111";
const olderId = "22222222-2222-4222-8222-222222222222";

function detail(patch: Partial<FormDetail> = {}): FormDetail {
  return {
    id: "form-1",
    slug: "hello-form",
    title: "Hello form",
    description: "",
    status: "published",
    publishedVersion: 2,
    submissionCount: 1,
    createdAt: ISO,
    updatedAt: ISO,
    draftSchema: emptySchema(),
    settings: DEFAULT_SETTINGS,
    hasUnpublishedChanges: false,
    ...patch,
  };
}

function signedIn() {
  mockRoute("GET", "/api/auth/session", {
    body: { authenticated: true, publicUrl: "https://forms.example", aiEnabled: false },
  });
}

function renderResponses() {
  signedIn();
  window.history.pushState({}, "", "/forms/form-1/responses");
  return render(<App />);
}

describe("ResponsesPage", () => {
  // source: stats use the ratio as a percent, and the table uses the first three columns, shortened to 80 characters.
  it("renders the stats and the rows from columns", async () => {
    const createdAt = new Date(Date.now() - (2 * 60 * 60 * 1000 + 5 * 60 * 1000)).toISOString();
    const essay = "A".repeat(90);
    mockRoute("GET", "/api/forms/form-1", { body: { form: detail() } });
    mockRoute("GET", "/api/forms/form-1/stats", {
      body: { views: 4, starts: 2, submissions: 1, completionRate: 0.25 },
    });
    mockRoute("GET", "/api/forms/form-1/submissions", {
      body: {
        submissions: [
          {
            id: submissionId,
            createdAt,
            version: 2,
            responses: { name: "Ada", boxes: ["Red", "Blue"], essay, legacy: "kept" },
          },
        ],
        nextBefore: null,
        columns: [
          { questionId: "name", prompt: "Name", type: "text" },
          { questionId: "boxes", prompt: "Boxes", type: "checkbox" },
          { questionId: "essay", prompt: "Essay", type: "textarea" },
          { questionId: "fourth", prompt: "Fourth", type: "text" },
        ],
      },
    });
    renderResponses();
    expect(within(await screen.findByRole("region", { name: "Views" })).getByText("4")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Started" })).getByText("2")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Responses" })).getByText("1")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Completion rate" })).getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("Views and starts count browser sessions.")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Ada" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Red, Blue" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "A".repeat(80) })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "2" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Fourth" })).not.toBeInTheDocument();
    expect(screen.getByTitle(new Date(createdAt).toLocaleString())).toHaveTextContent("2 hours ago");
    const csv = screen.getByRole("link", { name: "Export CSV" });
    expect(csv).toHaveAttribute("href", "/api/forms/form-1/export.csv");
    expect(csv.hasAttribute("download")).toBe(true);
  });

  // source: the detail lists every column, chips a checkbox answer, and puts unknown keys under Other answers.
  it("shows other answers in the detail and deletes the response", async () => {
    const user = userEvent.setup();
    const essay = "A".repeat(90);
    mockRoute("GET", "/api/forms/form-1", { body: { form: detail() } });
    mockRoute("GET", "/api/forms/form-1/stats", {
      body: { views: 4, starts: 2, submissions: 1, completionRate: 0.25 },
    });
    mockRoute("GET", "/api/forms/form-1/submissions", {
      body: {
        submissions: [
          {
            id: submissionId,
            createdAt: ISO,
            version: 2,
            responses: { name: "Ada", boxes: ["Red", "Blue"], essay, legacy: "kept" },
          },
        ],
        nextBefore: null,
        columns: [
          { questionId: "name", prompt: "Name", type: "text" },
          { questionId: "boxes", prompt: "Boxes", type: "checkbox" },
          { questionId: "essay", prompt: "Essay", type: "textarea" },
          { questionId: "fourth", prompt: "Fourth", type: "text" },
        ],
      },
    });
    mockRoute("DELETE", `/api/forms/form-1/submissions/${submissionId}`, { status: 204 });
    renderResponses();
    await user.click(await screen.findByRole("cell", { name: "Ada" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Other answers")).toBeInTheDocument();
    expect(within(dialog).getByText("legacy")).toBeInTheDocument();
    expect(within(dialog).getByText("kept")).toBeInTheDocument();
    expect(within(dialog).getByText(essay)).toBeInTheDocument();
    expect(within(dialog).getByText("Fourth")).toBeInTheDocument();
    expect(within(dialog).getByText("Red")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete response" }));
    const alert = await screen.findByRole("alertdialog");
    await user.click(within(alert).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(callsTo("DELETE", `/api/forms/form-1/submissions/${submissionId}`)).toHaveLength(1));
    expect(await screen.findByText("Response deleted")).toBeInTheDocument();
  });

  // source: Load more requests the next page with the before cursor from nextBefore.
  it("requests the before cursor when loading more", async () => {
    const user = userEvent.setup();
    const nextBefore = `${ISO}_${olderId}`;
    let page = 0;
    mockRoute("GET", "/api/forms/form-1", { body: { form: detail() } });
    mockRoute("GET", "/api/forms/form-1/stats", {
      body: { views: 1, starts: 1, submissions: 2, completionRate: 1 },
    });
    mockRoute("GET", "/api/forms/form-1/submissions", () => {
      page += 1;
      if (page === 1) {
        return {
          body: {
            submissions: [{ id: submissionId, createdAt: ISO, version: 2, responses: { name: "Ada" } }],
            nextBefore,
            columns: [{ questionId: "name", prompt: "Name", type: "text" }],
          },
        };
      }
      return {
        body: {
          submissions: [{ id: olderId, createdAt: "2026-04-01T11:00:00.000Z", version: 1, responses: { name: "Bea" } }],
          nextBefore: null,
          columns: [{ questionId: "name", prompt: "Name", type: "text" }],
        },
      };
    });
    renderResponses();
    expect(await screen.findByRole("cell", { name: "Ada" })).toBeInTheDocument();
    const seen: string[] = [];
    const current = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      seen.push(raw);
      return current(input, init);
    });
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(seen.some((url) => url.includes("before=") && url.includes(olderId))).toBe(true));
    expect(await screen.findByRole("cell", { name: "Bea" })).toBeInTheDocument();
  });

  // source: an empty unpublished form tells the owner to publish, with a link to the editor.
  it("tells the owner to publish when nothing has been collected", async () => {
    mockRoute("GET", "/api/forms/form-1", { body: { form: detail({ status: "draft", publishedVersion: null, submissionCount: 0 }) } });
    mockRoute("GET", "/api/forms/form-1/stats", { body: { views: 0, starts: 0, submissions: 0, completionRate: null } });
    mockRoute("GET", "/api/forms/form-1/submissions", { body: { submissions: [], nextBefore: null, columns: [] } });
    renderResponses();
    expect(await screen.findByText("No responses yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Publish the form to start collecting responses." })).toHaveAttribute(
      "href",
      "/forms/form-1/edit",
    );
    expect(screen.getByText("No views yet")).toBeInTheDocument();
  });

  // source: a null completion rate reads as no views yet.
  it("says there are no views when the completion rate is null", () => {
    render(<StatsTiles stats={{ views: 0, starts: 0, submissions: 0, completionRate: null }} />);
    expect(screen.getByText("No views yet")).toBeInTheDocument();
  });
});
