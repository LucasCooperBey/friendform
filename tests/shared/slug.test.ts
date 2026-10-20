// source: shared/slug.ts slug shape, folding, and the random suffix

import { describe, expect, it } from "vitest";
import { SLUG_RE, newSlug, slugify } from "../../shared/slug";

describe("slugs", () => {
  it("accepts a lowercase slug and rejects a leading or trailing hyphen", () => {
    // source: SLUG_RE is a lowercase slug of 1 to 64 characters
    expect(SLUG_RE.test("a")).toBe(true);
    expect(SLUG_RE.test("a-b")).toBe(true);
    expect(SLUG_RE.test("a".repeat(64))).toBe(true);
    expect(SLUG_RE.test("a".repeat(65))).toBe(false);
    expect(SLUG_RE.test("-a")).toBe(false);
    expect(SLUG_RE.test("a-")).toBe(false);
    expect(SLUG_RE.test("A")).toBe(false);
  });

  it("folds accents, collapses separators, and stops at 40 characters", () => {
    // source: slugify returns lowercase ASCII of at most 40 characters, or empty
    expect(slugify("Café Deluxe!")).toBe("cafe-deluxe");
    expect(slugify("  Hello   World  ")).toBe("hello-world");
    expect(slugify("!!!")).toBe("");
    const long = slugify(`${"word ".repeat(30)}`);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith("-")).toBe(false);
    expect(long.startsWith("-")).toBe(false);
  });

  it("adds four random characters and always matches SLUG_RE", () => {
    // source: newSlug is the slug or form, plus four characters, and matches SLUG_RE
    expect(newSlug("Hello", () => "ab12")).toBe("hello-ab12");
    expect(newSlug("!!!", () => "zz99")).toBe("form-zz99");
    expect(SLUG_RE.test(newSlug("Café"))).toBe(true);
  });
});
