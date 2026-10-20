// source: shared/validate.ts keeps only visible answers and checks each question type

import { describe, expect, it } from "vitest";
import type { FormSchema, Question } from "../../shared/form-schema";
import { validateResponses } from "../../shared/validate";

function question(partial: Question): Question {
  return partial;
}

const schema: FormSchema = {
  sections: [
    {
      title: "Answers",
      questions: [
        question({ questionId: "gate", type: "radio", prompt: "Show the rest?", required: true, metadata: { options: ["yes", "no"] } }),
        question({
          questionId: "note",
          type: "text",
          prompt: "Note",
          required: true,
          metadata: { conditionalLogic: { enabled: true, questionId: "gate", operator: "equals", value: "yes" } },
        }),
        question({ questionId: "essay", type: "textarea", prompt: "Essay", required: false }),
        question({ questionId: "email", type: "email", prompt: "Email", required: false }),
        question({ questionId: "phone", type: "phone", prompt: "Phone", required: false }),
        question({ questionId: "count", type: "number", prompt: "Count", required: false, metadata: { min: 1, max: 3 } }),
        question({ questionId: "when", type: "date", prompt: "When", required: false }),
        question({ questionId: "pick", type: "dropdown", prompt: "Pick", required: false, metadata: { options: ["Yes", "No"] } }),
        question({
          questionId: "boxes",
          type: "checkbox",
          prompt: "Boxes",
          required: false,
          metadata: { options: ["A", "B", "C"], minSelections: 1, maxSelections: 2 },
        }),
        question({ questionId: "stars", type: "rating", prompt: "Stars", required: false }),
        question({ questionId: "nps", type: "rating", prompt: "Score", required: false, metadata: { min: 0, max: 10 } }),
      ],
    },
  ],
};

