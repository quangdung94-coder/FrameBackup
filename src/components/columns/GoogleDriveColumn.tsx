import { Cloud, Link2, LogIn, RefreshCw } from 'lucide-react';
import { formatBytes, type DriveAuthStatus, type DriveFolderCheckResult } from '../../types/framebackup';
import { FileIcon, remoteFileMediaType } from '../FileIcon';
import { ColumnFooter, ColumnHeader, DropOverlay, InfoStrip, NavBar } from '../layout/ColumnParts';

interface GoogleDriveColumnProps {
  style: React.CSSProperties;
  expanded: boolean;
  onToggleExpand: () => void;
  driveAuth: DriveAuthStatus;
  driveLink: string;
  parsedFolderId: string | null;
  folderCheck: DriveFolderCheckResult | null;
  checkingLink: boolean;
  onOpenAuth: () => void;
  onDriveLinkChange: (value: string) => void;
  onCheckLink: () => void;
  /** Làm mới danh sách file trên Google Drive (F5). */
  onRefresh: () => void;
  picking?: boolean;
  /** Kéo thả file từ Ổ 2 sang cột Drive. */
  isDragOver?: boolean;
  dragCount?: number;
  dropHandlers?: Pick<React.HTMLAttributes<HTMLElement>, 'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'>;
  /** Chuột phải trong cột Drive. */
  onContextMenu?: (e: React.MouseEvent) => void;
}

function quotaFreeText(auth: DriveAuthStatus): string {
  return auth.quotaLimitBytes && auth.quotaUsageBytes !== undefined
    ? ` • Trống ${formatBytes(Math.max(0, auth.quotaLimitBytes - auth.quotaUsageBytes))}`
    : '';
}

