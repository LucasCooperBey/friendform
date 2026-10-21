import { useState } from "react";
import { ChevronDown, ChevronUp, Copy, Trash2 } from "lucide-react";
import type { ConditionalLogic, Question, QuestionMetadata } from "@shared/form-schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConditionEditor } from "@/components/editor/ConditionEditor";
import { OptionsEditor } from "@/components/editor/OptionsEditor";
import {
  QUESTION_TYPE_LIST,
  isQuestionType,
  metadataForType,
  questionLabel,
  questionTypeDetail,
  usesOptions,
  usesPlaceholder,
  usesRange,
} from "@/components/editor/question-types";

function commit(question: Question, metadata: QuestionMetadata | undefined): Question {
  const next: Question = {
    questionId: question.questionId,
    type: question.type,
    prompt: question.prompt,
    required: question.required,
  };
  if (question.subtext !== undefined) next.subtext = question.subtext;
  if (metadata !== undefined && Object.keys(metadata).length > 0) next.metadata = metadata;
  return next;
}

export function QuestionCard({
  question,
  earlier,
  canMoveUp,
  canMoveDown,
  defaultExpanded = false,
  onChange,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  question: Question;
  earlier: Question[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  defaultExpanded?: boolean;
  onChange: (question: Question) => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const label = questionLabel(question);
  const detail = questionTypeDetail(question.type);
  const Icon = detail.icon;
  const shownWhen = question.metadata?.conditionalLogic?.enabled === true;

  function changeType(value: string) {
    if (!isQuestionType(value) || value === question.type) return;
    const metadata = metadataForType(value, question.metadata);
    const next: Question = {
      questionId: question.questionId,
      type: value,
      prompt: question.prompt,
      required: question.required,
    };
    if (question.subtext !== undefined) next.subtext = question.subtext;
    if (metadata !== undefined) next.metadata = metadata;
    onChange(next);
  }

  function setNumber(key: "min" | "max" | "minSelections" | "maxSelections", raw: string) {
    const metadata: QuestionMetadata = { ...(question.metadata ?? {}) };
    if (raw.trim() === "") delete metadata[key];
    else {
      const value = Number(raw);
      if (!Number.isFinite(value)) return;
      metadata[key] = value;
    }
    onChange(commit(question, metadata));
  }

  function setPlaceholder(value: string) {
    const metadata: QuestionMetadata = { ...(question.metadata ?? {}) };
    if (value === "") delete metadata.placeholder;
    else metadata.placeholder = value;
    onChange(commit(question, metadata));
  }

  function clampRatingMax() {
    if (question.type !== "rating" || question.metadata?.max === undefined) return;
    const clamped = Math.min(10, Math.max(2, question.metadata.max));
    if (clamped !== question.metadata.max) setNumber("max", String(clamped));
  }

  return (
    <article aria-label={label} className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`Edit ${label}`}
          onClick={() => setExpanded((open) => !open)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{label}</span>
        </button>
        {question.required ? <Badge variant="outline">Required</Badge> : null}
        {shownWhen ? <Badge variant="outline">Shown when{"\u2026"}</Badge> : null}
        <Button variant="outline" size="icon" aria-label={`Move up: ${label}`} disabled={!canMoveUp} onClick={onMoveUp}>
          <ChevronUp />
        </Button>
        <Button variant="outline" size="icon" aria-label={`Move down: ${label}`} disabled={!canMoveDown} onClick={onMoveDown}>
          <ChevronDown />
        </Button>
        <Button variant="outline" size="icon" aria-label={`Duplicate: ${label}`} onClick={onDuplicate}>
          <Copy />
        </Button>
        <Button variant="outline" size="icon" aria-label={`Delete: ${label}`} onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
      {expanded ? (
        <div className="space-y-4 border-t p-4">
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={question.type} onValueChange={changeType}>
              <SelectTrigger aria-label="Question type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUESTION_TYPE_LIST.map((item) => (
                  <SelectItem key={item.type} value={item.type}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`prompt-${question.questionId}`}>Prompt</Label>
            <Input
              id={`prompt-${question.questionId}`}
              value={question.prompt}
              maxLength={500}
              onChange={(event) => onChange({ ...question, prompt: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`help-${question.questionId}`}>Help text</Label>
            <Textarea
              id={`help-${question.questionId}`}
              value={question.subtext ?? ""}
              maxLength={1000}
              onChange={(event) => onChange({ ...question, subtext: event.target.value })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`required-${question.questionId}`}>Required</Label>
            <Switch
              id={`required-${question.questionId}`}
              checked={question.required}
              onCheckedChange={(checked) => onChange({ ...question, required: checked === true })}
            />
          </div>
          {usesOptions(question.type) ? (
            <OptionsEditor
              options={question.metadata?.options ?? []}
              onChange={(options) => onChange(commit(question, { ...(question.metadata ?? {}), options }))}
            />
          ) : null}
          {usesPlaceholder(question.type) ? (
            <div className="space-y-2">
              <Label htmlFor={`placeholder-${question.questionId}`}>Placeholder</Label>
              <Input
                id={`placeholder-${question.questionId}`}
                value={question.metadata?.placeholder ?? ""}
                onChange={(event) => setPlaceholder(event.target.value)}
              />
            </div>
          ) : null}
          {usesRange(question.type) ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`min-${question.questionId}`}>Minimum</Label>
                <Input
                  id={`min-${question.questionId}`}
                  type="number"
                  value={question.metadata?.min ?? ""}
                  onChange={(event) => setNumber("min", event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`max-${question.questionId}`}>Maximum</Label>
                <Input
                  id={`max-${question.questionId}`}
                  type="number"
                  value={question.metadata?.max ?? ""}
                  onChange={(event) => setNumber("max", event.target.value)}
                  onBlur={clampRatingMax}
                />
              </div>
            </div>
          ) : null}
          {question.type === "checkbox" ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`min-selections-${question.questionId}`}>Minimum selections</Label>
                  <Input
                    id={`min-selections-${question.questionId}`}
                    type="number"
                    value={question.metadata?.minSelections ?? ""}
                    onChange={(event) => setNumber("minSelections", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`max-selections-${question.questionId}`}>Maximum selections</Label>
                  <Input
                    id={`max-selections-${question.questionId}`}
                    type="number"
                    value={question.metadata?.maxSelections ?? ""}
                    onChange={(event) => setNumber("maxSelections", event.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={`select-all-${question.questionId}`}>Allow select all</Label>
                <Switch
                  id={`select-all-${question.questionId}`}
                  checked={question.metadata?.allowSelectAll === true}
                  onCheckedChange={(checked) =>
                    onChange(commit(question, { ...(question.metadata ?? {}), allowSelectAll: checked === true }))
                  }
                />
              </div>
            </div>
          ) : null}
          <ConditionEditor
            questionId={question.questionId}
            earlier={earlier}
            logic={question.metadata?.conditionalLogic}
            onChange={(logic: ConditionalLogic) =>
              onChange(commit(question, { ...(question.metadata ?? {}), conditionalLogic: logic }))
            }
          />
        </div>
      ) : null}
    </article>
  );
}
