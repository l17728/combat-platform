let sessionId = '';
let userName = '';
let enabled = true;
let prevPath = '';
const buffer: OpEntry[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
const FLUSH_INTERVAL = 5000;
const MAX_BUFFER = 50;

type OpEntry = {
  session_id: string;
  user_name: string;
  category: 'api' | 'navigate' | 'error' | 'action';
  detail: Record<string, unknown>;
  timestamp: string;
};

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function initOpLog(user: string) {
  sessionId = sessionId || uuid();
  userName = user;
  fetchEnabled();
  if (!flushTimer && enabled) {
    flushTimer = setInterval(flush, FLUSH_INTERVAL);
  }
}

async function fetchEnabled() {
  try {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('combat-token') : null;
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch('/api/op-logs/settings', { headers });
    if (res.ok) {
      const data = await res.json();
      setEnabled(data.enabled !== false);
    }
  } catch {}
}

export function setEnabled(v: boolean) {
  if (!v && enabled) {
    flush();
  }
  enabled = v;
  if (enabled && !flushTimer) {
    flushTimer = setInterval(flush, FLUSH_INTERVAL);
  } else if (!enabled) {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    buffer.length = 0;
  }
}

export function isEnabled() {
  return enabled;
}

export function getSessionId() {
  return sessionId;
}

export function logApiCall(method: string, path: string, status: number, duration: number, error?: string) {
  if (!enabled) return;
  if (path === '/api/op-logs' && method === 'POST') return;
  if (path === '/api/op-logs/settings') return;
  push({
    session_id: sessionId,
    user_name: userName,
    category: 'api',
    detail: { method, path, status, duration, error: error || undefined },
    timestamp: new Date().toISOString(),
  });
}

export function logNavigate(to: string) {
  if (!enabled) return;
  const from = prevPath;
  prevPath = to;
  push({
    session_id: sessionId,
    user_name: userName,
    category: 'navigate',
    detail: { from, to },
    timestamp: new Date().toISOString(),
  });
}

export function logError(message: string, stack?: string, url?: string) {
  if (!enabled) return;
  push({
    session_id: sessionId,
    user_name: userName,
    category: 'error',
    detail: { message, stack: stack?.slice(0, 500), url },
    timestamp: new Date().toISOString(),
  });
}

export function logAction(action: string, extra?: Record<string, unknown>) {
  if (!enabled) return;
  push({
    session_id: sessionId,
    user_name: userName,
    category: 'action',
    detail: { action, ...extra },
    timestamp: new Date().toISOString(),
  });
}

function push(entry: OpEntry) {
  buffer.push(entry);
  if (buffer.length >= MAX_BUFFER) {
    flush();
  }
}

export async function flush() {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('combat-token') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch('/api/op-logs', {
      method: 'POST',
      headers,
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      buffer.unshift(...batch);
    }
  } catch {
    buffer.unshift(...batch);
  }
}

function syncFlush() {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('combat-token') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const data = JSON.stringify(batch);
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([data], { type: 'application/json' });
      navigator.sendBeacon('/api/op-logs', blob);
    }
  } catch {}
}

export function setupGlobalErrorHandler() {
  if (typeof window === 'undefined') return;
  const origHandler = window.onerror;
  window.onerror = (message, source, lineno, colno, error) => {
    logError(String(message), error?.stack, `${source}:${lineno}:${colno}`);
    if (origHandler) origHandler(message, source, lineno, colno, error);
  };
  const origUnhandled = (window as any).onunhandledrejection;
  (window as any).onunhandledrejection = (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    logError(
      reason?.message || String(reason),
      reason?.stack,
      'unhandledrejection'
    );
    if (origUnhandled) origUnhandled.call(window, e);
  };
  window.addEventListener('beforeunload', () => {
    syncFlush();
  });
}

export function destroyOpLog() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  flush();
}
