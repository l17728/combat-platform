import { useMemo, useCallback, useRef, useState } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Resizable } from 'react-resizable';
import type { ColumnType } from 'antd/es/table';
import type { ReactNode } from 'react';

const WIDTH_PREFIX = 'combat-col-w-';
const ORDER_PREFIX = 'combat-col-o-';

function colKey<T>(col: ColumnType<T>): string {
  return (col.key as string) ?? (typeof col.dataIndex === 'string' ? col.dataIndex : String(col.title));
}

function loadJSON(key: string): Record<string, unknown> | null {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch { return null; }
}

export function useFlexTable<T>(storageKey: string, rawColumns: ColumnType<T>[]) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const savedWidths = useMemo(() => loadJSON(WIDTH_PREFIX + storageKey) as Record<string, number> | null ?? {}, [storageKey]);
  const savedOrder = useMemo(() => loadJSON(ORDER_PREFIX + storageKey) as string[] | null, [storageKey]);

  const [colOrder, setColOrder] = useState<string[] | null>(savedOrder);
  const widthsRef = useRef(savedWidths);

  const applyWidth = useCallback((cols: ColumnType<T>[]) => {
    return cols.map((col) => {
      const key = colKey(col);
      if (col.width === undefined) return col;
      const w = widthsRef.current[key] ?? (col.width as number);
      return {
        ...col,
        width: w,
        onHeaderCell: () => ({ width: w, onResize: (nw: number) => { widthsRef.current = { ...widthsRef.current, [key]: Math.max(50, Math.min(600, nw)) }; } }),
      };
    });
  }, []);

  const ordered = useMemo(() => {
    if (!colOrder) return applyWidth(rawColumns);
    const colMap = new Map<string, ColumnType<T>>();
    rawColumns.forEach((c) => colMap.set(colKey(c), c));
    const result: ColumnType<T>[] = [];
    for (const k of colOrder) { const c = colMap.get(k); if (c) { result.push(c); colMap.delete(k); } }
    colMap.forEach((c) => result.push(c));
    return applyWidth(result);
  }, [rawColumns, colOrder, applyWidth]);

  const persistWidths = useCallback(() => {
    localStorage.setItem(WIDTH_PREFIX + storageKey, JSON.stringify(widthsRef.current));
  }, [storageKey]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const keys = ordered.map(colKey);
    const oldIdx = keys.indexOf(active.id as string);
    const newIdx = keys.indexOf(over.id as string);
    if (oldIdx === -1 || newIdx === -1) return;
    const newArr = arrayMove(keys, oldIdx, newIdx);
    setColOrder(newArr);
    localStorage.setItem(ORDER_PREFIX + storageKey, JSON.stringify(newArr));
  }, [ordered, storageKey]);

  const FlexWrapper = useMemo(() => {
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

  return { columns: ordered, FlexWrapper, persistWidths };
}

export function FlexHeaderCell({ id, width, onResize, children, ...rest }: {
  id: string; width?: number; onResize?: (w: number) => void; children: ReactNode; [key: string]: unknown;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const sortableStyle = {
    transform: CSS.Translate.toString(transform),
    transition,
    cursor: isDragging ? 'grabbing' : 'grab',
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
  };

  const resizeHandle = width && onResize ? (
    <span
      style={{ position: 'absolute', right: -2, bottom: 0, width: 10, height: '100%', cursor: 'col-resize', zIndex: 2 }}
      onClick={(e) => e.stopPropagation()}
    />
  ) : undefined;

  if (width && onResize) {
    return (
      <Resizable width={width} height={0} axis="x" handleSize={[10, 0]}
        minConstraints={[50, 0]} maxConstraints={[600, 0]} lockAspectRatio={false}
        resizeHandles={['se']} transformScale={1}
        handle={resizeHandle}
        onResize={(_e, data) => onResize(data.size.width)}
        draggableOpts={{ enableUserSelectHack: false }}>
        <th ref={setNodeRef} style={sortableStyle} {...attributes} {...listeners} {...rest}>
          {children}
        </th>
      </Resizable>
    );
  }

  return (
    <th ref={setNodeRef} style={sortableStyle} {...attributes} {...listeners} {...rest}>
      {children}
    </th>
  );
}
