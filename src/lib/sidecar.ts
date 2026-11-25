import type { FileEntry } from '../types/framebackup';

/** File phụ máy quay tạo ra (XML, THM, SONYCARD.IND...). Chỉ ẩn khỏi danh sách, vẫn chép theo cài đặt. */
const SIDECAR_EXT = new Set(['xml', 'ind', 'thm', 'bim', 'bin', 'cpi', 'bdm', 'mpl', 'ctg', 'lrv', 'smi', 'aae', 'xmp', 'dat', 'db', 'ini', 'tmp']);

export function isSidecarFile(f: FileEntry): boolean {
  if (f.isDirectory) return false;
  if (f.name.startsWith('.')) return true;
  const ext = (f.extension || f.name.split('.').pop() || '').replace(/^\./, '').toLowerCase();
  return SIDECAR_EXT.has(ext);
}
