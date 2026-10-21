export interface FormStats {
  views: number;
  starts: number;
  submissions: number;
  completionRate: number | null;
}

function rateText(rate: number | null): string {
  if (rate === null) return "No views yet";
  return `${Math.round(rate * 100)}%`;
}

export function StatsTiles({ stats }: { stats: FormStats }) {
  const tiles = [
    { label: "Views", value: String(stats.views) },
    { label: "Started", value: String(stats.starts) },
    { label: "Responses", value: String(stats.submissions) },
    { label: "Completion rate", value: rateText(stats.completionRate) },
  ];
  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-4">
        {tiles.map((tile) => (
          <section key={tile.label} aria-label={tile.label} className="rounded-lg border p-4">
            <h2 className="text-sm text-muted-foreground">{tile.label}</h2>
            <p className="text-2xl font-semibold">{tile.value}</p>
          </section>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Views and starts count browser sessions.</p>
    </div>
  );
}
