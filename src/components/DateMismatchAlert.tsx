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
  onSelectDateChip: (dateKey: string) => void;
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
  onSelectDateChip,
  onFilterTargetOnly,
  onSplitByDate,
  onIgnoreAndCopyAll,
  onDismiss,
}: DateMismatchAlertProps) {
  if (!visible) return null;

  const mismatchedGroups = groups.filter((g) => !g.isTarget);
  const totalMismatchFiles = mismatchedGroups.reduce((acc, g) => acc + g.count, 0);

  return (
    <div className="mx-2.5 mt-2 rounded-xl border-2 border-red-500 bg-gradient-to-r from-red-900/40 via-red-950/35 to-red-900/25 px-3.5 py-2.5 alert-pulse flex flex-wrap xl:flex-nowrap items-center justify-between gap-3 max-w-full overflow-hidden shrink-0">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <div className="w-10 h-10 rounded-xl bg-red-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-red-950/50">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-red-200 tracking-wide truncate">
            CẢNH BÁO LỆCH NGÀY TẠI {sourceLabel.toUpperCase()} — {totalMismatchFiles} FILE KHÁC NGÀY!
          </div>
          <p className="text-[11.5px] text-red-100/90 mt-0.5 leading-snug">
            Ngày mục tiêu: <strong>{formatDisplayDate(targetDate)}</strong> • Nguồn có{' '}
            <strong>{groups.length} ngày khác nhau</strong>. Bấm thẳng vào 1 chip ngày bên dưới để chọn chép riêng ngày đó:
          </p>
          <div className="flex flex-wrap gap-1.5 mt-1.5 max-h-16 overflow-y-auto pr-1">
            {groups.map((g) => (
              <button
                key={g.dateKey}
                type="button"
                onClick={() => onSelectDateChip(g.dateKey)}
                title={`Bấm để đặt ${formatDisplayDate(g.dateKey)} làm ngày mục tiêu và lọc file ngày này`}
                className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border transition cursor-pointer ${
                  g.isTarget
                    ? 'bg-emerald-500/25 text-emerald-200 border-emerald-400/60 hover:bg-emerald-500/40'
                    : 'bg-red-500/30 text-red-100 border-red-400/60 hover:bg-red-500/50'
                }`}
              >
                {g.isTarget ? '✓' : '✕'} {formatDisplayDate(g.dateKey)}: {g.count} ({formatBytes(g.totalBytes)})
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 shrink-0">
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={onFilterTargetOnly}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-bold text-xs transition"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Chỉ chép {formatDisplayDate(targetDate)}
          </button>
          <button
            onClick={onSplitByDate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold text-xs transition"
          >
            <FolderKanban className="w-3.5 h-3.5" />
            Tách theo ngày
          </button>
        </div>
        <div className="flex justify-end gap-1.5">
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
            Ẩn cảnh báo
          </button>
        </div>
      </div>
    </div>
  );
}
