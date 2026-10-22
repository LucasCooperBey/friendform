import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ConditionOperator, ConditionalLogic, Question, QuestionType } from "@shared/form-schema";

const OPERATOR_LABEL: Record<ConditionOperator, string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  not_contains: "doesn't contain",
  array_includes: "includes",
  array_not_includes: "doesn't include",
  is_empty: "is empty",
  is_not_empty: "is answered",
};

function operatorsFor(type: QuestionType): ConditionOperator[] {
  if (type === "checkbox") return ["array_includes", "array_not_includes", "is_empty", "is_not_empty"];
  if (type === "radio" || type === "dropdown") return ["equals", "not_equals", "is_empty", "is_not_empty"];
  if (type === "number" || type === "rating") return ["equals", "not_equals", "is_empty", "is_not_empty"];
  // Date answers are strings, so they use the same operators as text.
  return ["equals", "not_equals", "contains", "not_contains", "is_empty", "is_not_empty"];
}

function isOperator(value: string, allowed: readonly ConditionOperator[]): value is ConditionOperator {
  return (allowed as readonly string[]).includes(value);
}

function needsValue(operator: ConditionOperator): boolean {
  return operator !== "is_empty" && operator !== "is_not_empty";
}

function promptLabel(question: Question): string {
  const trimmed = question.prompt.trim();
  return trimmed === "" ? "Untitled question" : trimmed;
}

function defaultValue(question: Question | undefined, operator: ConditionOperator): string | number | undefined {
  if (!needsValue(operator) || !question) return undefined;
  if (question.type === "radio" || question.type === "checkbox" || question.type === "dropdown") {
    return question.metadata?.options?.find((option) => option.trim() !== "") ?? "";
  }
  if (question.type === "number" || question.type === "rating") return undefined;
  return "";
}

export function ConditionEditor({
  questionId,
  earlier,
  logic,
  onChange,
}: {
  questionId: string;
  earlier: Question[];
  logic: ConditionalLogic | undefined;
  onChange: (logic: ConditionalLogic) => void;
}) {
  const enabled = logic?.enabled === true;
  const selected = earlier.find((question) => question.questionId === logic?.questionId);
  const operators = selected ? operatorsFor(selected.type) : [];
  const operator = logic && operators.includes(logic.operator) ? logic.operator : undefined;

  function enable(next: boolean) {
    if (!next) {
      onChange({
        enabled: false,
        questionId: logic?.questionId ?? earlier[0]?.questionId ?? "",
        operator: logic?.operator ?? "equals",
        ...(logic?.value !== undefined ? { value: logic.value } : {}),
      });
      return;
    }
    if (logic) {
      onChange({ ...logic, enabled: true });
      return;
    }
    const first = earlier[0];
    const nextOperator = first ? operatorsFor(first.type)[0] ?? "equals" : "equals";
    const value = defaultValue(first, nextOperator);
    onChange({
      enabled: true,
      questionId: first?.questionId ?? "",
      operator: nextOperator,
      ...(value !== undefined ? { value } : {}),
    });
  }

  function chooseQuestion(nextId: string) {
    const question = earlier.find((item) => item.questionId === nextId);
    const allowed = question ? operatorsFor(question.type) : [];
    const nextOperator = logic && allowed.includes(logic.operator) ? logic.operator : allowed[0] ?? "equals";
    const value = defaultValue(question, nextOperator);
    onChange({
      enabled: true,
      questionId: nextId,
      operator: nextOperator,
      ...(value !== undefined ? { value } : {}),
    });
  }

  function chooseOperator(nextOperator: ConditionOperator) {
    if (!needsValue(nextOperator)) {
      onChange({ enabled: true, questionId: logic?.questionId ?? "", operator: nextOperator });
      return;
    }
    const value = logic?.value !== undefined && needsValue(logic.operator) ? logic.value : defaultValue(selected, nextOperator);
    onChange({
      enabled: true,
      questionId: logic?.questionId ?? "",
      operator: nextOperator,
      ...(value !== undefined ? { value } : {}),
    });
  }

  return (
    <div className="space-y-3 rounded-md bg-muted/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`condition-${questionId}`}>Only show this question when{"\u2026"}</Label>
        <Switch id={`condition-${questionId}`} checked={enabled} onCheckedChange={(checked) => enable(checked === true)} />
      </div>
      {enabled && earlier.length === 0 ? <p className="text-sm text-muted-foreground">Add a question above this one first</p> : null}
      {enabled && earlier.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Controlling question</Label>
            <Select value={selected?.questionId} onValueChange={chooseQuestion}>
              <SelectTrigger aria-label="Controlling question">
                <SelectValue placeholder="Choose a question" />
              </SelectTrigger>
              <SelectContent>
                {earlier.map((question) => (
                  <SelectItem key={question.questionId} value={question.questionId}>
                    {promptLabel(question)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selected && operator ? (
            <div className="space-y-2">
              <Label>Operator</Label>
              <Select
                value={operator}
                onValueChange={(value) => {
                  if (isOperator(value, operators)) chooseOperator(value);
                }}
              >
                <SelectTrigger aria-label="Operator">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {operators.map((item) => (
                    <SelectItem key={item} value={item}>
                      {OPERATOR_LABEL[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {selected && operator && needsValue(operator) ? (
            <ValueControl
              question={selected}
              value={logic?.value}
              onChange={(value) => onChange({ enabled: true, questionId: selected.questionId, operator, value })}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ValueControl({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: string | number | null | undefined;
  onChange: (value: string | number) => void;
}) {
  if (question.type === "radio" || question.type === "checkbox" || question.type === "dropdown") {
    const options = [...new Set((question.metadata?.options ?? []).filter((option) => option.trim() !== ""))];
    const current = typeof value === "string" && options.includes(value) ? value : undefined;
    return (
      <div className="space-y-2 sm:col-span-2">
        <Label>Value</Label>
        <Select value={current} onValueChange={onChange}>
          <SelectTrigger aria-label="Comparison value">
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (question.type === "number" || question.type === "rating") {
    return (
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`condition-value-${question.questionId}`}>Value</Label>
        <Input
          id={`condition-value-${question.questionId}`}
          type="number"
          aria-label="Comparison value"
          value={typeof value === "number" ? String(value) : ""}
          onChange={(event) => {
            if (event.target.value === "") return;
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) onChange(parsed);
          }}
        />
      </div>
    );
  }
  return (
    <div className="space-y-2 sm:col-span-2">
      <Label htmlFor={`condition-value-${question.questionId}`}>Value</Label>
      <Input
        id={`condition-value-${question.questionId}`}
        aria-label="Comparison value"
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
