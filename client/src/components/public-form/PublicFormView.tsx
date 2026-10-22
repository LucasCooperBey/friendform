import { useMemo, useRef, useState, type FormEvent } from "react";
import { allQuestions, type FormSchema, type Responses, type ResponseValue, type ThankYouSettings } from "@shared/form-schema";
import { isEmptyValue, visibleQuestionIds } from "@shared/logic";
import { validateResponses } from "@shared/validate";
import { Collapse } from "@/components/public-form/Collapse";
import { FormProgress } from "@/components/public-form/FormProgress";
import { QuestionRenderer } from "@/components/public-form/QuestionRenderer";
import { AutofillButton, filledToast } from "@/components/public-form/AutofillButton";
import { ThankYou } from "@/components/public-form/ThankYou";
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
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";

export interface PublicFormViewProps {
  form: {
    title: string;
    description: string;
    schema: FormSchema;
    settings: {
      theme: "light" | "dark" | "system";
      showProgress: boolean;
      thankYou: ThankYouSettings;
      allowAutofill?: boolean;
    };
  };
  mode: "live" | "preview";
  autofillSlug?: string;
  onSubmit?: (body: {
    responses: Responses;
    website: string;
  }) => Promise<{ ok: true } | { ok: false; errors?: Record<string, string>; message?: string }>;
  onFirstInput?: () => void;
}

function readResponse(responses: Responses, id: string): ResponseValue | undefined {
  if (!Object.hasOwn(responses, id)) return undefined;
  return responses[id];
}

function sameValue(left: ResponseValue | undefined, right: ResponseValue | undefined): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => item === right[index]);
  }
  return false;
}

function replaceSentence(count: number): string {
  return count === 1
    ? "This will replace 1 answer you already entered."
    : `This will replace ${count} answers you already entered.`;
}

function focusQuestion(questionId: string) {
  const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(questionId) : questionId;
  requestAnimationFrame(() => {
    const root = document.querySelector(`[data-question-id="${escaped}"]`);
    if (!(root instanceof HTMLElement)) return;
    try {
      root.scrollIntoView({ block: "center" });
    } catch {
      // Scrolling is optional. Focus still moves.
    }
    const control = root.querySelector<HTMLElement>("input, textarea, button, [role='combobox']");
    if (control) control.focus();
  });
}

