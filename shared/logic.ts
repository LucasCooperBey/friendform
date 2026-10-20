import type { ConditionalLogic, FormSchema, ResponseValue, Responses } from "./form-schema";
import { allQuestions } from "./form-schema";

export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function numericValue(value: ResponseValue | string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function valuesEqual(
  left: ResponseValue | undefined,
  right: string | number | null | undefined,
): boolean {
  if (Array.isArray(left)) return false;
  const leftNumber = numericValue(left);
  const rightNumber = numericValue(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber === rightNumber;
  return left === right;
}

function containsValue(
  response: ResponseValue | undefined,
  needle: string | number | null | undefined,
): boolean {
  if (typeof needle !== "string") return false;
  const want = needle.toLowerCase();
  if (typeof response === "string") return response.toLowerCase().includes(want);
  if (Array.isArray(response)) return response.some((item) => item.toLowerCase().includes(want));
  return false;
}

function arrayIncludes(
  response: ResponseValue | undefined,
  value: string | number | null | undefined,
): boolean {
  if (Array.isArray(response)) return response.some((item) => item === value);
  return response === value;
}

function readResponse(responses: Responses, id: string): ResponseValue | undefined {
  if (!Object.hasOwn(responses, id)) return undefined;
  return responses[id];
}

export function evaluateCondition(
  condition: ConditionalLogic | undefined,
  responses: Responses,
): boolean {
  if (!condition || !condition.enabled) return true;

  const response = readResponse(responses, condition.questionId);
  switch (condition.operator) {
    case "equals":
      return valuesEqual(response, condition.value);
    case "not_equals":
      return !valuesEqual(response, condition.value);
    case "contains":
      return containsValue(response, condition.value);
    case "not_contains":
      return !containsValue(response, condition.value);
    case "array_includes":
      return arrayIncludes(response, condition.value);
    case "array_not_includes":
      return !arrayIncludes(response, condition.value);
    case "is_empty":
      return isEmptyValue(response);
    case "is_not_empty":
      return !isEmptyValue(response);
    default:
      return true;
  }
}

export function visibleQuestionIds(schema: FormSchema, responses: Responses): Set<string> {
  const visible = new Set<string>();
  const visibleResponses: Responses = {};
  for (const question of allQuestions(schema)) {
    if (!evaluateCondition(question.metadata?.conditionalLogic, visibleResponses)) continue;
    visible.add(question.questionId);
    const value = readResponse(responses, question.questionId);
    if (value !== undefined) visibleResponses[question.questionId] = value;
  }
  return visible;
}
