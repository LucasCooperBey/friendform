import { useCallback } from "react";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import { isRecord } from "@/lib/utils";

function retryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (error instanceof ApiError) return error.status >= 500;
  return error instanceof TypeError;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: retryQuery,
    },
  },
});

interface SessionSnapshot {
  authenticated: boolean;
  publicUrl: string | null;
  aiEnabled: boolean;
}

const ANONYMOUS: SessionSnapshot = { authenticated: false, publicUrl: null, aiEnabled: false };

function parseSession(value: unknown): SessionSnapshot {
  if (!isRecord(value) || value.authenticated !== true) return ANONYMOUS;
  return {
    authenticated: true,
    publicUrl: typeof value.publicUrl === "string" ? value.publicUrl : null,
    aiEnabled: value.aiEnabled === true,
  };
}

export function useSession(): {
  status: "loading" | "authenticated" | "anonymous";
  publicUrl: string | null;
  aiEnabled: boolean;
  refresh: () => Promise<void>;
} {
  const query = useQuery({
    queryKey: ["session"],
    queryFn: async () => parseSession(await api<unknown>("/api/auth/session")),
  });
  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);
  if (query.isPending) {
    return { status: "loading", publicUrl: null, aiEnabled: false, refresh };
  }
  if (query.isError || !query.data || !query.data.authenticated) {
    return { status: "anonymous", publicUrl: null, aiEnabled: false, refresh };
  }
  return {
    status: "authenticated",
    publicUrl: query.data.publicUrl,
    aiEnabled: query.data.aiEnabled,
    refresh,
  };
}

export async function signIn(password: string): Promise<void> {
  await api<void>("/api/auth/login", { method: "POST", body: { password } });
  await queryClient.refetchQueries({ queryKey: ["session"] });
}

export async function signOut(): Promise<void> {
  await api<void>("/api/auth/logout", { method: "POST" });
  queryClient.setQueryData(["session"], ANONYMOUS);
  queryClient.removeQueries({ queryKey: ["forms"] });
}
