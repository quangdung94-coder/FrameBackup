import { Eye, Square, Terminal } from 'lucide-react';
import { useProgress, type ProgressStore } from '../lib/progressStore';
import type { CopyProgressEvent, DriveUploadProgressEvent, PackageProgressEvent } from '../types/framebackup';

export interface ActivityLogEntry {
  id: number;
  time: string;
  text: string;
  level: 'info' | 'success' | 'warn' | 'error';
}

interface PipelineBarProps {
  projectName: string;
  heightPx: number;
  progress: ProgressStore;
  activityLogs: ActivityLogEntry[];
  isRunning: boolean;
  onCancel: () => void;
  onOpenReportPreview: () => void;
}

function getStatusColor(
  status?: CopyProgressEvent['status'] | PackageProgressEvent['status'] | DriveUploadProgressEvent['status']
) {
  if (status === 'completed') return 'text-emerald-400';
  if (status === 'error' || status === 'cancelled') return 'text-red-400';
  if (
    status === 'copying' ||
    status === 'verifying' ||
    status === 'scanning' ||
    status === 'packing' ||
    status === 'preparing' ||
    status === 'uploading'
  ) {
    return 'text-blue-400';
  }
  return 'text-zinc-400';
}

function getCopyLabel(p: CopyProgressEvent | null, fallback: string) {
  if (!p) return fallback;
  if (p.status === 'completed') return '100%';
  if (p.status === 'cancelled') return 'Đã hủy';
  if (p.status === 'error') return 'Lỗi';
  return `${p.percent}%`;
}

function getPackLabel(p: PackageProgressEvent | null) {
  if (!p) return 'Chờ';
  if (p.status === 'completed') return '100%';
  if (p.status === 'cancelled') return 'Đã hủy';
  if (p.status === 'error') return 'Lỗi';
  return `${p.percent}%`;
}

function getDriveLabel(p: DriveUploadProgressEvent | null) {
  if (!p) return 'Chờ';
  if (p.status === 'completed') return '100%';
  if (p.status === 'cancelled') return 'Đã hủy';
  if (p.status === 'error') return 'Lỗi';
  return `${p.percent}%`;
}

