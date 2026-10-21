import { useState } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type { Question, Section } from "@shared/form-schema";
import { AddQuestionMenu } from "@/components/editor/AddQuestionMenu";
import { QuestionCard } from "@/components/editor/QuestionCard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function SectionCard({
  section,
  index,
  sectionCount,
  taken,
  earlierBefore,
  expandedId,
  onChange,
  onMove,
  onDelete,
  onQuestionChange,
  onQuestionMove,
  onQuestionDuplicate,
  onQuestionDelete,
  onAddQuestion,
}: {
  section: Section;
  index: number;
  sectionCount: number;
  taken: string[];
  earlierBefore: Question[];
  expandedId: string | null;
  onChange: (section: Section) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  onQuestionChange: (questionIndex: number, question: Question) => void;
  onQuestionMove: (questionIndex: number, direction: -1 | 1) => void;
  onQuestionDuplicate: (questionIndex: number) => void;
  onQuestionDelete: (questionIndex: number) => void;
  onAddQuestion: (question: Question) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const title = section.title.trim() === "" ? "Untitled section" : section.title;

  function requestDelete() {
    if (section.questions.length > 0) setConfirming(true);
    else onDelete();
  }

  return (
    <section aria-label={title} className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid flex-1 gap-3">
          <div className="space-y-2">
            <Label htmlFor={`section-${index}-title`}>Section title</Label>
            <Input
              id={`section-${index}-title`}
              value={section.title}
              maxLength={200}
              onChange={(event) => onChange({ ...section, title: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`section-${index}-description`}>Section description</Label>
            <Textarea
              id={`section-${index}-description`}
              value={section.description ?? ""}
              maxLength={2000}
              onChange={(event) => onChange({ ...section, description: event.target.value })}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" aria-label={`Move ${title} up`} disabled={index === 0} onClick={() => onMove(-1)}>
            <ChevronUp />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={`Move ${title} down`}
            disabled={index === sectionCount - 1}
            onClick={() => onMove(1)}
          >
            <ChevronDown />
          </Button>
          <Button variant="outline" size="icon" aria-label={`Delete ${title}`} onClick={requestDelete}>
            <Trash2 />
          </Button>
        </div>
      </div>
      <div className="space-y-3">
        {section.questions.map((question, questionIndex) => (
          <QuestionCard
            key={question.questionId}
            question={question}
            earlier={[...earlierBefore, ...section.questions.slice(0, questionIndex)]}
            canMoveUp={questionIndex > 0 || index > 0}
            canMoveDown={questionIndex < section.questions.length - 1 || index < sectionCount - 1}
            defaultExpanded={question.questionId === expandedId}
            onChange={(next) => onQuestionChange(questionIndex, next)}
            onDuplicate={() => onQuestionDuplicate(questionIndex)}
            onMoveUp={() => onQuestionMove(questionIndex, -1)}
            onMoveDown={() => onQuestionMove(questionIndex, 1)}
            onDelete={() => onQuestionDelete(questionIndex)}
          />
        ))}
      </div>
      <AddQuestionMenu taken={taken} onAdd={onAddQuestion} />
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {title}?</AlertDialogTitle>
            <AlertDialogDescription>This deletes the section and its questions.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false);
                onDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
