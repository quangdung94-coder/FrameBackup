import { ChevronDown, ChevronRight, LayoutGrid, ListTree, List, Loader2, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ContextMenuItem } from '../layout/ContextMenu';
import { useExplorerList, type ListCommand } from '../../hooks/useExplorerList';
import { ICON_MAX, ICON_MIN, type PaneGroup, type PaneMode, type PaneRow, type SortKey, type SortState, type ViewPrefs } from '../../hooks/useFilePane';
import { computePaneLayout, GROUP_H, hitTest, visibleRange } from '../../lib/paneLayout';
import { PreviewPane } from './PreviewPane';
import { openContextMenuAt } from '../../lib/globalMenu';
import { formatDuration, getMediaInfo, requestMediaInfo, useMediaVersion } from '../../lib/mediaStore';
import { buildViewMenu } from '../../lib/viewMenu';
import { GridCell, gridGeometry } from './GridCell';
import type { RowSelection } from '../../hooks/useRowSelection';
import { writeDragPaths, type DragType } from '../../lib/dragData';
import { formatBytes, formatShortDate, type FileEntry } from '../../types/framebackup';
import { FileIcon } from '../FileIcon';

export const ROW_H = 26;
const HEADER_H = 26;
const OVERSCAN = 10;

export type Tone = 'blue' | 'emerald' | 'teal';

export const TONES: Record<Tone, { sel: string; focus: string; accent: string; seg: string }> = {
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
  /** v1.4 kiểu xem (Chi tiết / Danh sách / Ô / Biểu tượng). */
  view: ViewPrefs;
  onViewChange: (patch: Partial<ViewPrefs>) => void;
  /** Nhóm (theo ngày / loại / máy quay) — dòng đã xếp theo nhóm. */
  groups?: PaneGroup[];
  /** Lọc theo máy quay. */
  cameraFilter?: string;
  onCameraFilterChange?: (model: string) => void;
}

/**
 * Danh sách file kiểu Explorer dùng chung cho Thẻ / Ổ 1 / Ổ 2:
 * Cây thư mục hoặc Phẳng, bấm tiêu đề để sắp xếp, ô tìm, chỉ vẽ các dòng đang thấy (mượt với hàng nghìn file).
 */
