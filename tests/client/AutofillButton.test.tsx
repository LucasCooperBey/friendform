// source: Fill from a document checks the file size, confirms overwrites, and posts a start event from the public page.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FormSchema } from "@shared/form-schema";
import { App } from "@/App";
import { PublicFormView } from "@/components/public-form/PublicFormView";
import { Toaster } from "@/components/ui/toaster";
import { isRecord } from "@/lib/utils";
import { callsTo, mockRoute, type MockResponse } from "./fetch-mock";

const schema: FormSchema = {
  sections: [{
    title: "About",
    questions: [
      { questionId: "name", type: "text", prompt: "Your name", required: false },
      { questionId: "city", type: "text", prompt: "City", required: false },
    ],
  }],
};

const PATH = "/api/public/forms/hello/autofill";

function liveForm(allowAutofill: boolean) {
  return {
    title: "Hello form",
    description: "",
    schema,
    settings: {
      theme: "light" as const,
      showProgress: false,
      thankYou: { title: "Thanks", message: "Saved" },
      allowAutofill,
    },
  };
}

function renderLive(options: { allowAutofill?: boolean; slug?: string; mode?: "live" | "preview"; onFirstInput?: () => void } = {}) {
  const slug = "slug" in options ? options.slug : "hello";
  return render(
    <>
      <PublicFormView
        form={liveForm(options.allowAutofill ?? true)}
        mode={options.mode ?? "live"}
        autofillSlug={slug}
        onFirstInput={options.onFirstInput}
      />
      <Toaster />
    </>,
  );
}

describe("AutofillButton", () => {
  // source: a file over 5 MB is refused in the browser and is not uploaded.
  it("refuses a file over 5 MB before upload", async () => {
    renderLive();
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.txt", { type: "text/plain" });
    expect(file.size).toBe(5 * 1024 * 1024 + 1);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Document"), file);
    expect(await screen.findByRole("alert")).toHaveTextContent("That file is over 5 MB.");
    expect(callsTo("POST", PATH)).toHaveLength(0);
    expect(screen.getByText("Your file goes to this form's AI service once to fill the answers. Friendform does not save it.")).toBeInTheDocument();
  });

  // source: the toast uses the server's filled count, including the singular sentence when filled is 1.
  it("toasts the server filled count", async () => {
    mockRoute("POST", PATH, { body: { answers: { name: "Ada", city: "Paris" }, filled: 1 } });
    renderLive();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Document"), new File(["Ada, Paris"], "notes.txt", { type: "text/plain" }));
    expect(await screen.findByText("Filled 1 answer. Check it before you submit.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Your name/)).toHaveValue("Ada");
    expect(screen.getByLabelText(/City/)).toHaveValue("Paris");
  });

  // source: an empty fill does not count as the first input.
  it("does not count an empty fill as the first input", async () => {
    mockRoute("POST", PATH, { body: { answers: {}, filled: 0 } });
    const onFirstInput = vi.fn();
    renderLive({ onFirstInput });
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Document"), new File(["nothing useful"], "notes.txt", { type: "text/plain" }));
    expect(await screen.findByText("Nothing in that file matched these questions.")).toBeInTheDocument();
    expect(onFirstInput).not.toHaveBeenCalled();
  });

  // source: a typed answer is replaced only after confirm, a keystroke during upload is seen, and a fill counts as the first input.
  it("confirms before replacing answers that were typed during upload", async () => {
    let release: (value: MockResponse) => void = () => undefined;
    mockRoute("POST", PATH, () => new Promise((resolve) => {
      release = resolve;
    }));
    const onFirstInput = vi.fn();
    renderLive({ onFirstInput });
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Document"), new File(["Ada lives in Paris"], "notes.txt", { type: "text/plain" }));
    await waitFor(() => expect(callsTo("POST", PATH)).toHaveLength(1));
    await user.type(screen.getByLabelText(/Your name/), "Bea");
    release({ body: { answers: { name: "Ada", city: "Paris" }, filled: 2 } });
    expect(await screen.findByText("This will replace 1 answer you already entered.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /City/, hidden: true })).toHaveValue("Paris");
    expect(screen.getByRole("textbox", { name: /Your name/, hidden: true })).toHaveValue("Bea");
    expect(onFirstInput).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText(/Your name/)).toHaveValue("Bea");
    await user.upload(screen.getByLabelText("Document"), new File(["Ada again"], "notes.txt", { type: "text/plain" }));
    await waitFor(() => expect(callsTo("POST", PATH)).toHaveLength(2));
    release({ body: { answers: { name: "Ada" }, filled: 1 } });
    await user.click(await screen.findByRole("button", { name: "Replace" }));
    expect(screen.getByLabelText(/Your name/)).toHaveValue("Ada");
    expect(onFirstInput).toHaveBeenCalledTimes(1);
  });

  // source: the button is hidden in preview, without the setting, and without a slug.
  it("hides the button outside a live form that allows it", () => {
    const { unmount } = renderLive({ mode: "preview" });
    expect(screen.queryByRole("button", { name: "Fill from a document" })).not.toBeInTheDocument();
    unmount();
    const hidden = renderLive({ allowAutofill: false });
    expect(screen.queryByRole("button", { name: "Fill from a document" })).not.toBeInTheDocument();
    hidden.unmount();
    renderLive({ slug: undefined });
    expect(screen.queryByRole("button", { name: "Fill from a document" })).not.toBeInTheDocument();
  });

  // source: the public page passes the slug and allowAutofill, and a fill posts the start event.
  it("fills from the public page and posts a start event", async () => {
    mockRoute("GET", "/api/public/forms/hello", {
      body: {
        slug: "hello",
        title: "Hello form",
        description: "",
        version: 1,
        schema,
        settings: {
          theme: "light",
          showProgress: false,
          thankYou: { title: "Thanks", message: "Saved" },
          allowAutofill: true,
        },
      },
    });
    mockRoute("POST", "/api/public/forms/hello/events", { status: 204 });
    mockRoute("POST", PATH, { body: { answers: { name: "Ada" }, filled: 3 } });
    window.history.pushState({}, "", "/f/hello");
    render(<App />);
    expect(await screen.findByRole("button", { name: "Fill from a document" })).toBeInTheDocument();
    expect(screen.getByText("Your file goes to this form's AI service once to fill the answers. Friendform does not save it.")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Document"), new File(["Ada"], "notes.txt", { type: "text/plain" }));
    expect(await screen.findByDisplayValue("Ada")).toBeInTheDocument();
    expect(await screen.findByText("Filled 3 answers. Check them before you submit.")).toBeInTheDocument();
    await waitFor(() => {
      expect(callsTo("POST", "/api/public/forms/hello/events").some((call) => isRecord(call.body) && call.body.type === "start")).toBe(true);
    });
  });
});
