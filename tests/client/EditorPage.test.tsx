// source: EditorPage adds a question, follows the publish label, shows a 422 problems dialog, and toasts a live version.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, emptySchema } from "@shared/form-schema";
import { App } from "@/App";
import type { FormDetail } from "@/components/editor/useDraft";
import { isRecord } from "@/lib/utils";
import { callsTo, mockRoute, type MockResponse } from "./fetch-mock";

const ISO = "2026-04-01T12:00:00.000Z";

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

function renderEditor(form: FormDetail = detail()) {
  signedIn();
  mockRoute("GET", "/api/forms/form-1", { body: { form } });
  window.history.pushState({}, "", "/forms/form-1/edit");
  return render(<App />);
}

function firstQuestion(body: unknown): Record<string, unknown> | undefined {
  if (!isRecord(body) || !isRecord(body.draftSchema) || !Array.isArray(body.draftSchema.sections)) return undefined;
  const section = body.draftSchema.sections[0];
  if (!isRecord(section) || !Array.isArray(section.questions)) return undefined;
  const question = section.questions[0];
  return isRecord(question) ? question : undefined;
}

describe("EditorPage", () => {
  // source: choosing Short text adds that question, and the PATCH body contains it.
  it("adds a question of a chosen type and the PATCH body contains it", async () => {
    const user = userEvent.setup();
    mockRoute("PATCH", "/api/forms/form-1", { body: { form: detail() } });
    renderEditor();
    await user.click(await screen.findByRole("button", { name: "Add question" }));
    await user.click(await screen.findByRole("menuitem", { name: "Short text" }));
    expect(callsTo("PATCH", "/api/forms/form-1")).toHaveLength(0);
    await waitFor(() => expect(callsTo("PATCH", "/api/forms/form-1")).toHaveLength(1));
    const body = callsTo("PATCH", "/api/forms/form-1")[0]?.body;
    expect(isRecord(body) ? Object.keys(body) : []).toEqual(["draftSchema"]);
    const question = firstQuestion(body);
    expect(question).toMatchObject({ type: "text", prompt: "Untitled question", required: false });
    expect(question?.questionId).toEqual(expect.stringMatching(/^q_[a-z0-9]+$/));
  });

  // source: a never-published form says Publish even though hasUnpublishedChanges is true.
  it("labels a never-published form Publish", async () => {
    renderEditor(detail({ publishedVersion: null, hasUnpublishedChanges: true }));
    expect(await screen.findByRole("button", { name: "Publish" })).toBeEnabled();
  });

  // source: a published form with unpublished changes says Publish changes.
  it("labels unpublished changes Publish changes", async () => {
    renderEditor(detail({ status: "published", publishedVersion: 2, hasUnpublishedChanges: true }));
    expect(await screen.findByRole("button", { name: "Publish changes" })).toBeEnabled();
  });

  // source: a published form with no unpublished changes disables the button as Published.
  it("labels a current publish Published", async () => {
    renderEditor(detail({ status: "published", publishedVersion: 2, hasUnpublishedChanges: false }));
    expect(await screen.findByRole("button", { name: "Published" })).toBeDisabled();
  });

  // source: publish 422 opens a dialog listing the returned problems.
  it("shows the problems dialog when publish returns 422", async () => {
    const user = userEvent.setup();
    const ready = detail({
      draftSchema: {
        sections: [
          {
            title: "Untitled section",
            questions: [{ questionId: "q_ready", type: "text", prompt: "Name", required: false }],
          },
        ],
      },
    });
    mockRoute("POST", "/api/forms/form-1/publish", {
      status: 422,
      body: { error: "not_publishable", problems: ["Give the form a title."] },
    });
    renderEditor(ready);
    await user.click(await screen.findByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Give the form a title.")).toBeInTheDocument();
  });

  // source: a successful publish toasts the version number and opens the share link.
  it("toasts the live version after publish", async () => {
    const user = userEvent.setup();
    mockRoute("POST", "/api/forms/form-1/publish", {
      body: {
        form: detail({ status: "published", publishedVersion: 4, hasUnpublishedChanges: false }),
        version: { id: "version-4", version: 4, publishedAt: ISO, questionCount: 0 },
      },
    });
    renderEditor();
    await user.click(await screen.findByRole("button", { name: "Publish" }));
    expect(await screen.findByText("Version 4 is live")).toBeInTheDocument();
    expect(await screen.findByText("https://forms.example/f/hello-form")).toBeInTheDocument();
  });

  // source: restoring a version copies it into the draft and says to publish.
  it("restores a version into the draft", async () => {
    const user = userEvent.setup();
    mockRoute("GET", "/api/forms/form-1/versions", {
      body: { versions: [{ id: "version-3", version: 3, publishedAt: ISO, questionCount: 1 }] },
    });
    mockRoute("POST", "/api/forms/form-1/versions/version-3/restore", {
      body: {
        form: detail({
          draftSchema: {
            sections: [
              {
                title: "Untitled section",
                questions: [{ questionId: "q_restored", type: "text", prompt: "Restored question", required: false }],
              },
            ],
          },
        }),
      },
    });
    renderEditor();
    await user.click(await screen.findByRole("tab", { name: "History" }));
    expect(await screen.findByText("Version 3")).toBeInTheDocument();
    expect(screen.getByText("1 question")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore to draft" }));
    expect(await screen.findByText("Version 3 copied into your draft. Publish to make it live.")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Questions" }));
    expect(await screen.findByText("Restored question")).toBeInTheDocument();
  });

  // source: every Restore button is disabled while one restore is running
  it("disables every restore button while one restore runs", async () => {
    const user = userEvent.setup();
    let release: (value: MockResponse) => void = () => undefined;
    mockRoute("GET", "/api/forms/form-1/versions", {
      body: {
        versions: [
          { id: "version-2", version: 2, publishedAt: ISO, questionCount: 1 },
          { id: "version-1", version: 1, publishedAt: ISO, questionCount: 2 },
        ],
      },
    });
    mockRoute("POST", "/api/forms/form-1/versions/version-2/restore", () => new Promise((resolve) => {
      release = resolve;
    }));
    renderEditor();
    await user.click(await screen.findByRole("tab", { name: "History" }));
    const buttons = await screen.findAllByRole("button", { name: "Restore to draft" });
    expect(buttons).toHaveLength(2);
    const first = buttons[0];
    if (!first) throw new Error("missing restore button");
    await user.click(first);
    await waitFor(() => {
      const busy = screen.getAllByRole("button", { name: "Restore to draft" });
      expect(busy[0]).toBeDisabled();
      expect(busy[1]).toBeDisabled();
    });
    release({ body: { form: detail() } });
    await waitFor(() => {
      const later = screen.getAllByRole("button", { name: "Restore to draft" });
      expect(later[0]).toBeEnabled();
      expect(later[1]).toBeEnabled();
    });
  });
});
