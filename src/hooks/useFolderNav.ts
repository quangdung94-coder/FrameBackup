import { useCallback, useRef, useState } from 'react';
import { getParentDirectory } from '../types/framebackup';

const MAX_HISTORY = 50;
const same = (a: string, b: string) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();

/**
 * Lịch sử duyệt thư mục của 1 cột (giống Explorer): Lùi / Tiến / Lên.
 * `onChange` được gọi mỗi khi thư mục đang mở đổi (để đọc lại danh sách, nhớ thư mục).
 */
export function useFolderNav(initial: string, onChange: (dir: string) => void) {
  const [path, setPath] = useState(initial);
  const backRef = useRef<string[]>([]);
  const fwdRef = useRef<string[]>([]);
  const [, force] = useState(0);
  const pathRef = useRef(initial);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const apply = useCallback((dir: string) => {
    pathRef.current = dir;
    setPath(dir);
    force((n) => n + 1);
    onChangeRef.current(dir);
  }, []);

  /** Mở thư mục mới (ghi lịch sử). Mở lại đúng thư mục đang xem = Làm mới. */
  const go = useCallback(
    (dir: string) => {
      const cur = pathRef.current;
      if (cur && !same(cur, dir)) {
        backRef.current = [...backRef.current, cur].slice(-MAX_HISTORY);
        fwdRef.current = [];
      }
      apply(dir);
    },
    [apply]
  );
  const back = useCallback(() => {
    const prev = backRef.current.pop();
    if (prev === undefined) return false;
    fwdRef.current = [...fwdRef.current, pathRef.current];
    apply(prev);
    return true;
  }, [apply]);
  const forward = useCallback(() => {
    const next = fwdRef.current.pop();
    if (next === undefined) return false;
    backRef.current = [...backRef.current, pathRef.current];
    apply(next);
    return true;
  }, [apply]);
  const up = useCallback(() => {
    const parent = getParentDirectory(pathRef.current);
    if (parent) go(parent);
  }, [go]);
  /** Đổi thư mục KHÔNG ghi lịch sử (vd. chọn thẻ khác ở ô chọn ổ). */
  const reset = useCallback(
    (dir: string) => {
      backRef.current = [];
      fwdRef.current = [];
      apply(dir);
    },
    [apply]
  );

  return {
    path,
    go,
    back,
    forward,
    up,
    reset,
    canBack: backRef.current.length > 0,
    canForward: fwdRef.current.length > 0,
    canUp: Boolean(getParentDirectory(path)),
  };
}

export type FolderNav = ReturnType<typeof useFolderNav>;
