/** Nối đường dẫn theo kiểu phân cách của `base` (\ trên Windows, / trên macOS). */
export function joinPath(base: string, child: string): string {
  const sep = base.includes('\\') ? '\\' : '/';
  return base.endsWith(sep) ? `${base}${child}` : `${base}${sep}${child}`;
}

/** Bỏ dấu \ hoặc / ở cuối. */
export function trimTrailingSeparators(p: string): string {
  return p.replace(/[\\/]+$/, '');
}

/** Tên file cuối cùng của đường dẫn. */
export function baseNameOf(p: string): string | undefined {
  return p.split(/[\\/]/).pop();
}

/** Thẻ nhớ giả lập (nút "Test Lệch ngày"). */
export function isDemoPath(p: string): boolean {
  return p.startsWith('DEMO');
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Gốc ổ đĩa (C:\, J:\, /, /Volumes/Card). */
export function isDriveRoot(p: string): boolean {
  const t = p.trim();
  return /^[A-Za-z]:[\\/]?$/.test(t) || t === '/' || /^\/Volumes\/[^/]+\/?$/.test(t);
}

/**
 * Sao lưu cả thư mục `sourceDir` vào thư mục đang mở `destView` (giống dán thư mục trong Explorer):
 * đích = destView\<tên thư mục nguồn>. Nếu đang mở sẵn đúng thư mục trùng tên thì chép thẳng vào đó (không lồng 2 lần).
 */
export function folderCopyTarget(sourceDir: string, destView: string): string {
  const name = baseNameOf(trimTrailingSeparators(sourceDir)) ?? '';
  const view = trimTrailingSeparators(destView) || destView;
  if (!name || !view) return destView;
  if (sameName(baseNameOf(view) ?? '', name)) return destView;
  return joinPath(destView, name);
}

/** Các đoạn của đường dẫn để vẽ thanh địa chỉ: [{label, path}] (J:\ › 01_Project video › Show). */
export function pathSegments(p: string): { label: string; path: string }[] {
  const t = trimTrailingSeparators(p);
  if (!t) return p === '/' ? [{ label: '/', path: '/' }] : [];
  const out: { label: string; path: string }[] = [];
  const win = /^[A-Za-z]:/.test(t);
  if (win) {
    const parts = t.split(/[\\/]/).filter(Boolean);
    let acc = '';
    parts.forEach((part, i) => {
      acc = i === 0 ? `${part}\\` : joinPath(acc, part);
      out.push({ label: i === 0 ? part : part, path: acc });
    });
    return out;
  }
  const parts = t.split('/').filter(Boolean);
  let acc = '';
  for (const part of parts) {
    acc = `${acc}/${part}`;
    out.push({ label: part, path: acc });
  }
  return out;
}

/** Thư mục cha (cùng kiểu phân cách). */
export function parentDirOf(p: string): string {
  const t = trimTrailingSeparators(p);
  const i = Math.max(t.lastIndexOf('\\'), t.lastIndexOf('/'));
  if (i <= 0) return t;
  const parent = t.slice(0, i);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
}

/** `a` nằm trong (hoặc chính là) `b` — không phân biệt hoa thường. */
export function isSameOrInside(a: string, b: string): boolean {
  const x = trimTrailingSeparators(a).toLowerCase();
  const y = trimTrailingSeparators(b).toLowerCase();
  return x === y || x.startsWith(`${y}\\`) || x.startsWith(`${y}/`);
}
