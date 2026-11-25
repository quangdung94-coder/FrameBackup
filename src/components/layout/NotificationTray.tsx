import { X } from 'lucide-react';
import type { ToastItem } from '../../hooks/useActivityLog';

const LEVEL_STYLE: Record<ToastItem['level'], string> = {
  info: 'border-l-blue-400',
  success: 'border-l-emerald-400',
  warn: 'border-l-amber-400',
  error: 'border-l-red-500',
};

/** Khay thông báo góc dưới phải: không đẩy lệch giao diện, thông báo trùng gộp ×N, lỗi giữ tới khi đóng. */
export function NotificationTray({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed right-4 bottom-4 z-[90] flex flex-col gap-2 w-[360px] max-w-[calc(100vw-32px)] pointer-events-none" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.level === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex items-start gap-2 rounded-md border border-[#3a3a46] border-l-[3px] ${LEVEL_STYLE[t.level]} bg-[#1f1f25]/95 backdrop-blur px-3 py-2 text-[12px] text-zinc-100 shadow-xl shadow-black/50`}
        >
          <span className="flex-1 min-w-0 break-words leading-snug">
            {t.text}
            {t.count > 1 && (
              <span className="ml-1.5 px-1.5 rounded-full bg-white/10 text-[10.5px] font-mono text-zinc-300">×{t.count}</span>
            )}
          </span>
          <button onClick={() => onDismiss(t.id)} className="text-zinc-500 hover:text-zinc-100 shrink-0" title="Đóng">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
