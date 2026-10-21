import type { ReactNode } from "react";
import { Redirect, useLocation, useSearch } from "wouter";
import { useSession } from "@/lib/session";
import { Skeleton } from "@/components/ui/skeleton";

export function RequireOwner({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [location] = useLocation();
  const search = useSearch();

  if (status === "loading") {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-10">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (status === "anonymous") {
    const next = `${location}${search}`;
    return <Redirect to={`/login?next=${encodeURIComponent(next)}`} />;
  }

  return children;
}
