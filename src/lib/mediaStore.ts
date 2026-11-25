import { useEffect, useState, useSyncExternalStore } from 'react';
import type { FileEntry, MediaInfo } from '../types/framebackup';

/**
 * v1.4 kiểu xem: kho dùng chung cho thông tin clip (thời lượng, độ phân giải...), hình thu nhỏ và dải tua nhanh.
 * Chỉ hỏi phía Electron cho file đang hiện trên màn hình; gom nhiều yêu cầu thành 1 lần gọi.
 */

export const hasVisualPreview = (f: FileEntry) => !f.isDirectory && (f.mediaType === 'video' || f.mediaType === 'photo' || f.mediaType === 'raw');

// ---------------- Thông tin clip ----------------
const info = new Map<string, MediaInfo>();
const requested = new Set<string>();
const pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let version = 0;
const listeners = new Set<() => void>();
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

async function flush() {
  flushTimer = null;
  const api = window.frameBackup;
  const batch = Array.from(pending).slice(0, 300);
  batch.forEach((p) => pending.delete(p));
  if (pending.size > 0) flushTimer = setTimeout(() => void flush(), 30);
  if (!api?.probeMediaInfo || batch.length === 0) return;
  try {
    const res = await api.probeMediaInfo(batch);
    for (const p of batch) info.set(p, res[p] ?? {});
  } catch {
    for (const p of batch) info.set(p, {});
  }
  notify();
}

/** Xin thông tin cho các file (bỏ qua file đã có / đang chờ). */
export function requestMediaInfo(files: FileEntry[]) {
  let added = false;
  for (const f of files) {
    if (!hasVisualPreview(f) || requested.has(f.fullPath)) continue;
    requested.add(f.fullPath);
    pending.add(f.fullPath);
    added = true;
  }
  if (added && !flushTimer) flushTimer = setTimeout(() => void flush(), 40);
}

export const getMediaInfo = (p: string): MediaInfo | undefined => info.get(p);

/** Số phiên bản: đổi mỗi khi có thông tin mới => vẽ lại / sắp xếp lại. */
export function useMediaVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

export function formatDuration(sec?: number): string {
  if (sec === undefined || !Number.isFinite(sec)) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function formatResolution(i?: MediaInfo): string {
  if (!i?.width || !i?.height) return '';
  const short = Math.min(i.width, i.height);
  const tag = i.width >= 3800 ? '4K' : short >= 1080 ? 'FHD' : short >= 720 ? 'HD' : '';
  return `${i.width}×${i.height}${tag ? ` ${tag}` : ''}`;
}

// ---------------- Hình thu nhỏ (hàng đợi LIFO: file vừa cuộn tới được làm trước) ----------------
const thumbs = new Map<string, string | null>();
const waiters = new Map<string, Set<(v: string | null) => void>>();
const thumbQueue: string[] = [];
let thumbActive = 0;
const THUMB_PARALLEL = 4;

function pumpThumbs() {
  const api = window.frameBackup;
  while (thumbActive < THUMB_PARALLEL && thumbQueue.length > 0) {
    const p = thumbQueue.pop()!;
    if (!waiters.get(p)?.size) continue;
    thumbActive++;
    const done = (v: string | null) => {
      thumbActive--;
      thumbs.set(p, v);
      waiters.get(p)?.forEach((cb) => cb(v));
      waiters.delete(p);
      pumpThumbs();
    };
    if (!api?.getMediaThumbnail) done(null);
    else api.getMediaThumbnail({ path: p }).then(done, () => done(null));
  }
}

/** Hình thu nhỏ của file (undefined = đang tải, null = không có). */
export function useThumbnail(f: FileEntry | null, enabled: boolean): string | null | undefined {
  const key = f && enabled && hasVisualPreview(f) ? f.fullPath : null;
  const [value, setValue] = useState<string | null | undefined>(() => (key ? thumbs.get(key) : null));
  useEffect(() => {
    if (!key) {
      setValue(null);
      return;
    }
    if (thumbs.has(key)) {
      setValue(thumbs.get(key));
      return;
    }
    setValue(undefined);
    const cb = (v: string | null) => setValue(v);
    let set = waiters.get(key);
    if (!set) {
      set = new Set();
      waiters.set(key, set);
      thumbQueue.push(key);
    } else {
      // Đưa lên đầu hàng đợi
      const i = thumbQueue.indexOf(key);
      if (i >= 0) thumbQueue.splice(i, 1);
      thumbQueue.push(key);
    }
    set.add(cb);
    pumpThumbs();
    return () => {
      const s = waiters.get(key);
      s?.delete(cb);
      if (s && s.size === 0) {
        waiters.delete(key);
        const i = thumbQueue.indexOf(key);
        if (i >= 0) thumbQueue.splice(i, 1);
      }
    };
  }, [key]);
  return value;
}
