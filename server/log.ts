function write(stream: NodeJS.WriteStream, level: string, msg: string, extra?: Record<string, unknown>): void {
  const suffix = extra && Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : "";
  stream.write(`${level} ${msg}${suffix}\n`);
}

export const log = {
  info(msg: string, extra?: Record<string, unknown>): void {
    write(process.stdout, "info", msg, extra);
  },
  warn(msg: string, extra?: Record<string, unknown>): void {
    write(process.stderr, "warn", msg, extra);
  },
  error(msg: string, extra?: Record<string, unknown>): void {
    write(process.stderr, "error", msg, extra);
  },
};
