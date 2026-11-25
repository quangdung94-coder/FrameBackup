import type { ContextMenuItem } from '../components/layout/ContextMenu';
import type { FileMenuActions } from '../lib/fileMenu';
import { isDemoPath } from '../lib/paths';
import { parseGoogleDriveFolderId, type FileEntry } from '../types/framebackup';
import type { SharedWorkspace } from './shared';

export type WorkspaceColumnId = 'card' | 'd1' | 'd2';

export interface WorkspaceMenuParams {
  busy: boolean;
  cardPath: string;
  drive1View: string;
  drive2View: string;
  d2SelectedCount: number;
  shared: SharedWorkspace;
  navigateCard: (dir: string) => void;
  navigateDrive1: (dir: string) => void;
  navigateDrive2: (dir: string) => void;
  refreshCardSmart: (dir: string) => Promise<void>;
  refreshDrive1View: () => Promise<void>;
  refreshDrive2View: () => Promise<void>;
  onCopyCardToDrive1: (paths?: string[]) => void;
  onCopyDrive1ToDrive2: (paths?: string[]) => void;
  onUploadFromDrive2: (paths?: string[]) => void;
  onUploadOnly: () => void;
  copyToClip: (col: WorkspaceColumnId, paths: string[]) => void;
  pasteLabel: (col: WorkspaceColumnId) => { label: string; disabled: boolean };
  pasteInto: (col: WorkspaceColumnId) => void;
  openNewFolder: (col: WorkspaceColumnId) => void;
  openRename: (col: WorkspaceColumnId, file: FileEntry) => void;
  openProperties: (fullPath: string) => void;
}

/** Tạo toàn bộ menu chuột phải (tệp/thư mục + cột Google Drive) cho 1 khu vực thẻ. */
export function createWorkspaceMenus(p: WorkspaceMenuParams) {
  const { shared, busy } = p;
  const { showToast } = shared;

  const copyPathsToClipboard = (paths: string[]) => {
    void navigator.clipboard
      .writeText(paths.join('\n'))
      .then(() => showToast(paths.length > 1 ? `Đã sao chép ${paths.length} đường dẫn.` : 'Đã sao chép đường dẫn.'))
      .catch(() => showToast('Không sao chép được vào clipboard.'));
  };

  const openEntry = (file: FileEntry, navigate: (dir: string) => void) => {
    if (file.isDirectory) {
      navigate(file.fullPath);
      return;
    }
    if (!window.frameBackup || isDemoPath(file.fullPath)) return;
    void window.frameBackup.openPath(file.fullPath).then((r) => {
      if (!r.ok) showToast(`Không mở được file: ${r.message}`);
    });
  };

  const revealEntry = (fullPath: string) => {
    if (!window.frameBackup || isDemoPath(fullPath)) return;
    void window.frameBackup.showInFolder(fullPath);
  };

  const cardMenuActions: Omit<FileMenuActions, 'selectAll' | 'clear'> = {
    open: (f) => openEntry(f, p.navigateCard),
    reveal: revealEntry,
    currentDir: isDemoPath(p.cardPath) ? undefined : p.cardPath || undefined,
    refresh: p.cardPath && !isDemoPath(p.cardPath) ? () => void p.refreshCardSmart(p.cardPath) : undefined,
    transfer: {
      label: (n) => `Copy ${n} item${n > 1 ? 's' : ''} to Drive 1 (verify XXHash64)`,
      run: p.onCopyCardToDrive1,
      disabled: busy,
    },
    copyPaths: copyPathsToClipboard,
    copyItems: (paths) => p.copyToClip('card', paths),
    properties: isDemoPath(p.cardPath) ? undefined : p.openProperties,
  };

  const drive1MenuActions: Omit<FileMenuActions, 'selectAll' | 'clear'> = {
    open: (f) => openEntry(f, p.navigateDrive1),
    reveal: revealEntry,
    currentDir: p.drive1View || undefined,
    refresh: p.drive1View ? () => void p.refreshDrive1View() : undefined,
    transfer: {
      label: (n) => `Back up ${n} item${n > 1 ? 's' : ''} to Drive 2 (verify XXHash64)`,
      run: p.onCopyDrive1ToDrive2,
      disabled: busy || !p.drive2View,
    },
    copyPaths: copyPathsToClipboard,
    copyItems: (paths) => p.copyToClip('d1', paths),
    paste: { ...p.pasteLabel('d1'), run: () => p.pasteInto('d1') },
    newFolder: p.drive1View ? () => p.openNewFolder('d1') : undefined,
    rename: (f) => p.openRename('d1', f),
    properties: p.openProperties,
  };

  const drive2MenuActions: Omit<FileMenuActions, 'selectAll' | 'clear'> = {
    open: (f) => openEntry(f, p.navigateDrive2),
    reveal: revealEntry,
    currentDir: p.drive2View || undefined,
    refresh: p.drive2View ? () => void p.refreshDrive2View() : undefined,
    transfer: {
      label: (n) => `Upload ${n} item${n > 1 ? 's' : ''} to Google Drive`,
      run: p.onUploadFromDrive2,
      disabled: busy || !shared.driveAuth.signedIn || !parseGoogleDriveFolderId(shared.driveLink),
    },
    copyPaths: copyPathsToClipboard,
    copyItems: (paths) => p.copyToClip('d2', paths),
    paste: { ...p.pasteLabel('d2'), run: () => p.pasteInto('d2') },
    newFolder: p.drive2View ? () => p.openNewFolder('d2') : undefined,
    rename: (f) => p.openRename('d2', f),
    properties: p.openProperties,
  };

  const buildDriveColumnMenu = (): ContextMenuItem[] => {
    const api = window.frameBackup;
    const link = shared.driveLink.trim();
    const signedIn = shared.driveAuth.signedIn;
    return [
      { label: 'Refresh', hint: 'F5', disabled: !link || !signedIn, onSelect: () => void shared.checkDriveLink(link, false) },
      { label: 'Open folder in browser', disabled: !link, onSelect: () => void api?.openExternalUrl(link) },
      {
        label: 'Copy folder link',
        disabled: !link,
        onSelect: () => void navigator.clipboard?.writeText(link).then(() => showToast('Đã sao chép link thư mục Drive.')),
      },
      { label: 'Check access', disabled: !link || !signedIn, onSelect: () => void shared.checkDriveLink() },
      { label: 'Choose Drive folder…', disabled: !signedIn, onSelect: () => void shared.pickDriveFolder() },
      {
        label: 'Upload Drive 1 folder',
        separatorBefore: true,
        disabled: busy || !signedIn || !link || !p.drive1View,
        onSelect: p.onUploadOnly,
      },
      {
        label: p.d2SelectedCount > 0 ? `Upload ${p.d2SelectedCount} selected from Drive 2` : 'Upload Drive 2 folder',
        disabled: busy || !signedIn || !link || !p.drive2View,
        onSelect: () => p.onUploadFromDrive2(),
      },
      { label: signedIn ? 'Switch Google account' : 'Sign in to Google', separatorBefore: true, onSelect: shared.openDriveAuth },
      {
        label: 'Sign out',
        disabled: !signedIn,
        onSelect: () =>
          void api?.signOutGoogleDrive().then(() => {
            showToast('Đã đăng xuất Google Drive.');
            void shared.reloadSystem();
          }),
      },
    ];
  };

  return { cardMenuActions, drive1MenuActions, drive2MenuActions, buildDriveColumnMenu };
}
