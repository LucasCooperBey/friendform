import { Link } from "wouter";
import { Wordmark } from "@/components/Wordmark";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="space-y-4 text-center">
        <Wordmark className="text-xl" />
        <h1 className="text-2xl font-semibold">This page does not exist.</h1>
        <Link href="/" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Back home
        </Link>
      </div>
    </div>
  );
}
