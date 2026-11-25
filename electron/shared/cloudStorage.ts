import type { DriveInfo } from './types';

export type CloudProvider = 'Google Drive' | 'OneDrive' | 'Dropbox' | 'iCloud Drive' | 'Box' | 'Cloud storage';

export interface CloudStorageHit {
  provider: CloudProvider;
  /** Gốc ổ ảo / thư mục đồng bộ (để chỉ cảnh báo 1 lần cho cùng 1 nơi). */
  rootKey: string;
}

const PATH_RULES: Array<[RegExp, CloudProvider]> = [
  [/[\\/]Library[\\/]CloudStorage[\\/]GoogleDrive/i, 'Google Drive'],
  [/^\/Volumes\/GoogleDrive/i, 'Google Drive'],
  [/[\\/]Library[\\/]CloudStorage[\\/]OneDrive/i, 'OneDrive'],
  [/[\\/]Library[\\/]CloudStorage[\\/]Dropbox/i, 'Dropbox'],
  [/[\\/]Library[\\/]CloudStorage[\\/]Box/i, 'Box'],
  [/[\\/]Library[\\/]Mobile Documents[\\/]com~apple~CloudDocs/i, 'iCloud Drive'],
  [/[\\/]Library[\\/]CloudStorage[\\/]/i, 'Cloud storage'],
  [/[\\/]iCloudDrive([\\/]|$)/i, 'iCloud Drive'],
  [/[\\/]OneDrive( - [^\\/]+)?([\\/]|$)/i, 'OneDrive'],
  [/[\\/]Dropbox( \([^\\/]+\))?([\\/]|$)/i, 'Dropbox'],
  [/^[A-Za-z]:[\\/](My Drive|Shared drives|Drive của tôi|Bộ nhớ dùng chung|Ổ đĩa dùng chung|Other computers)([\\/]|$)/i, 'Google Drive'],
];

const LABEL_RULES: Array<[RegExp, CloudProvider]> = [
  [/google\s*drive/i, 'Google Drive'],
  [/onedrive/i, 'OneDrive'],
  [/dropbox/i, 'Dropbox'],
  [/icloud/i, 'iCloud Drive'],
];

/** Thư mục có nằm trên ổ ảo / thư mục đồng bộ đám mây không (Google Drive for desktop, OneDrive, Dropbox, iCloud...). */
export function detectCloudStorage(dirPath: string, drives: DriveInfo[] = []): CloudStorageHit | null {
  if (!dirPath) return null;
  const n = dirPath.toLowerCase();
  const drive = drives.find((d) => d.mountPath && n.startsWith(d.mountPath.toLowerCase()));
  if (drive) {
    for (const [re, provider] of LABEL_RULES) {
      if (re.test(drive.label)) return { provider, rootKey: drive.mountPath.toLowerCase() };
    }
  }
  for (const [re, provider] of PATH_RULES) {
    const m = re.exec(dirPath);
    if (m) return { provider, rootKey: dirPath.slice(0, m.index + m[0].length).toLowerCase() };
  }
  return null;
}
