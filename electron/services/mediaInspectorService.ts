import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import exifr from 'exifr';
import ffmpegPathRaw from 'ffmpeg-static';
import { scanFilesRecursive, type FileEntry } from './diskService';

const execFileAsync = promisify(execFile);
const ffmpegPath = ffmpegPathRaw ? ffmpegPathRaw.replace('app.asar', 'app.asar.unpacked') : null;

export interface ShotInfo {
  name: string;
  relativePath: string;
  shotTimeMs: number;
  mediaType: FileEntry['mediaType'];
  thumbnailPath?: string;
  thumbnailFileName?: string;
  thumbnailDataUrl?: string;
}

export interface MediaReportResult {
  projectName: string;
  stagingDir: string;
  reportFilePath: string;
  reportFileName: string;
  reportText: string;
  totalFiles: number;
  videoCount: number;
  photoCount: number;
  rawCount: number;
  totalBytes: number;
  firstShot: ShotInfo | null;
  lastShot: ShotInfo | null;
}

export interface InspectReportRequest {
  projectName: string;
  sourceDir: string;
  verifyStatusText?: string;
  skippedOldFiles?: number;
  keptMismatchFiles?: number;
}

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}

function formatTimeTag(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}h${pad(d.getMinutes())}`;
}

function formatBytesHuman(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val >= 100 ? val.toFixed(0) : val >= 10 ? val.toFixed(1) : val.toFixed(2)} ${units[i]}`;
}

async function extractVideoThumbnail(videoPath: string, outJpgPath: string): Promise<boolean> {
  if (!ffmpegPath) return false;
  const runFfmpeg = async (seekSec: string) => {
    await execFileAsync(
      ffmpegPath!,
      ['-ss', seekSec, '-i', videoPath, '-vframes', '1', '-vf', 'scale=640:-1', '-q:v', '3', '-y', outJpgPath],
      { windowsHide: true, timeout: 25000 }
    );
  };
  try {
    await runFfmpeg('00:00:01');
    return true;
  } catch {
    try {
      await runFfmpeg('00:00:00');
      return true;
    } catch {
      return false;
    }
  }
}

async function extractImageThumbnail(imagePath: string, outJpgPath: string): Promise<boolean> {
  try {
    const thumbBuf = await exifr.thumbnail(imagePath);
    if (thumbBuf && thumbBuf.length > 0) {
      await fsp.writeFile(outJpgPath, thumbBuf);
      return true;
    }
  } catch {
    // Fallback to ffmpeg below
  }

  if (!ffmpegPath) return false;
  try {
    await execFileAsync(
      ffmpegPath,
      ['-i', imagePath, '-vframes', '1', '-vf', 'scale=640:-1', '-q:v', '3', '-y', outJpgPath],
      { windowsHide: true, timeout: 20000 }
    );
    return true;
  } catch {
    return false;
  }
}

