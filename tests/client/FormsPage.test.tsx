// source: FormsPage lists forms, shows the empty state, and posts a template schema.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@shared/templates";
import { App } from "@/App";
import { callsTo, mockRoute } from "./fetch-mock";

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

function signedIn() {
  mockRoute("GET", "/api/auth/session", {
    body: { authenticated: true, publicUrl: "https://forms.example", aiEnabled: false },
  });
}

describe("FormsPage", () => {
  // source: GET /api/forms renders title, Live, the response count, and the edited time.
  it("lists forms", async () => {
    signedIn();
    const updatedAt = new Date(Date.now() - (2 * 60 * 60 * 1000 + 5 * 60 * 1000)).toISOString();
    mockRoute("GET", "/api/forms", {
      body: {
        forms: [
          {
            id: "form-1",
            slug: "hello",
            title: "Hello form",
            description: "",
            status: "published",
            publishedVersion: 1,
            submissionCount: 3,
            createdAt: updatedAt,
            updatedAt,
          },
        ],
      },
    });
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Hello form" })).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText(/3 responses/)).toBeInTheDocument();
    expect(screen.getByText(/Edited 2 hours ago/)).toBeInTheDocument();
  });

  // source: an empty form list shows the empty sentence, the create button, and three templates.
  it("shows the empty state", async () => {
    signedIn();
    mockRoute("GET", "/api/forms", { body: { forms: [] } });
    renderAt("/");
    expect(await screen.findByText("You have no forms yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create your first form" })).toBeInTheDocument();
    for (const template of TEMPLATES.slice(0, 3)) {
      expect(screen.getByRole("button", { name: new RegExp(`^${template.name}`) })).toBeInTheDocument();
    }
  });

  // source: choosing a template posts its title and draftSchema, then opens the editor.
  it("posts a template schema", async () => {
    signedIn();
    mockRoute("GET", "/api/forms", { body: { forms: [] } });
    mockRoute("POST", "/api/forms", { status: 201, body: { form: { id: "form-new" } } });
    renderAt("/");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New form" }));
    const template = TEMPLATES[0];
    if (!template) throw new Error("missing template");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: new RegExp(`^${template.name}`) }));
    expect(await screen.findByRole("heading", { name: "Edit form" })).toBeInTheDocument();
    expect(callsTo("POST", "/api/forms")[0]?.body).toEqual({
      title: template.title,
      draftSchema: template.schema,
    });
  });
});
