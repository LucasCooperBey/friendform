import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { formSchemaZ, type FormSchema, type Responses, type ThankYouSettings } from "@shared/form-schema";
import { ApiError, api, errorMessage } from "@/lib/api";
import { isRecord } from "@/lib/utils";
import { useTheme, type ThemePreference } from "@/components/ThemeProvider";
import { PublicFormView } from "@/components/public-form/PublicFormView";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/;
const memoryIds = new Map<string, string>();

function respondentSessionId(slug: string): string {
  const key = `friendform-session-${slug}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing && SESSION_RE.test(existing)) return existing;
    const created = crypto.randomUUID();
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    const existing = memoryIds.get(slug);
    if (existing) return existing;
    const created = crypto.randomUUID();
    memoryIds.set(slug, created);
    return created;
  }
}

interface OpenForm {
  closed: false;
  title: string;
  description: string;
  schema: FormSchema;
  settings: {
    theme: ThemePreference;
    showProgress: boolean;
    thankYou: ThankYouSettings;
  };
}

interface ClosedForm {
  closed: true;
  title: string;
  closedMessage: string;
}

type PublicLoad = OpenForm | ClosedForm;

function readTheme(value: unknown): ThemePreference {
  if (value === "light" || value === "dark" || value === "system") return value;
  return "system";
}

function parseThankYou(value: unknown): ThankYouSettings {
  if (!isRecord(value)) return { title: "Thank you!", message: "Your response has been recorded." };
  const thankYou: ThankYouSettings = {
    title: typeof value.title === "string" ? value.title : "Thank you!",
    message: typeof value.message === "string" ? value.message : "Your response has been recorded.",
  };
  if (typeof value.redirectUrl === "string") thankYou.redirectUrl = value.redirectUrl;
  if (typeof value.redirectDelaySeconds === "number") thankYou.redirectDelaySeconds = value.redirectDelaySeconds;
  return thankYou;
}

function parseOpen(value: unknown): OpenForm {
  if (!isRecord(value) || !isRecord(value.settings)) throw new Error("This form could not be read.");
  const schema = formSchemaZ.safeParse(value.schema);
  if (!schema.success) throw new Error("This form could not be read.");
  return {
    closed: false,
    title: typeof value.title === "string" ? value.title : "Untitled form",
    description: typeof value.description === "string" ? value.description : "",
    schema: schema.data,
    settings: {
      theme: readTheme(value.settings.theme),
      showProgress: value.settings.showProgress !== false,
      thankYou: parseThankYou(value.settings.thankYou),
    },
  };
}

function parseClosed(body: unknown): ClosedForm {
  return {
    closed: true,
    title: isRecord(body) && typeof body.title === "string" ? body.title : "This form is closed",
    closedMessage:
      isRecord(body) && typeof body.closedMessage === "string"
        ? body.closedMessage
        : "This form is no longer accepting responses.",
  };
}

async function loadPublicForm(slug: string): Promise<PublicLoad> {
  try {
    return parseOpen(await api<unknown>(`/api/public/forms/${encodeURIComponent(slug)}`));
  } catch (error) {
    if (error instanceof ApiError && error.status === 410) return parseClosed(error.body);
    throw error;
  }
}

function stringErrors(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const errors: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") errors[key] = item;
  }
  return errors;
}

function NotFoundCopy() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl items-center px-4 py-16">
      <Card className="w-full">
        <CardHeader>
          <h1 className="text-xl font-semibold">Form not found</h1>
          <p className="text-sm text-muted-foreground">This form doesn't exist or isn't published yet.</p>
        </CardHeader>
      </Card>
    </div>
  );
}

export function PublicFormPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? "";
  const { setOverride } = useTheme();
  const query = useQuery({
    queryKey: ["public-form", slug],
    enabled: slug !== "",
    queryFn: () => loadPublicForm(slug),
  });
  const open = query.data && query.data.closed === false ? query.data : null;
  const postedView = useRef<string | null>(null);
  const postedStart = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setOverride(open.settings.theme);
    return () => setOverride(null);
  }, [open, setOverride]);

  useEffect(() => {
    if (!open || postedView.current === slug) return;
    postedView.current = slug;
    const sessionId = respondentSessionId(slug);
    api(`/api/public/forms/${encodeURIComponent(slug)}/events`, {
      method: "POST",
      body: { type: "view", sessionId },
    }).catch(() => undefined);
  }, [open, slug]);

  function onFirstInput() {
    if (postedStart.current === slug) return;
    postedStart.current = slug;
    const sessionId = respondentSessionId(slug);
    api(`/api/public/forms/${encodeURIComponent(slug)}/events`, {
      method: "POST",
      body: { type: "start", sessionId },
    }).catch(() => undefined);
  }

  async function onSubmit(body: { responses: Responses; website: string }) {
    const payload: { responses: Responses; website: string; sessionId: string; referrer?: string } = {
      responses: body.responses,
      website: body.website,
      sessionId: respondentSessionId(slug),
    };
    if (document.referrer !== "") payload.referrer = document.referrer;
    try {
      await api(`/api/public/forms/${encodeURIComponent(slug)}/submissions`, { method: "POST", body: payload });
      return { ok: true as const };
    } catch (error) {
      if (error instanceof ApiError && error.status === 400 && isRecord(error.body)) {
        return {
          ok: false as const,
          errors: stringErrors(error.body.errors),
          message: "Some answers need attention.",
        };
      }
      if (error instanceof ApiError && error.status === 429) {
        return { ok: false as const, message: "Too many submissions from your network. Try again in a few minutes." };
      }
      return { ok: false as const, message: errorMessage(error) };
    }
  }

  if (slug === "") return <NotFoundCopy />;
  if (query.isPending) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-10">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) return <NotFoundCopy />;
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <Card>
          <CardHeader className="space-y-3">
            <p>{errorMessage(query.error)}</p>
            <Button type="button" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </CardHeader>
        </Card>
      </div>
    );
  }
  if (!query.data) return <NotFoundCopy />;
  if (query.data.closed) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-2xl items-center px-4 py-16">
        <Card className="w-full">
          <CardHeader>
            <h1 className="text-xl font-semibold">{query.data.title}</h1>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{query.data.closedMessage}</p>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <PublicFormView
      form={{
        title: query.data.title,
        description: query.data.description,
        schema: query.data.schema,
        settings: query.data.settings,
      }}
      mode="live"
      onSubmit={onSubmit}
      onFirstInput={onFirstInput}
    />
  );
}
