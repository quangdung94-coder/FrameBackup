import { HardDrive } from 'lucide-react';
import { useCallback, useEffect, type ReactNode } from 'react';
import type { ListCommand } from '../../hooks/useExplorerList';
import { useFilePane, usePaneUi } from '../../hooks/useFilePane';
import type { FolderNav } from '../../hooks/useFolderNav';
import { useTreePref } from '../../hooks/useTreePref';
import { useRowSelection } from '../../hooks/useRowSelection';
import type { DragType } from '../../lib/dragData';
import { buildFileMenu, type FileMenuActions } from '../../lib/fileMenu';
import { formatBytes, type DriveInfo, type FileEntry } from '../../types/framebackup';
import { FilePaneView } from '../files/FilePaneView';
import { FolderTree } from '../files/FolderTree';
import { NavToolbar } from '../files/NavToolbar';
import { ColumnFooter, ColumnHeader, DropOverlay, DriveUsageRow, EmptyState } from '../layout/ColumnParts';

interface DriveColumnProps {
  index: 2 | 3;
  style: React.CSSProperties;
  expanded: boolean;
  onToggleExpand: () => void;
  /** Thư mục đang mở + lịch sử Lùi / Tiến / Lên. */
  nav: FolderNav;
  drives: DriveInfo[];
  files: FileEntry[];
  driveInfo: DriveInfo | undefined;
  insufficient: boolean;
  isDragOver: boolean;
  dragCount: number;
  dropHandlers: Pick<React.HTMLAttributes<HTMLElement>, 'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'>;
  onRefresh: () => void;
  onPickFolder: () => void;
  /** Phím tắt Ctrl+C / Ctrl+V / Ctrl+Shift+N / F2 / Alt+Enter. */
  onCommand: (cmd: ListCommand, targets: string[], focused: FileEntry | null) => void;
  menuActions: Omit<FileMenuActions, 'selectAll' | 'clear'>;
  /** Báo vùng chọn lên khu vực thẻ (dùng cho nút ➔ và kéo thả). */
  onSelectedChange?: (selected: Set<string>) => void;
  /** Kéo file từ cột này sang cột kế (chỉ Ổ 1). */
  dragType?: DragType;
  /** Dải thông tin dưới thanh đường dẫn (đích chép, cảnh báo lồng thư mục...). */
  infoStrip?: ReactNode;
  footerRight: ReactNode;
}

const listDir = (p: string) => window.frameBackup?.listDirectory(p) ?? Promise.resolve([]);
const scanDir = (p: string) => window.frameBackup?.scanRecursive(p) ?? Promise.resolve([]);

