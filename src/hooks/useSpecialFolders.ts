import { useEffect, useState } from 'react';
import type { SpecialFolder } from '../types/framebackup';

let cache: SpecialFolder[] | null = null;
let pending: Promise<SpecialFolder[]> | null = null;

/** Desktop / Tài liệu / Tải về... của máy (đọc 1 lần, dùng chung mọi cột). */
export function useSpecialFolders(): SpecialFolder[] {
  const [list, setList] = useState<SpecialFolder[]>(cache ?? []);
  useEffect(() => {
    if (cache) return;
    const api = window.frameBackup;
    if (!api?.getSpecialFolders) return;
    pending ??= api.getSpecialFolders().catch(() => []);
    let alive = true;
    void pending.then((r) => {
      cache = r;
      if (alive) setList(r);
    });
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

const SPECIAL_ICON: Record<SpecialFolder['id'], string> = {
  desktop: '🖥',
  documents: '📄',
  downloads: '⬇',
  pictures: '🖼',
  videos: '🎞',
  home: '🏠',
};
export const specialIcon = (id: SpecialFolder['id']) => SPECIAL_ICON[id] ?? '📁';
