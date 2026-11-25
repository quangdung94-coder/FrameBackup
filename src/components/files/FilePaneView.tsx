import { ChevronDown, ChevronRight, ListTree, List, Loader2, Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ContextMenuItem } from '../layout/ContextMenu';
import { useExplorerList, type ListCommand } from '../../hooks/useExplorerList';
import type { PaneMode, PaneRow, SortKey, SortState } from '../../hooks/useFilePane';
import type { RowSelection } from '../../hooks/useRowSelection';
import { writeDragPaths, type DragType } from '../../lib/dragData';
import { formatBytes, formatShortDate, type FileEntry } from '../../types/framebackup';
import { FileIcon } from '../FileIcon';

export const ROW_H = 26;
const HEADER_H = 26;
const OVERSCAN = 10;

type Tone = 'blue' | 'emerald' | 'teal';

const TONES: Record<Tone, { sel: string; focus: string; accent: string; seg: string }> = {
  blue: {
    sel: 'bg-blue-600/35 text-white shadow-[inset_4px_0_0_#60a5fa]',
    focus: 'outline outline-1 -outline-offset-1 outline-blue-300/50',
    accent: 'accent-blue-500',
    seg: 'bg-blue-600/30 text-blue-100 border-blue-400/60',
  },
  emerald: {
    sel: 'bg-emerald-600/35 text-white shadow-[inset_4px_0_0_#34d399]',
    focus: 'outline outline-1 -outline-offset-1 outline-emerald-300/50',
    accent: 'accent-emerald-500',
    seg: 'bg-emerald-600/30 text-emerald-100 border-emerald-400/60',
  },
  teal: {
    sel: 'bg-teal-600/35 text-white shadow-[inset_4px_0_0_#2dd4bf]',
    focus: 'outline outline-1 -outline-offset-1 outline-teal-300/50',
    accent: 'accent-teal-500',
    seg: 'bg-teal-600/30 text-teal-100 border-teal-400/60',
  },
};

interface FilePaneViewProps {
  rows: PaneRow[];
  visibleItems: FileEntry[];
  selection: RowSelection;
  onToggleExpand: (entry: FileEntry) => void;
  mode: PaneMode;
  onModeChange: (mode: PaneMode) => void;
  query: string;
  onQueryChange: (q: string) => void;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  /** Double-click / Enter. */
  onOpen: (file: FileEntry) => void;
  onGoUp?: () => void;
  buildMenu: (targets: string[], file: FileEntry | null) => ContextMenuItem[];
  tone: Tone;
  showDate?: boolean;
  /** Tô đỏ dòng lệch ngày quay (cột Thẻ). */
  isMismatch?: (f: FileEntry) => boolean;
  /** Dòng có ô chọn (Thẻ: chỉ file). */
  isSelectable?: (f: FileEntry) => boolean;
  dragType?: DragType;
  nameHeader: string;
  busy?: ReactNode;
  empty?: ReactNode;
  flatLoading?: boolean;
  /** Ghi chú nhỏ cạnh ô tìm (vd. "12 file"). */
  countLabel?: string;
  onCommand?: (cmd: ListCommand, targets: string[], focused: FileEntry | null) => void;
}

/**
 * Danh sách file kiểu Explorer dùng chung cho Thẻ / Ổ 1 / Ổ 2:
 * Cây thư mục hoặc Phẳng, bấm tiêu đề để sắp xếp, ô tìm, chỉ vẽ các dòng đang thấy (mượt với hàng nghìn file).
 */
