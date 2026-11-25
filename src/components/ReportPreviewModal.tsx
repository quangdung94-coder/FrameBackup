import { useState } from 'react';
import { X, FileText, Image as ImageIcon } from 'lucide-react';
import { formatDisplayDate, formatShortDate, type BackupReport, type MediaReportResult } from '../types/framebackup';

interface ReportPreviewModalProps {
  open: boolean;
  onClose: () => void;
  projectName: string;
  targetDate: string;
  driveLink: string;
  mediaReport: MediaReportResult | null;
  /** Báo cáo cuối (đã tạo sau khi up Drive). */
  backupReport?: BackupReport | null;
}

/** Báo cáo cuối: xem bản PDF (HTML chữ to) hoặc bản .txt. */
function FinalReportView({ report, onClose }: { report: BackupReport; onClose: () => void }) {
  const [tab, setTab] = useState<'pdf' | 'txt'>('pdf');
  const tabCls = (on: boolean) =>
    `px-3 py-1 rounded-md text-xs font-semibold border ${
      on ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#272730] border-[#3e3e4b] text-zinc-300 hover:bg-[#32323e]'
    }`;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#1e1e24] border border-[#3e3e4b] rounded-xl w-[960px] max-w-full h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="px-4 py-3 border-b border-[#2b2b34] flex items-center gap-2">
          <span className={`font-bold text-sm truncate ${report.verdict === 'ok' ? 'text-emerald-300' : 'text-amber-300'}`}>
            {report.headline}
          </span>
          <span className="flex-1" />
          <button className={tabCls(tab === 'pdf')} onClick={() => setTab('pdf')}>
            {report.pdfFileName ?? 'Bản PDF'}
          </button>
          <button className={tabCls(tab === 'txt')} onClick={() => setTab('txt')}>
            {report.txtFileName}
          </button>
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#272730] hover:bg-[#32323e] text-zinc-300 text-xs"
          >
            <X className="w-3.5 h-3.5" /> Đóng
          </button>
        </div>
        {tab === 'pdf' ? (
          <iframe title="Báo cáo sao lưu" sandbox="" srcDoc={report.html} className="flex-1 w-full bg-white" />
        ) : (
          <pre className="flex-1 overflow-auto m-0 p-4 bg-[#0c0c0f] text-zinc-200 font-mono text-[13px] leading-relaxed whitespace-pre">
            {report.text}
          </pre>
        )}
      </div>
    </div>
  );
}

export function ReportPreviewModal({
  open,
  onClose,
  projectName,
  targetDate,
  driveLink,
  mediaReport,
  backupReport,
}: ReportPreviewModalProps) {
  if (!open) return null;
  if (backupReport) return <FinalReportView report={backupReport} onClose={onClose} />;
  const displayDate = formatDisplayDate(targetDate);

  const first = mediaReport?.firstShot ?? null;
  const last = mediaReport?.lastShot ?? null;

  const fallbackText = `=========================================
FRAMEBACKUP — BACKUP & UPLOAD REPORT
Project  : ${projectName}
Completed: ${displayDate} (Chưa chạy job thực tế)
=========================================
- Total Files  : (Sẽ tự đếm khi chạy xong bước 2)
- Verify Ổ 1&2 : PASSED (XXHash64 100%)
- Cloud Mode   : Resumable Upload

[TIMELINE]
- First Shot : (Tự trích xuất từ EXIF / Video)
- Last Shot  : (Tự trích xuất từ EXIF / Video)

[THUMBNAILS IN THIS FOLDER]
- _01_FIRST_SHOT_<giờ>_<tên>.jpg
- _02_LAST_SHOT_<giờ>_<tên>.jpg
=========================================`;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#1e1e24] border border-[#3e3e4b] rounded-xl w-[860px] max-w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="px-4 py-3 border-b border-[#2b2b34] flex items-center justify-between">
          <span className="font-semibold text-sm text-zinc-100">
            {mediaReport
              ? 'Báo cáo Thực tế đã Tạo (Sẵn sàng đẩy lên Google Drive)'
              : 'Xem trước Mẫu Báo cáo Google Drive (_00_BACKUP_REPORT.txt + 2 Thumbnail)'}
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
              {/* First Shot */}
              <div className="bg-slate-900 border border-slate-700 rounded-md overflow-hidden">
                <div className="h-28 bg-gradient-to-br from-slate-800 to-slate-950 flex items-center justify-center text-[11px] text-slate-400 relative overflow-hidden">
                  <span className="absolute top-1.5 left-1.5 z-10 bg-blue-600/90 px-1.5 py-0.5 rounded text-[9.5px] text-white font-semibold">
                    SHOT ĐẦU
                  </span>
                  {first?.thumbnailDataUrl ? (
                    <img src={first.thumbnailDataUrl} alt="First Shot" className="w-full h-full object-cover" />
                  ) : (
                    <span>[Frame Shot Đầu]</span>
                  )}
                </div>
                <div className="p-2 text-[10.5px] text-slate-300">
                  <div className="font-semibold truncate">{first?.thumbnailFileName || first?.name || '_01_FIRST_SHOT.jpg'}</div>
                  <div className="text-slate-400">
                    {first ? formatShortDate(first.shotTimeMs) : `${displayDate} • --:--`}
                  </div>
                </div>
              </div>

              {/* Last Shot */}
              <div className="bg-slate-900 border border-slate-700 rounded-md overflow-hidden">
                <div className="h-28 bg-gradient-to-br from-slate-800 to-slate-950 flex items-center justify-center text-[11px] text-slate-400 relative overflow-hidden">
                  <span className="absolute top-1.5 left-1.5 z-10 bg-emerald-600/90 px-1.5 py-0.5 rounded text-[9.5px] text-white font-semibold">
                    SHOT CUỐI
                  </span>
                  {last?.thumbnailDataUrl ? (
                    <img src={last.thumbnailDataUrl} alt="Last Shot" className="w-full h-full object-cover" />
                  ) : (
                    <span>[Frame Shot Cuối]</span>
                  )}
                </div>
                <div className="p-2 text-[10.5px] text-slate-300">
                  <div className="font-semibold truncate">{last?.thumbnailFileName || last?.name || '_02_LAST_SHOT.jpg'}</div>
                  <div className="text-slate-400">
                    {last ? formatShortDate(last.shotTimeMs) : `${displayDate} • --:--`}
                  </div>
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
              {mediaReport?.reportText ?? fallbackText}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
