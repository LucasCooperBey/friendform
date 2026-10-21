import { useState, type FormEvent } from "react";
import { Redirect, useSearchParams } from "wouter";
import { ApiError, errorMessage } from "@/lib/api";
import { signIn, useSession } from "@/lib/session";
import { Wordmark } from "@/components/Wordmark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function safeNext(value: string | null): string {
  if (value === null) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("://")) return "/";
  if (value === "/login" || value.startsWith("/login?")) return "/";
  return value;
}

export function LoginPage() {
  const { status } = useSession();
  const [searchParams] = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (status === "authenticated") return <Redirect to={next} />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      await signIn(password);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setMessage("That password didn't match.");
      else if (error instanceof ApiError && error.status === 429) {
        setMessage("Too many attempts. Try again in 15 minutes.");
      } else setMessage(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center">
          <Wordmark className="text-xl" />
          <h1 className="sr-only">Sign in</h1>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="owner-password">Owner password</Label>
              <Input
                id="owner-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {message ? (
              <p role="alert" className="text-sm text-destructive">
                {message}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Signing in..." : "Sign in"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              The password is in your .env file as ADMIN_PASSWORD.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
