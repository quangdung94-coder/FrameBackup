import { useEffect, useState } from 'react';
import { ContextMenu, type ContextMenuItem, type ContextMenuState } from '../components/layout/ContextMenu';
import { FILE_MANAGER_NAME } from './fileMenu';

/** 1 menu chuột phải dùng chung cho mọi chỗ ngoài danh sách file (ổ đĩa, cây thư mục, thanh địa chỉ, cột Drive). */
let listener: ((m: ContextMenuState | null) => void) | null = null;

export function openContextMenu(e: React.MouseEvent, items: ContextMenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  if (items.length === 0) return;
  listener?.({ x: e.clientX, y: e.clientY, items });
}

/** Mở menu tại toạ độ màn hình (vd. nút "View ▾", hoặc mục "View" trong menu khác). */
export function openContextMenuAt(x: number, y: number, items: ContextMenuItem[]) {
  if (items.length === 0) return;
  // Đợi menu trước (nếu có) đóng xong
  setTimeout(() => listener?.({ x, y, items }), 0);
}

export function GlobalContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  useEffect(() => {
    listener = setMenu;
    return () => {
      listener = null;
    };
  }, []);
  return <ContextMenu menu={menu} onClose={() => setMenu(null)} />;
}

/** Việc làm được với 1 ổ / thư mục (chuột phải trên ổ đĩa, cây thư mục, thanh địa chỉ). */
export interface PathMenuActions {
  open: (path: string) => void;
  reveal: (path: string) => void;
  newFolderIn?: (parent: string) => void;
  rename?: (path: string) => void;
  properties: (path: string) => void;
  eject?: (mountPath: string) => void;
  refresh?: () => void;
}

export function buildPathMenu(
  path: string,
  kind: 'drive' | 'folder' | 'special',
  a: PathMenuActions,
  opts: { removable?: boolean; current?: boolean } = {}
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  if (!path) return items;
  items.push({ label: opts.current ? 'Open (current)' : 'Open', hint: 'Enter', disabled: opts.current, onSelect: () => a.open(path) });
  items.push({ label: `Open in ${FILE_MANAGER_NAME}`, onSelect: () => a.reveal(path) });
  if (opts.current && a.refresh) items.push({ label: 'Refresh', hint: 'F5', onSelect: a.refresh });
  if (a.newFolderIn) {
    const nf = a.newFolderIn;
    items.push({ label: 'New folder', hint: 'Ctrl+Shift+N', separatorBefore: true, onSelect: () => nf(path) });
  }
  if (kind === 'folder' && a.rename) {
    const rn = a.rename;
    items.push({ label: 'Rename', hint: 'F2', separatorBefore: !a.newFolderIn, onSelect: () => rn(path) });
  }
  items.push({
    label: 'Copy path',
    separatorBefore: true,
    onSelect: () => void navigator.clipboard?.writeText(path).catch(() => undefined),
  });
  if (kind === 'drive' && opts.removable && a.eject) {
    const ej = a.eject;
    items.push({ label: 'Eject', separatorBefore: true, onSelect: () => ej(path) });
  }
  items.push({ label: 'Properties', hint: 'Alt+Enter', separatorBefore: true, onSelect: () => a.properties(path) });
  return items;
}
