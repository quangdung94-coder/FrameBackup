import { DEFAULT_SHOW_NAME } from './constants';

/** Removes characters illegal in Windows/macOS folder names. */
export function sanitizeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\.+$/g, '')
    .trim();
}

export function getParentDirectory(dirPath: string): string | null {
  if (!dirPath) return null;
  const isWin = dirPath.includes('\\') || /^[A-Za-z]:/.test(dirPath);
  const sep = isWin ? '\\' : '/';
  const cleaned = dirPath.replace(/[\\/]+$/, '');
  if (!cleaned || (isWin && /^[A-Za-z]:$/.test(cleaned))) return null;
  const idx = Math.max(cleaned.lastIndexOf('\\'), cleaned.lastIndexOf('/'));
  if (idx < 0) return null;
  const parent = cleaned.slice(0, idx);
  if (isWin && /^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
  return parent || sep;
}

/** Tên an toàn ASCII cho file/thư mục tạm (staging, archive). Rỗng => fallback. */
export function toSafeAsciiName(name: string, fallback = DEFAULT_SHOW_NAME): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_') || fallback;
}

/** Tên thư mục Show hợp lệ trên Windows/macOS, rỗng => tên mặc định. */
export function toShowFolderName(name: string): string {
  return sanitizeFolderName(name) || DEFAULT_SHOW_NAME;
}
