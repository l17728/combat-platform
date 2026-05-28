import { useCallback, useRef } from 'react';
import { Resizable } from 'react-resizable';
import 'react-resizable/css/styles.css';

interface ResizableTitleProps {
  onResize?: (width: number) => void;
  width: number;
  [key: string]: unknown;
}

const RESIZABLE_PROPS = {
  axis: 'x' as const,
  handleSize: [10, 0] as [number, number],
  minConstraints: [50, 0] as [number, number],
  maxConstraints: [600, 0] as [number, number],
  lockAspectRatio: false,
  resizeHandles: ['se' as const],
  transformScale: 1,
};

export default function ResizableTitle({ onResize, width, ...rest }: ResizableTitleProps) {
  const resizing = useRef(false);

  const handleResize = useCallback((_e: React.SyntheticEvent, data: { size: { width: number } }) => {
    if (onResize && !resizing.current) {
      resizing.current = true;
      onResize(data.size.width);
      requestAnimationFrame(() => { resizing.current = false; });
    }
  }, [onResize]);

  if (!width || !onResize) {
    return <th {...rest} />;
  }

  return (
    <Resizable
      {...RESIZABLE_PROPS}
      width={width}
      height={0}
      handle={
        <span
          className="react-resizable-handle"
          style={{
            position: 'absolute',
            right: -2,
            bottom: 0,
            width: 10,
            height: '100%',
            cursor: 'col-resize',
            zIndex: 1,
          }}
          onClick={(e) => e.stopPropagation()}
        />
      }
      onResize={handleResize}
      draggableOpts={{ enableUserSelectHack: false }}
    >
      <th {...rest} />
    </Resizable>
  );
}

