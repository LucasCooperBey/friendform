import type { QuestionType, ResponseValue } from "@shared/form-schema";
import { relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";

export interface ResponseColumn {
  questionId: string;
  prompt: string;
  type: QuestionType | null;
}

export interface SubmissionRow {
  id: string;
  createdAt: string;
  version: number | null;
  responses: Record<string, ResponseValue>;
}

export function cellText(value: ResponseValue | undefined): string {
  if (value === undefined) return "";
  const text = Array.isArray(value) ? value.join(", ") : String(value);
  return text.length > 80 ? text.slice(0, 80) : text;
}

function readAnswer(row: SubmissionRow, questionId: string): ResponseValue | undefined {
  if (!Object.hasOwn(row.responses, questionId)) return undefined;
  return row.responses[questionId];
}

export function ResponsesTable({
  columns,
  rows,
  nextBefore,
  loadingMore,
  onOpen,
  onLoadMore,
}: {
  columns: ResponseColumn[];
  rows: SubmissionRow[];
  nextBefore: string | null;
  loadingMore: boolean;
  onOpen: (row: SubmissionRow) => void;
  onLoadMore: () => void;
}) {
  const shown = columns.slice(0, 3);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="px-3 py-2 font-medium">Submitted</th>
              <th className="px-3 py-2 font-medium">Version</th>
              {shown.map((column) => (
                <th key={column.questionId} className="px-3 py-2 font-medium">
                  {column.prompt}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                tabIndex={0}
                onClick={() => onOpen(row)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(row);
                  }
                }}
                className="cursor-pointer border-b hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <td className="px-3 py-2">
                  <time dateTime={row.createdAt} title={new Date(row.createdAt).toLocaleString()}>
                    {relativeTime(row.createdAt)}
                  </time>
                </td>
                <td className="px-3 py-2">{row.version === null ? "" : String(row.version)}</td>
                {shown.map((column) => (
                  <td key={column.questionId} className="px-3 py-2">
                    {cellText(readAnswer(row, column.questionId))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {nextBefore ? (
        <Button variant="outline" disabled={loadingMore} onClick={onLoadMore}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}
