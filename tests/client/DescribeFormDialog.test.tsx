// source: Describe your form drafts a form when AI is enabled, and the settings switch follows aiEnabled.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, emptySchema, type FormSchema } from "@shared/form-schema";
import { App } from "@/App";
import type { FormDetail } from "@/components/editor/useDraft";
import { callsTo, mockRoute } from "./fetch-mock";

const ISO = "2026-04-01T12:00:00.000Z";
const PURPOSE = "A workshop signup form";

const draftSchema: FormSchema = {
  sections: [{
    title: "About you",
    questions: [
      { questionId: "name", type: "text", prompt: "Your name", required: true },
      { questionId: "email", type: "email", prompt: "Email address", required: true },
      { questionId: "hope", type: "textarea", prompt: "What do you hope to learn", required: false },
    ],
  }],
};

const draft = {
  title: "Workshop signup",
  description: "Sign up for the workshop",
  schema: draftSchema,
};

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

function signedIn(aiEnabled: boolean) {
  mockRoute("GET", "/api/auth/session", {
    body: { authenticated: true, publicUrl: "https://forms.example", aiEnabled },
  });
}

function editorDetail(): { form: FormDetail } {
  return {
    form: {
      id: "form-new",
      slug: "workshop-signup",
      title: "Workshop signup",
      description: "Sign up for the workshop",
      status: "draft",
      publishedVersion: null,
      submissionCount: 0,
      createdAt: ISO,
      updatedAt: ISO,
      draftSchema,
      settings: DEFAULT_SETTINGS,
      hasUnpublishedChanges: true,
    },
  };
}

describe("DescribeFormDialog", () => {
  // source: with AI on, Describe it drafts a preview, Try again keeps the description, and Use this draft creates the form.
  it("drafts a form and opens the editor", async () => {
    signedIn(true);
    mockRoute("GET", "/api/forms", { body: { forms: [] } });
    let drafts = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockRoute("POST", "/api/ai/generate-form", async () => {
      drafts += 1;
      if (drafts === 1) await gate;
      return { body: draft };
    });
    mockRoute("POST", "/api/forms", { status: 201, body: { form: { id: "form-new" } } });
    mockRoute("GET", "/api/forms/form-new", { body: editorDetail() });
    mockRoute("PATCH", "/api/forms/form-new", { body: editorDetail() });
    renderAt("/");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New form" }));
    const chooser = await screen.findByRole("dialog", { name: "New form" });
    await user.click(within(chooser).getByRole("button", { name: /Describe it/ }));
    const dialog = await screen.findByRole("dialog", { name: "Describe your form" });
    await user.type(within(dialog).getByLabelText("What is this form for?"), PURPOSE);
    await user.click(within(dialog).getByRole("button", { name: "Draft it" }));
    expect(await screen.findByRole("button", { name: "Drafting..." })).toBeInTheDocument();
    release();
    expect(await screen.findByRole("heading", { name: "Workshop signup" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "About you" })).toBeInTheDocument();
    expect(screen.getByText("Your name")).toBeInTheDocument();
    expect(screen.getByText("Email address")).toBeInTheDocument();
    expect(screen.getByText("What do you hope to learn")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByLabelText("What is this form for?")).toHaveValue(PURPOSE);
    await user.click(screen.getByRole("button", { name: "Draft it" }));
    expect(await screen.findByRole("button", { name: "Use this draft" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use this draft" }));
    expect(await screen.findByRole("textbox", { name: "Form title" })).toHaveValue("Workshop signup");
    expect(callsTo("POST", "/api/ai/generate-form")[0]?.body).toEqual({ description: PURPOSE });
    expect(callsTo("POST", "/api/forms")[0]?.body).toEqual({
      title: "Workshop signup",
      description: "Sign up for the workshop",
      draftSchema,
    });
  });

  // source: Describe it is absent when the session says AI is off.
  it("hides Describe it when AI is off", async () => {
    signedIn(false);
    mockRoute("GET", "/api/forms", { body: { forms: [] } });
    renderAt("/");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New form" }));
    const dialog = await screen.findByRole("dialog", { name: "New form" });
    expect(within(dialog).queryByRole("button", { name: /Describe it/ })).not.toBeInTheDocument();
  });

  // source: ai_timeout uses the shorter-description sentence, and other errors use errorMessage.
  it("shows the timeout sentence and the generic server sentence", async () => {
    signedIn(true);
    mockRoute("GET", "/api/forms", { body: { forms: [] } });
    let calls = 0;
    mockRoute("POST", "/api/ai/generate-form", () => {
      calls += 1;
      if (calls === 1) return { status: 504, body: { error: "ai_timeout" } };
      return { status: 502, body: { error: "ai_bad_output" } };
    });
    renderAt("/");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New form" }));
    await user.click(within(await screen.findByRole("dialog", { name: "New form" })).getByRole("button", { name: /Describe it/ }));
    const field = await screen.findByLabelText("What is this form for?");
    await user.type(field, PURPOSE);
    await user.click(screen.getByRole("button", { name: "Draft it" }));
    expect(await screen.findByText("That took too long. Try a shorter description.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Draft it" }));
    expect(await screen.findByText("The server had a problem. Try again.")).toBeInTheDocument();
  });
});

describe("SettingsTab document fill", () => {
  function detail(): { form: FormDetail } {
    return {
      form: {
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
      },
    };
  }

  function renderSettings(aiEnabled: boolean) {
    signedIn(aiEnabled);
    mockRoute("GET", "/api/forms/form-1", { body: detail() });
    mockRoute("GET", "/api/forms/form-1/webhooks/deliveries", { body: { deliveries: [] } });
    mockRoute("PATCH", "/api/forms/form-1", { body: detail() });
    renderAt("/forms/form-1/edit");
  }

  // source: the document fill switch is disabled, with the env hint, when AI is off.
  it("disables document fill when AI is off", async () => {
    renderSettings(false);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("switch", { name: "Let people fill this form from a document" })).toBeDisabled();
    expect(screen.getByText("Set AI_BASE_URL, AI_API_KEY and AI_MODEL to turn this on.")).toBeInTheDocument();
  });

  // source: the document fill switch can be turned on when AI is on, and the env hint is absent.
  it("turns on document fill when AI is on", async () => {
    renderSettings(true);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Settings" }));
    const toggle = screen.getByRole("switch", { name: "Let people fill this form from a document" });
    expect(toggle).toBeEnabled();
    expect(screen.queryByText("Set AI_BASE_URL, AI_API_KEY and AI_MODEL to turn this on.")).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});
