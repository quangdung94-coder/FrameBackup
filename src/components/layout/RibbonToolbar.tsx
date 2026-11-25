import { Filter } from 'lucide-react';
import type { CopyEngineId, CopyEngineOption, PackMode } from '../../types/framebackup';

export type PostAction = 'drive-report-sleep' | 'drive-report-shutdown' | 'drive-report-only';

interface RibbonToolbarProps {
  projectName: string;
  targetDate: string;
  overnightMode: boolean;
  visibleExtCount: number;
  copyEngines: CopyEngineOption[];
  copyEngine: CopyEngineId;
  packMode: PackMode;
  postAction: PostAction;
  postDelayMin: number;
  onProjectNameChange: (value: string) => void;
  onTargetDateChange: (value: string) => void;
  onOvernightModeChange: (value: boolean) => void;
  onOpenFileFilter: () => void;
  onCopyEngineChange: (value: CopyEngineId) => void;
  onPackModeChange: (value: PackMode) => void;
  onPostActionChange: (value: PostAction) => void;
  onPostDelayMinChange: (value: number) => void;
}

/** Thanh công cụ: tên Show, ngày quay, trình copy, kiểu đóng gói Drive, hành động khi xong, nút chạy. */
export function RibbonToolbar({
  projectName,
  targetDate,
  overnightMode,
  visibleExtCount,
  copyEngines,
  copyEngine,
  packMode,
  postAction,
  postDelayMin,
  onProjectNameChange,
  onTargetDateChange,
  onOvernightModeChange,
  onOpenFileFilter,
  onCopyEngineChange,
  onPackModeChange,
  onPostActionChange,
  onPostDelayMinChange,
}: RibbonToolbarProps) {
  return (
    <div className="bg-[#1b1b20] border-b border-[#2b2b34] px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap shrink-0">
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="h-9 flex items-center gap-2 bg-[#101013] border border-[#32323d] px-3 rounded-lg">
          <span className="text-xs text-zinc-400 font-medium">Show:</span>
          <input
            type="text"
            value={projectName}
            onChange={(e) => onProjectNameChange(e.target.value)}
            className="bg-transparent text-[13px] text-zinc-100 outline-none w-48 font-semibold"
          />
        </div>

        <div className="h-9 flex items-center gap-2.5 bg-[#101013] border border-[#32323d] px-3 rounded-lg">
          <span className="text-xs text-zinc-400 font-medium">Ngày quay:</span>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => onTargetDateChange(e.target.value)}
            className="bg-transparent text-[13px] text-zinc-100 outline-none font-medium"
          />
          <label className="inline-flex items-center gap-1.5 text-xs text-zinc-300 cursor-pointer pl-1 border-l border-[#2e2e38]">
            <input
              type="checkbox"
              checked={overnightMode}
              onChange={(e) => onOvernightModeChange(e.target.checked)}
              className="accent-blue-500 w-3.5 h-3.5"
            />
            Xuyên đêm
          </label>
        </div>

        <button
          onClick={onOpenFileFilter}
          className="h-9 inline-flex items-center gap-1.5 px-3 rounded-lg bg-[#23232c] hover:bg-[#2e2e3a] border border-[#3e3e4b] text-zinc-200 text-xs font-semibold transition"
          title="Cài đặt hiển thị & lọc đuôi file (MP4, MOV, RAW, XML...)"
        >
          <Filter className="w-4 h-4 text-blue-400" /> Lọc đuôi file ({visibleExtCount})
        </button>
      </div>

      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="h-9 flex items-center gap-2 bg-[#101013] border border-[#32323d] px-3 rounded-lg">
          <span className="text-xs text-zinc-400 font-medium">Copy:</span>
          <select
            value={copyEngine}
            onChange={(e) => onCopyEngineChange(e.target.value as CopyEngineId)}
            className="bg-transparent text-[13px] text-zinc-100 outline-none font-medium"
            title="Chọn trình copy (tự nhận diện app đã cài trên Windows / macOS)"
          >
            {copyEngines.map((eng) => (
              <option key={eng.id} value={eng.id} disabled={!eng.available} className="bg-[#202024]">
                {eng.name}
                {!eng.available ? ' (Chưa cài)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="h-9 flex items-center gap-2 bg-[#101013] border border-[#32323d] px-3 rounded-lg">
          <span className="text-xs text-zinc-400 font-medium">Drive:</span>
          <select
            value={packMode}
            onChange={(e) => onPackModeChange(e.target.value as PackMode)}
            className="bg-transparent text-[13px] text-zinc-100 outline-none font-medium"
          >
            <option value="video-raw-smart" className="bg-[#202024]">Video lẻ | Ảnh: Zip Store</option>
            <option value="none" className="bg-[#202024]">Không nén tất cả</option>
            <option value="zip-store" className="bg-[#202024]">Zip Store tất cả</option>
            <option value="7z" className="bg-[#202024]">Nén 7z Tiêu chuẩn</option>
          </select>
        </div>

        <div className="h-9 flex items-center gap-2 bg-[#101013] border border-[#32323d] px-3 rounded-lg">
          <span className="text-xs text-zinc-400 font-medium">Xong:</span>
          <select
            value={postAction}
            onChange={(e) => onPostActionChange(e.target.value as PostAction)}
            className="bg-transparent text-[13px] text-zinc-100 outline-none font-medium"
          >
            <option value="drive-report-sleep" className="bg-[#202024]">Drive Report + Sleep</option>
            <option value="drive-report-shutdown" className="bg-[#202024]">Drive Report + Shutdown</option>
            <option value="drive-report-only" className="bg-[#202024]">Chỉ tạo Drive Report</option>
          </select>
          {postAction !== 'drive-report-only' && (
            <div className="inline-flex items-center gap-1.5 pl-2.5 border-l border-[#2e2e38] text-xs text-zinc-300">
              <span className="text-zinc-400 font-medium">Chờ</span>
              <div className="inline-flex items-center rounded-md overflow-hidden border border-[#3e3e4d] bg-[#1b1b22]">
                <button
                  type="button"
                  onClick={() => onPostDelayMinChange(Math.max(1, postDelayMin - 1))}
                  className="w-7 h-7 inline-flex items-center justify-center text-sm font-bold text-zinc-300 hover:text-white hover:bg-[#2a2a36] transition select-none"
                  title="Giảm 1 phút"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={postDelayMin}
                  onChange={(e) => onPostDelayMinChange(Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
                  className="w-12 h-7 bg-transparent text-center text-[13px] text-amber-300 font-extrabold tabular-nums outline-none border-x border-[#2e2e38] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  title="Số phút đếm ngược trước khi Sleep/Shutdown (1–120 phút)"
                />
                <button
                  type="button"
                  onClick={() => onPostDelayMinChange(Math.min(120, postDelayMin + 1))}
                  className="w-7 h-7 inline-flex items-center justify-center text-sm font-bold text-zinc-300 hover:text-white hover:bg-[#2a2a36] transition select-none"
                  title="Tăng 1 phút"
                >
                  +
                </button>
              </div>
              <span className="text-zinc-400 font-medium">phút</span>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