/** Cột 4: Google Drive — link thư mục, kiểm tra quyền Editor, danh sách file trên Drive. */
export function GoogleDriveColumn({
  style,
  expanded,
  onToggleExpand,
  driveAuth,
  driveLink,
  parsedFolderId,
  folderCheck,
  checkingLink,
  onOpenAuth,
  onDriveLinkChange,
  onCheckLink,
  onRefresh,
  picking,
  isDragOver,
  dragCount = 0,
  dropHandlers,
  onContextMenu,
}: GoogleDriveColumnProps) {
  return (
    <section
      {...dropHandlers}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'F5') {
          e.preventDefault();
          if (driveAuth.signedIn && driveLink.trim() && !checkingLink) onRefresh();
        }
      }}
      onContextMenu={(e) => {
        // Ô nhập link giữ menu Cut / Copy / Paste của hệ thống
        if ((e.target as HTMLElement).closest('input, textarea')) return;
        onContextMenu?.(e);
      }}
      style={style}
      className={`relative flex flex-col min-w-[160px] bg-[#18181c] border rounded-lg overflow-hidden outline-none ${
        isDragOver
          ? 'border-2 border-purple-400 ring-2 ring-purple-500/40'
          : expanded
          ? 'border-purple-500'
          : 'border-[#2b2b34]'
      }`}
    >
      {isDragOver && (
        <DropOverlay
          tone="purple"
          title={`Thả vào đây để Up ${dragCount || 1} mục từ Ổ 2 lên Drive`}
          subtitle="Resumable Upload · 3 luồng · Tự động so MD5"
        />
      )}
      <ColumnHeader
        index={4}
        title="GOOGLE DRIVE"
        tone="purple"
        expanded={expanded}
        onToggleExpand={onToggleExpand}
        actions={
          <button
            onClick={onOpenAuth}
            className={`px-2 py-0.5 rounded text-[10.5px] font-semibold border transition ${
              driveAuth.signedIn
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                : 'bg-purple-600/25 border-purple-500/50 text-purple-200 hover:bg-purple-600/40'
            }`}
          >
            {driveAuth.signedIn ? '✓ Drive OK' : 'Đăng nhập Google'}
          </button>
        }
      >
        <div className="flex items-center justify-between text-[10.5px] text-zinc-400 gap-2">
          <span className="truncate">
            {driveAuth.signedIn ? `${driveAuth.email}${quotaFreeText(driveAuth)}` : 'Chưa đăng nhập Google Drive'}
          </span>
          {folderCheck && (
            <span
              className={
                folderCheck.canEdit
                  ? 'text-emerald-400 font-semibold shrink-0'
                  : folderCheck.needsPick
                  ? 'text-amber-400 font-semibold shrink-0'
                  : 'text-red-400 font-semibold shrink-0'
              }
            >
              {folderCheck.canEdit ? '✓ Editor' : folderCheck.needsPick ? '⚠ Chưa cấp quyền' : '✕ Chỉ xem'}
            </span>
          )}
        </div>
      </ColumnHeader>

      <NavBar>
        <div className="flex-1 min-w-0 flex items-center gap-1.5 bg-[#101013] border border-[#2b2b34] rounded px-2 py-1">
          <Link2 className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <input
            type="text"
            value={driveLink}
            onChange={(e) => onDriveLinkChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCheckLink();
            }}
            placeholder="Dán link thư mục Google Drive..."
            className="w-full bg-transparent text-[11px] text-zinc-100 outline-none"
          />
        </div>
        <button
          disabled={checkingLink || picking || (!driveLink.trim() && !driveAuth.signedIn)}
          onClick={onCheckLink}
          title="Kiểm tra quyền thư mục. App chưa có quyền ghi thì tự mở bảng chọn thư mục của Google (chọn 1 lần). Chưa dán link thì mở bảng chọn để chọn thư mục."
          className="px-2 py-1 rounded bg-purple-600/80 hover:bg-purple-500 disabled:opacity-40 text-white text-[11px] font-semibold shrink-0"
        >
          {checkingLink || picking ? '...' : 'Check'}
        </button>
        <button
          disabled={checkingLink || !driveAuth.signedIn || !driveLink.trim()}
          onClick={onRefresh}
          title="Làm mới danh sách file trên Google Drive (F5)"
          className="p-1.5 rounded bg-[#23232a] hover:bg-[#32323c] disabled:opacity-35 border border-[#3e3e4b] text-zinc-200 shrink-0 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${checkingLink ? 'animate-spin text-purple-300' : ''}`} />
        </button>
      </NavBar>
      {(folderCheck?.needsPick || picking) && (
        <div className="px-2 py-2 bg-amber-950/40 border-b border-amber-800/50 text-[11px] text-amber-100">
          {picking ? (
            <>Đang chờ anh chọn thư mục trong trình duyệt… Bấm <b>Chọn</b> trên bảng của Google.</>
          ) : (
            <>
              App chưa có quyền ghi vào thư mục này. Bấm <b>Check</b>: bảng chọn của Google mở ra đúng thư mục đó, bấm <b>Chọn</b> 1 lần là xong.
            </>
          )}
        </div>
      )}

      <InfoStrip>
        <span className="truncate">
          {folderCheck?.folderName
            ? `📁 ${folderCheck.folderName}`
            : parsedFolderId
            ? `ID: ${parsedFolderId}`
            : 'Resumable 32/64MB · 3 luồng'}
        </span>
        <span className="text-purple-300 shrink-0">+ Report & 2 Thumbs</span>
      </InfoStrip>

      <div className="flex-1 overflow-auto">
        {folderCheck && folderCheck.files.length > 0 ? (
          <table className="w-full text-left border-collapse text-[11.5px]">
            <thead className="sticky top-0 bg-[#202026] text-zinc-400 text-[10.5px]">
              <tr>
                <th className="py-1.5 px-2 font-semibold">File trên Drive</th>
                <th className="py-1.5 px-2 font-semibold">Size</th>
              </tr>
            </thead>
            <tbody>
              {folderCheck.files.map((rf) => (
                <tr key={rf.id} className="border-b border-white/[0.03] hover:bg-[#272730]">
                  <td className="py-1 px-2 max-w-[160px] truncate">
                    <div className="flex items-center gap-1.5">
                      <FileIcon type={remoteFileMediaType(rf)} />
                      <span className="truncate">{rf.name}</span>
                    </div>
                  </td>
                  <td className="py-1 px-2 text-zinc-400 whitespace-nowrap">
                    {rf.isFolder ? 'Folder' : formatBytes(rf.sizeBytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-3 space-y-2">
            {!driveAuth.signedIn && (
              <div className="p-3 rounded-lg bg-purple-600/10 border border-purple-500/40 space-y-2 text-[11.5px]">
                <div className="text-zinc-200 font-semibold">Bước 1: Đăng nhập Google (1 lần)</div>
                <div className="text-zinc-400">Bước 2: Dán link thư mục Drive vào ô phía trên là xong.</div>
                <button
                  onClick={onOpenAuth}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold"
                >
                  <LogIn className="w-4 h-4" /> Đăng nhập Google
                </button>
              </div>
            )}
            <div className="p-2.5 rounded-lg bg-[#141418] border border-[#2b2b34] space-y-1 text-[11.5px]">
              <div className="font-semibold text-purple-300 flex items-center gap-1.5">
                <Cloud className="w-4 h-4" /> Tự động tạo ngay đầu thư mục Drive:
              </div>
              <div className="text-zinc-300">• 📄 `_00_BACKUP_REPORT.txt`</div>
              <div className="text-zinc-300">• 🖼️ `_01_FIRST_SHOT_*.jpg`</div>
              <div className="text-zinc-300">• 🖼️ `_02_LAST_SHOT_*.jpg`</div>
            </div>
            {folderCheck?.error && (
              <div className="p-2.5 rounded-lg bg-red-500/15 border border-red-500/40 text-[11.5px] text-red-200">
                {folderCheck.error}
              </div>
            )}
          </div>
        )}
      </div>

      <ColumnFooter alignCenter>
        <span>{folderCheck ? `${folderCheck.files.length} mục trên Drive` : 'Chưa tải danh sách'}</span>
        <span className="text-purple-300/80 text-[10.5px]">32/64MB · 3 luồng</span>
      </ColumnFooter>
    </section>
  );
}
