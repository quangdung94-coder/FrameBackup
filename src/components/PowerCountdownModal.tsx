import { useEffect, useState } from 'react';
import { Moon, Power, X } from 'lucide-react';
import type { PowerActionType } from '../types/framebackup';

interface PowerCountdownModalProps {
  action: PowerActionType | null;
  delayMinutes: number;
  onCancel: () => void;
  onExecute: (action: PowerActionType) => void;
}

function formatMMSS(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function PowerCountdownModal({ action, delayMinutes, onCancel, onExecute }: PowerCountdownModalProps) {
  const [remainingSec, setRemainingSec] = useState(Math.max(10, Math.round(delayMinutes * 60)));

  useEffect(() => {
    if (!action) return;
    setRemainingSec(Math.max(10, Math.round(delayMinutes * 60)));
  }, [action, delayMinutes]);

  useEffect(() => {
    if (!action) return;
    if (remainingSec <= 0) {
      onExecute(action);
      return;
    }
    const timer = setTimeout(() => {
      setRemainingSec((s) => s - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [action, remainingSec, onExecute]);

  if (!action) return null;

  const isShutdown = action === 'shutdown';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-5">
      <div className="bg-[#1e1e24] border-2 border-amber-500/70 rounded-xl w-[460px] max-w-full p-5 shadow-2xl space-y-4 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/20 border border-amber-500/50 flex items-center justify-center text-amber-400">
          {isShutdown ? <Power className="w-7 h-7" /> : <Moon className="w-7 h-7" />}
        </div>

        <div className="space-y-1">
          <h2 className="text-base font-bold text-zinc-100">
            {isShutdown ? 'Hoàn tất 100% — Chuẩn bị Tắt máy (Shutdown)' : 'Hoàn tất 100% — Chuẩn bị Ngủ (Sleep)'}
          </h2>
          <p className="text-xs text-zinc-400">
            Máy tính sẽ tự động {isShutdown ? 'tắt' : 'chuyển sang chế độ Sleep'} sau khi hết đếm ngược. Nếu anh vẫn đang
            làm việc, hãy bấm Hủy bên dưới.
          </p>
        </div>

        <div className="text-4xl font-extrabold font-mono text-amber-300 tracking-wider py-2">
          {formatMMSS(remainingSec)}
        </div>

        <div className="flex items-center justify-center gap-3 pt-1">
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2a2a34] hover:bg-[#363644] border border-[#444455] text-zinc-100 text-xs font-bold transition"
          >
            <X className="w-4 h-4" /> Hủy (Giữ máy thức)
          </button>
          <button
            onClick={() => onExecute(action)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-amber-950 text-xs font-extrabold transition"
          >
            {isShutdown ? 'Tắt máy ngay' : 'Sleep ngay'}
          </button>
        </div>
      </div>
    </div>
  );
}
