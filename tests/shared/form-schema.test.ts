// source: shared/form-schema.ts drafts, publishProblems, normalizeSchema, and newQuestionId

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  allQuestions,
  emptySchema,
  formSchemaZ,
  formSettingsZ,
  newQuestionId,
  normalizeSchema,
  publishProblems,
  type FormSchema,
  type Question,
} from "../../shared/form-schema";

function q(partial: Question): Question {
  return partial;
}

describe("form schema helpers", () => {
  it("starts from one empty section and lists questions in document order", () => {
    // source: emptySchema and allQuestions
    const schema = emptySchema();
    expect(schema).toEqual({ sections: [{ title: "Untitled section", questions: [] }] });
    const listed = allQuestions({
      sections: [
        { title: "A", questions: [q({ questionId: "a", type: "text", prompt: "A", required: false })] },
        { title: "B", questions: [q({ questionId: "b", type: "text", prompt: "B", required: false })] },
      ],
    });
    expect(listed.map((question) => question.questionId)).toEqual(["a", "b"]);
  });

  it("accepts a half-finished draft and strips unknown keys", () => {
    // source: formSchemaZ allows empty prompts, empty options, blank titles, and choice questions without options
    const parsed = formSchemaZ.parse({
      extra: true,
      sections: [
        {
          title: "",
          bonus: 1,
          questions: [
            {
              questionId: "q1",
              type: "radio",
              prompt: "",
              required: false,
              unknown: 1,
              metadata: { options: [""], extra: true },
            },
          ],
        },
      ],
    });
    expect(parsed).toEqual({
      sections: [
        {
          title: "",
          questions: [
            {
              questionId: "q1",
              type: "radio",
              prompt: "",
              required: false,
              metadata: { options: [""] },
            },
          ],
        },
      ],
    });
  });

  it("rejects ids, lengths, counts, and non-finite numbers that a draft must not store", () => {
    // source: formSchemaZ limits question ids, text length, section counts, and finite numbers
    expect(formSchemaZ.safeParse({ sections: [{ title: "S", questions: [q({ questionId: "1bad", type: "text", prompt: "P", required: false })] }] }).success).toBe(false);
    const tooLong = "a".repeat(65);
    expect(formSchemaZ.safeParse({ sections: [{ title: "S", questions: [q({ questionId: tooLong, type: "text", prompt: "P", required: false })] }] }).success).toBe(false);
    expect(formSchemaZ.safeParse({ sections: [{ title: "S", questions: [q({ questionId: "a", type: "text", prompt: "p".repeat(501), required: false })] }] }).success).toBe(false);
    expect(formSchemaZ.safeParse({ sections: [{ title: "t".repeat(201), questions: [] }] }).success).toBe(false);
    expect(formSchemaZ.safeParse({ sections: [{ title: "S", description: "d".repeat(2001), questions: [] }] }).success).toBe(false);
    const questions = Array.from({ length: 201 }, (_, index) =>
      q({ questionId: `q${index}`, type: "text", prompt: "P", required: false }),
    );
    expect(formSchemaZ.safeParse({ sections: [{ title: "S", questions }] }).success).toBe(false);
    const sections = Array.from({ length: 51 }, () => ({ title: "S", questions: [] }));
    expect(formSchemaZ.safeParse({ sections }).success).toBe(false);
    expect(
      formSchemaZ.safeParse({
        sections: [
          {
            title: "S",
            questions: [q({ questionId: "a", type: "number", prompt: "P", required: false, metadata: { min: Number.POSITIVE_INFINITY } })],
          },
        ],
      }).success,
    ).toBe(false);
    const options = Array.from({ length: 101 }, (_, index) => `o${index}`);
    expect(
      formSchemaZ.safeParse({
        sections: [{ title: "S", questions: [q({ questionId: "a", type: "radio", prompt: "P", required: false, metadata: { options } })] }],
      }).success,
    ).toBe(false);
  });

  it("fills settings defaults and rejects bad redirects and webhooks", () => {
    // source: formSettingsZ fills defaults, strips unknown keys, and checks URLs and limits
    expect(formSettingsZ.parse({})).toEqual(DEFAULT_SETTINGS);
    const partial = formSettingsZ.parse({ theme: "dark", extra: true, thankYou: { title: "Thanks" } });
    expect(partial.theme).toBe("dark");
    expect(partial).not.toHaveProperty("extra");
    expect(partial.thankYou).toEqual({ title: "Thanks", message: "Your response has been recorded." });
    expect(partial.webhooks).toEqual([]);
    expect(formSettingsZ.safeParse({ thankYou: { redirectUrl: "javascript:alert(1)" } }).success).toBe(false);
    expect(
      formSettingsZ.safeParse({
        thankYou: { redirectUrl: "http://127.0.0.1:3000/thanks", redirectDelaySeconds: 0 },
      }).success,
    ).toBe(true);
    expect(formSettingsZ.safeParse({ thankYou: { redirectUrl: "ftp://files.invalid/x" } }).success).toBe(false);
    expect(formSettingsZ.safeParse({ thankYou: { redirectDelaySeconds: 61 } }).success).toBe(false);
    expect(formSettingsZ.safeParse({ thankYou: { redirectDelaySeconds: 1.5 } }).success).toBe(false);
    expect(formSettingsZ.safeParse({ closedMessage: "c".repeat(501) }).success).toBe(false);
    const webhooks = Array.from({ length: 11 }, (_, index) => ({
      id: `hook${index}`,
      url: "https://receiver.invalid/hook",
      format: "json" as const,
      enabled: true,
    }));
    expect(formSettingsZ.safeParse({ webhooks }).success).toBe(false);
    expect(
      formSettingsZ.safeParse({
        webhooks: [{ id: "h".repeat(65), url: "https://receiver.invalid/hook", format: "json", enabled: true }],
      }).success,
    ).toBe(false);
  });

  it("refuses a webhook URL that is not http or https", () => {
    // source: formSettingsZ refuses a webhook URL whose protocol is not http or https, such as ftp://example.com/hook
    expect(
      formSettingsZ.safeParse({
        webhooks: [{ id: "hook", url: "ftp://example.com/hook", format: "json", enabled: true }],
      }).success,
    ).toBe(false);
  });
});

