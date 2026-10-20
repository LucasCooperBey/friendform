// source: shared/logic.ts empty values, comparisons, and visibility that ignores hidden answers

import { describe, expect, it } from "vitest";
import type { FormSchema, Question } from "../../shared/form-schema";
import { evaluateCondition, isEmptyValue, visibleQuestionIds } from "../../shared/logic";

function textQuestion(questionId: string, prompt = "Prompt"): Question {
  return { questionId, type: "text", prompt, required: false };
}

describe("isEmptyValue", () => {
  it("treats undefined, null, blank strings, and empty arrays as empty", () => {
    // source: isEmptyValue is true for undefined, null, "", whitespace, and []
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue("")).toBe(true);
    expect(isEmptyValue("   ")).toBe(true);
    expect(isEmptyValue([])).toBe(true);
  });

  it("treats 0, false, and non-empty answers as present", () => {
    // source: isEmptyValue is false for 0 and false
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue(false)).toBe(false);
    expect(isEmptyValue("0")).toBe(false);
    expect(isEmptyValue("a")).toBe(false);
    expect(isEmptyValue([""])).toBe(false);
  });
});

describe("evaluateCondition", () => {
  it("shows a question when the condition is missing or disabled", () => {
    // source: a missing or disabled condition returns true
    expect(evaluateCondition(undefined, {})).toBe(true);
    expect(
      evaluateCondition(
        { enabled: false, questionId: "a", operator: "equals", value: "yes" },
        { a: "no" },
      ),
    ).toBe(true);
  });

  it("compares numbers and numeric strings by value and strings case-sensitively", () => {
    // source: equals and not_equals compare 5 with "5" and keep string case
    expect(
      evaluateCondition({ enabled: true, questionId: "n", operator: "equals", value: "5" }, { n: 5 }),
    ).toBe(true);
    expect(
      evaluateCondition({ enabled: true, questionId: "n", operator: "equals", value: "5.0" }, { n: 5 }),
    ).toBe(true);
    expect(
      evaluateCondition({ enabled: true, questionId: "n", operator: "not_equals", value: 5 }, { n: "5" }),
    ).toBe(false);
    expect(
      evaluateCondition({ enabled: true, questionId: "n", operator: "equals", value: "Yes" }, { n: "yes" }),
    ).toBe(false);
    expect(
      evaluateCondition({ enabled: true, questionId: "n", operator: "equals", value: "Yes" }, { n: "Yes" }),
    ).toBe(true);
  });

  it("checks contains and not_contains without regard to case", () => {
    // source: contains and not_contains are case-insensitive substring checks
    expect(
      evaluateCondition({ enabled: true, questionId: "n", operator: "contains", value: "ELL" }, { n: "Hello" }),
    ).toBe(true);
    expect(
      evaluateCondition(
        { enabled: true, questionId: "n", operator: "contains", value: "alp" },
        { n: ["Alpha", "Beta"] },
      ),
    ).toBe(true);
    expect(
      evaluateCondition({ enabled: true, questionId: "n", operator: "not_contains", value: "zzz" }, { n: "Hello" }),
    ).toBe(true);
    expect(
      evaluateCondition({ enabled: true, questionId: "n", operator: "contains", value: "a" }, { n: 5 }),
    ).toBe(false);
    expect(
      evaluateCondition({ enabled: true, questionId: "n", operator: "not_contains", value: "a" }, {}),
    ).toBe(true);
  });

  it("matches array membership exactly and treats a missing array as not included", () => {
    // source: array_includes is an exact match and array_not_includes is its opposite
    expect(
      evaluateCondition(
        { enabled: true, questionId: "n", operator: "array_includes", value: "A" },
        { n: ["A", "B"] },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { enabled: true, questionId: "n", operator: "array_includes", value: "a" },
        { n: ["A"] },
      ),
    ).toBe(false);
    expect(
      evaluateCondition(
        { enabled: true, questionId: "n", operator: "array_not_includes", value: "C" },
        { n: ["A"] },
      ),
    ).toBe(true);
    expect(
      evaluateCondition({ enabled: true, questionId: "n", operator: "array_includes", value: "A" }, { n: "A" }),
    ).toBe(true);
  });

  it("does not treat a numeric 0 as empty", () => {
    // source: is_empty and is_not_empty use isEmptyValue, so 0 is not empty
    expect(evaluateCondition({ enabled: true, questionId: "n", operator: "is_empty" }, { n: 0 })).toBe(false);
    expect(evaluateCondition({ enabled: true, questionId: "n", operator: "is_not_empty" }, { n: 0 })).toBe(true);
    expect(evaluateCondition({ enabled: true, questionId: "n", operator: "is_empty" }, { n: "  " })).toBe(true);
    expect(evaluateCondition({ enabled: true, questionId: "n", operator: "is_empty" }, { n: [] })).toBe(true);
    expect(evaluateCondition({ enabled: true, questionId: "n", operator: "is_empty" }, {})).toBe(true);
  });
});

describe("visibleQuestionIds", () => {
  const schema: FormSchema = {
    sections: [
      {
        title: "One",
        questions: [
          textQuestion("a", "First"),
          {
            ...textQuestion("b", "Second"),
            metadata: { conditionalLogic: { enabled: true, questionId: "a", operator: "equals", value: "yes" } },
          },
          {
            ...textQuestion("c", "Third"),
            metadata: { conditionalLogic: { enabled: true, questionId: "b", operator: "equals", value: "go" } },
          },
        ],
      },
    ],
  };

  it("reveals a later question only from an answer on a question that is already visible", () => {
    // source: visibleQuestionIds walks document order and ignores answers on hidden questions
    expect(visibleQuestionIds(schema, { a: "yes", b: "go" })).toEqual(new Set(["a", "b", "c"]));
    expect(visibleQuestionIds(schema, { a: "no", b: "go" })).toEqual(new Set(["a"]));
    expect(visibleQuestionIds(schema, {})).toEqual(new Set(["a"]));
  });
});
