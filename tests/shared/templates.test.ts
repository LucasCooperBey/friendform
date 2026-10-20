// source: shared/templates.ts seven publishable generic templates

import { describe, expect, it } from "vitest";
import { formSchemaZ, publishProblems } from "../../shared/form-schema";
import { TEMPLATES } from "../../shared/templates";

describe("TEMPLATES", () => {
  it("includes seven generic templates that are valid and publishable", () => {
    // source: every template passes formSchemaZ and publishProblems
    expect(TEMPLATES.map((template) => template.id)).toEqual([
      "project-intake",
      "contact",
      "event-rsvp",
      "feedback-survey",
      "job-application",
      "workshop-interest",
      "potluck-sign-up",
    ]);
    for (const template of TEMPLATES) {
      expect(["personal", "work", "events", "feedback"]).toContain(template.category);
      expect(formSchemaZ.safeParse(template.schema).success).toBe(true);
      expect(publishProblems(template.schema)).toEqual([]);
    }
    const intake = TEMPLATES.find((template) => template.id === "project-intake");
    expect(intake?.schema.sections.map((section) => section.title)).toEqual([
      "About you",
      "What you need",
      "What good looks like",
      "What you already have",
      "Limits",
      "Permission",
    ]);
  });
});
