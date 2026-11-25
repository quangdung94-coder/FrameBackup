import { Filter, RotateCcw, X } from 'lucide-react';

export const PRESET_EXTENSION_GROUPS = [
  {
    label: 'Video Quay Phim',
    exts: ['.mp4', '.mov', '.mxf', '.mkv', '.avi', '.mts', '.braw', '.r3d'],
  },
  {
    label: 'Ảnh RAW',
    exts: ['.arw', '.cr2', '.cr3', '.nef', '.raf', '.dng', '.orf', '.rw2'],
  },
  {
    label: 'Ảnh Thường',
    exts: ['.jpg', '.jpeg', '.png', '.heic', '.tif', '.tiff'],
  },
  {
    label: 'Sidecar / Khác',
    exts: ['.xml', '.wav', '.mp3', '.cube', '.srt'],
  },
];

export const DEFAULT_VISIBLE_EXTENSIONS = [
  '.mp4',
  '.mov',
  '.mxf',
  '.mkv',
  '.braw',
  '.r3d',
  '.arw',
  '.cr2',
  '.cr3',
  '.nef',
  '.raf',
  '.dng',
  '.jpg',
  '.jpeg',
  '.heic',
];

interface FileFilterModalProps {
  open: boolean;
  onClose: () => void;
  visibleExtensions: string[];
  onChangeVisibleExtensions: (exts: string[]) => void;
  includeSidecarXml: boolean;
  onChangeIncludeSidecarXml: (val: boolean) => void;
}

export function FileFilterModal({
  open,
  onClose,
  visibleExtensions,
  onChangeVisibleExtensions,
  includeSidecarXml,
  onChangeIncludeSidecarXml,
}: FileFilterModalProps) {
  if (!open) return null;

  const selectedSet = new Set(visibleExtensions.map((e) => e.toLowerCase()));

  const toggleExt = (ext: string) => {
    const next = new Set(selectedSet);
    if (next.has(ext)) next.delete(ext);
    else next.add(ext);
    onChangeVisibleExtensions(Array.from(next));
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#1e1e24] border border-[#3e3e4b] rounded-xl w-[640px] max-w-full max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="px-4 py-3 border-b border-[#2b2b34] flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-sm text-zinc-100">
            <Filter className="w-4 h-4 text-blue-400" />
            Cài đặt Hiển thị &amp; Lọc Đuôi File (Cột 1)
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onChangeVisibleExtensions([...DEFAULT_VISIBLE_EXTENSIONS])}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#272730] hover:bg-[#32323e] text-zinc-300 text-xs"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Mặc định
            </button>
            <button
              onClick={onClose}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#272730] hover:bg-[#32323e] text-zinc-300 text-xs"
            >
              <X className="w-3.5 h-3.5" /> Đóng
            </button>
          </div>
        </div>

        <div className="p-4 overflow-y-auto space-y-4 text-xs">
          <div className="p-3 rounded-lg bg-[#141418] border border-[#2b2b34] space-y-2.5">
            <div className="font-semibold text-zinc-200">Tùy chọn khi Copy từ Thẻ nhớ:</div>
            <div className="text-zinc-400 leading-relaxed">
              App chép đúng những file đang hiện ở Cột 1: chip <strong>Tất cả</strong> = chép mọi file, chip{' '}
              <strong>Theo cài đặt</strong> = chỉ chép các đuôi đã tick bên dưới (bỏ file rác / index máy ảnh như{' '}
              <code className="text-zinc-400">.IND, .BIM, .BDM, .THM</code>).
            </div>

            <label className="flex items-start gap-2 cursor-pointer text-zinc-300">
              <input
                type="checkbox"
                checked={includeSidecarXml}
                onChange={(e) => onChangeIncludeSidecarXml(e.target.checked)}
                className="accent-emerald-500 mt-0.5"
              />
              <span>
                <strong>Smart Sidecar (.XML Sony / Gyro):</strong> Dù ẩn <code className="text-zinc-400">.XML</code> cho
                gọn danh sách, khi copy file <code className="text-zinc-400">.MP4</code> vẫn tự động copy kèm file{' '}
                <code className="text-zinc-400">M01.XML</code> đi cùng.
              </span>
            </label>
          </div>

          <div className="space-y-3">
            {PRESET_EXTENSION_GROUPS.map((grp) => (
              <div key={grp.label} className="p-3 rounded-lg bg-[#141418] border border-[#2b2b34] space-y-2">
                <div className="font-semibold text-blue-300">{grp.label}</div>
                <div className="flex flex-wrap gap-2">
                  {grp.exts.map((ext) => {
                    const checked = selectedSet.has(ext);
                    return (
                      <button
                        key={ext}
                        type="button"
                        onClick={() => toggleExt(ext)}
                        className={`px-2.5 py-1 rounded-md border text-xs font-mono font-semibold transition ${
                          checked
                            ? 'bg-blue-600/25 border-blue-400 text-blue-200'
                            : 'bg-[#1d1d24] border-[#32323d] text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        {checked ? '✓ ' : ''}
                        {ext.toUpperCase()}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
