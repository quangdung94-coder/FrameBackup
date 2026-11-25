import { useRef, useState } from 'react';
import { readDragPaths, type DragType } from '../lib/dragData';

/**
 * Vùng thả nhận 1 kiểu kéo-thả nội bộ, gọi onDropPaths với danh sách đường dẫn.
 * Đếm dragenter/dragleave để lớp phủ không nháy khi chuột đi qua các phần tử con (lỗi nháy cũ).
 */
export function useDropZone(type: DragType, onDropPaths: (paths: string[]) => void) {
  const [isOver, setIsOver] = useState(false);
  const depthRef = useRef(0);

  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(type);

  const handlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault();
      depthRef.current += 1;
      setIsOver(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!isOver) setIsOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!accepts(e)) return;
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) setIsOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      depthRef.current = 0;
      setIsOver(false);
      const paths = readDragPaths(e.dataTransfer, type);
      if (paths) onDropPaths(paths);
    },
  };

  return { isOver, handlers };
}