export function FilePaneView(props: FilePaneViewProps) {
  const { rows, visibleItems, selection, sort, tone, view } = props;
  const t = TONES[tone];
  const isSelectable = props.isSelectable ?? (() => true);
  const layout = view.layout;
  const isGrid = layout === 'tiles' || layout === 'icons';
  const rowH = layout === 'list' ? 22 : ROW_H;

  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const [viewW, setViewW] = useState(400);
  const rafRef = useRef(0);

  const geo = gridGeometry(layout, view.iconSize, viewW);
  const cellH = isGrid ? geo.cellH : rowH;
  const groups = props.groups ?? [];
  const paneLayout = useMemo(
    () =>
      computePaneLayout(rows.length, groups, {
        grid: isGrid,
        cols: geo.cols,
        cellW: geo.cellW,
        cellH: geo.cellH,
        pad: geo.pad,
        rowH,
      }),
    [rows.length, groups, isGrid, geo.cols, geo.cellW, geo.cellH, geo.pad, rowH]
  );

  const list = useExplorerList({
    items: visibleItems,
    selection,
    onOpen: props.onOpen,
    onGoUp: props.onGoUp,
    buildMenu: (targets, file) => {
      const items = props.buildMenu(targets, file);
      if (file) return items;
      // Chuột phải vùng trống: thêm "View" như Explorer
      return [
        ...items,
        {
          label: 'View…',
          separatorBefore: true,
          onSelect: () => openContextMenuAt(lastMenuPos.current.x, lastMenuPos.current.y, viewMenu()),
        },
      ];
    },
    rowHeight: cellH,
    headerHeight: HEADER_H,
    onCommand: props.onCommand,
    cols: isGrid ? geo.cols : 1,
    cellWidth: isGrid ? geo.cellW : 0,
    gridPad: isGrid ? geo.pad : 0,
    model: {
      top: (i) => paneLayout.tops[i] ?? 0,
      height: paneLayout.itemH,
      hit: (box) => hitTest(paneLayout, box, HEADER_H),
    },
  });
  const lastMenuPos = useRef({ x: 0, y: 0 });

  // Danh sách máy quay trong cột (giữ nguyên khi đang lọc, để còn chọn máy khác)
  const mediaVersion = useMediaVersion();
  const cameraCache = useRef<{ list: Array<[string, number]>; pending: boolean }>({ list: [], pending: false });
  const cameraList = useMemo(() => {
    if (props.cameraFilter) return cameraCache.current;
    const counts = new Map<string, number>();
    let pending = false;
    for (const f of visibleItems) {
      if (f.isDirectory || !(f.mediaType === 'video' || f.mediaType === 'photo' || f.mediaType === 'raw')) continue;
      const i = getMediaInfo(f.fullPath);
      if (!i) pending = true;
      else if (i.cameraModel) counts.set(i.cameraModel, (counts.get(i.cameraModel) ?? 0) + 1);
    }
    cameraCache.current = { list: Array.from(counts.entries()).sort((a, b) => b[1] - a[1]), pending };
    return cameraCache.current;
  }, [visibleItems, mediaVersion, props.cameraFilter]);
  const viewMenu = () => {
    // Mở menu View => đọc thông tin mọi file đang có (để biết các máy quay)
    requestMediaInfo(visibleItems);
    return buildViewMenu(
      view,
      props.onViewChange,
      sort,
      props.onSortChange,
      props.onCameraFilterChange
        ? {
            list: cameraList.list,
            active: props.cameraFilter ?? '',
            set: props.onCameraFilterChange,
            loading: cameraList.pending,
          }
        : undefined
    );
  };

  useEffect(() => {
    const el = list.containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewH(el.clientHeight);
      setViewW(el.clientWidth);
    });
    ro.observe(el);
    setViewH(el.clientHeight);
    setViewW(el.clientWidth);
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

  // Ctrl + cuộn chuột: đổi kiểu / cỡ biểu tượng như Explorer (Chi tiết ⇄ Danh sách ⇄ Ô ⇄ Biểu tượng nhỏ → lớn)
  const viewRef = useRef(view);
  viewRef.current = view;
  const onViewChangeRef = useRef(props.onViewChange);
  onViewChangeRef.current = props.onViewChange;
  useEffect(() => {
    const el = list.containerRef.current;
    if (!el) return;
    let lastStep = 0;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const now = performance.now();
      if (now - lastStep < 70) return;
      lastStep = now;
      const v = viewRef.current;
      const up = e.deltaY < 0;
      const set = onViewChangeRef.current;
      if (up) {
        if (v.layout === 'details') set({ layout: 'list' });
        else if (v.layout === 'list') set({ layout: 'tiles' });
        else if (v.layout === 'tiles') set({ layout: 'icons', iconSize: ICON_MIN });
        else set({ iconSize: Math.min(ICON_MAX, v.iconSize + 16) });
      } else if (v.layout === 'icons') {
        if (v.iconSize <= ICON_MIN) set({ layout: 'tiles' });
        else set({ iconSize: Math.max(ICON_MIN, v.iconSize - 16) });
      } else if (v.layout === 'tiles') set({ layout: 'list' });
      else if (v.layout === 'list') set({ layout: 'details' });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [list.containerRef]);

  // Vùng đang thấy (ảo hoá)
  const overscanPx = isGrid ? cellH * 2 : OVERSCAN * rowH;
  const [first, last] = visibleRange(paneLayout, scrollTop - overscanPx, scrollTop + viewH + overscanPx);
  void cellH;

  // Tiêu đề nhóm: bấm = chọn cả nhóm (như Explorer)
  const groupHeaders = paneLayout.headers
    .filter((h) => h.top + GROUP_H >= scrollTop - overscanPx && h.top <= scrollTop + viewH + overscanPx)
    .map(({ group: g, top }) => {
      const firstFile = rows.slice(g.start, g.start + g.count).find((r) => !r.entry.isDirectory)?.entry;
      const bad = Boolean(firstFile && props.view.groupBy === 'date' && props.isMismatch?.(firstFile));
      return (
        <button
          key={`g-${g.key}`}
          data-group-header
          onClick={() => {
            const idx = Array.from({ length: g.count }, (_, k) => g.start + k);
            selection.applyMarquee(idx, new Set());
          }}
          className={`absolute inset-x-0 flex items-center gap-2 px-2 text-left text-[11px] font-semibold border-b ${
            bad ? 'text-red-300 border-red-500/40 bg-red-500/10' : 'text-zinc-200 border-[#34343f] bg-[#1b1b21]'
          } hover:brightness-125`}
          style={{ top: top, height: GROUP_H }}
          title="Bấm để chọn cả nhóm"
        >
          <span>{bad ? `⚠ ${g.label} — lệch ngày` : g.label}</span>
          <span className="font-normal text-zinc-500">{g.count}</span>
          <span className="flex-1 border-t border-white/5" />
        </button>
      );
    });

  // Khung xem trước: mục đang chọn / đang focus
  const previewEntry =
    view.showPreview && !props.busy
      ? (selection.focusIndex !== null ? visibleItems[selection.focusIndex] : undefined) ??
        visibleItems.find((f) => selection.selected.has(f.fullPath)) ??
        null
      : null;

  // Thông tin clip (thời lượng...) chỉ cho các file đang thấy
  const showDurationCol = layout === 'details' && view.showDuration;
  const needInfo = showDurationCol || isGrid;
  useEffect(() => {
    if (!needInfo) return;
    requestMediaInfo(rows.slice(first, last).map((r) => r.entry));
  }, [needInfo, rows, first, last]);

  const cols =
    layout === 'list'
      ? '24px minmax(0,1fr)'
      : [
          '24px',
          'minmax(0,1fr)',
          showDurationCol ? '58px' : '',
          props.showDate ? '70px' : '74px',
          props.showDate ? '82px' : '',
        ]
          .filter(Boolean)
          .join(' ');

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

  const selectAllBox = (
    <input
      type="checkbox"
      checked={selection.allSelected()}
      onChange={selection.toggleSelectAll}
      className={`${t.accent} cursor-pointer`}
      title="Chọn tất cả / Bỏ chọn tất cả"
    />
  );

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
        <button
          data-view-button
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            openContextMenuAt(r.left, r.bottom + 2, viewMenu());
          }}
          className="shrink-0 px-1.5 py-0.5 rounded border border-[#2e2e38] text-[10.5px] inline-flex items-center gap-1 text-zinc-300 hover:text-white hover:bg-[#25252d]"
          title="View: Large icons / Tiles / List / Details, nhóm, lọc máy quay (Ctrl + cuộn chuột để đổi cỡ)"
        >
          <LayoutGrid className="w-3 h-3" /> View ▾
        </button>
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
        {props.cameraFilter && (
          <button
            onClick={() => props.onCameraFilterChange?.('')}
            className="shrink-0 max-w-[140px] truncate px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/50 text-amber-200 text-[10.5px]"
            title="Đang lọc theo máy quay — bấm để bỏ lọc"
          >
            📷 {props.cameraFilter} ✕
          </button>
        )}
        {props.countLabel && <span className="text-[10px] text-zinc-500 shrink-0">{props.countLabel}</span>}
      </div>

      <div
        {...list.containerProps}
        onContextMenuCapture={(e) => {
          lastMenuPos.current = { x: e.clientX, y: e.clientY };
        }}
        className="relative flex-1 overflow-y-auto overflow-x-hidden outline-none select-none"
        style={{ contain: 'content' }}
      >
        {list.overlays}
        {isGrid ? (
          <div
            data-pane-header
            className="sticky top-0 z-10 flex items-center gap-1 px-2 bg-[#202026] text-zinc-400 text-[10.5px] font-semibold border-b border-[#2b2b34]"
            style={{ height: HEADER_H }}
          >
            {selectAllBox}
            <span className="ml-1 mr-1 text-zinc-500 font-normal">Sort:</span>
            {(
              [
                ['name', 'Name'],
                ['date', 'Date'],
                ['size', 'Size'],
                ['duration', 'Duration'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => sortBy(k)}
                className={`px-1.5 py-px rounded hover:text-zinc-200 ${sort.key === k ? 'bg-white/10 text-zinc-100' : ''}`}
              >
                {label}
                {arrow(k)}
              </button>
            ))}
          </div>
        ) : (
          <div
            data-pane-header
            className="sticky top-0 z-10 grid items-center bg-[#202026] text-zinc-400 text-[10.5px] font-semibold border-b border-[#2b2b34]"
            style={{ gridTemplateColumns: cols, height: HEADER_H }}
          >
            <div className="pl-2">{selectAllBox}</div>
            <button className="text-left px-1.5 truncate hover:text-zinc-200" onClick={() => sortBy('name')}>
              {props.nameHeader}
              {arrow('name')}
            </button>
            {layout === 'details' && showDurationCol && (
              <button className="text-right px-2 hover:text-zinc-200" onClick={() => sortBy('duration')} title="Thời lượng clip">
                Duration{arrow('duration')}
              </button>
            )}
            {layout === 'details' && (
              <button className="text-right px-2 hover:text-zinc-200" onClick={() => sortBy('size')}>
                Size{arrow('size')}
              </button>
            )}
            {layout === 'details' && props.showDate && (
              <button className="text-right px-2 hover:text-zinc-200" onClick={() => sortBy('date')}>
                Ngày gốc{arrow('date')}
              </button>
            )}
          </div>
        )}

        {content ? (
          <div className="absolute inset-x-0 bottom-0" style={{ top: HEADER_H }}>
            {content}
          </div>
        ) : isGrid ? (
          <div className="relative" style={{ height: paneLayout.height }}>
            {groupHeaders}
            {rows.slice(first, last).map((row, k) => {
              const idx = first + k;
              const f = row.entry;
              const isSelected = selection.selected.has(f.fullPath);
              const selectable = isSelectable(f);
              return (
                <GridCell
                  key={f.fullPath}
                  entry={f}
                  layout={layout}
                  geo={geo}
                  left={paneLayout.lefts[idx]}
                  top={paneLayout.tops[idx]}
                  rowProps={list.rowProps(idx, f)}
                  selected={isSelected}
                  focused={selection.focusIndex === idx}
                  mismatch={!isSelected && Boolean(props.isMismatch?.(f))}
                  selectable={selectable}
                  canDrag={Boolean(props.dragType) && selectable && isSelected}
                  tone={tone}
                  showDate={props.showDate}
                  onCheck={(e) => {
                    if (list.isClickSuppressed()) return;
                    selection.toggleOne(idx, f, e);
                  }}
                  onDragStart={(e) => {
                    if (!props.dragType || !selectable) return;
                    writeDragPaths(e.dataTransfer, props.dragType, selection.beginDrag(f));
                  }}
                />
              );
            })}
          </div>
        ) : (
          <div className="relative" style={{ height: paneLayout.height }}>
            {groupHeaders}
            {rows.slice(first, last).map((row, k) => {
              const idx = first + k;
              const f = row.entry;
              const isSelected = selection.selected.has(f.fullPath);
              const isFocused = selection.focusIndex === idx;
              const mismatch = !isSelected && props.isMismatch?.(f);
              const selectable = isSelectable(f);
              // Giống Explorer: kéo tên file ĐÃ CHỌN = kéo file sang cột khác; dòng chưa chọn = quét chọn.
              const canDrag = Boolean(props.dragType) && selectable && isSelected;
              const dur = showDurationCol && f.mediaType === 'video' ? getMediaInfo(f.fullPath)?.durationSec : undefined;
              return (
                <div
                  key={f.fullPath}
                  {...list.rowProps(idx, f)}
                  className={`absolute inset-x-0 grid items-center ${layout === 'list' ? 'text-[11px]' : 'text-[11.5px]'} border-b border-white/[0.03] cursor-default ${
                    isFocused ? `${t.focus} ` : ''
                  }${
                    isSelected
                      ? t.sel
                      : mismatch
                      ? 'bg-red-500/15 hover:bg-red-500/25 text-red-200 shadow-[inset_2px_0_0_#ef4444]'
                      : 'hover:bg-[#272730]'
                  }`}
                  style={{ gridTemplateColumns: cols, height: rowH, transform: `translateY(${paneLayout.tops[idx]}px)` }}
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
                  {layout === 'details' && showDurationCol && (
                    <div className="px-2 text-right whitespace-nowrap text-zinc-400 tabular-nums">{formatDuration(dur)}</div>
                  )}
                  {layout === 'details' && (
                    <div className="px-2 text-right whitespace-nowrap text-zinc-400 tabular-nums">
                      {f.isDirectory ? (f.sizeBytes > 0 ? formatBytes(f.sizeBytes) : 'Folder') : formatBytes(f.sizeBytes)}
                    </div>
                  )}
                  {layout === 'details' && props.showDate && (
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
      {view.showPreview && (
        <PreviewPane
          entry={previewEntry}
          showDate={props.showDate}
          mismatch={Boolean(previewEntry && props.isMismatch?.(previewEntry))}
          onClose={() => props.onViewChange({ showPreview: false })}
        />
      )}
    </>
  );
}
