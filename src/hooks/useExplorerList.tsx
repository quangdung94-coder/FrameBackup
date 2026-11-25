import { useCallback, useEffect, useRef, useState } from 'react';
import { ContextMenu, type ContextMenuItem, type ContextMenuState } from '../components/layout/ContextMenu';
import type { FileEntry } from '../types/framebackup';
import { useLatestRef } from './useLatestRef';
import type { RowSelection } from './useRowSelection';

/** Khoảng kéo tối thiểu (px) để bắt đầu quét chọn — nhỏ hơn thì coi là click. */
const MARQUEE_THRESHOLD = 4;
/** Vùng sát mép trên/dưới (px) bắt đầu tự cuộn khi đang quét. */
const AUTOSCROLL_EDGE = 28;

interface ExplorerListOptions {
  items: FileEntry[];
  selection: RowSelection;
  /** Double-click / Enter: thư mục => mở vào, file => mở bằng app mặc định. */
  onOpen: (file: FileEntry) => void;
  /** Backspace / Alt+↑: lên thư mục cha. */
  onGoUp?: () => void;
  /** Menu chuột phải. `file` = null khi bấm vào vùng trống. */
  buildMenu: (targets: string[], file: FileEntry | null) => ContextMenuItem[];
  /** Danh sách ảo hoá: chiều cao cố định mỗi dòng & phần tiêu đề dính phía trên (px). */
  rowHeight: number;
  headerHeight: number;
  /** v1.4 kiểu Biểu tượng / Ô: lưới nhiều cột (mặc định 1 = danh sách). */
  cols?: number;
  cellWidth?: number;
  /** Lề trong của vùng lưới (px), tính từ dưới tiêu đề. */
  gridPad?: number;
  /**
   * v1.4 (nhóm theo ngày / loại): vị trí từng mục không đều => tự tính.
   * top(i): toạ độ trên của mục i, tính từ dưới tiêu đề; hit(box): các mục nằm trong khung quét (toạ độ nội dung, gồm tiêu đề).
   */
  model?: { top: (i: number) => number; height: number; hit: (box: MarqueeRect) => number[] };
  /** Phím tắt kiểu Explorer: Ctrl+C / Ctrl+V / Ctrl+Shift+N / F2 / Alt+Enter / F5 / Alt+← / Alt+→. */
  onCommand?: (cmd: ListCommand, targets: string[], focused: FileEntry | null) => void;
}

export type ListCommand = 'copy' | 'paste' | 'newFolder' | 'rename' | 'properties' | 'refresh' | 'back' | 'forward';

interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Thao tác chuột / bàn phím kiểu Windows Explorer cho 1 danh sách file:
 * giữ chuột trái quét chọn nhiều file (tự cuộn khi sát mép), click vùng trống để bỏ chọn,
 * chuột phải mở menu, phím tắt Ctrl+A / Esc / ↑ ↓ / Shift / Home / End / Enter / Backspace.
 * Kéo file đi (drag & drop) bắt đầu từ ô tên file (`data-drag-handle`), các ô khác dùng để quét chọn.
 */
