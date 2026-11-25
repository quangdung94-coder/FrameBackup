import { useState } from 'react';

/** Hiện / ẩn cây thư mục của 1 cột (nhớ theo máy). null = chưa chọn: tự hiện khi phóng to cột. */
export function useTreePref(storageKey: string): [boolean | null, (v: boolean) => void] {
  const key = `${storageKey}_tree`;
  const [v, setV] = useState<boolean | null>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === '1' ? true : raw === '0' ? false : null;
    } catch {
      return null;
    }
  });
  const set = (next: boolean) => {
    setV(next);
    try {
      localStorage.setItem(key, next ? '1' : '0');
    } catch {
      // ignore
    }
  };
  return [v, set];
}
