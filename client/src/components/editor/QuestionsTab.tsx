import { useState } from "react";
import { allQuestions, type FormSchema, type Question, type Section } from "@shared/form-schema";
import { ProblemsList } from "@/components/editor/ProblemsList";
import { SectionCard } from "@/components/editor/SectionCard";
import { duplicateQuestion } from "@/components/editor/question-types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function QuestionsTab({
  description,
  schema,
  onDescription,
  onSchema,
}: {
  description: string;
  schema: FormSchema;
  onDescription: (description: string) => void;
  onSchema: (schema: FormSchema) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const taken = allQuestions(schema).map((question) => question.questionId);

  function replaceSection(index: number, section: Section) {
    onSchema({ sections: schema.sections.map((item, itemIndex) => (itemIndex === index ? section : item)) });
  }

  function moveSection(index: number, direction: -1 | 1) {
    const target = index + direction;
    const current = schema.sections[index];
    const other = schema.sections[target];
    if (!current || !other || target < 0 || target >= schema.sections.length) return;
    const sections = [...schema.sections];
    sections[index] = other;
    sections[target] = current;
    onSchema({ sections });
  }

  function deleteSection(index: number) {
    onSchema({ sections: schema.sections.filter((_, itemIndex) => itemIndex !== index) });
  }

  function changeQuestion(sectionIndex: number, questionIndex: number, question: Question) {
    const section = schema.sections[sectionIndex];
    if (!section) return;
    replaceSection(sectionIndex, {
      ...section,
      questions: section.questions.map((item, index) => (index === questionIndex ? question : item)),
    });
  }

  function moveQuestion(sectionIndex: number, questionIndex: number, direction: -1 | 1) {
    const sections = schema.sections.map((section) => ({ ...section, questions: [...section.questions] }));
    const section = sections[sectionIndex];
    const question = section?.questions[questionIndex];
    if (!section || !question) return;
    const target = questionIndex + direction;
    if (target >= 0 && target < section.questions.length) {
      const other = section.questions[target];
      if (!other) return;
      section.questions[questionIndex] = other;
      section.questions[target] = question;
    } else if (direction === -1 && sectionIndex > 0) {
      const previous = sections[sectionIndex - 1];
      if (!previous) return;
      section.questions.splice(questionIndex, 1);
      previous.questions.push(question);
    } else if (direction === 1 && sectionIndex < sections.length - 1) {
      const next = sections[sectionIndex + 1];
      if (!next) return;
      section.questions.splice(questionIndex, 1);
      next.questions.unshift(question);
    } else {
      return;
    }
    onSchema({ sections });
  }

  function duplicateAt(sectionIndex: number, questionIndex: number) {
    const section = schema.sections[sectionIndex];
    const question = section?.questions[questionIndex];
    if (!section || !question) return;
    const copy = duplicateQuestion(question, taken);
    const questions = [...section.questions];
    questions.splice(questionIndex + 1, 0, copy);
    replaceSection(sectionIndex, { ...section, questions });
    setExpandedId(copy.questionId);
  }

  function deleteQuestion(sectionIndex: number, questionIndex: number) {
    const section = schema.sections[sectionIndex];
    if (!section) return;
    replaceSection(sectionIndex, {
      ...section,
      questions: section.questions.filter((_, index) => index !== questionIndex),
    });
  }

  function addQuestion(sectionIndex: number, question: Question) {
    const section = schema.sections[sectionIndex];
    if (!section) return;
    replaceSection(sectionIndex, { ...section, questions: [...section.questions, question] });
    setExpandedId(question.questionId);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="form-description">Description</Label>
        <Textarea
          id="form-description"
          value={description}
          maxLength={2000}
          onChange={(event) => onDescription(event.target.value)}
        />
      </div>
      {schema.sections.map((section, index) => {
        const earlierBefore = schema.sections.slice(0, index).flatMap((item) => item.questions);
        return (
          <SectionCard
            key={index}
            section={section}
            index={index}
            sectionCount={schema.sections.length}
            taken={taken}
            earlierBefore={earlierBefore}
            expandedId={expandedId}
            onChange={(next) => replaceSection(index, next)}
            onMove={(direction) => moveSection(index, direction)}
            onDelete={() => deleteSection(index)}
            onQuestionChange={(questionIndex, question) => changeQuestion(index, questionIndex, question)}
            onQuestionMove={(questionIndex, direction) => moveQuestion(index, questionIndex, direction)}
            onQuestionDuplicate={(questionIndex) => duplicateAt(index, questionIndex)}
            onQuestionDelete={(questionIndex) => deleteQuestion(index, questionIndex)}
            onAddQuestion={(question) => addQuestion(index, question)}
          />
        );
      })}
      <Button
        variant="outline"
        onClick={() => onSchema({ sections: [...schema.sections, { title: "Untitled section", questions: [] }] })}
      >
        Add section
      </Button>
      <ProblemsList schema={schema} />
    </div>
  );
}
