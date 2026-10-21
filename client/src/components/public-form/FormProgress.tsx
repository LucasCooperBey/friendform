export function FormProgress({ answered, total }: { answered: number; total: number }) {
  const percent = total === 0 ? 0 : Math.min(100, Math.max(0, (answered / total) * 100));
  return (
    <div className="sticky top-0 z-30 bg-background">
      <div
        className="h-1 bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={answered}
        aria-label={`${answered} of ${total} questions answered`}
      >
        <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
