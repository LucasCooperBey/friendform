export class ExtractError extends Error {
  readonly code: "unsupported" | "empty" | "too_large" | "too_complex" | "busy" | "aborted";

  constructor(code: ExtractError["code"]) {
    super(code);
    this.name = "ExtractError";
    this.code = code;
  }
}
