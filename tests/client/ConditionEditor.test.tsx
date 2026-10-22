// source: ConditionEditor lists only earlier questions and the operators that fit the controlling question's type.
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { FormSchema } from "@shared/form-schema";
import { QuestionsTab } from "@/components/editor/QuestionsTab";

const schema: FormSchema = {
  sections: [
    {
      title: "One",
      questions: [
        { questionId: "q1", type: "text", prompt: "First", required: false },
        { questionId: "q2", type: "checkbox", prompt: "Second", required: false, metadata: { options: ["Red", "Blue"] } },
      ],
    },
    {
      title: "Two",
      questions: [{ questionId: "q3", type: "text", prompt: "Third", required: false }],
    },
  ],
};

function Host() {
  const [current, setCurrent] = useState(schema);
  return <QuestionsTab description="" schema={current} onDescription={() => undefined} onSchema={setCurrent} />;
}

describe("ConditionEditor", () => {
  // source: the controlling list is earlier questions only, and a question with none says so.
  it("offers only earlier questions", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const first = screen.getByRole("article", { name: "First" });
    await user.click(within(first).getByRole("button", { name: "Edit First" }));
    await user.click(within(first).getByRole("switch", { name: /Only show this question when/ }));
    expect(within(first).getByText("Add a question above this one first")).toBeInTheDocument();

    const third = screen.getByRole("article", { name: "Third" });
    await user.click(within(third).getByRole("button", { name: "Edit Third" }));
    await user.click(within(third).getByRole("switch", { name: /Only show this question when/ }));
    await user.click(within(third).getByRole("combobox", { name: "Controlling question" }));
    expect(screen.getByRole("option", { name: "First" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Second" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Third" })).not.toBeInTheDocument();
  });

  // source: a text controller offers contains, and a checkbox controller offers includes.
  it("offers the operators for the controlling type", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const third = screen.getByRole("article", { name: "Third" });
    await user.click(within(third).getByRole("button", { name: "Edit Third" }));
    await user.click(within(third).getByRole("switch", { name: /Only show this question when/ }));
    await user.click(within(third).getByRole("combobox", { name: "Operator" }));
    expect(screen.getByRole("option", { name: "contains" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "includes" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(within(third).getByRole("combobox", { name: "Controlling question" }));
    await user.click(screen.getByRole("option", { name: "Second" }));
    await user.click(within(third).getByRole("combobox", { name: "Operator" }));
    expect(screen.getByRole("option", { name: "includes" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "contains" })).not.toBeInTheDocument();
  });

  // source: turning a condition back on restores the condition kept while it was off
  it("restores the condition that was turned off", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const third = screen.getByRole("article", { name: "Third" });
    await user.click(within(third).getByRole("button", { name: "Edit Third" }));
    await user.click(within(third).getByRole("switch", { name: /Only show this question when/ }));
    await user.click(within(third).getByRole("combobox", { name: "Controlling question" }));
    await user.click(screen.getByRole("option", { name: "Second" }));
    await user.click(within(third).getByRole("combobox", { name: "Comparison value" }));
    await user.click(screen.getByRole("option", { name: "Blue" }));
    expect(within(third).getByRole("combobox", { name: "Operator" })).toHaveTextContent("includes");
    await user.click(within(third).getByRole("switch", { name: /Only show this question when/ }));
    expect(within(third).queryByRole("combobox", { name: "Controlling question" })).not.toBeInTheDocument();
    await user.click(within(third).getByRole("switch", { name: /Only show this question when/ }));
    expect(within(third).getByRole("combobox", { name: "Controlling question" })).toHaveTextContent("Second");
    expect(within(third).getByRole("combobox", { name: "Operator" })).toHaveTextContent("includes");
    expect(within(third).getByRole("combobox", { name: "Comparison value" })).toHaveTextContent("Blue");
  });

  // source: turning a condition back on must not restore a controlling question that was deleted or an operator that question type no longer allows
  it("starts a new condition when the kept one no longer fits", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const third = () => screen.getByRole("article", { name: "Third" });
    await user.click(within(third()).getByRole("button", { name: "Edit Third" }));
    await user.click(within(third()).getByRole("switch", { name: /Only show this question when/ }));
    await user.click(within(third()).getByRole("combobox", { name: "Controlling question" }));
    await user.click(screen.getByRole("option", { name: "Second" }));
    expect(within(third()).getByRole("combobox", { name: "Operator" })).toHaveTextContent("includes");
    await user.click(within(third()).getByRole("switch", { name: /Only show this question when/ }));

    const second = () => screen.getByRole("article", { name: "Second" });
    await user.click(within(second()).getByRole("button", { name: "Edit Second" }));
    await user.click(within(second()).getByRole("combobox", { name: "Question type" }));
    await user.click(screen.getByRole("option", { name: "Short text" }));
    await user.click(within(third()).getByRole("switch", { name: /Only show this question when/ }));
    expect(within(third()).getByRole("combobox", { name: "Controlling question" })).toHaveTextContent("First");
    expect(within(third()).getByRole("combobox", { name: "Operator" }).textContent?.trim()).toBe("is");
    await user.click(within(third()).getByRole("switch", { name: /Only show this question when/ }));

    await user.click(within(screen.getByRole("article", { name: "First" })).getByRole("button", { name: "Delete: First" }));
    await user.click(within(third()).getByRole("switch", { name: /Only show this question when/ }));
    expect(within(third()).getByRole("combobox", { name: "Controlling question" })).toHaveTextContent("Second");
    expect(within(third()).getByRole("combobox", { name: "Operator" }).textContent?.trim()).toBe("is");
    expect(within(third()).queryByText("Choose a question")).not.toBeInTheDocument();
  });
});
