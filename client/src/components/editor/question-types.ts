import {
  AlignLeft,
  Calendar,
  ChevronDown,
  CircleDot,
  Hash,
  ListChecks,
  Mail,
  Phone,
  Star,
  Type,
  type LucideIcon,
} from "lucide-react";
import {
  CHOICE_TYPES,
  newQuestionId,
  QUESTION_TYPES,
  type Question,
  type QuestionMetadata,
  type QuestionType,
} from "@shared/form-schema";

const DETAILS: Record<QuestionType, { label: string; icon: LucideIcon }> = {
  text: { label: "Short text", icon: Type },
  textarea: { label: "Long text", icon: AlignLeft },
  email: { label: "Email", icon: Mail },
  phone: { label: "Phone", icon: Phone },
  number: { label: "Number", icon: Hash },
  date: { label: "Date", icon: Calendar },
  radio: { label: "Multiple choice", icon: CircleDot },
  checkbox: { label: "Checkboxes", icon: ListChecks },
  dropdown: { label: "Dropdown", icon: ChevronDown },
  rating: { label: "Rating", icon: Star },
};

export const QUESTION_TYPE_LIST: readonly { type: QuestionType; label: string; icon: LucideIcon }[] = QUESTION_TYPES.map(
  (type) => ({ type, label: DETAILS[type].label, icon: DETAILS[type].icon }),
);

const PLACEHOLDER_TYPES: readonly QuestionType[] = ["text", "textarea", "email", "phone", "number", "dropdown"];
const RANGE_TYPES: readonly QuestionType[] = ["number", "rating"];

export function isQuestionType(value: string): value is QuestionType {
  return (QUESTION_TYPES as readonly string[]).includes(value);
}

export function usesOptions(type: QuestionType): boolean {
  return (CHOICE_TYPES as readonly QuestionType[]).includes(type);
}

export function usesPlaceholder(type: QuestionType): boolean {
  return PLACEHOLDER_TYPES.includes(type);
}

export function usesRange(type: QuestionType): boolean {
  return RANGE_TYPES.includes(type);
}

export function questionTypeDetail(type: QuestionType): { label: string; icon: LucideIcon } {
  return DETAILS[type];
}

export function metadataForType(type: QuestionType, metadata: QuestionMetadata | undefined): QuestionMetadata | undefined {
  if (!metadata) return undefined;
  const next: QuestionMetadata = {};
  if ((CHOICE_TYPES as readonly QuestionType[]).includes(type) && metadata.options !== undefined) {
    next.options = [...metadata.options];
  }
  if (PLACEHOLDER_TYPES.includes(type) && metadata.placeholder !== undefined) {
    next.placeholder = metadata.placeholder;
  }
  if (RANGE_TYPES.includes(type)) {
    if (metadata.min !== undefined) next.min = metadata.min;
    if (metadata.max !== undefined) next.max = metadata.max;
  }
  if (type === "checkbox") {
    if (metadata.minSelections !== undefined) next.minSelections = metadata.minSelections;
    if (metadata.maxSelections !== undefined) next.maxSelections = metadata.maxSelections;
    if (metadata.allowSelectAll !== undefined) next.allowSelectAll = metadata.allowSelectAll;
  }
  if (metadata.conditionalLogic !== undefined) {
    next.conditionalLogic = { ...metadata.conditionalLogic };
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function createQuestion(type: QuestionType, taken: Iterable<string>): Question {
  const question: Question = {
    questionId: newQuestionId(taken),
    type,
    prompt: "Untitled question",
    required: false,
  };
  if ((CHOICE_TYPES as readonly QuestionType[]).includes(type)) {
    question.metadata = { options: ["Option 1", "Option 2"] };
  }
  return question;
}

export function duplicateQuestion(question: Question, taken: Iterable<string>): Question {
  const metadata = metadataForType(question.type, question.metadata);
  return {
    questionId: newQuestionId(taken),
    type: question.type,
    prompt: question.prompt,
    ...(question.subtext !== undefined ? { subtext: question.subtext } : {}),
    required: question.required,
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

export function questionLabel(question: Question): string {
  const trimmed = question.prompt.trim();
  return trimmed === "" ? "Untitled question" : trimmed;
}