export function PublicFormView({ form, mode, autofillSlug, onSubmit, onFirstInput }: PublicFormViewProps) {
  const [responses, setResponses] = useState<Responses>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [pendingFill, setPendingFill] = useState<Responses | null>(null);
  const [unparsed, setUnparsed] = useState<Record<string, true>>({});
  const started = useRef(false);
  const responsesRef = useRef(responses);
  responsesRef.current = responses;
  const pendingRef = useRef(pendingFill);
  pendingRef.current = pendingFill;
  const immediateRef = useRef(0);
  const unparsedRef = useRef(unparsed);
  unparsedRef.current = unparsed;
  const showAutofill = mode === "live" && autofillSlug !== undefined && form.settings.allowAutofill === true;

  const visible = useMemo(() => visibleQuestionIds(form.schema, responses), [form.schema, responses]);
  const visibleQuestions = useMemo(
    () => allQuestions(form.schema).filter((question) => visible.has(question.questionId)),
    [form.schema, visible],
  );
  const answered = visibleQuestions.filter((question) => !isEmptyValue(readResponse(responses, question.questionId))).length;
  const showProgress = form.settings.showProgress && visibleQuestions.length >= 2;

  function noteInput() {
    if (started.current) return;
    started.current = true;
    onFirstInput?.();
  }

  function writeResponses(next: Responses) {
    responsesRef.current = next;
    setResponses(next);
  }

  function applyAnswers(incoming: Responses): number {
    const current = responsesRef.current;
    const next = { ...current };
    let applied = 0;
    for (const [id, value] of Object.entries(incoming)) {
      const existing = Object.hasOwn(current, id) ? current[id] : undefined;
      if (sameValue(existing, value)) continue;
      next[id] = value;
      applied += 1;
    }
    if (applied === 0) return 0;
    noteInput();
    writeResponses(next);
    return applied;
  }

  function onFill(incoming: Responses): { pending: boolean } {
    const current = responsesRef.current;
    const safe: Responses = {};
    const conflicts: Responses = {};
    for (const [id, value] of Object.entries(incoming)) {
      const existing = Object.hasOwn(current, id) ? current[id] : undefined;
      const typed = existing !== undefined && !isEmptyValue(existing);
      if (typed && !sameValue(existing, value)) conflicts[id] = value;
      else safe[id] = value;
    }
    const applied = applyAnswers(safe);
    if (Object.keys(conflicts).length > 0) {
      immediateRef.current = applied;
      pendingRef.current = conflicts;
      setPendingFill(conflicts);
      return { pending: true };
    }
    return { pending: false };
  }

  function settleFill(replace: boolean) {
    const pending = pendingRef.current;
    if (pending === null) return;
    pendingRef.current = null;
    const base = immediateRef.current;
    immediateRef.current = 0;
    setPendingFill(null);
    const added = replace ? applyAnswers(pending) : 0;
    toast({ title: filledToast(base + added) });
  }

  function markUnparsed(id: string, flag: boolean) {
    const current = unparsedRef.current;
    const has = current[id] === true;
    if (flag === has) return;
    const next = { ...current };
    if (flag) next[id] = true;
    else delete next[id];
    unparsedRef.current = next;
    setUnparsed(next);
  }

  function update(id: string, value: ResponseValue | undefined) {
    noteInput();
    setResponses((current) => {
      const next = { ...current };
      if (value === undefined) delete next[id];
      else next[id] = value;
      return next;
    });
    setErrors((current) => {
      if (!Object.hasOwn(current, id)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateResponses(form.schema, responses);
    const unparsedNow = unparsedRef.current;
    const hasUnparsed = Object.keys(unparsedNow).length > 0;
    if (!result.ok || hasUnparsed) {
      setErrors(result.ok ? {} : result.errors);
      setBanner("Some answers need attention.");
      const first = allQuestions(form.schema).find(
        (question) => unparsedNow[question.questionId] === true || (!result.ok && result.errors[question.questionId] !== undefined),
      );
      if (first) focusQuestion(first.questionId);
      return;
    }
    setErrors({});
    if (mode === "preview" || !onSubmit) {
      setBanner(null);
      setDone(true);
      return;
    }
    setSubmitting(true);
    try {
      const outcome = await onSubmit({ responses: result.responses, website });
      if (outcome.ok) {
        setBanner(null);
        setDone(true);
        return;
      }
      setErrors(outcome.errors ?? {});
      setBanner(outcome.message ?? "Some answers need attention.");
      if (outcome.errors) {
        const first = allQuestions(form.schema).find((question) => outcome.errors?.[question.questionId] !== undefined);
        if (first) focusQuestion(first.questionId);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {showProgress ? <FormProgress answered={answered} total={visibleQuestions.length} /> : null}
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
        {mode === "preview" ? (
          <p className="mb-6 rounded-md bg-primary px-3 py-2 text-center text-sm font-semibold text-primary-foreground">
            Preview
          </p>
        ) : null}
        {done ? (
          <ThankYou settings={form.settings.thankYou} mode={mode} />
        ) : (
          <div className="space-y-6">
            <header className="space-y-3">
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{form.title}</h1>
              {form.description !== "" ? (
                <p className="whitespace-pre-wrap text-base text-muted-foreground">{form.description}</p>
              ) : null}
            </header>
            <form noValidate onSubmit={(event) => void handleSubmit(event)} className="relative space-y-6">
              {banner ? (
                <p role="status" aria-live="polite" className="rounded-md border border-destructive px-4 py-3 text-sm text-destructive">
                  {banner}
                </p>
              ) : null}
              <div className="absolute left-[-10000px]" aria-hidden="true">
                <label htmlFor="ff-leave-blank">Leave blank</label>
                <input
                  id="ff-leave-blank"
                  name="ff-leave-blank"
                  tabIndex={-1}
                  autoComplete="off"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  data-bwignore="true"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                />
              </div>
              {showAutofill && autofillSlug ? <AutofillButton slug={autofillSlug} onFill={onFill} /> : null}
              {form.schema.sections.map((section, index) => (
                <Card key={`${section.title}-${index}`}>
                  <CardHeader>
                    <h2 className="text-xl font-semibold">{section.title}</h2>
                    {section.description ? (
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">{section.description}</p>
                    ) : null}
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {section.questions.map((question) => (
                      <Collapse key={question.questionId} open={visible.has(question.questionId)}>
                        <QuestionRenderer
                          question={question}
                          value={readResponse(responses, question.questionId)}
                          onChange={(value) => update(question.questionId, value)}
                          onNumberUnparsed={(flag) => markUnparsed(question.questionId, flag)}
                          error={unparsed[question.questionId] ? "Enter a number." : errors[question.questionId]}
                          disabled={submitting}
                        />
                      </Collapse>
                    ))}
                  </CardContent>
                </Card>
              ))}
              <Button type="submit" disabled={submitting}>
                {submitting ? "Sending..." : "Submit"}
              </Button>
            </form>
          </div>
        )}
        <AlertDialog open={pendingFill !== null} onOpenChange={(open) => { if (!open) settleFill(false); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Replace answers you already entered?</AlertDialogTitle>
              <AlertDialogDescription>
                {replaceSentence(pendingFill ? Object.keys(pendingFill).length : 0)}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => settleFill(true)}>Replace</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <footer className="mt-10 text-center text-sm text-muted-foreground">
          <a
            href="https://github.com/LucasCooperBey/friendform"
            rel="noopener"
            target="_blank"
            className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Made with Friendform
          </a>
        </footer>
      </div>
    </div>
  );
}
