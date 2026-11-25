import { cancelledError } from './errors';

/** Chờ `ms`, reject CANCELLED ngay khi signal bị hủy. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(cancelledError());
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(cancelledError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
