// source: PublicFormPage renders a published form, conditional questions, validation, and submit states.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { FormSchema } from "@shared/form-schema";
import { App } from "@/App";
import { isRecord } from "@/lib/utils";
import { callsTo, mockRoute } from "./fetch-mock";

const schema: FormSchema = {
  sections: [
    {
      title: "About",
      description: "A few details",
      questions: [
        {
          questionId: "color",
          type: "radio",
          prompt: "Favorite color",
          required: false,
          metadata: { options: ["Red", "Blue"] },
        },
        {
          questionId: "why",
          type: "text",
          prompt: "Why that color",
          required: true,
          metadata: {
            conditionalLogic: { enabled: true, questionId: "color", operator: "equals", value: "Red" },
          },
        },
        {
          questionId: "name",
          type: "text",
          prompt: "Your name",
          required: true,
        },
      ],
    },
  ],
};

const openBody = {
  slug: "hello",
  title: "Hello form",
  description: "Tell us.\nBring a note.",
  version: 1,
  schema,
  settings: {
    theme: "light",
    showProgress: true,
    thankYou: { title: "Thanks", message: "We got it." },
    allowAutofill: false,
  },
};

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

function mockOpenForm() {
  mockRoute("GET", "/api/public/forms/hello", { body: openBody });
  mockRoute("POST", "/api/public/forms/hello/events", { status: 204 });
}

function eventsOf(type: string) {
  return callsTo("POST", "/api/public/forms/hello/events").filter(
    (call) => isRecord(call.body) && call.body.type === type,
  );
}

describe("PublicFormPage", () => {
  // source: GET /api/public/forms/:slug renders the title, description, and questions.
  it("loads and renders a form", async () => {
    mockOpenForm();
    renderAt("/f/hello");
    expect(await screen.findByRole("heading", { name: "Hello form" })).toBeInTheDocument();
    expect(document.body.textContent).toContain("Tell us.\nBring a note.");
    expect(screen.getByLabelText(/Your name/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Red" })).toBeInTheDocument();
  });

  // source: a conditional question appears for the matching answer and disappears otherwise, keeping its text.
  it("shows and hides a conditional question", async () => {
    mockOpenForm();
    renderAt("/f/hello");
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Hello form" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Why that color/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Red" }));
    const why = await screen.findByRole("textbox", { name: /Why that color/ });
    await user.type(why, "because");
    await user.click(screen.getByRole("radio", { name: "Blue" }));
    expect(screen.queryByRole("textbox", { name: /Why that color/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Red" }));
    expect(screen.getByRole("textbox", { name: /Why that color/ })).toHaveValue("because");
  });

  // source: a hidden required question is left out of the submission and does not block it.
  it("does not let a hidden required question block submit", async () => {
    mockOpenForm();
    mockRoute("POST", "/api/public/forms/hello/submissions", { status: 201, body: { id: "sub-1" } });
    renderAt("/f/hello");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "Red" }));
    await user.type(await screen.findByLabelText(/Why that color/), "because");
    await user.type(screen.getByLabelText(/Your name/), "Ada");
    await user.click(screen.getByRole("radio", { name: "Blue" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("We got it.")).toBeInTheDocument();
    const body = callsTo("POST", "/api/public/forms/hello/submissions")[0]?.body;
    expect(body).toMatchObject({ responses: { color: "Blue", name: "Ada" }, website: "" });
    if (!isRecord(body) || !isRecord(body.responses)) throw new Error("missing submission");
    expect(body.responses).not.toHaveProperty("why");
  });

  // source: client validation blocks an empty required answer and does not post a submission.
  it("blocks an empty required answer without a network call", async () => {
    mockOpenForm();
    mockRoute("POST", "/api/public/forms/hello/submissions", { status: 201, body: { id: "sub-1" } });
    renderAt("/f/hello");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Submit" }));
    expect(await screen.findByText("This question is required.")).toBeInTheDocument();
    expect(screen.getByText("Some answers need attention.")).toBeInTheDocument();
    expect(callsTo("POST", "/api/public/forms/hello/submissions")).toHaveLength(0);
  });

  // source: a successful submission shows the thank-you message.
  it("shows the thank-you text after submit", async () => {
    mockOpenForm();
    mockRoute("POST", "/api/public/forms/hello/submissions", { status: 201, body: { id: "sub-1" } });
    renderAt("/f/hello");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Your name/), "Ada");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("We got it.")).toBeInTheDocument();
    const body = callsTo("POST", "/api/public/forms/hello/submissions")[0]?.body;
    if (!isRecord(body)) throw new Error("missing submission");
    expect(typeof body.sessionId).toBe("string");
    if (document.referrer === "") expect(body).not.toHaveProperty("referrer");
    else expect(body.referrer).toBe(document.referrer);
  });

  // source: a submission 400 maps server errors onto the matching questions and keeps the answers.
  it("shows server errors on the right questions", async () => {
    mockOpenForm();
    mockRoute("POST", "/api/public/forms/hello/submissions", {
      status: 400,
      body: { error: "invalid_responses", errors: { name: "Server says no." } },
    });
    renderAt("/f/hello");
    const user = userEvent.setup();
    const name = await screen.findByLabelText(/Your name/);
    await user.type(name, "Ada");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Server says no.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Your name/)).toHaveValue("Ada");
  });

  // source: GET 410 shows the closed title and closedMessage.
  it("shows the closed message", async () => {
    mockRoute("GET", "/api/public/forms/hello", {
      status: 410,
      body: { error: "closed", title: "Old form", closedMessage: "Closed for the season." },
    });
    renderAt("/f/hello");
    expect(await screen.findByRole("heading", { name: "Old form" })).toBeInTheDocument();
    expect(screen.getByText("Closed for the season.")).toBeInTheDocument();
  });

  // source: GET 404 shows the not-published copy.
  it("shows the not-found copy", async () => {
    mockRoute("GET", "/api/public/forms/hello", { status: 404, body: { error: "not_found" } });
    renderAt("/f/hello");
    expect(await screen.findByText("This form doesn't exist or isn't published yet.")).toBeInTheDocument();
  });

  // source: the view event posts once after the form loads.
  it("posts the view event once", async () => {
    mockOpenForm();
    renderAt("/f/hello");
    await screen.findByRole("heading", { name: "Hello form" });
    await waitFor(() => expect(eventsOf("view")).toHaveLength(1));
    expect(eventsOf("view")).toHaveLength(1);
  });

  // source: the start event posts once on the first answer and not again.
  it("posts the start event once on first input", async () => {
    mockOpenForm();
    renderAt("/f/hello");
    const user = userEvent.setup();
    const name = await screen.findByLabelText(/Your name/);
    await user.type(name, "A");
    await waitFor(() => expect(eventsOf("start")).toHaveLength(1));
    await user.type(name, "da");
    expect(eventsOf("start")).toHaveLength(1);
  });

  // source: the honeypot field exists, is empty, and stays out of the tab order.
  it("renders an empty honeypot", async () => {
    mockOpenForm();
    renderAt("/f/hello");
    await screen.findByRole("heading", { name: "Hello form" });
    const field = document.querySelector("input[name='website']");
    if (!(field instanceof HTMLInputElement)) throw new Error("honeypot missing");
    expect(field.value).toBe("");
    expect(field.tabIndex).toBe(-1);
    expect(field.autocomplete).toBe("off");
    expect(field.parentElement?.getAttribute("aria-hidden")).toBe("true");
  });
});
