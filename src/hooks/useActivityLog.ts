import { useCallback, useRef, useState } from 'react';
import type { ActivityLogEntry } from '../components/PipelineBar';
import { formatNowClock } from '../lib/time';

const MAX_LOGS = 80;
const MAX_TOASTS = 4;
/** Thông tin tự ẩn nhanh, xong/cảnh báo lâu hơn chút, lỗi giữ tới khi đóng. */
const TOAST_MS: Record<ActivityLogEntry['level'], number | null> = { info: 3000, success: 4500, warn: 6000, error: null };

export interface ToastItem {
  id: number;
  text: string;
  level: ActivityLogEntry['level'];
  /** Số lần thông báo trùng (gộp thành ×N). */
  count: number;
}

/** Mức log suy ra từ emoji đầu thông báo: ❌ lỗi, ✅ xong, ⚠/⛔/👁 cảnh báo. */
export function inferLogLevel(msg: string): ActivityLogEntry['level'] {
  if (msg.startsWith('❌')) return 'error';
  if (msg.startsWith('✅')) return 'success';
  if (msg.startsWith('⚠') || msg.startsWith('⛔') || msg.startsWith('👁')) return 'warn';
  return 'info';
}

/**
 * Live Log (tối đa 80 dòng) + khay thông báo góc dưới phải:
 * thông báo trùng gộp lại (×N), tối đa 4 cái, không đẩy lệch giao diện. Nút 🔔 xem lại toàn bộ.
 */
export function useActivityLog() {
  const idRef = useRef(0);
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [unread, setUnread] = useState(0);

  const pushLog = useCallback((text: string, level: ActivityLogEntry['level'] = 'info') => {
    setActivityLogs((prev) => [{ id: ++idRef.current, time: formatNowClock(), text, level }, ...prev.slice(0, MAX_LOGS - 1)]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    const t = timersRef.current.get(id);
    if (t) clearTimeout(t);
    timersRef.current.delete(id);
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const armTimer = useCallback(
    (id: number, level: ActivityLogEntry['level']) => {
      const old = timersRef.current.get(id);
      if (old) clearTimeout(old);
      const ms = TOAST_MS[level];
      if (ms === null) return;
      timersRef.current.set(
        id,
        setTimeout(() => dismissToast(id), ms)
      );
    },
    [dismissToast]
  );

  const showToast = useCallback(
    (msg: string) => {
      const level = inferLogLevel(msg);
      pushLog(msg, level);
      setUnread((n) => n + 1);
      setToasts((prev) => {
        const same = prev.find((x) => x.text === msg);
        if (same) {
          armTimer(same.id, level);
          return prev.map((x) => (x.id === same.id ? { ...x, count: x.count + 1 } : x));
        }
        const id = ++idRef.current;
        armTimer(id, level);
        const next = [...prev, { id, text: msg, level, count: 1 }];
        // Quá 4 cái: bỏ cái cũ nhất (ưu tiên giữ lỗi)
        while (next.length > MAX_TOASTS) {
          const idx = next.findIndex((x) => x.level !== 'error');
          const [gone] = next.splice(idx >= 0 ? idx : 0, 1);
          const t = timersRef.current.get(gone.id);
          if (t) clearTimeout(t);
          timersRef.current.delete(gone.id);
        }
        return next;
      });
    },
    [armTimer, pushLog]
  );

  const markRead = useCallback(() => setUnread(0), []);

  return { activityLogs, toasts, unread, markRead, dismissToast, pushLog, showToast };
}
