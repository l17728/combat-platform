import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';

type SettingsMap = Record<string, { values: string[]; label?: string }>;

// Module-level singleton cache shared across all useSettings() hook instances.
// Solves: 13 callsites each fetching /api/settings on mount → up to 13 duplicate
// requests per page load. Now boot-load 1 request, TTL 5min, in-flight de-dup.
const TTL_MS = 5 * 60 * 1000;
let cache: SettingsMap | null = null;
let cacheAt = 0;
let inflight: Promise<SettingsMap> | null = null;
const subscribers = new Set<(s: SettingsMap) => void>();

function fresh(): boolean {
  return cache !== null && Date.now() - cacheAt < TTL_MS;
}

function notify(next: SettingsMap): void {
  for (const cb of subscribers) cb(next);
}

function fetchSettings(): Promise<SettingsMap> {
  // Reuse in-flight promise → concurrent useSettings() mounts share 1 request.
  if (inflight) return inflight;
  inflight = api.listSettings()
    .then(all => {
      cache = all;
      cacheAt = Date.now();
      inflight = null;
      notify(all);
      return all;
    })
    .catch(err => {
      inflight = null;
      throw err;
    });
  return inflight;
}

/** Force-invalidate the cache and refetch (e.g. after settings mutation). */
export function refreshSettings(): Promise<SettingsMap> {
  cache = null;
  cacheAt = 0;
  return fetchSettings();
}

export function useSettings() {
  const [settings, setSettings] = useState<SettingsMap>(() => cache ?? {});
  const [ready, setReady] = useState<boolean>(() => fresh());

  useEffect(() => {
    let cancelled = false;
    const subscriber = (next: SettingsMap) => {
      if (!cancelled) setSettings(next);
    };
    subscribers.add(subscriber);

    if (fresh()) {
      // Cache hit — sync render with current value, no network.
      setSettings(cache!);
      setReady(true);
    } else {
      fetchSettings()
        .then(all => { if (!cancelled) { setSettings(all); setReady(true); } })
        .catch(() => { if (!cancelled) setReady(true); });
    }

    return () => {
      cancelled = true;
      subscribers.delete(subscriber);
    };
  }, []);

  const getOptions = useCallback((key: string, fallback?: string[]): { value: string; label: string }[] => {
    const vals = settings[key]?.values ?? fallback ?? [];
    return vals.map(v => ({ value: v, label: v }));
  }, [settings]);

  // 第二个参数 fallback:配置中心被清空 / 未 seed / 网络失败时,UI 仍能渲染出可用选项。
  // 这是 UI 配置化的硬底线 — 任何业务枚举控件都不能因为后端没有 setting 就变成空下拉。
  const getValues = useCallback((key: string, fallback?: string[]): string[] => {
    const vals = settings[key]?.values;
    if (vals && vals.length > 0) return vals;
    return fallback ?? [];
  }, [settings]);

  const reload = useCallback(async () => {
    const all = await refreshSettings();
    setSettings(all);
  }, []);

  return { settings, ready, getOptions, getValues, reload };
}
