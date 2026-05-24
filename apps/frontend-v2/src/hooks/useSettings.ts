import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';

const cache: Record<string, { values: string[]; label?: string }> = {};
let loaded = false;
let loadPromise: Promise<void> | null = null;

async function loadAll() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const all = await api.listSettings();
      for (const [k, v] of Object.entries(all)) cache[k] = v;
    } catch {}
    loaded = true;
  })();
  return loadPromise;
}

export function useSettings() {
  const [settings, setSettings] = useState<Record<string, { values: string[]; label?: string }>>({ ...cache });
  const [ready, setReady] = useState(loaded);

  useEffect(() => {
    if (loaded) { setSettings({ ...cache }); setReady(true); return; }
    loadAll().then(() => { setSettings({ ...cache }); setReady(true); });
  }, []);

  const getOptions = useCallback((key: string, fallback?: string[]): { value: string; label: string }[] => {
    const vals = settings[key]?.values ?? fallback ?? [];
    return vals.map(v => ({ value: v, label: v }));
  }, [settings]);

  const getValues = useCallback((key: string, fallback?: string[]): string[] => {
    return settings[key]?.values ?? fallback ?? [];
  }, [settings]);

  const reload = useCallback(async () => {
    loaded = false; loadPromise = null;
    await loadAll();
    setSettings({ ...cache });
  }, []);

  return { settings, ready, getOptions, getValues, reload };
}
