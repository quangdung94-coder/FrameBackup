import { useRef, useState } from 'react';
import type { FileEntry } from '../types/framebackup';

/**
 * Chọn nhiều dòng giống Windows Explorer / Finder:
 * - Click            : chỉ chọn dòng đó (click lại dòng đang chọn KHÔNG bỏ chọn)
 * - Ctrl/Cmd + click : bật/tắt 1 dòng
 * - Shift + click    : chọn dải từ mốc (thay vùng chọn cũ); Ctrl+Shift: cộng thêm dải
 * - Phím: ↑/↓ (+Shift), Home/End, Ctrl+A, Esc
 * `items` là danh sách đang hiển thị (thứ tự dùng cho Shift). `isSelectable` loại trừ dòng không được chọn.
 */
export function useRowSelection(items: FileEntry[], isSelectable: (f: FileEntry) => boolean = () => true) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Dòng đang "focus" (viền mờ), dùng cho phím mũi tên. */
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const anchorIdxRef = useRef<number | null>(null);

  const rangePaths = (from: number, to: number): string[] => {
    const out: string[] = [];
    const start = Math.max(0, Math.min(from, to));
    const end = Math.min(items.length - 1, Math.max(from, to));
    for (let i = start; i <= end; i++) {
      const item = items[i];
      if (item && isSelectable(item)) out.push(item.fullPath);
    }
    return out;
  };

  const handleRowClick = (index: number, file: FileEntry, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    setFocusIndex(index);
    const additive = e.ctrlKey || e.metaKey;
    if (e.shiftKey && anchorIdxRef.current !== null) {
      const range = rangePaths(anchorIdxRef.current, index);
      setSelected((prev) => new Set(additive ? [...prev, ...range] : range));
      return;
    }
    anchorIdxRef.current = index;
    if (!isSelectable(file)) {
      if (!additive) setSelected(new Set());
      return;
    }
    if (additive) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(file.fullPath)) next.delete(file.fullPath);
        else next.add(file.fullPath);
        return next;
      });
    } else {
      setSelected(new Set([file.fullPath]));
    }
  };

  /** Ô checkbox: bật/tắt 1 dòng, không ảnh hưởng dòng khác. Shift + tích = tích thêm cả dải từ mốc tới dòng này. */
  const toggleOne = (index: number, file: FileEntry, e?: { shiftKey?: boolean }) => {
    if (e?.shiftKey && anchorIdxRef.current !== null) {
      const range = rangePaths(anchorIdxRef.current, index);
      setSelected((prev) => new Set([...prev, ...range]));
      setFocusIndex(index);
      return;
    }
    if (!isSelectable(file)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(file.fullPath)) next.delete(file.fullPath);
      else next.add(file.fullPath);
      return next;
    });
    anchorIdxRef.current = index;
    setFocusIndex(index);
  };

  const selectableItems = () => items.filter(isSelectable);

  const allSelected = () => {
    const selectable = selectableItems();
    return selectable.length > 0 && selectable.every((f) => selected.has(f.fullPath));
  };

  const selectAll = () => setSelected(new Set(selectableItems().map((f) => f.fullPath)));
  const clear = () => setSelected(new Set());

  const toggleSelectAll = () => {
    if (allSelected()) clear();
    else selectAll();
  };

  /** Bỏ chọn hết & xóa mốc Shift (khi đổi thư mục). */
  const reset = () => {
    setSelected(new Set());
    setFocusIndex(null);
    anchorIdxRef.current = null;
  };

  /** Quét chuột (marquee): `base` là vùng chọn lúc bắt đầu kéo (có Ctrl thì cộng dồn). */
  const applyMarquee = (indices: number[], base: Set<string>) => {
    const next = new Set(base);
    for (const i of indices) {
      const item = items[i];
      if (item && isSelectable(item)) next.add(item.fullPath);
    }
    setSelected(next);
    if (indices.length > 0) {
      anchorIdxRef.current = indices[0];
      setFocusIndex(indices[indices.length - 1]);
    }
  };

  /** Phím mũi tên / Home / End. Trả về index mới để cuộn tới. */
  const moveFocus = (target: number, extend: boolean): number | null => {
    if (items.length === 0) return null;
    const idx = Math.max(0, Math.min(items.length - 1, target));
    setFocusIndex(idx);
    if (extend) {
      if (anchorIdxRef.current === null) anchorIdxRef.current = focusIndex ?? idx;
      setSelected(new Set(rangePaths(anchorIdxRef.current, idx)));
    } else {
      anchorIdxRef.current = idx;
      const item = items[idx];
      setSelected(item && isSelectable(item) ? new Set([item.fullPath]) : new Set());
    }
    return idx;
  };

  /** Chuột phải vào dòng chưa chọn => chỉ chọn dòng đó (giống Explorer). */
  const ensureSelectedForContext = (index: number, file: FileEntry): string[] => {
    setFocusIndex(index);
    if (selected.has(file.fullPath)) return Array.from(selected);
    anchorIdxRef.current = index;
    if (!isSelectable(file)) {
      setSelected(new Set());
      return [file.fullPath];
    }
    setSelected(new Set([file.fullPath]));
    return [file.fullPath];
  };

  /** Danh sách kéo đi: dòng đang chọn => cả vùng chọn, chưa chọn => chỉ dòng đó (và chọn nó). */
  const beginDrag = (file: FileEntry): string[] => {
    const isSel = selected.has(file.fullPath);
    if (!isSel) setSelected(new Set([file.fullPath]));
    return isSel ? Array.from(selected) : [file.fullPath];
  };

  return {
    selected,
    setSelected,
    focusIndex,
    handleRowClick,
    toggleOne,
    allSelected,
    selectAll,
    clear,
    toggleSelectAll,
    reset,
    applyMarquee,
    moveFocus,
    ensureSelectedForContext,
    beginDrag,
  };
}

export type RowSelection = ReturnType<typeof useRowSelection>;

export const isFileNotFolder = (f: FileEntry) => !f.isDirectory;
