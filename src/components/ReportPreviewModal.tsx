import { X, FileText, Image as ImageIcon } from 'lucide-react';
import { formatDisplayDate } from '../types/framebackup';

interface ReportPreviewModalProps {
  open: boolean;
  onClose: () => void;
  projectName: string;
  targetDate: string;
  driveLink: string;
}

export function ReportPreviewModal({
  open,
  onClose,
  projectName,
  targetDate,
  driveLink,
}: ReportPreviewModalProps) {
  if (!open) return null;
  const displayDate = formatDisplayDate(targetDate);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#1e1e24] border border-[#3e3e4b] rounded-xl w-[840px] max-w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="px-4 py-3 border-b border-[#2b2b34] flex items-center justify-between">
          <span className="font-semibold text-sm text-zinc-100">
            Xem trước Báo cáo tự động trên Google Drive (_00_BACKUP_REPORT.txt + 2 Thumbnail)
          </span>
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#272730] hover:bg-[#32323e] text-zinc-300 text-xs"
          >
            <X className="w-3.5 h-3.5" /> Đóng
          </button>
        </div>

        <div className="p-4 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Drive Top Thumbnails Preview */}
          <div className="bg-[#131317] border border-[#2b2b34] rounded-lg p-3 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-purple-300">
              <ImageIcon className="w-4 h-4" /> Hiển thị ngay đầu thư mục Google Drive
            </div>
            <p className="text-[11.5px] text-zinc-400 leading-relaxed">
              Đặt tiền tố <code className="text-zinc-200">_00_</code>, <code className="text-zinc-200">_01_</code>,{' '}
              <code className="text-zinc-200">_02_</code> để khi mở link Drive trên điện thoại, báo cáo và 2 ảnh Shot
              đầu/cuối luôn nằm ngay trên cùng:
            </p>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-slate-900 border border-slate-700 rounded-md overflow-hidden">
                <div className="h-24 bg-gradient-to-br from-slate-800 to-slate-950 flex items-center justify-center text-[11px] text-slate-400 relative">
                  <span className="absolute top-1.5 left-1.5 bg-blue-600/90 px-1.5 py-0.5 rounded text-[9.5px] text-white font-semibold">
                    _01_FIRST_SHOT
                  </span>
                  [Frame C0001.MP4]
                </div>
                <div className="p-2 text-[10.5px] text-slate-300">
                  <div className="font-semibold truncate">_01_FIRST_SHOT_08h15_C0001.jpg</div>
                  <div className="text-slate-400">{displayDate} • 08:15:10</div>
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-700 rounded-md overflow-hidden">
                <div className="h-24 bg-gradient-to-br from-slate-800 to-slate-950 flex items-center justify-center text-[11px] text-slate-400 relative">
                  <span className="absolute top-1.5 left-1.5 bg-emerald-600/90 px-1.5 py-0.5 rounded text-[9.5px] text-white font-semibold">
                    _02_LAST_SHOT
                  </span>
                  [Frame C0003.MP4]
                </div>
                <div className="p-2 text-[10.5px] text-slate-300">
                  <div className="font-semibold truncate">_02_LAST_SHOT_18h50_C0003.jpg</div>
                  <div className="text-slate-400">{displayDate} • 18:50:41</div>
                </div>
              </div>
            </div>

            <div className="text-[11px] text-zinc-400 bg-[#18181f] border border-[#2b2b34] rounded p-2 truncate">
              🔗 <strong>Link Drive:</strong>{' '}
              <span className="text-purple-300">{driveLink || 'https://drive.google.com/drive/folders/...'}</span>
            </div>
          </div>

          {/* Drive Note Preview */}
          <div className="bg-[#131317] border border-[#2b2b34] rounded-lg p-3 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-300">
              <FileText className="w-4 h-4" /> Nội dung file _00_BACKUP_REPORT.txt
            </div>
            <pre className="font-mono text-[11px] leading-relaxed text-zinc-300 bg-[#0c0c0f] p-3 rounded-md border border-[#2b2b34] whitespace-pre-wrap flex-1">
{`=========================================
FRAMEBACKUP — BACKUP & UPLOAD REPORT
Project  : ${projectName}
Completed: ${displayDate} 19:45:10
=========================================
- Total Files  : 138 files (82.05 GB)
- Verify Ổ 1&2 : PASSED (XXHash64 100%)
- Cloud Mode   : Resumable Upload OK

[TIMELINE]
- First Shot : C0001.MP4 | ${displayDate} 08:15:10
- Last Shot  : C0003.MP4 | ${displayDate} 18:50:41

[THUMBNAILS IN THIS FOLDER]
- _01_FIRST_SHOT_08h15_C0001.jpg
- _02_LAST_SHOT_18h50_C0003.jpg
=========================================`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
