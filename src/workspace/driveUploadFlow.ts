import { buildDriveUploadItems, buildReportUploadItems } from '../lib/uploadPlan';
import type { ProgressStore } from '../lib/progressStore';
import {
  CANCELLED,
  parseGoogleDriveFolderId,
  type BackupReport,
  type BuildReportRequest,
  type CardIngestRecord,
  type MediaReportResult,
  type PackMode,
  type PackageResult,
} from '../types/framebackup';
import type { SharedWorkspace, UploadPackChoice } from './shared';

/** Quy đổi công tắc `Up Drive: [Có nén | Không nén]` + kiểu đóng gói trên thanh Ribbon thành PackMode thực thi. */
export function resolveEffectivePackMode(uploadPack: UploadPackChoice, defaultPackMode: PackMode): PackMode {
  if (uploadPack === 'none') return 'none';
  return defaultPackMode === 'none' ? 'video-raw-smart' : defaultPackMode;
}

/** Thêm ghi chú chuẩn về file nén vào báo cáo Drive. */
export function appendPackNotes(notes: string[], packRes: Pick<PackageResult, 'archivePaths' | 'looseFilePaths'>): void {
  if (packRes.archivePaths.length > 0 && packRes.looseFilePaths.length > 0) {
    notes.push('Trên Drive: ảnh được gom vào 1 file Zip (không nén), video để lẻ giữ nguyên thư mục.');
  } else if (packRes.archivePaths.length > 0) {
    notes.push('Trên Drive: toàn bộ file nằm trong file nén (đã kiểm tra file nén bằng 7-Zip).');
  }
}

export interface PackUploadReportParams {
  jobId: string;
  sourceDir: string;
  /** Thư mục Ổ 1 dùng cho báo cáo (mặc định = sourceDir). */
  reportDrive1Dir?: string;
  /** Thư mục Ổ 2 dùng cho báo cáo (nếu có). */
  reportDrive2Dir?: string;
  stagingName: string;
  camFolder: string;
  packMode: PackMode;
  selectedFilePaths?: string[];
  shared: SharedWorkspace;
  progress: ProgressStore;
  card?: CardIngestRecord;
  drive2VerifiedNow?: boolean;
  notes: string[];
  onMediaReport: (media: MediaReportResult) => void;
  onBackupReport: (report: BackupReport) => void;
}

export interface PackUploadReportResult {
  aborted?: boolean;
  emptySelection?: boolean;
  media?: MediaReportResult;
  packRes?: PackageResult;
  driveInfo?: BuildReportRequest['drive'];
  report?: BackupReport;
  webLink?: string;
  canUpload?: boolean;
}

/**
 * Luồng dùng chung cho Bước 3 & 4 (Thumbnail ➔ Đóng gói 7-Zip ➔ Upload Google Drive ➔ Báo cáo PDF/TXT).
 * Dùng thống nhất cho cả: Chạy cả chuỗi, Chỉ Up Drive từ Ổ 1, và Upload cả thư mục / chọn lọc từ Ổ 2.
 */
export async function runPackUploadAndReport(p: PackUploadReportParams): Promise<PackUploadReportResult> {
  const api = window.frameBackup;
  if (!api) return { aborted: true };

  const { shared, progress, jobId } = p;
  const notes = [...p.notes];
  const camSub = p.camFolder.trim();

  // Bước 3a: trích xuất Thumbnail đầu/cuối
  progress.set({
    step3: { jobId, status: 'scanning', percent: 5, message: 'Đang trích xuất Thumbnail Shot đầu & cuối...' },
  });
  const media = await api.inspectAndBuildReport({
    jobId,
    projectName: p.stagingName,
    sourceDir: p.sourceDir,
  });
  p.onMediaReport(media);

  // Bước 3b: đóng gói (toàn bộ thư mục hoặc đúng các file chọn lọc)
  const packRes = await api.packageForDrive({
    jobId,
    projectName: p.stagingName,
    sourceDir: p.sourceDir,
    packMode: p.packMode,
    selectedFilePaths: p.selectedFilePaths,
  });
  if (!packRes.success) {
    if (packRes.error !== CANCELLED) shared.showToast(`❌ Lỗi đóng gói: ${packRes.error}`);
    return { aborted: true };
  }
  if (p.selectedFilePaths && p.selectedFilePaths.length > 0 && (packRes.sourceFiles ?? 0) === 0) {
    return { emptySelection: true };
  }
  appendPackNotes(notes, packRes);

  // Bước 4a: Upload lên Google Drive (thumbnail + file nén + file lẻ)
  const folderId = parseGoogleDriveFolderId(shared.driveLink);
  const canUpload = Boolean(folderId && shared.driveAuth.signedIn);
  let driveInfo: BuildReportRequest['drive'] = { status: 'skipped' };
  let targetFolderId: string | null = null;
  let webLink: string | undefined;

  if (canUpload && folderId) {
    const upRes = await api.uploadToGoogleDrive({
      jobId,
      parentFolderId: folderId,
      createProjectSubfolder: camSub || undefined,
      items: buildDriveUploadItems([media.firstShot, media.lastShot], packRes, p.sourceDir),
      cleanupArchivePaths: packRes.archivePaths,
    });
    if (upRes.success) {
      targetFolderId = upRes.targetFolderId;
      webLink = upRes.webViewLink;
      driveInfo = {
        status: 'uploaded',
        files: packRes.sourceFiles,
        bytes: packRes.sourceBytes,
        folderName: [shared.driveFolderCheck?.folderName, camSub].filter(Boolean).join(' / ') || undefined,
        link: upRes.webViewLink,
      };
      if (upRes.dedupedFiles) {
        notes.push(`${upRes.dedupedFiles} file đã có sẵn trên Drive (cùng MD5) nên không up lại.`);
      }
    } else {
      driveInfo = { status: upRes.error === CANCELLED ? 'cancelled' : 'failed', error: upRes.error };
      if (upRes.error !== CANCELLED) shared.showToast(`❌ Lỗi Upload Google Drive: ${upRes.error}`);
    }
  }

  // Bước 4b: Tạo báo cáo cuối (PDF + TXT) rồi upload kèm lên Drive
  const report = await api.buildBackupReport({
    jobId,
    projectName: camSub ? `${shared.projectName} · ${camSub}` : shared.projectName,
    shootDate: shared.targetDate,
    drive1Dir: p.reportDrive1Dir ?? p.sourceDir,
    drive2Dir: p.reportDrive2Dir,
    card: p.card,
    drive2VerifiedNow: p.drive2VerifiedNow,
    selectedUploadOnly: Boolean(p.selectedFilePaths && p.selectedFilePaths.length > 0),
    drive: driveInfo,
    firstShot: media.firstShot,
    lastShot: media.lastShot,
    notes,
    stagingDir: media.stagingDir,
  });
  p.onBackupReport(report);

  if (targetFolderId) {
    await api.uploadToGoogleDrive({
      jobId,
      parentFolderId: targetFolderId,
      items: buildReportUploadItems(report),
    });
    void shared.checkDriveLink(shared.driveLink, true);
  }

  return { media, packRes, driveInfo, report, webLink, canUpload };
}
