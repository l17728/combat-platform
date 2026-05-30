import { useCallback, useEffect, useRef, useState } from 'react';

// 用 left/top 实现的简易拖拽:挂在拖拽手柄(header)的 onMouseDown 即可。
// initial 为首次定位的左上角坐标(像素);后续位置由 state 维护,不在窗口大小变化时复位。
export function useDraggable(initial: { x: number; y: number }) {
  const [pos, setPos] = useState(initial);
  const startRef = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startRef.current = { startX: e.clientX, startY: e.clientY, offsetX: pos.x, offsetY: pos.y };
  }, [pos]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!startRef.current) return;
      const dx = e.clientX - startRef.current.startX;
      const dy = e.clientY - startRef.current.startY;
      // 限制在视口内,防止拖出屏幕找不回来
      const maxX = window.innerWidth - 60;
      const maxY = window.innerHeight - 40;
      setPos({
        x: Math.min(Math.max(0, startRef.current.offsetX + dx), maxX),
        y: Math.min(Math.max(0, startRef.current.offsetY + dy), maxY),
      });
    };
    const onUp = () => { startRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  return { pos, onMouseDown };
}
