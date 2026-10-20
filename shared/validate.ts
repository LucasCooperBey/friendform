import type { FormSchema, Question, Responses, ResponseValue } from "./form-schema";
import { allQuestions } from "./form-schema";
import { visibleQuestionIds } from "./logic";

export type ValidationResult =
  | { ok: true; responses: Responses }
  | { ok: false; errors: Record<string, string> };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isAbsent(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function readOwn(input: Record<string, unknown>, id: string): unknown {
  if (!Object.hasOwn(input, id)) return undefined;
  return input[id];
}

function normalizeAnswer(value: unknown): ResponseValue | undefined {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.map((item) => item.trim());
  }
  return undefined;
}

function responsesFromInput(input: Record<string, unknown>): Responses {
  const responses: Responses = {};
  for (const key of Object.keys(input)) {
    const normalized = normalizeAnswer(readOwn(input, key));
    if (normalized !== undefined) responses[key] = normalized;
  }
  return responses;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function isEmailAddress(value: string): boolean {
  if (value.length > 254) return false;
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(
    value,
  );
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function optionMatches(answer: string, options: readonly string[]): boolean {
  const trimmed = answer.trim();
  return options.some((option) => option.trim() === trimmed);
}

function numberError(value: number, min: number | undefined, max: number | undefined): string | null {
  const below = min !== undefined && value < min;
  const above = max !== undefined && value > max;
  if (!below && !above) return null;
  if (min !== undefined && max !== undefined) return `Enter a number from ${min} to ${max}.`;
  if (min !== undefined) return `Enter a number of at least ${min}.`;
  return `Enter a number of at most ${max}.`;
}

function checkQuestion(question: Question, raw: unknown): { error: string } | { value: ResponseValue } | { omit: true } {
  if (isAbsent(raw)) {
    return question.required ? { error: "This question is required." } : { omit: true };
  }

  switch (question.type) {
    case "text":
    case "textarea": {
      if (typeof raw !== "string") return { error: "Enter text." };
      const text = raw.trim();
      const limit = question.type === "text" ? 1000 : 10000;
      if (text.length > limit) return { error: `Enter at most ${limit} characters.` };
      return { value: text };
    }
    case "email": {
      if (typeof raw !== "string") return { error: "Enter a valid email address." };
      const text = raw.trim();
      if (!isEmailAddress(text)) return { error: "Enter a valid email address." };
      return { value: text };
    }
    case "phone": {
      if (typeof raw !== "string") return { error: "Enter a valid phone number." };
      const text = raw.trim();
      if (!/^[0-9+().\-\s]{5,40}$/.test(text)) return { error: "Enter a valid phone number." };
      return { value: text };
    }
    case "number": {
      const parsed = parseNumber(raw);
      if (parsed === null) return { error: "Enter a valid number." };
      const range = numberError(parsed, question.metadata?.min, question.metadata?.max);
      if (range) return { error: range };
      return { value: parsed };
    }
    case "date": {
      if (typeof raw !== "string") return { error: "Enter a real date as YYYY-MM-DD." };
      const text = raw.trim();
      if (!isCalendarDate(text)) return { error: "Enter a real date as YYYY-MM-DD." };
      return { value: text };
    }
    case "radio":
    case "dropdown": {
      const options = question.metadata?.options ?? [];
      if (typeof raw !== "string" || !optionMatches(raw, options)) {
        return { error: "Choose one of the listed options." };
      }
      return { value: raw.trim() };
    }
    case "checkbox": {
      if (!Array.isArray(raw)) return { error: "Choose one or more options." };
      const options = question.metadata?.options ?? [];
      const chosen: string[] = [];
      const seen = new Set<string>();
      for (const item of raw) {
        if (typeof item !== "string" || !optionMatches(item, options) || item.trim() === "") {
          return { error: "Choose only the listed options." };
        }
        const trimmed = item.trim();
        if (seen.has(trimmed)) return { error: "Choose each option only once." };
        seen.add(trimmed);
        chosen.push(trimmed);
      }
      const minSelections = question.metadata?.minSelections;
      const maxSelections = question.metadata?.maxSelections;
      if (minSelections !== undefined && chosen.length < minSelections) {
        return { error: `Choose at least ${minSelections} options.` };
      }
      if (maxSelections !== undefined && chosen.length > maxSelections) {
        return { error: `Choose at most ${maxSelections} options.` };
      }
      return { value: chosen };
    }
    case "rating": {
      const parsed = parseNumber(raw);
      if (parsed === null || !Number.isInteger(parsed)) {
        const min = question.metadata?.min ?? 1;
        const max = question.metadata?.max ?? 5;
        return { error: `Enter a whole number from ${min} to ${max}.` };
      }
      const min = question.metadata?.min ?? 1;
      const max = question.metadata?.max ?? 5;
      if (parsed < min || parsed > max) return { error: `Enter a whole number from ${min} to ${max}.` };
      return { value: parsed };
    }
    default:
      return { error: "Enter text." };
  }
}

export function validateResponses(schema: FormSchema, input: unknown): ValidationResult {
  if (!isPlainObject(input)) {
    return { ok: false, errors: { _form: "Send responses as an object." } };
  }

  const visible = visibleQuestionIds(schema, responsesFromInput(input));
  const errors: Record<string, string> = {};
  const responses: Responses = {};

  for (const question of allQuestions(schema)) {
    if (!visible.has(question.questionId)) continue;
    const result = checkQuestion(question, readOwn(input, question.questionId));
    if ("error" in result) errors[question.questionId] = result.error;
    else if ("value" in result) responses[question.questionId] = result.value;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, responses };
}
