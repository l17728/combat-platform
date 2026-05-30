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
    const all = await api.listSettings();
    setSettings(all);
  }, []);

  return { settings, ready, getOptions, getValues, reload };
}