describe("publishProblems", () => {
  it("names each problem, including an empty form and an empty prompt", () => {
    // source: publishProblems reports no questions and an empty prompt by position
    expect(publishProblems(emptySchema())).toEqual(["Add at least one question before publishing."]);
    expect(
      publishProblems({
        sections: [{ title: "First", questions: [q({ questionId: "a", type: "text", prompt: "  ", required: false })] }],
      }),
    ).toEqual(["Question 1 in section 1 has an empty prompt."]);
  });

  it("reports duplicate ids, choice options, ranges, selection limits, and conditions", () => {
    // source: publishProblems covers duplicate ids, options, rating, number, checkbox, and conditions
    const schema: FormSchema = {
      sections: [
        {
          title: "First",
          questions: [
            q({ questionId: "a", type: "text", prompt: "One", required: false }),
            q({ questionId: "b", type: "text", prompt: "Two", required: false }),
            q({ questionId: "b", type: "text", prompt: "Three", required: false }),
            q({ questionId: "choice", type: "radio", prompt: "Pick", required: false, metadata: { options: ["A", " A ", " "] } }),
            q({ questionId: "empty_choice", type: "dropdown", prompt: "Empty", required: false }),
            q({ questionId: "rate", type: "rating", prompt: "Rate", required: false, metadata: { min: 11, max: 11 } }),
            q({ questionId: "count", type: "number", prompt: "Count", required: false, metadata: { min: 4, max: 3 } }),
            q({
              questionId: "boxes",
              type: "checkbox",
              prompt: "Choose",
              required: false,
              metadata: { options: ["a", "b"], minSelections: 3, maxSelections: 1 },
            }),
            q({
              questionId: "loop",
              type: "text",
              prompt: "Loop",
              required: false,
              metadata: { conditionalLogic: { enabled: true, questionId: "loop", operator: "equals", value: "x" } },
            }),
            q({
              questionId: "later",
              type: "text",
              prompt: "Later",
              required: false,
              metadata: { conditionalLogic: { enabled: true, questionId: "missing", operator: "equals", value: "x" } },
            }),
          ],
        },
      ],
    };
    expect(publishProblems(schema)).toEqual([
      'Question 3 in section 1 ("Three") uses the same id as an earlier question.',
      'Question 4 in section 1 ("Pick") has an empty option.',
      'Question 4 in section 1 ("Pick") has repeated options.',
      'Question 5 in section 1 ("Empty") needs at least one option.',
      'Question 6 in section 1 ("Rate") has a rating minimum or maximum outside 0 to 10.',
      'Question 6 in section 1 ("Rate") has a minimum that is not lower than its maximum.',
      'Question 7 in section 1 ("Count") has a minimum greater than its maximum.',
      'Question 8 in section 1 ("Choose") asks for more selections than its maximum.',
      'Question 8 in section 1 ("Choose") asks for more selections than it has options.',
      'Question 9 in section 1 ("Loop") depends on itself.',
      'Question 10 in section 1 ("Later") depends on a question that does not appear earlier.',
    ]);
  });

  it("allows a condition that points at an earlier question and ignores a disabled self check", () => {
    // source: a condition is publishable when it points at an earlier question, and a disabled one is ignored
    const schema: FormSchema = {
      sections: [
        {
          title: "First",
          questions: [
            q({
              questionId: "a",
              type: "text",
              prompt: "First",
              required: false,
              metadata: { conditionalLogic: { enabled: false, questionId: "a", operator: "equals", value: "x" } },
            }),
            q({
              questionId: "b",
              type: "text",
              prompt: "Second",
              required: false,
              metadata: { conditionalLogic: { enabled: true, questionId: "a", operator: "is_not_empty" } },
            }),
          ],
        },
      ],
    };
    expect(publishProblems(schema)).toEqual([]);
  });

  it("refuses a condition that references a later question", () => {
    // source: publishProblems refuses a condition whose question appears later in the form
    expect(
      publishProblems({
        sections: [
          {
            title: "First",
            questions: [
              q({
                questionId: "early",
                type: "text",
                prompt: "Early",
                required: false,
                metadata: {
                  conditionalLogic: { enabled: true, questionId: "late", operator: "equals", value: "x" },
                },
              }),
              q({ questionId: "late", type: "text", prompt: "Late", required: false }),
            ],
          },
        ],
      }),
    ).toEqual(['Question 1 in section 1 ("Early") depends on a question that does not appear earlier.']);
  });
});

