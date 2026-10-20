export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function slugify(title: string): string {
  const folded = title.normalize("NFKD").replace(/\p{M}+/gu, "");
  return folded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

function randomSlugSuffix(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) {
    const char = SLUG_ALPHABET[byte % SLUG_ALPHABET.length];
    if (char !== undefined) out += char;
  }
  return out;
}

export function newSlug(title: string, random?: () => string): string {
  const base = slugify(title) || "form";
  const suffix = random ? random() : randomSlugSuffix();
  const slug = `${base}-${suffix}`;
  if (!SLUG_RE.test(slug)) {
    throw new Error("Generated slug does not match SLUG_RE.");
  }
  return slug;
}
