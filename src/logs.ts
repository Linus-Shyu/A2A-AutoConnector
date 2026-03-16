type LogLine = {
  ts: number;
  msg: string;
};

const MAX_LINES = 300;
const buffer: LogLine[] = [];
const listeners = new Set<(line: LogLine) => void>();

export function log(msg: string): void {
  const line: LogLine = { ts: Date.now(), msg };
  buffer.push(line);
  if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES);
  for (const cb of listeners) cb(line);
}

export function getLogs(): LogLine[] {
  return buffer.slice();
}

export function onLog(cb: (line: LogLine) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

