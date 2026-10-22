import { afterEach, describe, expect, it, vi } from "vitest";
import { createExtractionBudget } from "../../server/extract-budget";

describe("createExtractionBudget", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // source: slice 3b review, slow files hold the single reader: an address is allowed until its charged reading time reaches the limit.
  it("allows a key until its charged time reaches the limit", () => {
    let now = 0;
    const budget = createExtractionBudget(100, 60_000, () => now);
    expect(budget.allows("a")).toBe(true);
    budget.charge("a", -20);
    budget.charge("a", Number.NaN);
    budget.charge("a", Number.POSITIVE_INFINITY);
    budget.charge("a", Number.NEGATIVE_INFINITY);
    expect(budget.allows("a")).toBe(true);
    budget.charge("a", 99);
    expect(budget.allows("a")).toBe(true);
    budget.charge("a", 1);
    expect(budget.allows("a")).toBe(false);
    now = 1;
    expect(budget.allows("a")).toBe(false);
  });

  // source: slice 3b review, slow files hold the single reader: charged time expires when the address's hour ends and the next charge starts a new window.
  it("starts a new window after windowMs", () => {
    let now = 1_000;
    const windowMs = 5_000;
    const budget = createExtractionBudget(100, windowMs, () => now);
    budget.charge("a", 0);
    now = 1_000 + windowMs - 1;
    budget.charge("a", 100);
    expect(budget.allows("a")).toBe(false);
    now = 1_000 + windowMs;
    expect(budget.allows("a")).toBe(true);
    budget.charge("a", 40);
    expect(budget.allows("a")).toBe(true);
    budget.charge("a", 60);
    expect(budget.allows("a")).toBe(false);
    now = 1_000 + windowMs + windowMs;
    expect(budget.allows("a")).toBe(true);
  });

  // source: slice 3b review, slow files hold the single reader: one address's charged time does not block another.
  it("keeps two keys independent", () => {
    const budget = createExtractionBudget(50, 10_000, () => 0);
    budget.charge("a", 50);
    budget.charge("b", 49);
    expect(budget.allows("a")).toBe(false);
    expect(budget.allows("b")).toBe(true);
    budget.charge("b", 1);
    expect(budget.allows("a")).toBe(false);
    expect(budget.allows("b")).toBe(false);
  });

  // source: slice 3b review, slow files hold the single reader: Retry-After counts down in whole seconds to the end of the address's window.
  it("counts retryAfterSeconds down to the window end", () => {
    let now = 0;
    const budget = createExtractionBudget(10, 10_000, () => now);
    budget.charge("a", 10);
    expect(budget.retryAfterSeconds("a")).toBe(10);
    now = 2_600;
    expect(budget.retryAfterSeconds("a")).toBe(8);
    now = 9_100;
    expect(budget.retryAfterSeconds("a")).toBe(1);
    now = 10_000;
    expect(budget.retryAfterSeconds("a")).toBe(1);
  });

  // source: slice 3b review, slow files hold the single reader: the default window is one hour measured by Date.now.
  it("defaults the window to one hour and the clock to Date.now", () => {
    let now = 50_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const budget = createExtractionBudget(5);
    budget.charge("a", 5);
    expect(budget.retryAfterSeconds("a")).toBe(3_600);
    now += 1_800;
    expect(budget.retryAfterSeconds("a")).toBe(3_599);
    expect(budget.allows("a")).toBe(false);
  });

  // source: slice 3b review, slow files hold the single reader: remembering addresses cannot grow past 10000 keys.
  it("holds at most 10000 keys after 10001 distinct charges", () => {
    const budget = createExtractionBudget(10_000, 60_000, () => 0);
    for (let i = 0; i < 10_001; i += 1) budget.charge(String(i), 1);
    expect(budget.size).toBeLessThanOrEqual(10_000);
    expect(budget.size).toBe(10_000);
  });

  // source: slice 3b review, slow files hold the single reader: a full map drops ended windows first, then the window that ends soonest.
  it("drops ended windows before the window that ends soonest", () => {
    let now = 0;
    const windowMs = 100_000;
    const budget = createExtractionBudget(1_000, windowMs, () => now);
    for (let i = 0; i < 10_000; i += 1) {
      now = i;
      budget.charge(`k${i}`, 1);
    }
    expect(budget.size).toBe(10_000);
    now = 10_000;
    budget.charge("overflow", 1);
    expect(budget.size).toBeLessThanOrEqual(10_000);
    expect(budget.size).toBe(10_000);
    budget.charge("k1", 999);
    expect(budget.allows("k1")).toBe(false);
    budget.charge("k0", 999);
    expect(budget.allows("k0")).toBe(true);

    const expired = createExtractionBudget(100, 1_000, () => now);
    now = 0;
    for (let i = 0; i < 9_999; i += 1) expired.charge(`old${i}`, 1);
    now = 10;
    expired.charge("live", 50);
    expect(expired.size).toBe(10_000);
    now = 1_000;
    expired.charge("fresh", 1);
    expect(expired.size).toBe(2);
    expired.charge("live", 50);
    expect(expired.allows("live")).toBe(false);
  });
});
