import { FolderOpen, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import type { ListCommand } from '../../hooks/useExplorerList';
import { useFilePane, usePaneUi } from '../../hooks/useFilePane';
import type { FolderNav } from '../../hooks/useFolderNav';
import { useTreePref } from '../../hooks/useTreePref';
import { isFileNotFolder, useRowSelection } from '../../hooks/useRowSelection';
import { buildFileMenu, type FileMenuActions } from '../../lib/fileMenu';
import { DRAG_TYPES } from '../../lib/dragData';
import { isDemoPath } from '../../lib/paths';
import {
  formatBytes,
  isTimestampMatchingTargetDate,
  type DateFilterMode,
  type DriveInfo,
  type FileEntry,
} from '../../types/framebackup';
import { FilePaneView } from '../files/FilePaneView';
import { buildPathMenu, openContextMenu, type PathMenuActions } from '../../lib/globalMenu';
import { FolderTree } from '../files/FolderTree';
import { NavToolbar } from '../files/NavToolbar';
import { ColumnFooter, ColumnHeader, DriveUsageRow, EmptyState, NavBar } from '../layout/ColumnParts';

export type CardMode = 'ingest' | 'watch';

interface CardColumnProps {
  style: React.CSSProperties;
  expanded: boolean;
  onToggleExpand: () => void;
  /** Viền đỏ khi có cảnh báo lệch ngày. */
  alertBorder: boolean;
  cardPath: string;
  drives: DriveInfo[];
  driveInfo: DriveInfo | undefined;
  cardMode: CardMode;
  onToggleCardMode: () => void;
  dateFilterMode: DateFilterMode;
  allFilesCount: number;
  displayedFiles: FileEntry[];
  extensionCounts: [string, number][];
  quickExtFilter: string;
  onQuickExtFilter: (value: string) => void;
  scanning: boolean;
  /** Thẻ đã bị rút khỏi máy (danh sách giữ lại để xem). */
  cardRemoved?: boolean;
  /** Đang đọc ngày chụp ngầm (danh sách đã hiện). */
  shotDateProgress: { done: number; total: number } | null;
  /** Thư mục đang mở + Lùi / Tiến / Lên. */
  nav: FolderNav;
  /** Kèm XML theo video (mặc định tắt). */
  includeSidecarXml: boolean;
  onIncludeSidecarXml: (v: boolean) => void;
  onRefresh: () => void;
  onCommand: (cmd: ListCommand, targets: string[], focused: FileEntry | null) => void;
  /** Chuột phải trên ổ đĩa / cây thư mục / thanh địa chỉ. */
  pathActions?: PathMenuActions;
  /** Báo vùng chọn lên khu vực thẻ. */
  onSelectedChange: (selected: Set<string>) => void;
  /** Menu chuột phải / double-click / Enter (kiểu Explorer). */
  menuActions: Omit<FileMenuActions, 'selectAll' | 'clear'>;
  totalBytes: number;
  targetDate: string;
  overnightMode: boolean;
  onEject: () => void;
  /** Chọn ổ / thẻ từ dropdown (reset bộ lọc ngày). */
  onSelectSource: (value: string) => void;
  onPickFolder: () => void;
}

function chipClass(active: boolean, activeTone: 'blue' | 'amber', mono = false): string {
  const activeCls =
    activeTone === 'blue' ? 'bg-blue-600/30 border-blue-400 text-blue-200' : 'bg-amber-500/25 border-amber-400 text-amber-200';
  return `px-2 py-0.5 rounded text-[10px] ${mono ? 'font-mono ' : ''}font-semibold whitespace-nowrap border transition ${
    active ? activeCls : 'bg-[#202026] border-[#2e2e38] text-zinc-400 hover:text-zinc-200'
  }`;
}

/** Cột 1: Thẻ nhớ (Nguồn) — duyệt kiểu Explorer (cây / phẳng), lọc đuôi/ngày, chọn nhiều & kéo sang Ổ 1. */
export function CardColumn(props: CardColumnProps) {
  const { cardPath, drives, driveInfo, displayedFiles, targetDate, overnightMode, quickExtFilter, onQuickExtFilter } = props;
  // v1.3: mặc định xem phẳng (thấy hết file ngay, không phải mở từng thư mục DCIM / PRIVATE)
  const ui = usePaneUi('fb_pane_card_v13', 'flat', { key: 'name', asc: true });
  const { nav } = props;
  const isDemo = isDemoPath(cardPath);
  const [treePref, setTreePref] = useTreePref('fb_pane_card');
  const showTree = (treePref ?? props.expanded) && !isDemo;
  const hasXml = useMemo(() => props.extensionCounts.some(([ext]) => ext === '.xml'), [props.extensionCounts]);
  const pane = useFilePane({ kind: 'static', items: displayedFiles, mode: ui.mode, query: ui.query, sort: ui.sort, rootPath: cardPath, hideSidecar: ui.view.hideSidecar, groupBy: ui.view.groupBy, cameraFilter: ui.cameraFilter });
  const selection = useRowSelection(pane.visibleItems, isFileNotFolder);
  const { selected } = selection;
  const { onSelectedChange } = props;

  // Đổi thẻ / quét lại => bỏ chọn
  useEffect(() => {
    selection.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardPath, props.allFilesCount]);
  useEffect(() => {
    onSelectedChange(selected);
  }, [selected, onSelectedChange]);

  const selectedBytes = useMemo(() => {
    if (selected.size === 0) return 0;
    let sum = 0;
    for (const f of displayedFiles) if (selected.has(f.fullPath)) sum += f.sizeBytes;
    return sum;
  }, [displayedFiles, selected]);

  const canGoUp = nav.canUp && !isDemo;
  const fileCount = displayedFiles.filter((f) => !f.isDirectory).length;

  return (
    <section
      onMouseUp={(e) => {
        if (e.button === 3) nav.back();
        else if (e.button === 4) nav.forward();
      }}
      style={props.style}
      className={`flex flex-col min-w-[160px] bg-[#18181c] border rounded-lg overflow-hidden ${
        props.expanded ? 'border-blue-500' : props.alertBorder ? 'border-red-500/75' : 'border-[#2b2b34]'
      }`}
    >
      <ColumnHeader
        index={1}
        title="THẺ NHỚ (NGUỒN)"
        tone="amber"
        expanded={props.expanded}
        onToggleExpand={props.onToggleExpand}
        actions={
          cardPath && !isDemoPath(cardPath) ? (
            <button
              onClick={props.onEject}
              className="px-1.5 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-[10.5px] font-medium"
              title="Safe Eject thẻ nhớ"
            >
              ⏏ Eject
            </button>
          ) : (
            <></>
          )
        }
      >
        <div
          onContextMenu={(e) =>
            props.pathActions &&
            props.driveInfo &&
            openContextMenu(e, buildPathMenu(props.driveInfo.mountPath, 'drive', props.pathActions, { removable: props.driveInfo.isRemovable }))
          }
          title="Chuột phải: Open, New folder, Properties..."
        >
        <DriveUsageRow
          tone="amber"
          usedPercent={driveInfo?.usedPercent ?? 0}
          text={driveInfo ? `${driveInfo.label} • Trống ${formatBytes(driveInfo.freeBytes)}` : 'Chọn thẻ nhớ hoặc ổ nguồn'}
        />
        </div>
      </ColumnHeader>

      <NavBar>
        <select
          value={cardPath}
          onChange={(e) => props.onSelectSource(e.target.value)}
          className="flex-1 min-w-0 bg-[#101013] border border-[#2b2b34] rounded px-2 py-1 text-[11px] text-zinc-100 outline-none"
        >
          <option value="" className="bg-[#202024]">-- Chọn ổ / thẻ nhớ --</option>
          {drives.map((d) => (
            <option key={d.id} value={d.mountPath} className="bg-[#202024]">
              {d.isRemovable ? '💳 ' : '💿 '}
              {d.label} ({formatBytes(d.freeBytes)} trống)
            </option>
          ))}
          {cardPath && !drives.some((d) => d.mountPath === cardPath) && (
            <option value={cardPath} className="bg-[#202024]">{cardPath}</option>
          )}
        </select>
      </NavBar>
      <NavToolbar
        pathActions={props.pathActions}
        nav={nav}
        drives={drives}
        treeOpen={showTree}
        onToggleTree={() => setTreePref(!showTree)}
        onRefresh={props.onRefresh}
        onPickFolder={props.onPickFolder}
        placeholder="Chọn thẻ nhớ ở ô trên hoặc mở thư mục nguồn"
        disabled={isDemo}
      />

      <div className="px-2 py-1 bg-[#1b1b20] border-b border-[#2b2b34] flex items-center justify-between text-[10.5px] text-zinc-400">
        <button
          onClick={props.onToggleCardMode}
          className="hover:text-zinc-200"
          title="Bấm để đổi giữa App tự Ingest từ thẻ và Watch Mode canh Ổ 1"
        >
          Chế độ: <strong className="text-amber-300">{props.cardMode === 'ingest' ? 'App tự Ingest' : 'Watch Ổ 1'}</strong>
        </button>
        <span>
          {props.dateFilterMode === 'target-only'
            ? 'Đã lọc đúng ngày'
            : props.dateFilterMode === 'split'
            ? 'Tách theo ngày'
            : `${fileCount}/${props.allFilesCount} file`}
        </span>
      </div>
      {props.cardRemoved && (
        <div className="px-2 py-1 bg-amber-950/50 border-b border-amber-800/60 text-[10.5px] text-amber-200 shrink-0">
          ⏏ Thẻ đã được rút khỏi máy — danh sách giữ lại để xem, không chép được nữa. Cắm lại thẻ để chép tiếp.
        </div>
      )}
      {props.shotDateProgress && (
        <div
          className="px-2 py-0.5 bg-blue-950/40 border-b border-blue-900/50 flex items-center gap-1.5 text-[10.5px] text-blue-200 shrink-0"
          title="Danh sách đã dùng được ngay. App đang đọc ngày chụp (EXIF / MP4) phía sau để kiểm Date Guard; lần sau cắm lại thẻ này sẽ nhanh hơn."
        >
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          <span className="truncate">
            Đang đọc ngày chụp ngầm {props.shotDateProgress.done}/{props.shotDateProgress.total}
          </span>
          <div className="flex-1 h-1 rounded-full bg-blue-900/60 overflow-hidden min-w-[30px]">
            <div
              className="h-full bg-blue-400 transition-all"
              style={{ width: `${Math.round((props.shotDateProgress.done / Math.max(1, props.shotDateProgress.total)) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Lọc nhanh theo đuôi — mặc định Tất cả */}
      {props.extensionCounts.length > 0 && (
        <div className="px-2 py-1 bg-[#16161b] border-b border-[#2b2b34] flex items-center gap-1 overflow-x-auto shrink-0">
          <button onClick={() => onQuickExtFilter('all')} className={chipClass(quickExtFilter === 'all', 'blue')}>
            Tất cả ({props.allFilesCount})
          </button>
          <button
            onClick={() => onQuickExtFilter('preset')}
            className={chipClass(quickExtFilter === 'preset', 'blue')}
            title="Chỉ hiện (và chỉ chép) các đuôi file đã bật trong Lọc đuôi file"
          >
            Theo cài đặt
          </button>
          {props.extensionCounts.map(([ext, cnt]) => (
            <button key={ext} onClick={() => onQuickExtFilter(ext)} className={chipClass(quickExtFilter === ext, 'amber', true)}>
              {ext.replace('.', '').toUpperCase()} ({cnt})
            </button>
          ))}
        </div>
      )}
      {hasXml && (
        <label
          className="px-2 py-1 bg-[#16161b] border-b border-[#2b2b34] flex items-center gap-1.5 text-[10.5px] text-zinc-400 cursor-pointer hover:text-zinc-200 shrink-0"
          title="Sony / máy quay ghi kèm file C0001M01.XML (metadata) cho mỗi video. Bật để chép XML cùng video. Mặc định TẮT."
        >
          <input
            type="checkbox"
            checked={props.includeSidecarXml}
            onChange={(e) => props.onIncludeSidecarXml(e.target.checked)}
            className="accent-blue-500"
          />
          Kèm XML theo video (Sony M01.XML)
        </label>
      )}

      <div className="flex-1 min-h-0 flex">
        {showTree && (
          <div className="w-[38%] max-w-[230px] min-w-[120px] border-r border-[#2b2b34] bg-[#16161b] shrink-0">
            <FolderTree currentPath={cardPath} drives={drives} onNavigate={nav.go} pathActions={props.pathActions} />
          </div>
        )}
        <div className="flex-1 min-w-0 flex flex-col">
      <FilePaneView
        rows={pane.rows}
        visibleItems={pane.visibleItems}
        selection={selection}
        onToggleExpand={pane.toggleExpand}
        mode={ui.mode}
        onModeChange={ui.setMode}
        query={ui.query}
        onQueryChange={ui.setQuery}
        sort={ui.sort}
        onSortChange={ui.setSort}
        view={ui.view}
        onViewChange={ui.setView}
        groups={pane.groups}
        cameraFilter={ui.cameraFilter}
        onCameraFilterChange={ui.setCameraFilter}
        onOpen={props.menuActions.open}
        onGoUp={canGoUp ? nav.up : undefined}
        onCommand={(cmd, targets, focused) => {
          if (cmd === 'back') nav.back();
          else if (cmd === 'forward') nav.forward();
          else if (cmd === 'refresh') props.onRefresh();
          else props.onCommand(cmd, targets, focused);
        }}
        buildMenu={(targets, file) =>
          buildFileMenu(targets, file, { ...props.menuActions, selectAll: selection.selectAll, clear: selection.clear })
        }
        tone="blue"
        showDate
        isMismatch={(f) => !f.isDirectory && f.dateSource !== 'pending' && !isTimestampMatchingTargetDate(f.shotTimeMs, targetDate, overnightMode)}
        isSelectable={isFileNotFolder}
        dragType={DRAG_TYPES.cardFiles}
        nameHeader="File (Kéo sang Ổ 1)"
        busy={
          props.scanning ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-4 text-blue-300 gap-2">
              <RefreshCw className="w-6 h-6 animate-spin" />
              <div className="text-xs">Đang liệt kê file trên thẻ...</div>
            </div>
          ) : undefined
        }
        empty={
          <EmptyState
            icon={FolderOpen}
            title={cardPath ? 'Không có file nào khớp bộ lọc hiện tại' : 'Chưa chọn thẻ nhớ'}
            hint={<>Chọn thẻ nhớ, bấm &ldquo;Tất cả&rdquo; hoặc &ldquo;Test Lệch ngày&rdquo;</>}
          />
        }
      />
        </div>
      </div>

      <ColumnFooter>
        <span>
          {selected.size > 0 ? (
            <strong className="text-blue-300">
              Đã chọn: {selected.size} ({formatBytes(selectedBytes)})
            </strong>
          ) : (
            `${fileCount} file`
          )}
        </span>
        <span className="text-amber-300 font-medium">{formatBytes(props.totalBytes)}</span>
      </ColumnFooter>
    </section>
  );
}
