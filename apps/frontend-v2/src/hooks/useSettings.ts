import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';

export function useSettings() {
  const [settings, setSettings] = useState<Record<string, { values: string[]; label?: string }>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.listSettings()
      .then(all => { if (!cancelled) { setSettings(all); setReady(true); } })
      .catch(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  const getOptions = useCallback((key: string): { value: string; label: string }[] => {
    const vals = settings[key]?.values ?? [];
    return vals.map(v => ({ value: v, label: v }));
  }, [settings]);

  const getValues = useCallback((key: string): string[] => {
    return settings[key]?.values ?? [];
  }, [settings]);

  const reload = useCallback(async () => {
    const all = await api.listSettings();
    setSettings(all);
  }, []);

  return { settings, ready, getOptions, getValues, reload };
}