describe("normalizeSchema and newQuestionId", () => {
  it("trims text fields and leaves the input unchanged", () => {
    // source: normalizeSchema trims titles, prompts, options, placeholders, and string condition values
    const schema: FormSchema = {
      sections: [
        {
          title: "  Hello  ",
          description: "  About  ",
          questions: [
            q({
              questionId: "a",
              type: "radio",
              prompt: "  Pick  ",
              subtext: "  More  ",
              required: false,
              metadata: {
                options: ["  A  "],
                placeholder: "  type  ",
                min: 1,
                conditionalLogic: { enabled: true, questionId: "b", operator: "equals", value: "  Yes  " },
              },
            }),
          ],
        },
      ],
    };
    const normalized = normalizeSchema(schema);
    expect(normalized.sections[0]?.title).toBe("Hello");
    expect(normalized.sections[0]?.description).toBe("About");
    expect(normalized.sections[0]?.questions[0]?.prompt).toBe("Pick");
    expect(normalized.sections[0]?.questions[0]?.subtext).toBe("More");
    expect(normalized.sections[0]?.questions[0]?.metadata?.options).toEqual(["A"]);
    expect(normalized.sections[0]?.questions[0]?.metadata?.placeholder).toBe("type");
    expect(normalized.sections[0]?.questions[0]?.metadata?.conditionalLogic?.value).toBe("Yes");
    expect(schema.sections[0]?.title).toBe("  Hello  ");
  });

  it("builds a q_ id that is not already taken", () => {
    // source: newQuestionId is q_ plus 6 lowercase letters or digits, retried until unused
    let calls = 0;
    const id = newQuestionId(["q_aaaaaa"], () => {
      calls += 1;
      return calls === 1 ? "aaaaaa" : "bbbbbb";
    });
    expect(id).toBe("q_bbbbbb");
    expect(newQuestionId([])).toMatch(/^q_[a-z0-9]{6}$/);
  });
});
