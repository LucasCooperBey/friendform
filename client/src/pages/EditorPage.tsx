import { Link } from "wouter";

export function EditorPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Edit form</h1>
      <Link href="/" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
        Back to forms
      </Link>
    </div>
  );
}
