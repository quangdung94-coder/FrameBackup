import type { ContextMenuItem } from '../components/layout/ContextMenu';
import type { FileEntry } from '../types/framebackup';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
export const FILE_MANAGER_NAME = isMac ? 'Finder' : 'Explorer';

export interface FileMenuActions {
  /** Mở thư mục (vào trong) hoặc mở file bằng app mặc định. */
  open: (file: FileEntry) => void;
  /** Hiện file/thư mục trong Explorer / Finder. */
  reveal: (fullPath: string) => void;
  /** Thư mục đang xem (cho menu vùng trống). */
  currentDir?: string;
  refresh?: () => void;
  /** Chép sang cột kế tiếp (Ổ 1 / Ổ 2). */
  transfer?: { label: (count: number) => string; run: (paths: string[]) => void; disabled?: boolean };
  copyPaths: (paths: string[]) => void;
  /** Sao chép (Ctrl+C) để Dán sang cột khác (chép có verify). */
  copyItems?: (paths: string[]) => void;
  /** Dán vào thư mục đang mở (Ctrl+V). */
  paste?: { label: string; disabled?: boolean; run: () => void };
  newFolder?: () => void;
  rename?: (file: FileEntry) => void;
  properties?: (fullPath: string) => void;
  selectAll: () => void;
  clear: () => void;
}

/** Menu chuột phải kiểu Explorer / Air Explorer. Không có Xóa để tránh mất dữ liệu gốc. */
export function buildFileMenu(targets: string[], file: FileEntry | null, a: FileMenuActions): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  if (file) {
    items.push({ label: 'Open', hint: 'Enter', onSelect: () => a.open(file) });
    items.push({ label: `Show in ${FILE_MANAGER_NAME}`, onSelect: () => a.reveal(file.fullPath) });
    if (a.copyItems && targets.length > 0) {
      const copy = a.copyItems;
      items.push({
        label: targets.length > 1 ? `Copy ${targets.length} items` : 'Copy',
        hint: 'Ctrl+C',
        separatorBefore: true,
        onSelect: () => copy(targets),
      });
    }
    if (a.transfer && targets.length > 0) {
      const t = a.transfer;
      items.push({ label: t.label(targets.length), separatorBefore: !a.copyItems, disabled: t.disabled, onSelect: () => t.run(targets) });
    }
    if (a.rename) {
      const rename = a.rename;
      items.push({ label: 'Rename', hint: 'F2', disabled: targets.length > 1, onSelect: () => rename(file) });
    }
    items.push({
      label: targets.length > 1 ? `Copy ${targets.length} paths` : 'Copy path',
      separatorBefore: true,
      onSelect: () => a.copyPaths(targets.length > 0 ? targets : [file.fullPath]),
    });
    if (a.properties) {
      const props = a.properties;
      items.push({ label: 'Properties', hint: 'Alt+Enter', separatorBefore: true, onSelect: () => props(file.fullPath) });
    }
  } else {
    if (a.paste) {
      const p = a.paste;
      items.push({ label: p.label, hint: 'Ctrl+V', disabled: p.disabled, onSelect: p.run });
    }
    if (a.newFolder) items.push({ label: 'New folder', hint: 'Ctrl+Shift+N', onSelect: a.newFolder });
    if (a.refresh) items.push({ label: 'Refresh', hint: 'F5', separatorBefore: items.length > 0, onSelect: a.refresh });
    if (a.currentDir) {
      const dir = a.currentDir;
      items.push({ label: `Open in ${FILE_MANAGER_NAME}`, onSelect: () => a.reveal(dir) });
      if (a.properties) {
        const props = a.properties;
        items.push({ label: 'Properties', hint: 'Alt+Enter', separatorBefore: true, onSelect: () => props(dir) });
      }
    }
    if (a.transfer && targets.length > 0) {
      const t = a.transfer;
      items.push({ label: t.label(targets.length), separatorBefore: true, disabled: t.disabled, onSelect: () => t.run(targets) });
    }
  }
  items.push({ label: 'Select all', hint: 'Ctrl+A', separatorBefore: true, onSelect: a.selectAll });
  items.push({ label: 'Select none', hint: 'Esc', disabled: targets.length === 0, onSelect: a.clear });
  return items;
}
