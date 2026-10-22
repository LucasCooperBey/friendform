// source: PublicFormPage renders a published form, conditional questions, validation, and submit states.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FormSchema, ThankYouSettings } from "@shared/form-schema";
import { App } from "@/App";
import { PublicFormView } from "@/components/public-form/PublicFormView";
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
    const field = document.querySelector("input[name='ff-leave-blank']");
    if (!(field instanceof HTMLInputElement)) throw new Error("honeypot missing");
    expect(field.value).toBe("");
    expect(field.tabIndex).toBe(-1);
    expect(field.autocomplete).toBe("off");
    expect(field.parentElement?.getAttribute("aria-hidden")).toBe("true");
    expect(field.getAttribute("data-1p-ignore")).not.toBeNull();
    expect(field.getAttribute("data-lpignore")).toBe("true");
  });

  // source: the honeypot name, id, and label avoid autofill words, and the field sets data-1p-ignore, data-lpignore, and data-bwignore
  it("hides the honeypot from password managers", async () => {
    mockOpenForm();
    renderAt("/f/hello");
    await screen.findByRole("heading", { name: "Hello form" });
    const field = document.querySelector("input[name='ff-leave-blank']");
    if (!(field instanceof HTMLInputElement)) throw new Error("honeypot missing");
    expect(field.id).toBe("ff-leave-blank");
    expect(field.name).toBe("ff-leave-blank");
    expect(field.labels?.[0]?.textContent).toBe("Leave blank");
    const label = `${field.name} ${field.id} ${field.labels?.[0]?.textContent ?? ""}`.toLowerCase();
    for (const word of ["website", "url", "name", "email", "phone", "address", "company"]) {
      expect(label).not.toContain(word);
    }
    expect(field.getAttribute("data-1p-ignore")).toBe("true");
    expect(field.getAttribute("data-lpignore")).toBe("true");
    expect(field.getAttribute("data-bwignore")).toBe("true");
    expect(field.autocomplete).toBe("off");
    expect(field.tabIndex).toBe(-1);
    expect(field.parentElement?.getAttribute("aria-hidden")).toBe("true");
  });

  function renderRedirect(mode: "live" | "preview", delay: number) {
    const thankYou: ThankYouSettings = {
      title: "Thanks",
      message: "Saved",
      redirectUrl: "https://example.com/next",
      redirectDelaySeconds: delay,
    };
    return render(
      <PublicFormView
        mode={mode}
        onSubmit={async () => ({ ok: true })}
        form={{
          title: "Hello form",
          description: "",
          schema: {
            sections: [{
              title: "About",
              questions: [{ questionId: "name", type: "text", prompt: "Your name", required: false }],
            }],
          },
          settings: { theme: "light", showProgress: false, thankYou },
        }}
      />,
    );
  }

  // source: a preview thank-you page shows the destination and does not leave the editor
  it("shows where a preview would redirect without leaving the page", async () => {
    const before = window.location.href;
    const user = userEvent.setup();
    renderRedirect("preview", 0);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("People would be sent to https://example.com/next")).toBeInTheDocument();
    expect(screen.queryByText(/Redirecting in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Taking you onward/)).not.toBeInTheDocument();
    expect(window.location.href).toBe(before);
  });

  // source: the thank-you countdown says Redirecting in N seconds
  it("counts a live redirect down in seconds", async () => {
    const user = userEvent.setup();
    renderRedirect("live", 4);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Redirecting in 4 seconds.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue now" })).toHaveAttribute("href", "https://example.com/next");
  });

  // source: the redirect countdown says "1 seconds" when one second is left
  it("says second when one second is left", async () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    try {
      const user = userEvent.setup();
      renderRedirect("live", 2);
      await user.click(screen.getByRole("button", { name: "Submit" }));
      expect(screen.getByText("Redirecting in 2 seconds.")).toBeInTheDocument();
      expect(await screen.findByText("Redirecting in 1 second.", {}, { timeout: 5000 })).toBeInTheDocument();
    } finally {
      assign.mockRestore();
    }
  });

  // source: an unparsed number on a question conditional logic has hidden still blocks submit, and Enter a number stays on that hidden question
  it("submits when an unparsed number is on a hidden question", async () => {
    const posted: unknown[] = [];
    const user = userEvent.setup();
    render(
      <PublicFormView
        mode="live"
        onSubmit={async (body) => {
          posted.push(body);
          return { ok: true };
        }}
        form={{
          title: "Count form",
          description: "",
          schema: {
            sections: [{
              title: "About",
              questions: [
                {
                  questionId: "choice",
                  type: "radio",
                  prompt: "Include a count",
                  required: true,
                  metadata: { options: ["Yes", "No"] },
                },
                {
                  questionId: "count",
                  type: "number",
                  prompt: "Count",
                  required: false,
                  metadata: {
                    conditionalLogic: { enabled: true, questionId: "choice", operator: "equals", value: "Yes" },
                  },
                },
              ],
            }],
          },
          settings: {
            theme: "light",
            showProgress: false,
            thankYou: { title: "Thanks", message: "Saved" },
          },
        }}
      />,
    );
    await user.click(screen.getByRole("radio", { name: "Yes" }));
    const count = await screen.findByLabelText("Count");
    await user.type(count, "5,5");
    expect(count).toHaveValue("5,5");
    expect(screen.getByText("Enter a number.")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "No" }));
    expect(screen.queryByRole("textbox", { name: "Count" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Enter a number.");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(posted).toHaveLength(1);
    const body = posted[0];
    if (!isRecord(body) || !isRecord(body.responses)) throw new Error("missing submission");
    expect(body).toMatchObject({ responses: { choice: "No" }, website: "" });
    expect(body.responses).not.toHaveProperty("count");
  });
});
