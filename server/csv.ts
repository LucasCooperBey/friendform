const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(value: string): string {
  const guarded = !PLAIN_NUMBER.test(value) && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[,"\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(rows: string[][]): string {
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
