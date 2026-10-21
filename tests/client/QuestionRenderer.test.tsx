// source: QuestionRenderer emits the value type for each question and shows field errors.
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Question, ResponseValue } from "@shared/form-schema";
import { QuestionRenderer } from "@/components/public-form/QuestionRenderer";

function Harness({ question, error }: { question: Question; error?: string }) {
  const [value, setValue] = useState<ResponseValue | undefined>(undefined);
  return (
    <>
      <QuestionRenderer question={question} value={value} onChange={setValue} error={error} />
      <output data-testid="value">{JSON.stringify(value ?? null)}</output>
    </>
  );
}

function valueText(): string {
  return screen.getByTestId("value").textContent ?? "";
}

describe("QuestionRenderer", () => {
  // source: a text question emits a string.
  it("emits a string for text", async () => {
    const user = userEvent.setup();
    render(
      <Harness question={{ questionId: "name", type: "text", prompt: "Your name", required: false }} />,
    );
    await user.type(screen.getByLabelText("Your name"), "Ada");
    expect(valueText()).toBe(JSON.stringify("Ada"));
  });

  // source: an email question emits a string from an email input.
  it("emits a string for email", async () => {
    const user = userEvent.setup();
    render(
      <Harness question={{ questionId: "email", type: "email", prompt: "Email", required: false }} />,
    );
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("type", "email");
    await user.type(input, "ada@example.com");
    expect(valueText()).toBe(JSON.stringify("ada@example.com"));
  });

  // source: a phone question emits a string from a tel input.
  it("emits a string for phone", async () => {
    const user = userEvent.setup();
    render(
      <Harness question={{ questionId: "phone", type: "phone", prompt: "Phone", required: false }} />,
    );
    const input = screen.getByLabelText("Phone");
    expect(input).toHaveAttribute("type", "tel");
    await user.type(input, "2065550100");
    expect(valueText()).toBe(JSON.stringify("2065550100"));
  });

  // source: a textarea emits a string.
  it("emits a string for textarea", async () => {
    const user = userEvent.setup();
    render(
      <Harness question={{ questionId: "notes", type: "textarea", prompt: "Notes", required: false }} />,
    );
    await user.type(screen.getByLabelText("Notes"), "Hello");
    expect(valueText()).toBe(JSON.stringify("Hello"));
  });

  // source: a number question emits a number, and a cleared field emits nothing.
  it("emits a number or nothing for number", async () => {
    const user = userEvent.setup();
    render(
      <Harness question={{ questionId: "count", type: "number", prompt: "Count", required: false }} />,
    );
    const input = screen.getByLabelText("Count");
    expect(input).toHaveAttribute("inputmode", "decimal");
    await user.type(input, "12");
    expect(valueText()).toBe(JSON.stringify(12));
    await user.clear(input);
    expect(valueText()).toBe(JSON.stringify(null));
  });

  // source: a date question emits YYYY-MM-DD.
  it("emits a date string", () => {
    render(
      <Harness question={{ questionId: "when", type: "date", prompt: "When", required: false }} />,
    );
    fireEvent.change(screen.getByLabelText("When"), { target: { value: "2026-10-20" } });
    expect(valueText()).toBe(JSON.stringify("2026-10-20"));
  });

  // source: a radio question emits the chosen option string.
  it("emits a string for radio", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        question={{
          questionId: "channel",
          type: "radio",
          prompt: "Channel",
          required: false,
          metadata: { options: ["Email", "Phone"] },
        }}
      />,
    );
    await user.click(screen.getByRole("radio", { name: "Email" }));
    expect(valueText()).toBe(JSON.stringify("Email"));
  });

  // source: a checkbox question emits a string array.
  it("emits a string array for checkbox", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        question={{
          questionId: "topics",
          type: "checkbox",
          prompt: "Topics",
          required: false,
          metadata: { options: ["Design", "Build"] },
        }}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Design" }));
    await user.click(screen.getByRole("checkbox", { name: "Build" }));
    expect(valueText()).toBe(JSON.stringify(["Design", "Build"]));
  });

  // source: Select all fills the checkbox array, and maxSelections shows its hint.
  it("selects every checkbox option", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        question={{
          questionId: "topics",
          type: "checkbox",
          prompt: "Topics",
          required: false,
          metadata: { options: ["Design", "Build"], allowSelectAll: true, maxSelections: 2 },
        }}
      />,
    );
    expect(screen.getByText("Choose up to 2.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(valueText()).toBe(JSON.stringify(["Design", "Build"]));
  });

  // source: a dropdown emits the chosen option string.
  it("emits a string for dropdown", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        question={{
          questionId: "size",
          type: "dropdown",
          prompt: "Size",
          required: false,
          metadata: { options: ["Small", "Large"] },
        }}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Size" })).toHaveTextContent("Choose one");
    await user.click(screen.getByRole("combobox", { name: "Size" }));
    await user.click(await screen.findByRole("option", { name: "Large" }));
    expect(valueText()).toBe(JSON.stringify("Large"));
  });

  // source: a rating question emits the pressed score as a number.
  it("emits a number for rating", async () => {
    const user = userEvent.setup();
    render(
      <Harness question={{ questionId: "score", type: "rating", prompt: "Score", required: false }} />,
    );
    const four = screen.getByRole("button", { name: "4" });
    expect(four).toHaveAttribute("aria-pressed", "false");
    await user.click(four);
    expect(valueText()).toBe(JSON.stringify(4));
    expect(four).toHaveAttribute("aria-pressed", "true");
  });

  // source: rating buttons move the score with the arrow keys.
  it("changes a rating from the keyboard", async () => {
    const user = userEvent.setup();
    render(
      <Harness question={{ questionId: "score", type: "rating", prompt: "Score", required: false }} />,
    );
    const four = screen.getByRole("button", { name: "4" });
    four.focus();
    await user.keyboard("{ArrowRight}");
    expect(valueText()).toBe(JSON.stringify(5));
  });

  // source: a field error is visible and tied to the input.
  it("shows an error on the input", () => {
    render(
      <Harness
        question={{ questionId: "name", type: "text", prompt: "Your name", required: true }}
        error="Enter your name."
      />,
    );
    const input = screen.getByLabelText(/Your name/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "name-error");
    expect(screen.getByText("Enter your name.")).toBeInTheDocument();
    expect(screen.getByText("required")).toBeInTheDocument();
  });
});
