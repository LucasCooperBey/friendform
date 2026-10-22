import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Question, ResponseValue } from "@shared/form-schema";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface QuestionRendererProps {
  question: Question;
  value: ResponseValue | undefined;
  onChange: (value: ResponseValue | undefined) => void;
  error?: string;
  disabled?: boolean;
  onNumberUnparsed?: (unparsed: boolean) => void;
  onNumberError?: (show: boolean) => void;
}

const PLAIN_NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const PARTIAL_NUMBER = /^[+-]$|^[+-]?(?:\d+\.|\.\d*)$/;
const SCIENTIFIC_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d*$/;

function plainNumber(text: string): number | undefined {
  if (!PLAIN_NUMBER.test(text)) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function deferNumberError(text: string): boolean {
  return PARTIAL_NUMBER.test(text) || SCIENTIFIC_NUMBER.test(text);
}

const TEXT_FIELDS = {
  text: { type: "text", inputMode: "text", autoComplete: "on" },
  email: { type: "email", inputMode: "email", autoComplete: "email" },
  phone: { type: "tel", inputMode: "tel", autoComplete: "tel" },
} as const;

function describedBy(question: Question, error: string | undefined): string | undefined {
  const ids: string[] = [];
  if (question.subtext) ids.push(`${question.questionId}-subtext`);
  if (error) ids.push(`${question.questionId}-error`);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

function optionId(questionId: string, option: string, index: number): string {
  return `${questionId}-option-${index}-${option.replace(/[^A-Za-z0-9]+/g, "-")}`;
}

function ratingValues(question: Question): number[] {
  const min = question.metadata?.min ?? 1;
  const max = question.metadata?.max ?? 5;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  const start = Math.ceil(min);
  const end = Math.floor(max);
  const values: number[] = [];
  for (let current = start; current <= end; current += 1) values.push(current);
  return values;
}

function Prompt({ question }: { question: Question }) {
  const single =
    question.type === "text" ||
    question.type === "email" ||
    question.type === "phone" ||
    question.type === "textarea" ||
    question.type === "number" ||
    question.type === "date" ||
    question.type === "dropdown";
  return (
    <Label id={`${question.questionId}-label`} htmlFor={single ? `${question.questionId}-input` : undefined}>
      {question.prompt}
      {question.required ? (
        <>
          <span aria-hidden="true"> *</span>
          <span className="sr-only"> required</span>
        </>
      ) : null}
    </Label>
  );
}

function NumberField({
  question,
  value,
  onChange,
  described,
  invalid,
  disabled,
  onUnparsed,
  onError,
}: {
  question: Question;
  value: ResponseValue | undefined;
  onChange: (value: ResponseValue | undefined) => void;
  described: string | undefined;
  invalid: boolean;
  disabled: boolean | undefined;
  onUnparsed?: (unparsed: boolean) => void;
  onError?: (show: boolean) => void;
}) {
  const [text, setText] = useState(typeof value === "number" ? String(value) : "");
  const emitted = useRef(value);
  const onUnparsedRef = useRef(onUnparsed);
  const onErrorRef = useRef(onError);
  onUnparsedRef.current = onUnparsed;
  onErrorRef.current = onError;

  useEffect(() => {
    if (Object.is(value, emitted.current)) return;
    emitted.current = value;
    setText(typeof value === "number" ? String(value) : "");
    onUnparsedRef.current?.(false);
    onErrorRef.current?.(false);
  }, [value]);

  function publish(next: string) {
    setText(next);
    const trimmed = next.trim();
    if (trimmed === "") {
      emitted.current = undefined;
      onChange(undefined);
      onUnparsedRef.current?.(false);
      onErrorRef.current?.(false);
      return;
    }
    const parsed = plainNumber(trimmed);
    if (parsed !== undefined) {
      onUnparsedRef.current?.(false);
      onErrorRef.current?.(false);
      emitted.current = parsed;
      onChange(parsed);
      return;
    }
    onUnparsedRef.current?.(true);
    if (!deferNumberError(trimmed)) onErrorRef.current?.(true);
  }

  return (
    <Input
      id={`${question.questionId}-input`}
      inputMode="decimal"
      autoComplete="off"
      placeholder={question.metadata?.placeholder}
      aria-invalid={invalid || undefined}
      aria-describedby={described}
      disabled={disabled}
      value={text}
      onChange={(event) => publish(event.target.value)}
      onBlur={(event) => {
        const trimmed = event.currentTarget.value.trim();
        if (trimmed === "" || plainNumber(trimmed) !== undefined) return;
        onErrorRef.current?.(true);
      }}
    />
  );
}

function CheckboxField({
  question,
  value,
  onChange,
  described,
  invalid,
  disabled,
}: {
  question: Question;
  value: ResponseValue | undefined;
  onChange: (value: ResponseValue | undefined) => void;
  described: string | undefined;
  invalid: boolean;
  disabled: boolean | undefined;
}) {
  const options = question.metadata?.options ?? [];
  const selected = Array.isArray(value) ? value : [];
  const max = question.metadata?.maxSelections;

  function emit(next: string[]) {
    onChange(next);
  }

  function toggle(option: string, checked: boolean) {
    if (checked) {
      if (selected.includes(option)) return;
      if (max !== undefined && selected.length >= max) return;
      emit([...selected, option]);
      return;
    }
    emit(selected.filter((item) => item !== option));
  }

  function selectAll() {
    const allOn = options.length > 0 && options.every((option) => selected.includes(option));
    if (allOn) {
      emit([]);
      return;
    }
    const capped = max !== undefined ? options.slice(0, max) : options;
    emit([...capped]);
  }

  return (
    <div
      role="group"
      aria-labelledby={`${question.questionId}-label`}
      aria-describedby={described}
      aria-invalid={invalid || undefined}
      className="space-y-2"
    >
      {max !== undefined ? <p className="text-sm text-muted-foreground">Choose up to {max}.</p> : null}
      {question.metadata?.allowSelectAll === true ? (
        <Button type="button" variant="outline" size="sm" onClick={selectAll} disabled={disabled}>
          Select all
        </Button>
      ) : null}
      {options.map((option, index) => {
        const id = optionId(question.questionId, option, index);
        return (
          <div key={option} className="flex min-h-11 items-center gap-3">
            <Checkbox
              id={id}
              checked={selected.includes(option)}
              onCheckedChange={(checked) => toggle(option, checked === true)}
              disabled={disabled}
            />
            <Label htmlFor={id} className="font-normal">
              {option}
            </Label>
          </div>
        );
      })}
    </div>
  );
}

function RatingField({
  question,
  value,
  onChange,
  described,
  invalid,
  disabled,
}: {
  question: Question;
  value: ResponseValue | undefined;
  onChange: (value: ResponseValue | undefined) => void;
  described: string | undefined;
  invalid: boolean;
  disabled: boolean | undefined;
}) {
  const values = ratingValues(question);
  const selected = typeof value === "number" ? value : undefined;

  function move(current: number, key: string): number | undefined {
    const index = values.indexOf(current);
    if (key === "Home") return values[0];
    if (key === "End") return values[values.length - 1];
    if (key === "ArrowRight" || key === "ArrowDown") return values[index + 1];
    if (key === "ArrowLeft" || key === "ArrowUp") return values[index - 1];
    return undefined;
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: number) {
    const next = move(current, event.key);
    if (next === undefined) return;
    event.preventDefault();
    onChange(next);
    const target = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-rating="${next}"]`);
    target?.focus();
  }

  return (
    <div
      role="group"
      aria-labelledby={`${question.questionId}-label`}
      aria-describedby={described}
      aria-invalid={invalid || undefined}
      className="flex flex-wrap gap-2"
    >
      {values.map((score) => {
        const pressed = selected === score;
        return (
          <button
            key={score}
            type="button"
            data-rating={score}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={() => onChange(score)}
            onKeyDown={(event) => onKeyDown(event, score)}
            className={cn(
              "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border px-3 text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50",
              pressed ? "border-transparent bg-primary text-primary-foreground" : "border-input bg-card",
            )}
          >
            {score}
          </button>
        );
      })}
    </div>
  );
}

function Control(props: QuestionRendererProps & { described: string | undefined; invalid: boolean }) {
  const { question, value, onChange, disabled, described, invalid, onNumberUnparsed, onNumberError } = props;
  const options = question.metadata?.options ?? [];

  switch (question.type) {
    case "text":
    case "email":
    case "phone": {
      const field = TEXT_FIELDS[question.type];
      return (
        <Input
          id={`${question.questionId}-input`}
          type={field.type}
          inputMode={field.inputMode}
          autoComplete={field.autoComplete}
          placeholder={question.metadata?.placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={described}
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
        />
      );
    }
    case "textarea":
      return (
        <Textarea
          id={`${question.questionId}-input`}
          placeholder={question.metadata?.placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={described}
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
        />
      );
    case "number":
      return (
        <NumberField
          question={question}
          value={value}
          onChange={onChange}
          described={described}
          invalid={invalid}
          disabled={disabled}
          onUnparsed={onNumberUnparsed}
          onError={onNumberError}
        />
      );
    case "date":
      return (
        <Input
          id={`${question.questionId}-input`}
          type="date"
          autoComplete="off"
          aria-invalid={invalid || undefined}
          aria-describedby={described}
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
        />
      );
    case "radio":
      return (
        <RadioGroup
          value={typeof value === "string" ? value : ""}
          onValueChange={(next) => onChange(next)}
          disabled={disabled}
          aria-labelledby={`${question.questionId}-label`}
          aria-describedby={described}
          aria-invalid={invalid || undefined}
        >
          {options.map((option, index) => {
            const id = optionId(question.questionId, option, index);
            return (
              <div key={option} className="flex min-h-11 items-center gap-3">
                <RadioGroupItem id={id} value={option} />
                <Label htmlFor={id} className="font-normal">
                  {option}
                </Label>
              </div>
            );
          })}
        </RadioGroup>
      );
    case "checkbox":
      return (
        <CheckboxField
          question={question}
          value={value}
          onChange={onChange}
          described={described}
          invalid={invalid}
          disabled={disabled}
        />
      );
    case "dropdown":
      return (
        <Select
          value={typeof value === "string" ? value : undefined}
          onValueChange={(next) => onChange(next)}
          disabled={disabled}
        >
          <SelectTrigger
            id={`${question.questionId}-input`}
            aria-invalid={invalid || undefined}
            aria-describedby={described}
          >
            <SelectValue placeholder={question.metadata?.placeholder ?? "Choose one"} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "rating":
      return (
        <RatingField
          question={question}
          value={value}
          onChange={onChange}
          described={described}
          invalid={invalid}
          disabled={disabled}
        />
      );
    default:
      return null;
  }
}

export function QuestionRenderer(props: QuestionRendererProps) {
  const { question, error } = props;
  const described = describedBy(question, error);
  const invalid = error !== undefined && error !== "";
  return (
    <div className="space-y-2" data-question-id={question.questionId}>
      <div className="space-y-1">
        <Prompt question={question} />
        {question.subtext ? (
          <p id={`${question.questionId}-subtext`} className="whitespace-pre-wrap text-sm text-muted-foreground">
            {question.subtext}
          </p>
        ) : null}
      </div>
      <Control {...props} described={described} invalid={invalid} />
      {invalid ? (
        <p id={`${question.questionId}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
