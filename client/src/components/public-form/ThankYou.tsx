import { useEffect, useState } from "react";
import type { ThankYouSettings } from "@shared/form-schema";

function httpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    return null;
  }
  return null;
}

export function ThankYou({ settings, mode }: { settings: ThankYouSettings; mode: "live" | "preview" }) {
  const redirect = httpUrl(settings.redirectUrl);
  const delay = settings.redirectDelaySeconds ?? 3;
  const [left, setLeft] = useState(delay);

  useEffect(() => {
    if (mode === "preview" || !redirect) return;
    if (left <= 0) {
      window.location.assign(redirect);
      return;
    }
    const timer = window.setTimeout(() => setLeft((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [mode, redirect, left]);

  return (
    <div className="space-y-4 rounded-lg border bg-card p-6 text-card-foreground">
      <h2 className="text-2xl font-semibold tracking-tight">{settings.title}</h2>
      <p className="whitespace-pre-wrap text-base">{settings.message}</p>
      {redirect && mode === "preview" ? <p>People would be sent to {redirect}</p> : null}
      {redirect && mode === "live" ? (
        <div className="space-y-2">
          <p>Redirecting in {left} seconds.</p>
          <a
            href={redirect}
            className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Continue now
          </a>
        </div>
      ) : null}
    </div>
  );
}
