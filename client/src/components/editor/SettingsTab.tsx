import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import type { FormSettings, ThankYouSettings } from "@shared/form-schema";
import { ApiError, api, errorMessage } from "@/lib/api";
import { queryClient, useSession } from "@/lib/session";
import { toast } from "@/hooks/use-toast";
import { WebhooksEditor } from "@/components/editor/WebhooksEditor";
import { discardFormDraft, formQueryKey, parseFormDetail, type FormDetail } from "@/components/editor/useDraft";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

function isTheme(value: string): value is FormSettings["theme"] {
  return value === "light" || value === "dark" || value === "system";
}

export function SettingsTab({
  form,
  settings,
  onSettings,
}: {
  form: FormDetail;
  settings: FormSettings;
  onSettings: (settings: FormSettings) => void;
}) {
  const { publicUrl, aiEnabled } = useSession();
  const [, setLocation] = useLocation();
  const [slug, setSlug] = useState(form.slug);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [savingSlug, setSavingSlug] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const origin = publicUrl ?? window.location.origin;

  useEffect(() => {
    setSlug(form.slug);
  }, [form.slug]);

  function updateThankYou(patch: Partial<ThankYouSettings>, omit: Array<"redirectUrl" | "redirectDelaySeconds"> = []) {
    const thankYou: ThankYouSettings = { ...settings.thankYou, ...patch };
    if (omit.includes("redirectUrl") || thankYou.redirectUrl?.trim() === "") delete thankYou.redirectUrl;
    if (omit.includes("redirectDelaySeconds")) delete thankYou.redirectDelaySeconds;
    onSettings({ ...settings, thankYou });
  }

  async function saveSlug() {
    setSavingSlug(true);
    setSlugError(null);
    try {
      const next = parseFormDetail(await api<unknown>(`/api/forms/${encodeURIComponent(form.id)}`, { method: "PATCH", body: { slug } }));
      queryClient.setQueryData(formQueryKey(form.id), next);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setSlugError("That link is already taken.");
        return;
      }
      if (error instanceof ApiError && error.status === 400) {
        setSlugError("Use lowercase letters, numbers and dashes.");
        return;
      }
      toast({ title: errorMessage(error) });
    } finally {
      setSavingSlug(false);
    }
  }

  async function changeAvailability(action: "close" | "reopen") {
    try {
      const next = parseFormDetail(await api<unknown>(`/api/forms/${encodeURIComponent(form.id)}/${action}`, { method: "POST" }));
      queryClient.setQueryData(formQueryKey(form.id), next);
    } catch (error) {
      toast({ title: errorMessage(error) });
    }
  }

  async function removeForm() {
    try {
      await api<void>(`/api/forms/${encodeURIComponent(form.id)}`, { method: "DELETE" });
      discardFormDraft(form.id);
      await queryClient.invalidateQueries({ queryKey: ["forms"] });
      queryClient.removeQueries({ queryKey: formQueryKey(form.id) });
      toast({ title: "Form deleted" });
      setLocation("/");
    } catch (error) {
      toast({ title: errorMessage(error) });
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Link</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{origin}/f/</span>
          <Input aria-label="Link" value={slug} onChange={(event) => setSlug(event.target.value)} className="max-w-xs" />
          <Button onClick={() => void saveSlug()} disabled={savingSlug}>
            Save link
          </Button>
        </div>
        {slugError ? <p className="text-sm text-destructive">{slugError}</p> : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Appearance</h2>
        <div className="space-y-2">
          <Label>Theme</Label>
          <Select
            value={settings.theme}
            onValueChange={(value) => {
              if (isTheme(value)) onSettings({ ...settings, theme: value });
            }}
          >
            <SelectTrigger aria-label="Theme" className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="system">Match device</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="show-progress">Show progress bar</Label>
          <Switch
            id="show-progress"
            checked={settings.showProgress}
            onCheckedChange={(checked) => onSettings({ ...settings, showProgress: checked === true })}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Fill from a document</h2>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="allow-autofill">Let people fill this form from a document</Label>
          <Switch
            id="allow-autofill"
            checked={settings.allowAutofill}
            disabled={!aiEnabled && !settings.allowAutofill}
            onCheckedChange={(checked) => onSettings({ ...settings, allowAutofill: checked === true })}
          />
        </div>
        {aiEnabled ? null : (
          <p className="text-sm text-muted-foreground">Set AI_BASE_URL, AI_API_KEY and AI_MODEL to turn this on.</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">After someone submits</h2>
        <div className="space-y-2">
          <Label htmlFor="thanks-title">Thank-you title</Label>
          <Input
            id="thanks-title"
            value={settings.thankYou.title}
            maxLength={200}
            onChange={(event) => updateThankYou({ title: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="thanks-message">Thank-you message</Label>
          <Textarea
            id="thanks-message"
            value={settings.thankYou.message}
            maxLength={2000}
            onChange={(event) => updateThankYou({ message: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="thanks-redirect">Redirect URL</Label>
          <Input
            id="thanks-redirect"
            value={settings.thankYou.redirectUrl ?? ""}
            onChange={(event) => updateThankYou({ redirectUrl: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="thanks-delay">Delay in seconds</Label>
          <Input
            id="thanks-delay"
            type="number"
            min={0}
            max={60}
            value={settings.thankYou.redirectDelaySeconds ?? ""}
            onChange={(event) => {
              if (event.target.value === "") {
                updateThankYou({}, ["redirectDelaySeconds"]);
                return;
              }
              const value = Number(event.target.value);
              if (Number.isFinite(value)) updateThankYou({ redirectDelaySeconds: value });
            }}
            onBlur={() => {
              const value = settings.thankYou.redirectDelaySeconds;
              if (value === undefined) return;
              const clamped = Math.min(60, Math.max(0, Math.round(value)));
              if (clamped !== value) updateThankYou({ redirectDelaySeconds: clamped });
            }}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">When the form is closed</h2>
        <div className="space-y-2">
          <Label htmlFor="closed-message">Closed message</Label>
          <Textarea
            id="closed-message"
            value={settings.closedMessage}
            maxLength={500}
            onChange={(event) => onSettings({ ...settings, closedMessage: event.target.value })}
          />
        </div>
      </section>

      <WebhooksEditor formId={form.id} webhooks={settings.webhooks} onChange={(webhooks) => onSettings({ ...settings, webhooks })} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Availability</h2>
        {form.publishedVersion === null ? (
          <p className="text-sm text-muted-foreground">Publish the form before you can close it.</p>
        ) : form.status === "closed" ? (
          <>
            <p className="text-sm text-muted-foreground">Reopening the form lets people submit responses again.</p>
            <Button variant="outline" onClick={() => void changeAvailability("reopen")}>
              Reopen form
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Closing the form keeps the link open and shows your closed message instead of the questions.
            </p>
            <Button variant="outline" onClick={() => void changeAvailability("close")}>
              Close form
            </Button>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Delete form</h2>
        <Button variant="destructive" onClick={() => setConfirming(true)}>
          Delete form
        </Button>
      </section>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this form?</AlertDialogTitle>
            <AlertDialogDescription>This deletes the form and its responses.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void removeForm()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
