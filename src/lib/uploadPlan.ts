import type { BackupReport, DriveUploadItem, PackageResult, ShotInfo } from '../types/framebackup';
import { baseNameOf } from './paths';

/**
 * Danh sách file upload lên Google Drive cho 1 show (báo cáo up SAU, khi đã biết số file trên Drive):
 * 1. 2 Thumbnail Shot đầu / cuối
 * 2. File nén (Zip Store / 7z)
 * 3. File lẻ, giữ cấu trúc thư mục con so với `sourceRoot` (so sánh không phân biệt hoa thường trên Windows)
 */
export function buildDriveUploadItems(
  shots: (ShotInfo | null)[],
  packRes: Pick<PackageResult, 'archivePaths' | 'looseFilePaths'>,
  sourceRoot: string
): DriveUploadItem[] {
  const uploadItems: DriveUploadItem[] = [];

  for (const shot of shots) {
    if (shot?.thumbnailPath && shot.thumbnailFileName) {
      uploadItems.push({ localPath: shot.thumbnailPath, remoteName: shot.thumbnailFileName });
    }
  }

  for (const ap of packRes.archivePaths) {
    uploadItems.push({ localPath: ap, remoteName: baseNameOf(ap) || 'archive.zip' });
  }

  const normalizedRoot = sourceRoot.replace(/[\\/]+$/, '');
  const lowerRoot = normalizedRoot.toLowerCase();
  for (const fp of packRes.looseFilePaths) {
    const rel = fp.toLowerCase().startsWith(lowerRoot) ? fp.slice(normalizedRoot.length).replace(/^[\\/]+/, '') : '';
    const parts = rel.split(/[\\/]+/).filter(Boolean);
    const remoteName = parts.pop() || baseNameOf(fp) || 'file';
    const relativeSubdir = parts.length > 0 ? parts.join('/') : undefined;
    uploadItems.push({ localPath: fp, remoteName, relativeSubdir });
  }

  return uploadItems;
}

/** Báo cáo cuối: PDF (đọc trên Drive / điện thoại) + TXT. */
export function buildReportUploadItems(report: BackupReport): DriveUploadItem[] {
  const items: DriveUploadItem[] = [];
  if (report.pdfPath && report.pdfFileName) items.push({ localPath: report.pdfPath, remoteName: report.pdfFileName });
  items.push({ localPath: report.txtPath, remoteName: report.txtFileName });
  return items;
}