export function useExplorerList({
  items,
  selection,
  onOpen,
  onGoUp,
  buildMenu,
  rowHeight,
  headerHeight,
  onCommand,
  cols: colsOpt = 1,
  cellWidth = 0,
  gridPad = 0,
  model,
}: ExplorerListOptions) {
  const cols = Math.max(1, colsOpt);
  const containerRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const suppressClickRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const latest = useLatestRef({ items, selection, onOpen, onGoUp, buildMenu, onCommand });

  useEffect(() => () => cleanupRef.current?.(), []);

  const closeMenu = useCallback(() => setMenu(null), []);

  // Danh sách ảo hoá: dòng ngoài màn hình không có trong DOM => tính vị trí bằng số học
  const scrollRowIntoView = (index: number) => {
    const c = containerRef.current;
    if (!c) return;
    const top = model ? headerHeight + model.top(index) : headerHeight + gridPad + Math.floor(index / cols) * rowHeight;
    const bottom = top + (model ? model.height : rowHeight);
    if (top - headerHeight < c.scrollTop) c.scrollTop = Math.max(0, top - headerHeight - gridPad);
    else if (bottom > c.scrollTop + c.clientHeight) c.scrollTop = bottom - c.clientHeight;
  };

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Quét được từ mọi chỗ trên dòng (kể cả tên, ô tích); chỉ trừ tên file ĐANG CHỌN (để kéo file đi) và các nút/ô nhập.
    if (target.closest('[data-drag-handle], button, select, a, textarea, thead, [data-pane-header]')) return;
    if (target.closest('input') && !target.closest('[data-row-check]')) return;
    const container = containerRef.current;
    if (!container) return;

    container.focus({ preventScroll: true });
    e.preventDefault(); // không bôi đen chữ khi quét

    const additive = e.ctrlKey || e.metaKey;
    const base = additive ? new Set(latest.current.selection.selected) : new Set<string>();
    const startRect = container.getBoundingClientRect();
    const startX = e.clientX - startRect.left + container.scrollLeft;
    const startY = e.clientY - startRect.top + container.scrollTop;
    const startedOnRow = Boolean(target.closest('[data-row-index]'));
    let lastClientX = e.clientX;
    let lastClientY = e.clientY;
    let moved = false;
    let rafId = 0;
    let lastRange = '';

    const update = () => {
      const rect = container.getBoundingClientRect();
      const curX = Math.max(0, Math.min(lastClientX - rect.left, rect.width)) + container.scrollLeft;
      const curY = Math.max(0, Math.min(lastClientY - rect.top, container.clientHeight)) + container.scrollTop;
      if (!moved && Math.hypot(curX - startX, curY - startY) < MARQUEE_THRESHOLD) return;
      moved = true;
      const box = {
        left: Math.min(startX, curX),
        top: Math.min(startY, curY),
        width: Math.abs(curX - startX),
        height: Math.abs(curY - startY),
      };
      setMarquee(box);
      const count = latest.current.items.length;
      if (model) {
        const hits = model.hit(box);
        const key = hits.join(',');
        if (key === lastRange) return;
        lastRange = key;
        latest.current.selection.applyMarquee(hits, base);
        return;
      }
      const rowsTotal = Math.ceil(count / cols);
      const first = Math.max(0, Math.floor((box.top - headerHeight - gridPad) / rowHeight));
      const last = Math.min(rowsTotal - 1, Math.floor((box.top + box.height - headerHeight - gridPad - 0.01) / rowHeight));
      let c0 = 0;
      let c1 = 0;
      if (cols > 1 && cellWidth > 0) {
        c0 = Math.max(0, Math.floor((box.left - gridPad) / cellWidth));
        c1 = Math.min(cols - 1, Math.floor((box.left + box.width - gridPad - 0.01) / cellWidth));
      }
      const key = `${first}:${last}:${c0}:${c1}`;
      if (key === lastRange) return; // không đổi vùng chọn => không vẽ lại danh sách
      lastRange = key;
      const hits: number[] = [];
      for (let r = first; r <= last; r++) {
        for (let c = c0; c <= c1; c++) {
          const i = r * cols + c;
          if (i < count) hits.push(i);
        }
      }
      latest.current.selection.applyMarquee(hits, base);
    };

    // Tự cuộn khi kéo sát mép trên / dưới (kể cả khi chuột đứng yên)
    const tick = () => {
      const rect = container.getBoundingClientRect();
      let dy = 0;
      if (lastClientY < rect.top + AUTOSCROLL_EDGE) dy = -Math.ceil((rect.top + AUTOSCROLL_EDGE - lastClientY) / 2);
      else if (lastClientY > rect.bottom - AUTOSCROLL_EDGE) dy = Math.ceil((lastClientY - (rect.bottom - AUTOSCROLL_EDGE)) / 2);
      if (moved && dy !== 0) {
        container.scrollTop += Math.max(-40, Math.min(40, dy));
        update();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    const onMove = (ev: MouseEvent) => {
      lastClientX = ev.clientX;
      lastClientY = ev.clientY;
      update();
    };
    const finish = () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      cleanupRef.current = null;
      setMarquee(null);
    };
    const onUp = () => {
      finish();
      if (moved) {
        // Không để click cuối (nếu nhả chuột trên 1 dòng) ghi đè kết quả quét
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      } else if (!startedOnRow && !additive) {
        latest.current.selection.clear(); // click vào vùng trống => bỏ chọn
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    cleanupRef.current = finish;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const { items: list, selection: sel, onOpen: open, onGoUp: goUp, onCommand: cmd } = latest.current;
    const mod = e.ctrlKey || e.metaKey;
    const current = sel.focusIndex ?? -1;
    const key = e.key.toLowerCase();
    const run = (c: ListCommand) => {
      const focused = current >= 0 ? list[current] ?? null : null;
      cmd?.(c, Array.from(sel.selected), focused);
    };
    let handled = true;
    if (mod && e.shiftKey && key === 'n') run('newFolder');
    else if (mod && key === 'a') sel.selectAll();
    else if (mod && key === 'c' && sel.selected.size > 0) run('copy');
    else if (mod && key === 'v') run('paste');
    else if (e.key === 'F2') run('rename');
    else if (e.key === 'F5') run('refresh');
    else if (e.key === 'Enter' && e.altKey) run('properties');
    else if (e.key === 'ArrowLeft' && e.altKey) run('back');
    else if (e.key === 'ArrowRight' && e.altKey) run('forward');
    else if (e.key === 'Escape') sel.clear();
    else if (cols > 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const next = current < 0 ? 0 : Math.max(0, Math.min(list.length - 1, current + (e.key === 'ArrowRight' ? 1 : -1)));
      const idx = sel.moveFocus(next, e.shiftKey);
      if (idx !== null) scrollRowIntoView(idx);
    } else if (e.key === 'ArrowDown') {
      const idx = sel.moveFocus(current < 0 ? 0 : Math.min(list.length - 1, current + cols), e.shiftKey);
      if (idx !== null) scrollRowIntoView(idx);
    } else if (e.key === 'ArrowUp' && e.altKey) goUp?.();
    else if (e.key === 'ArrowUp') {
      const idx = sel.moveFocus(current < 0 ? 0 : Math.max(0, current - cols), e.shiftKey);
      if (idx !== null) scrollRowIntoView(idx);
    } else if (e.key === 'Home') {
      const idx = sel.moveFocus(0, e.shiftKey);
      if (idx !== null) scrollRowIntoView(idx);
    } else if (e.key === 'End') {
      const idx = sel.moveFocus(list.length - 1, e.shiftKey);
      if (idx !== null) scrollRowIntoView(idx);
    } else if (e.key === 'Enter' && current >= 0 && list[current]) open(list[current]);
    else if (e.key === 'Backspace') {
      // Giống Explorer: Backspace = Lùi (chưa có lịch sử thì lên thư mục cha)
      if (cmd) run('back');
      else goUp?.();
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const openMenuAt = (x: number, y: number, targets: string[], file: FileEntry | null) => {
    const menuItems = latest.current.buildMenu(targets, file);
    if (menuItems.length > 0) setMenu({ x, y, items: menuItems });
  };

  const containerProps = {
    ref: containerRef,
    tabIndex: 0,
    onMouseDown,
    onKeyDown,
    onContextMenu: (e: React.MouseEvent) => {
      // Chuột phải vào vùng trống
      e.preventDefault();
      openMenuAt(e.clientX, e.clientY, Array.from(latest.current.selection.selected), null);
    },
  };

  const rowProps = (index: number, file: FileEntry) => ({
    'data-row-index': index,
    onClick: (e: React.MouseEvent) => {
      if (suppressClickRef.current) return;
      latest.current.selection.handleRowClick(index, file, e);
    },
    onDoubleClick: () => latest.current.onOpen(file),
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      containerRef.current?.focus({ preventScroll: true });
      const targets = latest.current.selection.ensureSelectedForContext(index, file);
      openMenuAt(e.clientX, e.clientY, targets, file);
    },
  });

  const overlays = (
    <>
      {marquee && (
        <div
          className="absolute z-30 pointer-events-none border border-blue-400 bg-blue-500/20 rounded-[1px]"
          style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }}
        />
      )}
      <ContextMenu menu={menu} onClose={closeMenu} />
    </>
  );

  /** true ngay sau khi vừa quét chuột xong (để ô tích không tự bật/tắt khi nhả chuột trên nó). */
  const isClickSuppressed = () => suppressClickRef.current;

  return { containerRef, containerProps, rowProps, overlays, isMarqueeActive: marquee !== null, isClickSuppressed };
}
