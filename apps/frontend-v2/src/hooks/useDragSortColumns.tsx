import { useState, useMemo, useCallback } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ColumnType } from 'antd/es/table';
import type { ReactNode } from 'react';

const STORAGE_PREFIX = 'combat-col-order-';

export function useDragSortColumns<T>(
  storageKey: string,
  columns: ColumnType<T>[],
) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const savedOrder = useMemo(() => {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + storageKey);
      return raw ? JSON.parse(raw) as string[] : null;
    } catch { return null; }
  }, [storageKey]);

  const [colOrder, setColOrder] = useState<string[] | null>(savedOrder);

  const ordered = useMemo(() => {
    if (!colOrder) return columns;
    const colMap = new Map<string, ColumnType<T>>();
    columns.forEach((c) => {
      const k = colKey(c);
      colMap.set(k, c);
    });
    const result: ColumnType<T>[] = [];
    for (const k of colOrder) {
      const c = colMap.get(k);
      if (c) { result.push(c); colMap.delete(k); }
    }
    colMap.forEach((c) => result.push(c));
    return result;
  }, [columns, colOrder]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const keys = ordered.map(colKey);
    const oldIdx = keys.indexOf(active.id as string);
    const newIdx = keys.indexOf(over.id as string);
    if (oldIdx === -1 || newIdx === -1) return;
    const newArr = arrayMove(keys, oldIdx, newIdx);
    setColOrder(newArr);
    localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(newArr));
  }, [ordered, storageKey]);

  const SortableWrapper = useMemo(() => {
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ordered.map(colKey)} strategy={horizontalListSortingStrategy}>
            {children}
          </SortableContext>
        </DndContext>
      );
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sensors, handleDragEnd, colOrder]);

  return { columns: ordered, SortableWrapper };
}

export function colKey<T>(col: ColumnType<T>): string {
  return (col.key as string) ?? (typeof col.dataIndex === 'string' ? col.dataIndex : String(col.title));
}

export function SortableHeaderCell({ id, children, ...rest }: { id: string; children: ReactNode; [key: string]: unknown }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    ...rest.style as Record<string, unknown>,
    transform: CSS.Translate.toString(transform),
    transition,
    cursor: 'grab',
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
  };
  return (
    <th ref={setNodeRef} style={style} {...attributes} {...listeners} {...rest}>
      {children}
    </th>
  );
}
