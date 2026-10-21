// source: QuestionCard drops metadata the new type does not use, paste splits options, and new ids come from newQuestionId.
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { allQuestions, emptySchema, type FormSchema, type Question } from "@shared/form-schema";
import { QuestionCard } from "@/components/editor/QuestionCard";
import { QuestionsTab } from "@/components/editor/QuestionsTab";

const tracked = vi.hoisted(() => {
  const takenCalls: string[][] = [];
  let call = 0;
  return {
    takenCalls,
    next() {
      call += 1;
      return `fixed${call}`;
    },
  };
});

vi.mock("@shared/form-schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/form-schema")>();
  return {
    ...actual,
    newQuestionId: (taken: Iterable<string>, random?: () => string) => {
      tracked.takenCalls.push([...taken]);
      return actual.newQuestionId(taken, random ?? (() => tracked.next()));
    },
  };
});

const checkbox: Question = {
  questionId: "q_keep",
  type: "checkbox",
  prompt: "Pick",
  subtext: "Helpful",
  required: true,
  metadata: {
    options: ["A", "B"],
    placeholder: "Choose",
    minSelections: 1,
    maxSelections: 2,
    allowSelectAll: true,
    conditionalLogic: { enabled: false, questionId: "q_prev", operator: "equals", value: "A" },
  },
};

function noop() {
  return undefined;
}

describe("QuestionCard", () => {
  // source: changing checkbox to email keeps prompt, help, required, placeholder, and conditional logic, and drops choice metadata.
  it("drops unused metadata when the type changes", async () => {
    const user = userEvent.setup();
    let latest = checkbox;
    function Host() {
      const [question, setQuestion] = useState(checkbox);
      return (
        <QuestionCard
          question={question}
          earlier={[]}
          canMoveUp={false}
          canMoveDown={false}
          defaultExpanded
          onChange={(next) => {
            latest = next;
            setQuestion(next);
          }}
          onDuplicate={noop}
          onMoveUp={noop}
          onMoveDown={noop}
          onDelete={noop}
        />
      );
    }
    render(<Host />);
    await user.click(screen.getByRole("combobox", { name: "Question type" }));
    await user.click(await screen.findByRole("option", { name: "Email" }));
    expect(latest.type).toBe("email");
    expect(latest.prompt).toBe("Pick");
    expect(latest.subtext).toBe("Helpful");
    expect(latest.required).toBe(true);
    expect(latest.metadata?.placeholder).toBe("Choose");
    expect(latest.metadata?.conditionalLogic).toEqual(checkbox.metadata?.conditionalLogic);
    expect(latest.metadata?.options).toBeUndefined();
    expect(latest.metadata?.minSelections).toBeUndefined();
    expect(latest.metadata?.maxSelections).toBeUndefined();
    expect(latest.metadata?.allowSelectAll).toBeUndefined();
    expect(screen.queryByRole("textbox", { name: "Option 1" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Placeholder")).toHaveValue("Choose");
  });

  // source: Paste a list splits lines, trims them, and drops blanks and duplicates.
  it("splits a pasted option list and drops duplicates", async () => {
    const user = userEvent.setup();
    const radio: Question = {
      questionId: "q_opts",
      type: "radio",
      prompt: "Color",
      required: false,
      metadata: { options: ["Option 1", "Option 2"] },
    };
    function Host() {
      const [question, setQuestion] = useState(radio);
      return (
        <QuestionCard
          question={question}
          earlier={[]}
          canMoveUp={false}
          canMoveDown={false}
          defaultExpanded
          onChange={setQuestion}
          onDuplicate={noop}
          onMoveUp={noop}
          onMoveDown={noop}
          onDelete={noop}
        />
      );
    }
    render(<Host />);
    await user.click(screen.getByRole("button", { name: "Paste a list" }));
    const list = await screen.findByRole("textbox", { name: "Option list" });
    list.focus();
    await user.paste("Red\nBlue\nRed\n\n Blue \nGreen");
    expect(screen.getByRole("textbox", { name: "Option 1" })).toHaveValue("Red");
    expect(screen.getByRole("textbox", { name: "Option 2" })).toHaveValue("Blue");
    expect(screen.getByRole("textbox", { name: "Option 3" })).toHaveValue("Green");
    expect(screen.queryByDisplayValue("Option 1")).not.toBeInTheDocument();
  });

  // source: a new question and a duplicate each take a fresh id from newQuestionId over the ids already in the draft.
  it("gives a new question and a duplicate fresh ids from newQuestionId", async () => {
    const user = userEvent.setup();
    function Host() {
      const [schema, setSchema] = useState<FormSchema>(emptySchema());
      const ids = allQuestions(schema)
        .map((question) => question.questionId)
        .join(",");
      return (
        <>
          <p data-testid="ids">{ids}</p>
          <QuestionsTab description="" schema={schema} onDescription={noop} onSchema={setSchema} />
        </>
      );
    }
    render(<Host />);
    await user.click(screen.getByRole("button", { name: "Add question" }));
    await user.click(await screen.findByRole("menuitem", { name: "Short text" }));
    await user.click(screen.getByRole("button", { name: "Add question" }));
    await user.click(await screen.findByRole("menuitem", { name: "Email" }));
    await user.click(screen.getAllByRole("button", { name: "Duplicate: Untitled question" })[0]!);
    expect(screen.getByTestId("ids")).toHaveTextContent("q_fixed1,q_fixed3,q_fixed2");
    expect(tracked.takenCalls[2]).toEqual(["q_fixed1", "q_fixed2"]);
  });
});
