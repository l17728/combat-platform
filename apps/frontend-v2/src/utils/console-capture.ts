interface ConsoleEntry {
  level: string;
  args: string[];
  timestamp: string;
  url: string;
}

const MAX_ENTRIES = 200;
let entries: ConsoleEntry[] = [];
let capturing = false;

const origConsole: Record<string, (...args: any[]) => void> = {};

function serialize(args: any[]): string[] {
  return args.map((a) => {
    if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`;
    if (typeof a === 'object' && a !== null) {
      try { return JSON.stringify(a, null, 2); } catch { return String(a); }
    }
    return String(a);
  });
}

export function startConsoleCapture() {
  if (capturing) return;
  capturing = true;
  entries = [];

  const levels = ['log', 'warn', 'error', 'info', 'debug'] as const;
  for (const level of levels) {
    origConsole[level] = console[level];
    (console as any)[level] = (...args: any[]) => {
      origConsole[level](...args);
      const entry: ConsoleEntry = {
        level,
        args: serialize(args),
        timestamp: new Date().toISOString(),
        url: window.location.href,
      };
      entries.push(entry);
      if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
    };
  }
}

export function stopConsoleCapture() {
  if (!capturing) return;
  const levels = ['log', 'warn', 'error', 'info', 'debug'] as const;
  for (const level of levels) {
    if (origConsole[level]) (console as any)[level] = origConsole[level];
  }
  capturing = false;
}

export function getCapturedLogs(): string {
  if (entries.length === 0) return '';
  return entries
    .map((e) => `[${e.timestamp}] [${e.level.toUpperCase()}] ${e.args.join(' ')}`)
    .join('\n');
}

export function clearCapturedLogs() {
  entries = [];
}

export function isCapturing(): boolean {
  return capturing;
}
