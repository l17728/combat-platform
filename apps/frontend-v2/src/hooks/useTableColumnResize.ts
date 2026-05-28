import { useMemo } from 'react';
import type { ColumnType } from 'antd/es/table';

const STORAGE_PREFIX = 'combat-col-widths-';

export function useTableColumnResize<T>(
  storageKey: string,
  columns: ColumnType<T>[],
  options?: { minWidth?: number; maxWidth?: number },
) {
  const minWidth = options?.minWidth ?? 60;
  const maxWidth = options?.maxWidth ?? 600;

  const savedWidths = useMemo(() => {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + storageKey);
      return raw ? JSON.parse(raw) as Record<string, number> : {};
    } catch { return {}; }
  }, [storageKey]);

  const enriched = useMemo(() => {
    return columns.map((col) => {
      const key = (col.key as string) ?? (typeof col.dataIndex === 'string' ? col.dataIndex : col.title as string);
      const saved = savedWidths[key];
      if (saved && col.width !== undefined) {
        return { ...col, width: saved, onHeaderCell: () => ({ width: saved, onResize: (w: number) => handleResize(key, w) }) };
      }
      if (col.width !== undefined) {
        return { ...col, onHeaderCell: () => ({ width: col.width as number, onResize: (w: number) => handleResize(key, w) }) };
      }
      return col;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, savedWidths]);

  function handleResize(key: string, width: number) {
    const clamped = Math.max(minWidth, Math.min(maxWidth, width));
    const updated = { ...savedWidths, [key]: clamped };
    localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(updated));
  }

  return { columns: enriched };
}
