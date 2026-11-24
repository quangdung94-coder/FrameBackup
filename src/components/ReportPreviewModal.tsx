import { X, Send, FileText } from 'lucide-react';
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
            Xem trước Báo cáo Tự động (Telegram + File Note trên Google Drive)
          </span>
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#272730] hover:bg-[#32323e] text-zinc-300 text-xs"
          >
            <X className="w-3.5 h-3.5" /> Đóng
          </button>
        </div>

        <div className="p-4 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Telegram Preview */}
          <div className="bg-[#131317] border border-[#2b2b34] rounded-lg p-3 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-300">
              <Send className="w-4 h-4" /> Tin nhắn gửi về Telegram
            </div>
            <div className="bg-slate-800/90 rounded-lg p-3 text-xs leading-relaxed text-slate-200 space-y-1">
              <div className="font-bold text-emerald-300">✅ SAO LƯU & UPLOAD HOÀN TẤT</div>
              <div>📁 <strong>Dự án:</strong> {projectName}</div>
              <div>💳 <strong>Thẻ ➔ Ổ 1 ➔ Ổ 2:</strong> 138/138 files (82.05 GB) — Verify OK</div>
              <div>☁️ <strong>Google Drive:</strong> Đã up xong 100%</div>
              <div>⏱ <strong>Shot đầu tiên:</strong> {displayDate} 08:15:10 (C0001.MP4)</div>
              <div>⏱ <strong>Shot cuối cùng:</strong> {displayDate} 18:50:41 (C0003.MP4)</div>
              <div className="truncate">
                🔗 <strong>Link:</strong>{' '}
                <span className="text-blue-400 underline">{driveLink || 'https://drive.google.com/drive/folders/...'}</span>
              </div>
              <div className="italic text-slate-400 pt-1">😴 Máy tính sẽ tự động Sleep sau 60 giây.</div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-slate-900 border border-slate-700 rounded-md overflow-hidden">
                <div className="h-20 bg-gradient-to-br from-slate-800 to-slate-950 flex items-center justify-center text-[11px] text-slate-400 relative">
                  <span className="absolute top-1 left-1 bg-black/75 px-1.5 py-0.5 rounded text-[9.5px] text-white font-semibold">
                    SHOT ĐẦU
                  </span>
                  [Frame C0001.MP4]
                </div>
                <div className="p-2 text-[10.5px] text-slate-300">
                  <div className="font-semibold">C0001.MP4</div>
                  <div className="text-slate-400">{displayDate} • 08:15:10</div>
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-700 rounded-md overflow-hidden">
                <div className="h-20 bg-gradient-to-br from-slate-800 to-slate-950 flex items-center justify-center text-[11px] text-slate-400 relative">
                  <span className="absolute top-1 left-1 bg-black/75 px-1.5 py-0.5 rounded text-[9.5px] text-white font-semibold">
                    SHOT CUỐI
                  </span>
                  [Frame C0003.MP4]
                </div>
                <div className="p-2 text-[10.5px] text-slate-300">
                  <div className="font-semibold">C0003.MP4</div>
                  <div className="text-slate-400">{displayDate} • 18:50:41</div>
                </div>
              </div>
            </div>
          </div>

          {/* Drive Note Preview */}
          <div className="bg-[#131317] border border-[#2b2b34] rounded-lg p-3 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-300">
              <FileText className="w-4 h-4" /> File _BACKUP_REPORT.txt trong Google Drive
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

[THUMBNAILS]
- _report/first_shot_C0001.jpg
- _report/last_shot_C0003.jpg
=========================================`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
