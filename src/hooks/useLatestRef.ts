import { useRef } from 'react';

/**
 * Ref luôn giữ giá trị mới nhất của mỗi lần render.
 * Dùng trong callback đăng ký 1 lần (vd. Watch Mode) để không đọc phải state cũ.
 */
export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
