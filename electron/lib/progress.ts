/** Chặn tần suất phát sự kiện tiến trình (vd. 120–150ms) để không spam IPC. */
export function createThrottle(intervalMs: number) {
  let lastAt = 0;
  return (now: number = Date.now()): boolean => {
    if (now - lastAt > intervalMs) {
      lastAt = now;
      return true;
    }
    return false;
  };
}
