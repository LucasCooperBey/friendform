const UNITS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { unit: "year", seconds: 60 * 60 * 24 * 365 },
  { unit: "month", seconds: 60 * 60 * 24 * 30 },
  { unit: "week", seconds: 60 * 60 * 24 * 7 },
  { unit: "day", seconds: 60 * 60 * 24 },
  { unit: "hour", seconds: 60 * 60 },
  { unit: "minute", seconds: 60 },
];

export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "just now";
  const deltaSeconds = Math.round((then - now.getTime()) / 1000);
  if (Math.abs(deltaSeconds) < 60) return "just now";
  const format = new Intl.RelativeTimeFormat("en", { numeric: "always" });
  for (const { unit, seconds } of UNITS) {
    if (Math.abs(deltaSeconds) >= seconds) {
      return format.format(Math.round(deltaSeconds / seconds), unit);
    }
  }
  return "just now";
}

export function shareUrl(slug: string, publicUrl: string | null): string {
  const origin = publicUrl ?? window.location.origin;
  return `${origin}/f/${slug}`;
}
