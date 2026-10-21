import { publishProblems, type FormSchema } from "@shared/form-schema";

export function ProblemsList({ schema }: { schema: FormSchema }) {
  const problems = publishProblems(schema);
  if (problems.length === 0) return null;
  const noun = problems.length === 1 ? "thing" : "things";
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
      <p className="font-medium">
        {problems.length} {noun} to fix before publishing
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {problems.map((problem, index) => (
          <li key={`${problem}-${index}`}>{problem}</li>
        ))}
      </ul>
    </div>
  );
}
