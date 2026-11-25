import { useEffect, useRef, useState } from 'react';
import { loadSavedJson, loadSavedNumber, saveToStorage, STORAGE_KEYS } from '../lib/storage';

export type ColWeights = [number, number, number, number];
export type ColumnIndex = 1 | 2 | 3 | 4;

export const DEFAULT_COL_WEIGHTS: ColWeights = [25, 25, 25, 25];
export const DEFAULT_BOTTOM_HEIGHT = 195;
const MIN_COL_PCT = 12;
const BOTTOM_MIN = 155;
const BOTTOM_MAX = 480;

const isColWeights = (v: unknown): v is ColWeights =>
  Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && n >= 10);

/** Kéo chuột toàn cửa sổ: đổi con trỏ, gọi onMove, tự gỡ listener khi nhả chuột. */
function trackPointerDrag(cursor: 'col-resize' | 'row-resize', onMove: (ev: MouseEvent) => void) {
  document.body.style.cursor = cursor;
  const onUp = () => {
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

/** Bố cục 4 cột co giãn + khung tiến trình phía dưới (lưu theo máy). */
export function useColumnLayout() {
  const [expandedCol, setExpandedCol] = useState<number | null>(null);
  const [colWeights, setColWeights] = useState<ColWeights>(() =>
    loadSavedJson(STORAGE_KEYS.colWeights, isColWeights, () => [...DEFAULT_COL_WEIGHTS])
  );
  const [bottomHeight, setBottomHeight] = useState<number>(() =>
    loadSavedNumber(STORAGE_KEYS.bottomHeight, DEFAULT_BOTTOM_HEIGHT, BOTTOM_MIN, BOTTOM_MAX)
  );
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    saveToStorage({ [STORAGE_KEYS.colWeights]: colWeights });
  }, [colWeights]);

  useEffect(() => {
    saveToStorage({ [STORAGE_KEYS.bottomHeight]: bottomHeight });
  }, [bottomHeight]);

  const startHorizontalResize = (dividerIndex: 0 | 1 | 2, e: React.MouseEvent) => {
    e.preventDefault();
    const container = workspaceRef.current;
    if (!container) return;
    const totalWidth = container.getBoundingClientRect().width;
    if (totalWidth <= 0) return;

    const startX = e.clientX;
    const startWeights: ColWeights = [...colWeights];
    setExpandedCol(null);

    trackPointerDrag('col-resize', (ev) => {
      const deltaPct = ((ev.clientX - startX) / totalWidth) * 100;
      const pairSum = startWeights[dividerIndex] + startWeights[dividerIndex + 1];
      const nextLeft = Math.min(pairSum - MIN_COL_PCT, Math.max(MIN_COL_PCT, startWeights[dividerIndex] + deltaPct));
      const nextRight = pairSum - nextLeft;
      const next: ColWeights = [...startWeights];
      next[dividerIndex] = Number(nextLeft.toFixed(2));
      next[dividerIndex + 1] = Number(nextRight.toFixed(2));
      setColWeights(next);
    });
  };

  const startVerticalResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = bottomHeight;
    trackPointerDrag('row-resize', (ev) => {
      const deltaY = startY - ev.clientY;
      setBottomHeight(Math.max(BOTTOM_MIN, Math.min(BOTTOM_MAX, Math.round(startHeight + deltaY))));
    });
  };

  /** Chia đều 4 cột. */
  const resetColumns = () => {
    setExpandedCol(null);
    setColWeights([...DEFAULT_COL_WEIGHTS]);
  };

  /** Phóng to 1 cột (46%) / bấm lần nữa để chia đều. */
  const toggleExpandCol = (colIndex: ColumnIndex) => {
    if (expandedCol === colIndex) {
      resetColumns();
    } else {
      setExpandedCol(colIndex);
      const next: ColWeights = [18, 18, 18, 18];
      next[colIndex - 1] = 46;
      setColWeights(next);
    }
  };

  const resetBottomHeight = () => setBottomHeight(DEFAULT_BOTTOM_HEIGHT);

  /** style flex cho cột thứ `colIndex` (1–4). */
  const columnStyle = (colIndex: ColumnIndex): React.CSSProperties => {
    const w = colWeights[colIndex - 1];
    return { flexBasis: `${w}%`, flexGrow: w, flexShrink: 1 };
  };

  return {
    workspaceRef,
    expandedCol,
    bottomHeight,
    startHorizontalResize,
    startVerticalResize,
    resetColumns,
    toggleExpandCol,
    resetBottomHeight,
    columnStyle,
  };
}
