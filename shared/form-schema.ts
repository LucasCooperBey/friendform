import { z } from "zod";

export const QUESTION_TYPES = [
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "date",
  "radio",
  "checkbox",
  "dropdown",
  "rating",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export const CHOICE_TYPES: readonly QuestionType[] = ["radio", "checkbox", "dropdown"];

export const CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "array_includes",
  "array_not_includes",
  "is_empty",
  "is_not_empty",
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export type ResponseValue = string | number | string[];

export type Responses = Record<string, ResponseValue>;

export interface ConditionalLogic {
  enabled: boolean;
  questionId: string;
  operator: ConditionOperator;
  value?: string | number | null;
}

export interface QuestionMetadata {
  options?: string[];
  placeholder?: string;
  min?: number;
  max?: number;
  minSelections?: number;
  maxSelections?: number;
  allowSelectAll?: boolean;
  conditionalLogic?: ConditionalLogic;
}

export interface Question {
  questionId: string;
  type: QuestionType;
  prompt: string;
  subtext?: string;
  required: boolean;
  metadata?: QuestionMetadata;
}

export interface Section {
  title: string;
  description?: string;
  questions: Question[];
}

export interface FormSchema {
  sections: Section[];
}

export type WebhookFormat = "json" | "slack" | "discord";

export interface WebhookConfig {
  id: string;
  url: string;
  format: WebhookFormat;
  enabled: boolean;
}

export interface ThankYouSettings {
  title: string;
  message: string;
  redirectUrl?: string;
  redirectDelaySeconds?: number;
}

export interface FormSettings {
  theme: "light" | "dark" | "system";
  showProgress: boolean;
  thankYou: ThankYouSettings;
  closedMessage: string;
  webhooks: WebhookConfig[];
  allowAutofill: boolean;
}

const QUESTION_ID_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const conditionalLogicZ = z.object({
  enabled: z.boolean(),
  questionId: z.string(),
  operator: z.enum(CONDITION_OPERATORS),
  value: z.union([z.string(), z.number(), z.null()]).optional(),
});

const questionMetadataZ = z.object({
  options: z.array(z.string().max(200)).max(100).optional(),
  placeholder: z.string().optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  minSelections: z.number().finite().optional(),
  maxSelections: z.number().finite().optional(),
  allowSelectAll: z.boolean().optional(),
  conditionalLogic: conditionalLogicZ.optional(),
});

const questionZ = z.object({
  questionId: z.string().regex(QUESTION_ID_RE),
  type: z.enum(QUESTION_TYPES),
  prompt: z.string().max(500),
  subtext: z.string().max(1000).optional(),
  required: z.boolean(),
  metadata: questionMetadataZ.optional(),
});

const sectionZ = z.object({
  title: z.string().max(200),
  description: z.string().max(2000).optional(),
  questions: z.array(questionZ).max(200),
});

export const formSchemaZ: z.ZodType<FormSchema> = z.object({
  sections: z.array(sectionZ).max(50),
});

const thankYouZ = z.object({
  title: z.string().max(200).default("Thank you!"),
  message: z.string().max(2000).default("Your response has been recorded."),
  redirectUrl: z.string().refine(isHttpUrl, "Enter an http or https URL.").optional(),
  redirectDelaySeconds: z.number().int().min(0).max(60).optional(),
});

const webhookZ = z.object({
  id: z.string().min(1).max(64),
  url: z.string().max(2000).refine(isHttpUrl, "Enter an http or https URL."),
  format: z.enum(["json", "slack", "discord"]),
  enabled: z.boolean(),
});

export const formSettingsZ: z.ZodType<FormSettings> = z.object({
  theme: z.enum(["light", "dark", "system"]).default("system"),
  showProgress: z.boolean().default(true),
  thankYou: thankYouZ.default({
    title: "Thank you!",
    message: "Your response has been recorded.",
  }),
  closedMessage: z.string().max(500).default("This form is no longer accepting responses."),
  webhooks: z.array(webhookZ).max(10).default([]),
  allowAutofill: z.boolean().default(false),
});

export const DEFAULT_SETTINGS: FormSettings = {
  theme: "system",
  showProgress: true,
  thankYou: {
    title: "Thank you!",
    message: "Your response has been recorded.",
  },
  closedMessage: "This form is no longer accepting responses.",
  webhooks: [],
  allowAutofill: false,
};

export function emptySchema(): FormSchema {
  return { sections: [{ title: "Untitled section", questions: [] }] };
}

export function allQuestions(schema: FormSchema): Question[] {
  const questions: Question[] = [];
  for (const section of schema.sections) {
    questions.push(...section.questions);
  }
  return questions;
}

function questionLabel(sectionIndex: number, questionIndex: number, prompt: string): string {
  const where = `Question ${questionIndex + 1} in section ${sectionIndex + 1}`;
  const trimmed = prompt.trim();
  if (trimmed === "") return where;
  return `${where} ("${trimmed}")`;
}

function isChoice(type: QuestionType): boolean {
  return type === "radio" || type === "checkbox" || type === "dropdown";
}

export function publishProblems(schema: FormSchema): string[] {
  const problems: string[] = [];
  const questions = allQuestions(schema);
  if (questions.length === 0) {
    problems.push("Add at least one question before publishing.");
  }

  const seenIds = new Set<string>();
  const earlierIds = new Set<string>();

  schema.sections.forEach((section, sectionIndex) => {
    section.questions.forEach((question, questionIndex) => {
      const label = questionLabel(sectionIndex, questionIndex, question.prompt);
      if (question.prompt.trim() === "") {
        problems.push(`${label} has an empty prompt.`);
      }
      if (seenIds.has(question.questionId)) {
        problems.push(`${label} uses the same id as an earlier question.`);
      }
      seenIds.add(question.questionId);

      if (isChoice(question.type)) {
        const options = question.metadata?.options ?? [];
        if (options.length === 0) {
          problems.push(`${label} needs at least one option.`);
        } else {
          const trimmed = options.map((option) => option.trim());
          if (trimmed.some((option) => option === "")) {
            problems.push(`${label} has an empty option.`);
          }
          if (new Set(trimmed).size !== trimmed.length) {
            problems.push(`${label} has repeated options.`);
          }
        }
      }

      if (question.type === "rating") {
        const min = question.metadata?.min;
        const max = question.metadata?.max;
        const outside = (value: number | undefined) => value !== undefined && (value < 0 || value > 10);
        if (outside(min) || outside(max)) {
          problems.push(`${label} has a rating minimum or maximum outside 0 to 10.`);
        }
        if ((min ?? 1) >= (max ?? 5)) {
          problems.push(`${label} has a minimum that is not lower than its maximum.`);
        }
      }

      if (question.type === "number") {
        const min = question.metadata?.min;
        const max = question.metadata?.max;
        if (min !== undefined && max !== undefined && min > max) {
          problems.push(`${label} has a minimum greater than its maximum.`);
        }
      }

      if (question.type === "checkbox") {
        const minSelections = question.metadata?.minSelections;
        const maxSelections = question.metadata?.maxSelections;
        const optionCount = question.metadata?.options?.length ?? 0;
        if (
          minSelections !== undefined &&
          maxSelections !== undefined &&
          minSelections > maxSelections
        ) {
          problems.push(`${label} asks for more selections than its maximum.`);
        }
        if (minSelections !== undefined && minSelections > optionCount) {
          problems.push(`${label} asks for more selections than it has options.`);
        }
        if (maxSelections !== undefined && maxSelections < 1) {
          problems.push(`${label} has a maximum selection count below 1.`);
        }
      }

      const logic = question.metadata?.conditionalLogic;
      if (logic?.enabled) {
        if (logic.questionId === question.questionId) {
          problems.push(`${label} depends on itself.`);
        } else if (!earlierIds.has(logic.questionId)) {
          problems.push(`${label} depends on a question that does not appear earlier.`);
        }
      }
      earlierIds.add(question.questionId);
    });
  });

  return problems;
}

function normalizeMetadata(metadata: QuestionMetadata): QuestionMetadata {
  const next: QuestionMetadata = {};
  if (metadata.options !== undefined) {
    next.options = metadata.options.map((option) => option.trim());
  }
  if (metadata.placeholder !== undefined) {
    next.placeholder = metadata.placeholder.trim();
  }
  if (metadata.min !== undefined) next.min = metadata.min;
  if (metadata.max !== undefined) next.max = metadata.max;
  if (metadata.minSelections !== undefined) next.minSelections = metadata.minSelections;
  if (metadata.maxSelections !== undefined) next.maxSelections = metadata.maxSelections;
  if (metadata.allowSelectAll !== undefined) next.allowSelectAll = metadata.allowSelectAll;
  if (metadata.conditionalLogic !== undefined) {
    const logic = metadata.conditionalLogic;
    next.conditionalLogic = {
      enabled: logic.enabled,
      questionId: logic.questionId,
      operator: logic.operator,
      ...(logic.value !== undefined
        ? { value: typeof logic.value === "string" ? logic.value.trim() : logic.value }
        : {}),
    };
  }
  return next;
}

export function normalizeSchema(schema: FormSchema): FormSchema {
  return {
    sections: schema.sections.map((section) => ({
      title: section.title.trim(),
      ...(section.description !== undefined ? { description: section.description.trim() } : {}),
      questions: section.questions.map((question) => ({
        questionId: question.questionId,
        type: question.type,
        prompt: question.prompt.trim(),
        ...(question.subtext !== undefined ? { subtext: question.subtext.trim() } : {}),
        required: question.required,
        ...(question.metadata !== undefined ? { metadata: normalizeMetadata(question.metadata) } : {}),
      })),
    })),
  };
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomIdSuffix(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) {
    const char = ID_ALPHABET[byte % ID_ALPHABET.length];
    if (char !== undefined) out += char;
  }
  return out;
}

export function newQuestionId(taken: Iterable<string>, random?: () => string): string {
  const used = new Set(taken);
  const next = random ?? randomIdSuffix;
  for (;;) {
    const id = `q_${next()}`;
    if (!used.has(id)) return id;
  }
}