export function PipelineBar({
  projectName,
  heightPx,
  progress,
  activityLogs,
  isRunning,
  onCancel,
  onOpenReportPreview,
}: PipelineBarProps) {
  const showLogPane = heightPx >= 235;
  const { step1: step1Progress, step2: step2Progress, step3: step3Progress, step4: step4Progress, watch: watchStatus } =
    useProgress(progress);

  return (
    <div
      style={{ height: `${heightPx}px` }}
      className="bg-[#151519] px-4 py-3 flex flex-col gap-3 shrink-0 overflow-hidden"
    >
      {/* Header Row */}
      <div className="flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0 text-[13px]">
          <span className="font-bold text-zinc-100 shrink-0">Tiến trình 4 cột:</span>
          <span className="text-blue-300 font-semibold truncate">{projectName}</span>
          {watchStatus && watchStatus.state !== 'idle' && (
            <span className="px-2.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-medium truncate">
              👁 {watchStatus.message}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {isRunning && (
            <button
              onClick={onCancel}
              title="Dừng ngay toàn bộ tiến trình đang chạy của thẻ này (Copy, Đóng gói 7z, Upload Google Drive, Watch Mode)"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 border border-red-400 text-white text-base font-extrabold shadow-lg shadow-red-950/60 transition"
            >
              <Square className="w-5 h-5 fill-current" /> Dừng khẩn cấp
            </button>
          )}
          <button
            onClick={onOpenReportPreview}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#24242d] hover:bg-[#30303d] border border-[#424252] text-zinc-100 text-base font-bold transition"
          >
            <Eye className="w-5 h-5 text-purple-400" />
            Xem trước Báo cáo Drive & 2 Thumbnail
          </button>
        </div>
      </div>

      {/* 4 Big Status Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        {/* Step 1 */}
        <div
          className={`bg-[#1a1a20] border rounded-lg px-3.5 py-2.5 flex flex-col gap-2 ${
            step1Progress?.status === 'completed'
              ? 'border-emerald-500/50 bg-emerald-950/10'
              : step1Progress && ['scanning', 'copying', 'verifying'].includes(step1Progress.status)
              ? 'border-blue-500 bg-blue-950/15'
              : 'border-[#2e2e38]'
          }`}
        >
          <div className="flex justify-between items-baseline gap-2">
            <span className="text-[13px] font-bold text-zinc-100 truncate">① Thẻ nhớ ➔ Ổ 1</span>
            <span className={`text-lg font-extrabold tabular-nums ${getStatusColor(step1Progress?.status)}`}>
              {getCopyLabel(step1Progress, 'Sẵn sàng')}
            </span>
          </div>
          <div className="h-2.5 bg-[#272732] rounded-full overflow-hidden">
            <div
              className={`h-full origin-left transition-transform duration-200 ease-out will-change-transform ${
                step1Progress?.status === 'completed' ? 'bg-emerald-500' : 'bg-blue-500'
              }`}
              style={{ transform: `scaleX(${(step1Progress?.percent ?? 0) / 100})` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-zinc-400 gap-2">
            <span className="truncate">
              {step1Progress ? step1Progress.currentFile : 'Ingest + Date Guard + XXHash64'}
            </span>
            {step1Progress && (
              <span className="shrink-0 font-mono text-[11.5px] text-blue-300 font-semibold">
                {step1Progress.verifiedFiles}/{step1Progress.totalFiles} • {step1Progress.speedMBs} MB/s
              </span>
            )}
          </div>
        </div>

        {/* Step 2 */}
        <div
          className={`bg-[#1a1a20] border rounded-lg px-3.5 py-2.5 flex flex-col gap-2 ${
            step2Progress?.status === 'completed'
              ? 'border-emerald-500/50 bg-emerald-950/10'
              : step2Progress && ['scanning', 'copying', 'verifying'].includes(step2Progress.status)
              ? 'border-emerald-400 bg-emerald-950/15'
              : 'border-[#2e2e38]'
          }`}
        >
          <div className="flex justify-between items-baseline gap-2">
            <span className="text-[13px] font-bold text-zinc-100 truncate">② Ổ 1 ➔ Ổ 2 (Backup)</span>
            <span className={`text-lg font-extrabold tabular-nums ${getStatusColor(step2Progress?.status)}`}>
              {getCopyLabel(step2Progress, 'Chờ')}
            </span>
          </div>
          <div className="h-2.5 bg-[#272732] rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 origin-left transition-transform duration-200 ease-out will-change-transform"
              style={{ transform: `scaleX(${(step2Progress?.percent ?? 0) / 100})` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-zinc-400 gap-2">
            <span className="truncate">
              {step2Progress ? step2Progress.currentFile : 'Mirror 1:1 & Verify XXHash64'}
            </span>
            {step2Progress && (
              <span className="shrink-0 font-mono text-[11.5px] text-emerald-300 font-semibold">
                {step2Progress.verifiedFiles}/{step2Progress.totalFiles} • {step2Progress.speedMBs} MB/s
              </span>
            )}
          </div>
        </div>

        {/* Step 3 */}
        <div
          className={`bg-[#1a1a20] border rounded-lg px-3.5 py-2.5 flex flex-col gap-2 ${
            step3Progress?.status === 'completed'
              ? 'border-emerald-500/50 bg-emerald-950/10'
              : step3Progress && ['scanning', 'packing'].includes(step3Progress.status)
              ? 'border-amber-400 bg-amber-950/15'
              : 'border-[#2e2e38]'
          }`}
        >
          <div className="flex justify-between items-baseline gap-2">
            <span className="text-[13px] font-bold text-zinc-100 truncate">③ Đóng gói & Thumbnail</span>
            <span className={`text-lg font-extrabold tabular-nums ${getStatusColor(step3Progress?.status)}`}>
              {getPackLabel(step3Progress)}
            </span>
          </div>
          <div className="h-2.5 bg-[#272732] rounded-full overflow-hidden">
            <div
              className={`h-full origin-left transition-transform duration-200 ease-out will-change-transform ${
                step3Progress?.status === 'completed' ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
              style={{ transform: `scaleX(${(step3Progress?.percent ?? 0) / 100})` }}
            />
          </div>
          <div className="text-xs text-zinc-400 truncate">
            {step3Progress ? step3Progress.message : 'Zip Store (Ảnh) + Cắt 2 Thumbnail đầu/cuối'}
          </div>
        </div>

        {/* Step 4 */}
        <div
          className={`bg-[#1a1a20] border rounded-lg px-3.5 py-2.5 flex flex-col gap-2 ${
            step4Progress?.status === 'completed'
              ? 'border-emerald-500/50 bg-emerald-950/10'
              : step4Progress && ['preparing', 'uploading'].includes(step4Progress.status)
              ? 'border-purple-500 bg-purple-950/15'
              : 'border-[#2e2e38]'
          }`}
        >
          <div className="flex justify-between items-baseline gap-2">
            <span className="text-[13px] font-bold text-zinc-100 truncate">④ Upload Google Drive</span>
            <span className={`text-lg font-extrabold tabular-nums ${getStatusColor(step4Progress?.status)}`}>
              {getDriveLabel(step4Progress)}
            </span>
          </div>
          <div className="h-2.5 bg-[#272732] rounded-full overflow-hidden">
            <div
              className={`h-full origin-left transition-transform duration-200 ease-out will-change-transform ${
                step4Progress?.status === 'completed' ? 'bg-emerald-500' : 'bg-purple-500'
              }`}
              style={{ transform: `scaleX(${(step4Progress?.percent ?? 0) / 100})` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-zinc-400 gap-2">
            <span className="truncate">
              {step4Progress ? step4Progress.currentFile : 'Resumable Upload + _00_BACKUP_REPORT.txt'}
            </span>
            {step4Progress && (
              <span className="shrink-0 font-mono text-[11.5px] text-purple-300 font-semibold">
                {step4Progress.filesUploaded}/{step4Progress.totalFiles} • {step4Progress.speedMBs} MB/s
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Expandable Live Activity Log (visible when user drags bottom panel taller) */}
      {showLogPane && (
        <div className="flex-1 min-h-0 bg-[#0f0f13] border border-[#2b2b34] rounded-lg flex flex-col overflow-hidden">
          <div className="px-3 py-1.5 bg-[#18181f] border-b border-[#2b2b34] flex items-center justify-between text-[11.5px] text-zinc-400">
            <span className="inline-flex items-center gap-1.5 font-semibold text-zinc-300">
              <Terminal className="w-3.5 h-3.5 text-blue-400" /> Nhật ký hoạt động trực tiếp (Live Log)
            </span>
            <span>{activityLogs.length} sự kiện</span>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11.5px] space-y-1">
            {activityLogs.length === 0 ? (
              <div className="text-zinc-500">Chưa có sự kiện nào. Kéo thanh ngang phía trên để thu gọn/mở rộng vùng này.</div>
            ) : (
              activityLogs.map((log) => (
                <div
                  key={log.id}
                  className={
                    log.level === 'error'
                      ? 'text-red-300'
                      : log.level === 'warn'
                      ? 'text-amber-300'
                      : log.level === 'success'
                      ? 'text-emerald-300'
                      : 'text-zinc-300'
                  }
                >
                  <span className="text-zinc-500 mr-2">[{log.time}]</span>
                  <span>{log.text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
