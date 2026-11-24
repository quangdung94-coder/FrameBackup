import { Eye } from 'lucide-react';

interface PipelineBarProps {
  projectName: string;
  onOpenReportPreview: () => void;
}

export function PipelineBar({ projectName, onOpenReportPreview }: PipelineBarProps) {
  return (
    <div className="bg-[#151519] border-t border-[#2b2b34] px-3.5 py-2.5 flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-200">Chuỗi 4 cột hiện tại:</span>
          <span className="text-blue-300 font-medium">{projectName}</span>
          <span className="text-zinc-500">•</span>
          <span className="text-zinc-400">Phase 1 Foundation (Sẵn sàng kết nối Engine ở Phase 2–4)</span>
        </div>
        <button
          onClick={onOpenReportPreview}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#23232a] hover:bg-[#2e2e38] border border-[#3e3e4b] text-zinc-200 text-[11px] transition"
        >
          <Eye className="w-3.5 h-3.5 text-blue-400" />
          Xem trước Báo cáo Telegram & Thumbnail Shot đầu/cuối
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="bg-[#18181c] border border-[#2b2b34] rounded-md px-2.5 py-2 flex flex-col gap-1">
          <div className="flex justify-between items-center text-[11.5px] font-semibold">
            <span>① Thẻ nhớ ➔ Ổ 1</span>
            <span className="text-amber-400">Sẵn sàng</span>
          </div>
          <div className="text-[10.5px] text-zinc-400">Ingest + Date Guard + XXHash64</div>
          <div className="h-1.5 bg-[#272730] rounded-full overflow-hidden">
            <div className="h-full w-0 bg-blue-500 rounded-full" />
          </div>
        </div>

        <div className="bg-[#18181c] border border-[#2b2b34] rounded-md px-2.5 py-2 flex flex-col gap-1">
          <div className="flex justify-between items-center text-[11.5px] font-semibold">
            <span>② Ổ 1 ➔ Ổ 2 (Backup)</span>
            <span className="text-zinc-400">Chờ bước 1</span>
          </div>
          <div className="text-[10.5px] text-zinc-400">Mirror 1:1 & Verify Checksum</div>
          <div className="h-1.5 bg-[#272730] rounded-full overflow-hidden">
            <div className="h-full w-0 bg-emerald-500 rounded-full" />
          </div>
        </div>

        <div className="bg-[#18181c] border border-[#2b2b34] rounded-md px-2.5 py-2 flex flex-col gap-1">
          <div className="flex justify-between items-center text-[11.5px] font-semibold">
            <span>③ Đóng gói & Thumbnail</span>
            <span className="text-zinc-400">Chờ bước 2</span>
          </div>
          <div className="text-[10.5px] text-zinc-400">Zip Store (Ảnh) + Cắt 2 Thumbnail</div>
          <div className="h-1.5 bg-[#272730] rounded-full overflow-hidden">
            <div className="h-full w-0 bg-amber-500 rounded-full" />
          </div>
        </div>

        <div className="bg-[#18181c] border border-[#2b2b34] rounded-md px-2.5 py-2 flex flex-col gap-1">
          <div className="flex justify-between items-center text-[11.5px] font-semibold">
            <span>④ Upload Google Drive</span>
            <span className="text-zinc-400">Chờ bước 3</span>
          </div>
          <div className="text-[10.5px] text-zinc-400">Resumable Upload + _BACKUP_REPORT.txt</div>
          <div className="h-1.5 bg-[#272730] rounded-full overflow-hidden">
            <div className="h-full w-0 bg-purple-500 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
