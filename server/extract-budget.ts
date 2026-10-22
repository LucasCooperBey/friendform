export interface ExtractionBudget {
  allows(key: string): boolean;
  charge(key: string, ms: number): void;
  retryAfterSeconds(key: string): number;
  readonly size: number;
}

const MAX_KEYS = 10_000;
const HOUR_MS = 3_600_000;

interface KeyWindow {
  chargedMs: number;
  endsAt: number;
}

function finiteCharge(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return ms;
}

export function createExtractionBudget(
  limitMs: number,
  windowMs = HOUR_MS,
  now: () => number = Date.now,
): ExtractionBudget {
  const entries = new Map<string, KeyWindow>();

  function allows(key: string): boolean {
    const entry = entries.get(key);
    if (entry === undefined || now() >= entry.endsAt) return true;
    return entry.chargedMs < limitMs;
  }

  // A new key at capacity drops every ended window, then the one that ends soonest.
  function dropForNewKey(time: number): void {
    for (const [key, entry] of entries) {
      if (time >= entry.endsAt) entries.delete(key);
    }
    if (entries.size < MAX_KEYS) return;
    let soonestKey: string | undefined;
    let soonestEnd = Number.POSITIVE_INFINITY;
    for (const [key, entry] of entries) {
      if (entry.endsAt < soonestEnd) {
        soonestEnd = entry.endsAt;
        soonestKey = key;
      }
    }
    if (soonestKey !== undefined) entries.delete(soonestKey);
  }

  function charge(key: string, ms: number): void {
    const amount = finiteCharge(ms);
    const time = now();
    const entry = entries.get(key);
    if (entry !== undefined && time < entry.endsAt) {
      entry.chargedMs += amount;
      return;
    }
    if (entry === undefined && entries.size >= MAX_KEYS) dropForNewKey(time);
    if (entry !== undefined) {
      entry.chargedMs = amount;
      entry.endsAt = time + windowMs;
      return;
    }
    entries.set(key, { chargedMs: amount, endsAt: time + windowMs });
  }

  function retryAfterSeconds(key: string): number {
    const entry = entries.get(key);
    if (entry === undefined) return 1;
    const remainingMs = entry.endsAt - now();
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 1;
    return Math.ceil(remainingMs / 1000);
  }

  return {
    allows,
    charge,
    retryAfterSeconds,
    get size() {
      return entries.size;
    },
  };
}