/** Cột 2 (Ổ 1 – Làm việc) và Cột 3 (Ổ 2 – Sao lưu): duyệt kiểu Explorer, cây / phẳng, nhận file thả vào. */
export function DriveColumn(props: DriveColumnProps) {
  const { index, nav, files } = props;
  const path = nav.path;
  const isD1 = index === 2;
  const [treePref, setTreePref] = useTreePref(isD1 ? 'fb_pane_d1' : 'fb_pane_d2');
  const showTree = treePref ?? props.expanded;
  const ui = usePaneUi(isD1 ? 'fb_pane_d1' : 'fb_pane_d2', 'tree');
  const loadChildren = useCallback((p: string) => listDir(p), []);
  const loadFlat = useCallback((p: string) => scanDir(p), []);
  const pane = useFilePane({
    kind: 'lazy',
    items: files,
    mode: ui.mode,
    query: ui.query,
    sort: ui.sort,
    rootPath: path,
    loadChildren,
    loadFlat,
  });
  const selection = useRowSelection(pane.visibleItems);
  const { onSelectedChange } = props;

  // Đổi thư mục đang xem => bỏ chọn (giống Explorer)
  useEffect(() => {
    selection.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  useEffect(() => {
    onSelectedChange?.(selection.selected);
  }, [selection.selected, onSelectedChange]);

  const tone = isD1 ? 'blue' : 'emerald';
  const selectedCount = selection.selected.size;
  const fileCount = files.filter((f) => !f.isDirectory).length;

  return (
    <section
      {...props.dropHandlers}
      onMouseUp={(e) => {
        // Nút Back / Forward bên hông chuột
        if (e.button === 3) nav.back();
        else if (e.button === 4) nav.forward();
      }}
      style={props.style}
      className={`relative flex flex-col min-w-[160px] bg-[#18181c] border rounded-lg overflow-hidden ${
        props.isDragOver
          ? `border-2 ${isD1 ? 'border-blue-400 ring-blue-500/40' : 'border-emerald-400 ring-emerald-500/40'} ring-2`
          : props.expanded
          ? isD1
            ? 'border-blue-500'
            : 'border-emerald-500'
          : props.insufficient
          ? 'border-red-500'
          : 'border-[#2b2b34]'
      }`}
    >
      {props.isDragOver && (
        <DropOverlay
          tone={tone}
          title={isD1 ? `Thả vào đây để Copy ${props.dragCount || 1} file sang Ổ 1` : `Thả vào đây để Sao lưu ${props.dragCount || 1} mục sang Ổ 2`}
        />
      )}
      <ColumnHeader
        index={index}
        title={isD1 ? 'Ổ 1 (LÀM VIỆC)' : 'Ổ 2 (SAO LƯU)'}
        tone={tone}
        expanded={props.expanded}
        onToggleExpand={props.onToggleExpand}
      >
        <DriveUsageRow
          tone={tone}
          insufficient={props.insufficient}
          usedPercent={props.driveInfo?.usedPercent ?? 0}
          text={
            props.driveInfo
              ? props.insufficient
                ? `⚠️ Thiếu chỗ! Trống ${formatBytes(props.driveInfo.freeBytes)}`
                : `${props.driveInfo.label} • Trống ${formatBytes(props.driveInfo.freeBytes)}`
              : isD1
              ? 'Chọn thư mục Ổ 1 (NVMe/SSD)'
              : 'Chọn thư mục Ổ 2 (HDD/SSD Backup)'
          }
        />
      </ColumnHeader>

      <NavToolbar
        nav={nav}
        drives={props.drives}
        treeOpen={showTree}
        onToggleTree={() => setTreePref(!showTree)}
        onRefresh={props.onRefresh}
        onPickFolder={props.onPickFolder}
        placeholder={isD1 ? 'Chọn thư mục Ổ 1 (vd. J:\\01_Project video)' : 'Chọn thư mục Ổ 2 (vd. F:\\Backup)'}
      />

      {props.infoStrip}

      <div className="flex-1 min-h-0 flex">
        {showTree && (
          <div className="w-[38%] max-w-[230px] min-w-[120px] border-r border-[#2b2b34] bg-[#16161b] shrink-0">
            <FolderTree currentPath={path} drives={props.drives} onNavigate={nav.go} />
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
        onOpen={props.menuActions.open}
        onGoUp={nav.canUp ? nav.up : undefined}
        onCommand={(cmd, targets, focused) => {
          if (cmd === 'back') nav.back();
          else if (cmd === 'forward') nav.forward();
          else if (cmd === 'refresh') props.onRefresh();
          else props.onCommand(cmd, targets, focused);
        }}
        buildMenu={(targets, file) =>
          buildFileMenu(targets, file, { ...props.menuActions, selectAll: selection.selectAll, clear: selection.clear })
        }
        tone={isD1 ? 'emerald' : 'teal'}
        dragType={props.dragType}
        nameHeader={isD1 ? 'Tên (Kéo sang Ổ 2)' : 'Tên'}
        flatLoading={pane.flatLoading}
        empty={
          <EmptyState
            icon={HardDrive}
            title={path ? 'Thư mục trống' : isD1 ? 'Chưa chọn thư mục Ổ 1' : 'Chưa chọn thư mục Ổ 2'}
            hint={path ? 'Chuột phải để Dán hoặc tạo Thư mục mới' : 'Chọn ổ ở nút 💻 › trên thanh địa chỉ hoặc mở cây thư mục'}
          />
        }
      />
        </div>
      </div>

      <ColumnFooter>
        <span>
          {selectedCount > 0 ? (
            <strong className={isD1 ? 'text-emerald-300' : 'text-teal-300'}>Đã chọn: {selectedCount} mục</strong>
          ) : (
            `${files.length} mục${fileCount !== files.length ? ` (${fileCount} file)` : ''}`
          )}
        </span>
        {props.footerRight}
      </ColumnFooter>
    </section>
  );
}
