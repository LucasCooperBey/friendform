// source: useDraft sends one debounced PATCH of only the changed fields, holds an invalid schema, and retries a failed save.
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, emptySchema, formSchemaZ, type FormSchema } from "@shared/form-schema";
import { queryClient } from "@/lib/session";
import { useDraft, type FormDetail } from "@/components/editor/useDraft";
import { callsTo, mockRoute } from "./fetch-mock";

const ISO = "2026-04-01T12:00:00.000Z";

function detail(patch: Partial<FormDetail> = {}): FormDetail {
  return {
    id: "form-1",
    slug: "hello-form",
    title: "Hello form",
    description: "",
    status: "draft",
    publishedVersion: null,
    submissionCount: 0,
    createdAt: ISO,
    updatedAt: ISO,
    draftSchema: emptySchema(),
    settings: DEFAULT_SETTINGS,
    hasUnpublishedChanges: true,
    ...patch,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useDraft", () => {
  // source: two edits inside 800ms become one PATCH carrying only title and description.
  it("debounces to one PATCH of only the changed fields", async () => {
    mockRoute("GET", "/api/forms/form-1", { body: { form: detail() } });
    mockRoute("PATCH", "/api/forms/form-1", { body: { form: detail({ title: "B", description: "More" }) } });
    const { result } = renderHook(() => useDraft("form-1"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.draft?.title).toBe("Hello form"));

    vi.useFakeTimers();
    act(() => {
      result.current.update({ title: "A", description: "More" });
      result.current.update({ title: "B" });
    });
    const pending = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(pending);
    expect(pending.defaultPrevented).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(799);
    });
    expect(callsTo("PATCH", "/api/forms/form-1")).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(callsTo("PATCH", "/api/forms/form-1")).toHaveLength(1);
    expect(callsTo("PATCH", "/api/forms/form-1")[0]?.body).toEqual({ title: "B", description: "More" });
    vi.useRealTimers();
  });

  // source: a schema that fails formSchemaZ is not sent, and invalid is the schema message.
  it("does not send an invalid schema and exposes invalid", async () => {
    mockRoute("GET", "/api/forms/form-1", { body: { form: detail() } });
    mockRoute("PATCH", "/api/forms/form-1", { body: { form: detail() } });
    const bad: FormSchema = {
      sections: [
        {
          title: "Untitled section",
          questions: [{ questionId: "Bad ID", type: "text", prompt: "Hi", required: false }],
        },
      ],
    };
    const parsed = formSchemaZ.safeParse(bad);
    expect(parsed.success).toBe(false);
    const { result } = renderHook(() => useDraft("form-1"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.draft).toBeDefined());

    vi.useFakeTimers();
    act(() => {
      result.current.update({ schema: bad });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(callsTo("PATCH", "/api/forms/form-1")).toHaveLength(0);
    if (!parsed.success) expect(result.current.invalid).toBe(parsed.error.issues[0]?.message);
    expect(result.current.draft?.schema).toEqual(bad);
    vi.useRealTimers();
  });

  // source: a failed save sets error, keeps the local copy, and retry() sends that copy again.
  it("sets error on a failed save and retry resends", async () => {
    let attempts = 0;
    mockRoute("GET", "/api/forms/form-1", { body: { form: detail() } });
    mockRoute("PATCH", "/api/forms/form-1", () => {
      attempts += 1;
      if (attempts === 1) return { status: 500, body: { error: "server_error" } };
      return { body: { form: detail({ title: "Renamed" }) } };
    });
    const { result } = renderHook(() => useDraft("form-1"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.draft?.title).toBe("Hello form"));

    vi.useFakeTimers();
    act(() => {
      result.current.update({ title: "Renamed" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(result.current.saveState).toBe("error");
    expect(result.current.draft?.title).toBe("Renamed");
    const failed = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(failed);
    expect(failed.defaultPrevented).toBe(true);
    vi.useRealTimers();

    act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.saveState).toBe("saved"));
    expect(callsTo("PATCH", "/api/forms/form-1")).toHaveLength(2);
    expect(callsTo("PATCH", "/api/forms/form-1")[1]?.body).toEqual({ title: "Renamed" });
  });
});