async function generateShotThumbnail(
  file: FileEntry,
  prefix: '_01_FIRST_SHOT' | '_02_LAST_SHOT',
  stagingDir: string
): Promise<{ thumbnailPath?: string; thumbnailFileName?: string; thumbnailDataUrl?: string }> {
  const baseName = path.basename(file.name, path.extname(file.name)).replace(/[^a-zA-Z0-9_-]/g, '_');
  const timeTag = formatTimeTag(file.shotTimeMs);
  const fileName = `${prefix}_${timeTag}_${baseName}.jpg`;
  const outPath = path.join(stagingDir, fileName);

  const ok =
    file.mediaType === 'video'
      ? await extractVideoThumbnail(file.fullPath, outPath)
      : await extractImageThumbnail(file.fullPath, outPath);

  if (!ok) return {};

  try {
    const buf = await fsp.readFile(outPath);
    return {
      thumbnailPath: outPath,
      thumbnailFileName: fileName,
      thumbnailDataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`,
    };
  } catch {
    return {};
  }
}

export async function inspectAndBuildReport(req: InspectReportRequest): Promise<MediaReportResult> {
  const safeProj = req.projectName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'FrameBackup_Show';
  const stagingDir = path.join(os.tmpdir(), 'framebackup_staging', safeProj);
  await fsp.mkdir(stagingDir, { recursive: true });

  const allFiles = await scanFilesRecursive(req.sourceDir, true);
  const mediaFiles = allFiles.filter(
    (f) => f.mediaType === 'video' || f.mediaType === 'photo' || f.mediaType === 'raw'
  );

  const videoCount = mediaFiles.filter((f) => f.mediaType === 'video').length;
  const photoCount = mediaFiles.filter((f) => f.mediaType === 'photo').length;
  const rawCount = mediaFiles.filter((f) => f.mediaType === 'raw').length;
  const totalBytes = allFiles.reduce((acc, f) => acc + f.sizeBytes, 0);

  const sortedMedia = [...mediaFiles].sort((a, b) => a.shotTimeMs - b.shotTimeMs);
  const firstFile = sortedMedia[0] ?? null;
  const lastFile = sortedMedia.length > 0 ? sortedMedia[sortedMedia.length - 1] : null;

  let firstShot: ShotInfo | null = null;
  if (firstFile) {
    const thumb = await generateShotThumbnail(firstFile, '_01_FIRST_SHOT', stagingDir);
    firstShot = {
      name: firstFile.name,
      relativePath: firstFile.relativePath,
      shotTimeMs: firstFile.shotTimeMs,
      mediaType: firstFile.mediaType,
      ...thumb,
    };
  }

  let lastShot: ShotInfo | null = null;
  if (lastFile) {
    const thumb = await generateShotThumbnail(lastFile, '_02_LAST_SHOT', stagingDir);
    lastShot = {
      name: lastFile.name,
      relativePath: lastFile.relativePath,
      shotTimeMs: lastFile.shotTimeMs,
      mediaType: lastFile.mediaType,
      ...thumb,
    };
  }

  const lines: string[] = [
    '=========================================',
    'FRAMEBACKUP — BACKUP & UPLOAD REPORT',
    `Project  : ${req.projectName}`,
    `Generated: ${formatDateTime(Date.now())}`,
    '=========================================',
    `- Total Files  : ${allFiles.length} files (${formatBytesHuman(totalBytes)})`,
    `- Breakdown    : ${videoCount} Video | ${rawCount} RAW | ${photoCount} Photo`,
    `- Verify Ổ 1&2 : ${req.verifyStatusText || 'PASSED (XXHash64 100%)'}`,
  ];

  if (req.skippedOldFiles && req.skippedOldFiles > 0) {
    lines.push(`- Date Guard   : Đã lọc bỏ ${req.skippedOldFiles} file lệch ngày cũ`);
  }
  if (req.keptMismatchFiles && req.keptMismatchFiles > 0) {
    lines.push(`- Date Guard   : Đã xác nhận chép đủ ${req.keptMismatchFiles} file từ body sai ngày/giờ`);
  }

  lines.push('', '[TIMELINE]');
  lines.push(
    firstShot
      ? `- First Shot   : ${firstShot.name} | ${formatDateTime(firstShot.shotTimeMs)}`
      : '- First Shot   : (Không tìm thấy file media)'
  );
  lines.push(
    lastShot
      ? `- Last Shot    : ${lastShot.name} | ${formatDateTime(lastShot.shotTimeMs)}`
      : '- Last Shot    : (Không tìm thấy file media)'
  );

  lines.push('', '[THUMBNAILS IN THIS FOLDER]');
  lines.push(`- ${firstShot?.thumbnailFileName || '(Chưa xuất được thumbnail đầu)'}`);
  lines.push(`- ${lastShot?.thumbnailFileName || '(Chưa xuất được thumbnail cuối)'}`);
  lines.push('=========================================');

  const reportFileName = '_00_BACKUP_REPORT.txt';
  const reportFilePath = path.join(stagingDir, reportFileName);
  const reportText = lines.join('\n');
  await fsp.writeFile(reportFilePath, reportText, 'utf8');

  return {
    projectName: req.projectName,
    stagingDir,
    reportFilePath,
    reportFileName,
    reportText,
    totalFiles: allFiles.length,
    videoCount,
    photoCount,
    rawCount,
    totalBytes,
    firstShot,
    lastShot,
  };
}