export function FilePaneView(props: FilePaneViewProps) {
  const { rows, visibleItems, selection, sort, tone } = props;
  const t = TONES[tone];
  const isSelectable = props.isSelectable ?? (() => true);
  const list = useExplorerList({
    items: visibleItems,
    selection,
    onOpen: props.onOpen,
    onGoUp: props.onGoUp,
    buildMenu: props.buildMenu,
    rowHeight: ROW_H,
    headerHeight: HEADER_H,
    onCommand: props.onCommand,
  });

  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const rafRef = useRef(0);

  useEffect(() => {
    const el = list.containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        setScrollTop(el.scrollTop);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [list.containerRef]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);
  const cols = props.showDate ? '24px minmax(0,1fr) 70px 82px' : '24px minmax(0,1fr) 74px';

  const sortBy = (key: SortKey) => props.onSortChange(sort.key === key ? { key, asc: !sort.asc } : { key, asc: key === 'name' });
  const arrow = (key: SortKey) => (sort.key === key ? (sort.asc ? ' ▲' : ' ▼') : '');

  const content =
    props.busy ??
    (rows.length === 0 ? (
      props.flatLoading ? (
        <div className="h-full flex items-center justify-center gap-2 text-xs text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Đang quét các thư mục con...
        </div>
      ) : (
        props.empty
      )
    ) : null);

  return (
    <>
      <div className="px-2 py-1 bg-[#16161b] border-b border-[#2b2b34] flex items-center gap-1.5 shrink-0">
        <div className="inline-flex rounded border border-[#2e2e38] overflow-hidden shrink-0">
          <button
            onClick={() => props.onModeChange('tree')}
            className={`px-1.5 py-0.5 text-[10.5px] inline-flex items-center gap-1 border-r border-[#2e2e38] ${
              props.mode === 'tree' ? t.seg : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title="Cây thư mục: mở từng cấp như Explorer"
          >
            <ListTree className="w-3 h-3" /> Cây
          </button>
          <button
            onClick={() => props.onModeChange('flat')}
            className={`px-1.5 py-0.5 text-[10.5px] inline-flex items-center gap-1 ${
              props.mode === 'flat' ? t.seg : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title="Phẳng: mọi file trong các thư mục con"
          >
            <List className="w-3 h-3" /> Phẳng
          </button>
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-1 bg-[#101013] border border-[#2b2b34] rounded px-1.5">
          <Search className="w-3 h-3 text-zinc-500 shrink-0" />
          <input
            value={props.query}
            onChange={(e) => props.onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') props.onQueryChange('');
              e.stopPropagation();
            }}
            placeholder="Tìm tên file..."
            className="flex-1 min-w-0 bg-transparent py-0.5 text-[11px] text-zinc-100 outline-none"
          />
          {props.query && (
            <button onClick={() => props.onQueryChange('')} className="text-zinc-500 hover:text-zinc-200" title="Xoá tìm kiếm">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {props.countLabel && <span className="text-[10px] text-zinc-500 shrink-0">{props.countLabel}</span>}
      </div>

      <div {...list.containerProps} className="relative flex-1 overflow-auto outline-none select-none" style={{ contain: 'content' }}>
        {list.overlays}
        <div
          data-pane-header
          className="sticky top-0 z-10 grid items-center bg-[#202026] text-zinc-400 text-[10.5px] font-semibold border-b border-[#2b2b34]"
          style={{ gridTemplateColumns: cols, height: HEADER_H }}
        >
          <div className="pl-2">
            <input
              type="checkbox"
              checked={selection.allSelected()}
              onChange={selection.toggleSelectAll}
              className={`${t.accent} cursor-pointer`}
              title="Chọn tất cả / Bỏ chọn tất cả"
            />
          </div>
          <button className="text-left px-1.5 truncate hover:text-zinc-200" onClick={() => sortBy('name')}>
            {props.nameHeader}
            {arrow('name')}
          </button>
          <button className="text-right px-2 hover:text-zinc-200" onClick={() => sortBy('size')}>
            Size{arrow('size')}
          </button>
          {props.showDate && (
            <button className="text-right px-2 hover:text-zinc-200" onClick={() => sortBy('date')}>
              Ngày gốc{arrow('date')}
            </button>
          )}
        </div>

        {content ? (
          <div className="absolute inset-x-0 bottom-0" style={{ top: HEADER_H }}>
            {content}
          </div>
        ) : (
          <div className="relative" style={{ height: rows.length * ROW_H }}>
            {rows.slice(first, last).map((row, k) => {
              const idx = first + k;
              const f = row.entry;
              const isSelected = selection.selected.has(f.fullPath);
              const isFocused = selection.focusIndex === idx;
              const mismatch = !isSelected && props.isMismatch?.(f);
              const selectable = isSelectable(f);
              // Giống Explorer: kéo tên file ĐÃ CHỌN = kéo file sang cột khác; dòng chưa chọn = quét chọn.
              const canDrag = Boolean(props.dragType) && selectable && isSelected;
              return (
                <div
                  key={f.fullPath}
                  {...list.rowProps(idx, f)}
                  className={`absolute inset-x-0 grid items-center text-[11.5px] border-b border-white/[0.03] cursor-default ${
                    isFocused ? `${t.focus} ` : ''
                  }${
                    isSelected
                      ? t.sel
                      : mismatch
                      ? 'bg-red-500/15 hover:bg-red-500/25 text-red-200 shadow-[inset_2px_0_0_#ef4444]'
                      : 'hover:bg-[#272730]'
                  }`}
                  style={{ gridTemplateColumns: cols, height: ROW_H, transform: `translateY(${idx * ROW_H}px)` }}
                >
                  <div
                    data-row-check
                    className="pl-2 h-full flex items-center"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (list.isClickSuppressed()) return;
                      selection.toggleOne(idx, f, e);
                    }}
                  >
                    {selectable && (
                      <input type="checkbox" checked={isSelected} onChange={() => {}} className={`${t.accent} cursor-pointer`} />
                    )}
                  </div>
                  <div className="min-w-0 flex items-center px-1.5" style={{ paddingLeft: 6 + row.depth * 14 }}>
                    {row.expandable ? (
                      <button
                        className="w-4 h-4 -ml-1 mr-0.5 flex items-center justify-center text-zinc-400 hover:text-zinc-100 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onToggleExpand(f);
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        title={row.expanded ? 'Thu gọn' : 'Mở thư mục con'}
                      >
                        {row.loading ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : row.expanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                    ) : (
                      row.depth > 0 && <span className="w-4 shrink-0" />
                    )}
                    <div
                      data-drag-handle={canDrag ? '' : undefined}
                      draggable={canDrag}
                      onDragStart={(e) => {
                        if (!props.dragType || !selectable) return;
                        writeDragPaths(e.dataTransfer, props.dragType, selection.beginDrag(f));
                      }}
                      className={`inline-flex min-w-0 max-w-full items-center gap-1.5 ${canDrag ? 'cursor-grab' : ''}`}
                      title={f.relativePath || f.name}
                    >
                      <FileIcon type={f.isDirectory ? 'folder' : f.mediaType} />
                      <span className="truncate font-medium">{f.name}</span>
                    </div>
                  </div>
                  <div className="px-2 text-right whitespace-nowrap text-zinc-400 tabular-nums">
                    {f.isDirectory ? (f.sizeBytes > 0 ? formatBytes(f.sizeBytes) : 'Folder') : formatBytes(f.sizeBytes)}
                  </div>
                  {props.showDate && (
                    <div className="px-2 text-right whitespace-nowrap" title={`Nguồn ngày: ${f.dateSource}`}>
                      {f.shotTimeMs > 0 &&
                        (props.isMismatch?.(f) ? (
                          <span className="px-1 py-px rounded bg-red-500 text-white text-[10px] font-bold">{formatShortDate(f.shotTimeMs)}</span>
                        ) : (
                          <span className="text-zinc-400">{formatShortDate(f.shotTimeMs)}</span>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
