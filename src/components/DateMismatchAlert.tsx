import { AlertTriangle, CheckCircle2, FolderKanban } from 'lucide-react';
import { formatBytes, formatDisplayDate } from '../types/framebackup';

export interface DateGroupSummary {
  dateKey: string;
  count: number;
  totalBytes: number;
  isTarget: boolean;
}

interface DateMismatchAlertProps {
  visible: boolean;
  sourceLabel: string;
  targetDate: string;
  groups: DateGroupSummary[];
  onFilterTargetOnly: () => void;
  onSplitByDate: () => void;
  onIgnoreAndCopyAll: () => void;
  onDismiss: () => void;
}

export function DateMismatchAlert({
  visible,
  sourceLabel,
  targetDate,
  groups,
  onFilterTargetOnly,
  onSplitByDate,
  onIgnoreAndCopyAll,
  onDismiss,
}: DateMismatchAlertProps) {
  if (!visible) return null;

  const mismatchedGroups = groups.filter((g) => !g.isTarget);
  const totalMismatchFiles = mismatchedGroups.reduce((acc, g) => acc + g.count, 0);

  return (
    <div className="mx-2.5 mt-2 rounded-xl border-2 border-red-500 bg-gradient-to-r from-red-900/40 via-red-950/35 to-red-900/25 px-4 py-3 alert-pulse flex flex-wrap lg:flex-nowrap items-center justify-between gap-4">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-red-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-red-950/50">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <div>
          <div className="text-sm font-bold text-red-200 tracking-wide">
            CẢNH BÁO LỆCH NGÀY QUAY TẠI {sourceLabel.toUpperCase()} — PHÁT HIỆN {totalMismatchFiles} FILE KHÁC NGÀY!
          </div>
          <p className="text-xs text-red-100/90 mt-0.5 leading-relaxed">
            Ngày mục tiêu là <strong>{formatDisplayDate(targetDate)}</strong>, nhưng nguồn có lẫn{' '}
            <strong>{groups.length} ngày khác nhau</strong>. Chọn cách xử lý để tránh chép trùng hoặc sót thẻ:
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {groups.map((g) => (
              <span
                key={g.dateKey}
                className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${
                  g.isTarget
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                    : 'bg-red-500/30 text-red-200 border-red-400/60'
                }`}
              >
                {g.isTarget ? '✓' : '✕'} {formatDisplayDate(g.dateKey)}: {g.count} files ({formatBytes(g.totalBytes)})
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 shrink-0">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onFilterTargetOnly}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-bold text-xs transition"
          >
            <CheckCircle2 className="w-4 h-4" />
            Chỉ chép ngày {formatDisplayDate(targetDate)}
          </button>
          <button
            onClick={onSplitByDate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold text-xs transition"
          >
            <FolderKanban className="w-4 h-4" />
            Tách thư mục theo ngày
          </button>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onIgnoreAndCopyAll}
            className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white border border-white/20 text-[11px] transition"
          >
            Vẫn chép tất cả
          </button>
          <button
            onClick={onDismiss}
            className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/15 text-zinc-200 border border-white/15 text-[11px] transition"
          >
            Dừng kiểm tra lại
          </button>
        </div>
      </div>
    </div>
  );
}
