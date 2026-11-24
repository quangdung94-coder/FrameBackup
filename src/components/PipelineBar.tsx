import { Eye, Square } from 'lucide-react';
import type { CopyProgressEvent, PackageProgressEvent, WatchStatusEvent } from '../types/framebackup';

interface PipelineBarProps {
  projectName: string;
  step1Progress: CopyProgressEvent | null;
  step2Progress: CopyProgressEvent | null;
  step3Progress: PackageProgressEvent | null;
  watchStatus: WatchStatusEvent | null;
  isRunning: boolean;
  onCancel: () => void;
  onOpenReportPreview: () => void;
}

function getStatusColor(status?: CopyProgressEvent['status'] | PackageProgressEvent['status']) {
  if (status === 'completed') return 'text-emerald-400';
  if (status === 'error' || status === 'cancelled') return 'text-red-400';
  if (status === 'copying' || status === 'verifying' || status === 'scanning' || status === 'packing') {
    return 'text-blue-400';
  }
  return 'text-zinc-400';
}

function getCopyLabel(p: CopyProgressEvent | null, fallback: string) {
  if (!p) return fallback;
  if (p.status === 'completed') return '100% OK';
  if (p.status === 'cancelled') return 'Đã hủy';
  if (p.status === 'error') return 'Lỗi';
  if (p.status === 'verifying') return `Verify ${p.percent}%`;
  return `${p.percent}%`;
}

function getPackLabel(p: PackageProgressEvent | null) {
  if (!p) return 'Chờ bước 2';
  if (p.status === 'completed') return '100% OK';
  if (p.status === 'cancelled') return 'Đã hủy';
  if (p.status === 'error') return 'Lỗi';
  return `${p.percent}%`;
}

export function PipelineBar({
  projectName,
  step1Progress,
  step2Progress,
  step3Progress,
  watchStatus,
  isRunning,
  onCancel,
  onOpenReportPreview,
}: PipelineBarProps) {
  return (
    <div className="bg-[#151519] border-t border-[#2b2b34] px-3.5 py-2.5 flex flex-col gap-2 shrink-0">
      <div className="flex items-center justify-between text-xs gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-zinc-200 shrink-0">Chuỗi 4 cột:</span>
          <span className="text-blue-300 font-medium truncate">{projectName}</span>
          {watchStatus && watchStatus.state !== 'idle' && (
            <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[11px] truncate">
              👁 {watchStatus.message}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isRunning && (
            <button
              onClick={onCancel}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-600/20 hover:bg-red-600/35 border border-red-500/50 text-red-300 text-[11px] font-semibold"
            >
              <Square className="w-3 h-3 fill-current" /> Dừng khẩn cấp
            </button>
          )}
          <button
            onClick={onOpenReportPreview}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#23232a] hover:bg-[#2e2e38] border border-[#3e3e4b] text-zinc-200 text-[11px] transition"
          >
            <Eye className="w-3.5 h-3.5 text-purple-400" />
            Xem trước Báo cáo Drive & 2 Thumbnail
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {/* Step 1 */}
        <div
          className={`bg-[#18181c] border rounded-md px-2.5 py-2 flex flex-col gap-1 ${
            step1Progress?.status === 'completed'
              ? 'border-emerald-500/45'
              : step1Progress && ['scanning', 'copying', 'verifying'].includes(step1Progress.status)
              ? 'border-blue-500'
              : 'border-[#2b2b34]'
          }`}
        >
          <div className="flex justify-between items-center text-[11.5px] font-semibold">
            <span>① Thẻ nhớ ➔ Ổ 1</span>
            <span className={getStatusColor(step1Progress?.status)}>
              {getCopyLabel(step1Progress, 'Sẵn sàng')}
            </span>
          </div>
          <div className="text-[10.5px] text-zinc-400 truncate">
            {step1Progress
              ? `${step1Progress.currentFile} • ${step1Progress.verifiedFiles}/${step1Progress.totalFiles} files (${step1Progress.speedMBs} MB/s)`
              : 'Ingest + Date Guard + XXHash64'}
          </div>
          <div className="h-1.5 bg-[#272730] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                step1Progress?.status === 'completed' ? 'bg-emerald-500' : 'bg-blue-500'
              }`}
              style={{ width: `${step1Progress?.percent ?? 0}%` }}
            />
          </div>
        </div>

        {/* Step 2 */}
        <div
          className={`bg-[#18181c] border rounded-md px-2.5 py-2 flex flex-col gap-1 ${
            step2Progress?.status === 'completed'
              ? 'border-emerald-500/45'
              : step2Progress && ['scanning', 'copying', 'verifying'].includes(step2Progress.status)
              ? 'border-emerald-400'
              : 'border-[#2b2b34]'
          }`}
        >
          <div className="flex justify-between items-center text-[11.5px] font-semibold">
            <span>② Ổ 1 ➔ Ổ 2 (Backup)</span>
            <span className={getStatusColor(step2Progress?.status)}>
              {getCopyLabel(step2Progress, 'Chờ bước 1')}
            </span>
          </div>
          <div className="text-[10.5px] text-zinc-400 truncate">
            {step2Progress
              ? `${step2Progress.currentFile} • ${step2Progress.verifiedFiles}/${step2Progress.totalFiles} files (${step2Progress.speedMBs} MB/s)`
              : 'Mirror 1:1 & Verify XXHash64'}
          </div>
          <div className="h-1.5 bg-[#272730] rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: `${step2Progress?.percent ?? 0}%` }}
            />
          </div>
        </div>

        {/* Step 3 */}
        <div
          className={`bg-[#18181c] border rounded-md px-2.5 py-2 flex flex-col gap-1 ${
            step3Progress?.status === 'completed'
              ? 'border-emerald-500/45'
              : step3Progress && ['scanning', 'packing'].includes(step3Progress.status)
              ? 'border-amber-400'
              : 'border-[#2b2b34]'
          }`}
        >
          <div className="flex justify-between items-center text-[11.5px] font-semibold">
            <span>③ Đóng gói & Thumbnail</span>
            <span className={getStatusColor(step3Progress?.status)}>{getPackLabel(step3Progress)}</span>
          </div>
          <div className="text-[10.5px] text-zinc-400 truncate">
            {step3Progress ? step3Progress.message : 'Zip Store (Ảnh) + Cắt 2 Thumbnail đầu/cuối'}
          </div>
          <div className="h-1.5 bg-[#272730] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                step3Progress?.status === 'completed' ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
              style={{ width: `${step3Progress?.percent ?? 0}%` }}
            />
          </div>
        </div>

        {/* Step 4 */}
        <div className="bg-[#18181c] border border-[#2b2b34] rounded-md px-2.5 py-2 flex flex-col gap-1">
          <div className="flex justify-between items-center text-[11.5px] font-semibold">
            <span>④ Upload Google Drive</span>
            <span className="text-zinc-500">Phase 4</span>
          </div>
          <div className="text-[10.5px] text-zinc-400 truncate">Resumable + _00_BACKUP_REPORT.txt</div>
          <div className="h-1.5 bg-[#272730] rounded-full overflow-hidden">
            <div className="h-full w-0 bg-purple-500 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