describe("validateResponses", () => {
  it("rejects input that is not a plain object", () => {
    // source: a non-object input returns ok false and a _form error
    for (const input of [null, [], "hello", 1]) {
      const result = validateResponses(schema, input);
      expect(result).toEqual({ ok: false, errors: { _form: "Send responses as an object." } });
    }
  });

  it("drops hidden and unknown answers and does not require a hidden question", () => {
    // source: only visible questions are validated and kept
    const hidden = validateResponses(schema, { gate: "no", note: "secret", extra: "nope" });
    expect(hidden).toEqual({ ok: true, responses: { gate: "no" } });
    const missing = validateResponses(schema, { gate: "yes" });
    expect(missing).toEqual({ ok: false, errors: { note: "This question is required." } });
  });

  it("trims strings and omits an empty optional answer", () => {
    // source: strings are trimmed and a blank answer is omitted
    const hidden = validateResponses(schema, { gate: " no ", note: "  hi  ", essay: "   " });
    expect(hidden).toEqual({ ok: true, responses: { gate: "no" } });
    const kept = validateResponses(schema, { gate: "yes", note: "  hi  ", essay: "  hello  " });
    expect(kept).toEqual({ ok: true, responses: { gate: "yes", note: "hi", essay: "hello" } });
  });

  it("limits text and textarea length", () => {
    // source: text is at most 1000 characters and textarea at most 10000
    expect(validateResponses(schema, { gate: "yes", note: "a".repeat(1000) })).toEqual({
      ok: true,
      responses: { gate: "yes", note: "a".repeat(1000) },
    });
    expect(validateResponses(schema, { gate: "yes", note: "a".repeat(1001) })).toEqual({
      ok: false,
      errors: { note: "Enter at most 1000 characters." },
    });
    expect(validateResponses(schema, { gate: "no", essay: "a".repeat(10001) })).toEqual({
      ok: false,
      errors: { essay: "Enter at most 10000 characters." },
    });
  });

  it("checks email, phone, number, and date answers", () => {
    // source: email, phone, number, and date follow the format and range rules
    const email = "a".repeat(249) + "@b.co";
    expect(email).toHaveLength(254);
    const good = validateResponses(schema, {
      gate: "no",
      email,
      phone: "+12 34",
      count: "2",
      when: "2024-02-29",
    });
    expect(good).toEqual({
      ok: true,
      responses: { gate: "no", email, phone: "+12 34", count: 2, when: "2024-02-29" },
    });
    const bad = validateResponses(schema, {
      gate: "no",
      email: "a".repeat(250) + "@b.co",
      phone: "1234",
      count: "9",
      when: "2023-02-29",
    });
    expect(bad).toEqual({
      ok: false,
      errors: {
        email: "Enter a valid email address.",
        phone: "Enter a valid phone number.",
        count: "Enter a number from 1 to 3.",
        when: "Enter a real date as YYYY-MM-DD.",
      },
    });
    expect(validateResponses(schema, { gate: "no", email: "not-an-email", count: "nope", when: "02-29-2024" })).toEqual({
      ok: false,
      errors: {
        email: "Enter a valid email address.",
        count: "Enter a valid number.",
        when: "Enter a real date as YYYY-MM-DD.",
      },
    });
  });

  it("matches choice answers after trimming and rejects a checkbox string", () => {
    // source: radio and dropdown match trimmed options, and checkbox rejects a single string
    expect(validateResponses(schema, { gate: "no", pick: " Yes " })).toEqual({
      ok: true,
      responses: { gate: "no", pick: "Yes" },
    });
    expect(validateResponses(schema, { gate: "no", pick: "Maybe" })).toEqual({
      ok: false,
      errors: { pick: "Choose one of the listed options." },
    });
    expect(validateResponses(schema, { gate: "no", boxes: "A" })).toEqual({
      ok: false,
      errors: { boxes: "Choose one or more options." },
    });
    expect(validateResponses(schema, { gate: "no", boxes: ["A", " A "] })).toEqual({
      ok: false,
      errors: { boxes: "Choose each option only once." },
    });
    expect(validateResponses(schema, { gate: "no", boxes: ["A", "Z"] })).toEqual({
      ok: false,
      errors: { boxes: "Choose only the listed options." },
    });
    expect(validateResponses(schema, { gate: "no", boxes: ["A", "B", "C"] })).toEqual({
      ok: false,
      errors: { boxes: "Choose at most 2 options." },
    });
    expect(validateResponses(schema, { gate: "no", boxes: [] })).toEqual({
      ok: true,
      responses: { gate: "no" },
    });
    expect(validateResponses(schema, { gate: "no", boxes: ["B"] })).toEqual({
      ok: true,
      responses: { gate: "no", boxes: ["B"] },
    });
  });

  it("stores a rating as an integer inside the configured range", () => {
    // source: rating accepts an integer or numeric string from min to max
    expect(validateResponses(schema, { gate: "no", stars: "4" })).toEqual({
      ok: true,
      responses: { gate: "no", stars: 4 },
    });
    expect(validateResponses(schema, { gate: "no", stars: 0 })).toEqual({
      ok: false,
      errors: { stars: "Enter a whole number from 1 to 5." },
    });
    expect(validateResponses(schema, { gate: "no", stars: "3.5" })).toEqual({
      ok: false,
      errors: { stars: "Enter a whole number from 1 to 5." },
    });
    expect(validateResponses(schema, { gate: "no", nps: "0" })).toEqual({
      ok: true,
      responses: { gate: "no", nps: 0 },
    });
    expect(validateResponses(schema, { gate: "no", nps: 11 })).toEqual({
      ok: false,
      errors: { nps: "Enter a whole number from 0 to 10." },
    });
  });

  it("decides visibility from trimmed answers", () => {
    // source: visible questions are computed from trimmed string answers and trimmed strings inside arrays
    const follow: FormSchema = {
      sections: [
        {
          title: "Gate",
          questions: [
            question({
              questionId: "gate",
              type: "radio",
              prompt: "Gate",
              required: true,
              metadata: { options: ["yes", "no"] },
            }),
            question({
              questionId: "follow",
              type: "text",
              prompt: "Follow",
              required: true,
              metadata: {
                conditionalLogic: { enabled: true, questionId: "gate", operator: "equals", value: "yes" },
              },
            }),
          ],
        },
      ],
    };
    expect(validateResponses(follow, { gate: " yes " })).toEqual({
      ok: false,
      errors: { follow: "This question is required." },
    });
    expect(validateResponses(follow, { gate: " yes ", follow: "x" })).toEqual({
      ok: true,
      responses: { gate: "yes", follow: "x" },
    });

    const colors: FormSchema = {
      sections: [
        {
          title: "Colors",
          questions: [
            question({
              questionId: "colors",
              type: "checkbox",
              prompt: "Colors",
              required: false,
              metadata: { options: ["red", "blue"] },
            }),
            question({
              questionId: "why",
              type: "text",
              prompt: "Why",
              required: true,
              metadata: {
                conditionalLogic: { enabled: true, questionId: "colors", operator: "array_includes", value: "red" },
              },
            }),
          ],
        },
      ],
    };
    expect(validateResponses(colors, { colors: [" red "] })).toEqual({
      ok: false,
      errors: { why: "This question is required." },
    });
  });

  it("treats prototype property names as unanswered when they are not own properties", () => {
    // source: question ids constructor, toString, valueOf, and hasOwnProperty are read with Object.hasOwn
    const proto: FormSchema = {
      sections: [
        {
          title: "Proto",
          questions: ["constructor", "toString", "valueOf", "hasOwnProperty"].map((questionId) =>
            question({ questionId, type: "text", prompt: questionId, required: false }),
          ),
        },
      ],
    };
    expect(validateResponses(proto, {})).toEqual({ ok: true, responses: {} });
    expect(validateResponses(proto, { constructor: " kept " })).toEqual({
      ok: true,
      responses: { constructor: "kept" },
    });
  });

  it("matches a trimmed answer to an option that still has surrounding spaces", () => {
    // source: a choice option stored with surrounding spaces in an unnormalized schema matches the trimmed answer
    const spaced: FormSchema = {
      sections: [
        {
          title: "Choices",
          questions: [
            question({
              questionId: "pick",
              type: "dropdown",
              prompt: "Pick",
              required: true,
              metadata: { options: [" yes ", " no "] },
            }),
          ],
        },
      ],
    };
    expect(validateResponses(spaced, { pick: " yes " })).toEqual({
      ok: true,
      responses: { pick: "yes" },
    });
  });

  it("refuses a checkbox answer with fewer selections than minSelections", () => {
    // source: a checkbox answer with fewer selections than minSelections is refused
    const boxes: FormSchema = {
      sections: [
        {
          title: "Boxes",
          questions: [
            question({
              questionId: "boxes",
              type: "checkbox",
              prompt: "Boxes",
              required: false,
              metadata: { options: ["A", "B", "C"], minSelections: 2 },
            }),
          ],
        },
      ],
    };
    expect(validateResponses(boxes, { boxes: ["A"] })).toEqual({
      ok: false,
      errors: { boxes: "Choose at least 2 options." },
    });
  });

  it("refuses a phone answer that contains letters", () => {
    // source: a phone answer containing letters is refused
    expect(validateResponses(schema, { gate: "no", phone: "555-CALL" })).toEqual({
      ok: false,
      errors: { phone: "Enter a valid phone number." },
    });
  });
});
