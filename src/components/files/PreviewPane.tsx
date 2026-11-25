import { X } from 'lucide-react';
import { useEffect } from 'react';
import { formatDuration, formatResolution, getMediaInfo, hasVisualPreview, requestMediaInfo, useMediaVersion } from '../../lib/mediaStore';
import { formatBytes, formatDateTime, type FileEntry } from '../../types/framebackup';
import { Thumb } from './GridCell';

/** v1.4: khung xem trước dưới danh sách — hình lớn (rê chuột tua clip) + thông tin clip / ảnh. */
export function PreviewPane({
  entry,
  showDate,
  mismatch,
  onClose,
}: {
  entry: FileEntry | null;
  showDate?: boolean;
  mismatch?: boolean;
  onClose: () => void;
}) {
  useMediaVersion();
  useEffect(() => {
    if (entry) requestMediaInfo([entry]);
  }, [entry]);
  const info = entry ? getMediaInfo(entry.fullPath) : undefined;
  const rows: Array<[string, string]> = entry
    ? (
        [
          ['Ngày quay', entry.shotTimeMs > 0 ? formatDateTime(entry.shotTimeMs) : ''],
          ['Thời lượng', entry.mediaType === 'video' ? formatDuration(info?.durationSec) : ''],
          ['Độ phân giải', formatResolution(info)],
          ['Khung hình', info?.fps ? `${Math.round(info.fps * 100) / 100} fps` : ''],
          ['Codec', info?.codec ?? ''],
          ['Máy quay', info?.cameraModel ?? ''],
          ['Dung lượng', entry.isDirectory ? '' : formatBytes(entry.sizeBytes)],
        ] as Array<[string, string]>
      ).filter(([, v]) => v)
    : [];
  return (
    <div data-preview-pane className="shrink-0 h-[136px] border-t border-[#2b2b34] bg-[#141418] flex flex-col">
      <div className="px-2 py-0.5 flex items-center justify-between text-[10px] uppercase tracking-wide text-zinc-500 border-b border-[#24242c]">
        <span>Preview</span>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200" title="Ẩn khung xem trước (View › Preview pane)">
          <X className="w-3 h-3" />
        </button>
      </div>
      {!entry ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-zinc-500">Chọn 1 file để xem trước</div>
      ) : (
        <div className="flex-1 min-h-0 flex gap-2 p-2">
          {(hasVisualPreview(entry) || entry.isDirectory) && <Thumb entry={entry} w={150} h={100} big />}
          <div className="min-w-0 flex-1 overflow-y-auto text-[10.5px] leading-[15px]">
            <div className="font-semibold text-zinc-100 truncate mb-0.5" title={entry.name}>{entry.name}</div>
            {rows.map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <span className="w-[70px] shrink-0 text-zinc-500 truncate">{k}</span>
                <span
                  title={v}
                  className={`min-w-0 truncate ${k === 'Ngày quay' && showDate && mismatch ? 'text-red-300 font-semibold' : 'text-zinc-200'}`}
                >
                  {v}
                  {k === 'Ngày quay' && showDate && mismatch ? ' ⚠' : ''}
                </span>
              </div>
            ))}
            <div className="mt-0.5 text-[10px] text-zinc-600 truncate" title={entry.fullPath}>
              {entry.fullPath}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
