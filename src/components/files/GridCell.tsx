import { Folder } from 'lucide-react';
import type { ViewLayout } from '../../hooks/useFilePane';
import { formatDuration, formatResolution, getMediaInfo, useThumbnail } from '../../lib/mediaStore';
import { formatBytes, formatShortDate, type FileEntry } from '../../types/framebackup';
import { FileIcon } from '../FileIcon';
import { TONES, type Tone } from './FilePaneView';

export interface GridGeometry {
  cols: number;
  cellW: number;
  cellH: number;
  pad: number;
  thumbW: number;
  thumbH: number;
}

/** Kích thước ô theo kiểu xem & bề rộng vùng danh sách (ô giãn đều cho kín hàng như Explorer). */
export function gridGeometry(layout: ViewLayout, iconSize: number, viewW: number): GridGeometry {
  const pad = 6;
  const avail = Math.max(120, viewW - pad * 2);
  if (layout === 'tiles') {
    const cols = Math.max(1, Math.floor(avail / 250));
    return { cols, cellW: avail / cols, cellH: 70, pad, thumbW: 100, thumbH: 60 };
  }
  const cols = Math.max(1, Math.floor(avail / (iconSize + 16)));
  const thumbH = Math.round(iconSize * 0.62);
  return { cols, cellW: avail / cols, cellH: thumbH + 46, pad, thumbW: iconSize, thumbH };
}

interface GridCellProps {
  entry: FileEntry;
  layout: ViewLayout;
  geo: GridGeometry;
  left: number;
  top: number;
  rowProps: Record<string, unknown>;
  selected: boolean;
  focused: boolean;
  mismatch: boolean;
  selectable: boolean;
  canDrag: boolean;
  tone: Tone;
  showDate?: boolean;
  onCheck: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
}

/** Khung hình thu nhỏ (chỉ ảnh tĩnh, không phát / tua clip để nhẹ máy với video 4K H.265). */
export function Thumb({ entry, w, h, big }: { entry: FileEntry; w: number; h: number; big: boolean }) {
  const thumb = useThumbnail(entry, true);
  const info = getMediaInfo(entry.fullPath);
  const isVideo = entry.mediaType === 'video';
  const dur = isVideo ? formatDuration(info?.durationSec) : '';

  return (
    <div
      className="relative shrink-0 rounded overflow-hidden bg-black/60 flex items-center justify-center"
      style={{ width: w, height: h }}
      data-thumb
    >
      {entry.isDirectory ? (
        <Folder className="text-amber-400" style={{ width: h * 0.7, height: h * 0.7 }} />
      ) : thumb ? (
        <img src={thumb} alt="" draggable={false} className="max-w-full max-h-full object-contain" />
      ) : (
        <div className="flex flex-col items-center gap-1 text-zinc-500">
          <div style={{ transform: `scale(${big ? 2.2 : 1.6})` }}>
            <FileIcon type={entry.mediaType} />
          </div>
          {big && <span className="text-[9px] uppercase mt-2">{thumb === undefined && entry.mediaType !== 'other' ? '…' : entry.extension}</span>}
        </div>
      )}
      {dur && (
        <span className="absolute right-1 bottom-1 px-1 rounded bg-black/75 text-[9.5px] font-semibold text-white tabular-nums">{dur}</span>
      )}
    </div>
  );
}

export function GridCell(p: GridCellProps) {
  const { entry: f, geo, layout } = p;
  const t = TONES[p.tone];
  const info = getMediaInfo(f.fullPath);
  const tiles = layout === 'tiles';
  const state = p.selected
    ? t.sel
    : p.mismatch
    ? 'bg-red-500/15 ring-1 ring-inset ring-red-500/70 hover:bg-red-500/25'
    : 'hover:bg-[#272730]';
  const meta = [
    f.mediaType === 'video' ? formatDuration(info?.durationSec) : '',
    formatResolution(info),
    info?.fps ? `${Math.round(info.fps * 100) / 100}p` : '',
  ]
    .filter(Boolean)
    .join(' • ');

  const check = p.selectable && (
    <div
      data-row-check
      onClick={(e) => {
        e.stopPropagation();
        p.onCheck(e);
      }}
      className={`absolute left-1.5 top-1.5 z-[1] ${p.selected ? '' : 'opacity-0 group-hover:opacity-100'}`}
    >
      <input type="checkbox" checked={p.selected} onChange={() => {}} className={`${t.accent} cursor-pointer`} />
    </div>
  );

  return (
    <div
      {...p.rowProps}
      className={`group absolute rounded-md cursor-default ${state} ${p.focused ? t.focus : ''}`}
      style={{
        left: p.left,
        top: p.top,
        width: geo.cellW - 4,
        height: geo.cellH - 4,
      }}
      title={f.relativePath || f.name}
    >
      {check}
      <div
        data-drag-handle={p.canDrag ? '' : undefined}
        draggable={p.canDrag}
        onDragStart={p.onDragStart}
        className={`h-full ${tiles ? 'flex items-center gap-2 px-1.5' : 'flex flex-col items-center pt-1.5 px-1'} ${p.canDrag ? 'cursor-grab' : ''}`}
      >
        <Thumb entry={f} w={geo.thumbW} h={geo.thumbH} big={!tiles && geo.thumbW >= 120} />
        {tiles ? (
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[11.5px] font-semibold">{f.name}</div>
            <div className="truncate text-[10.5px] text-zinc-400">{f.isDirectory ? 'Folder' : meta || f.extension.toUpperCase()}</div>
            <div className="truncate text-[10.5px] text-zinc-500">
              {!f.isDirectory && formatBytes(f.sizeBytes)}
              {p.showDate && f.shotTimeMs > 0 && (
                <span className={p.mismatch ? 'ml-1.5 px-1 rounded bg-red-500 text-white font-bold' : 'ml-1.5'}>
                  {formatShortDate(f.shotTimeMs)}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="w-full mt-1 text-center leading-tight">
            <div className="text-[11px] font-medium break-all line-clamp-2">{f.name}</div>
            {p.mismatch && f.shotTimeMs > 0 && (
              <span className="inline-block mt-0.5 px-1 rounded bg-red-500 text-white text-[9.5px] font-bold">{formatShortDate(f.shotTimeMs)}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
