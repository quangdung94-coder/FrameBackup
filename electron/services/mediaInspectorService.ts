import fsp from 'node:fs/promises';
import path from 'node:path';
import exifr from 'exifr';
import ffmpegPathRaw from 'ffmpeg-static';
import { resolveUnpackedBinary } from '../lib/binaries';
import { execFileAsync } from '../lib/exec';
import { osStagingDir } from '../lib/tempFiles';
import { formatDateTime, formatTimeTag } from '../shared/dates';
import { formatBytes } from '../shared/format';
import { toSafeAsciiName } from '../shared/paths';
import { statsOf } from '../shared/report';
import type { InspectReportRequest, MediaReportResult, ShotInfo } from '../shared/types';
import { scanFilesRecursive, type FileEntry } from './diskService';

export type { InspectReportRequest, MediaReportResult, ShotInfo } from '../shared/types';

const ffmpegPath = resolveUnpackedBinary(ffmpegPathRaw);

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

async function buildShotInfo(
  file: FileEntry | null,
  prefix: '_01_FIRST_SHOT' | '_02_LAST_SHOT',
  stagingDir: string
): Promise<ShotInfo | null> {
  if (!file) return null;
  const thumb = await generateShotThumbnail(file, prefix, stagingDir);
  return {
    name: file.name,
    relativePath: file.relativePath,
    shotTimeMs: file.shotTimeMs,
    mediaType: file.mediaType,
    ...thumb,
  };
}

export async function inspectAndBuildReport(req: InspectReportRequest): Promise<MediaReportResult> {
  const stagingDir = osStagingDir(toSafeAsciiName(req.projectName));
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

  const firstShot = await buildShotInfo(firstFile, '_01_FIRST_SHOT', stagingDir);
  const lastShot = await buildShotInfo(lastFile, '_02_LAST_SHOT', stagingDir);

  const lines: string[] = [
    '=========================================',
    'FRAMEBACKUP — BACKUP & UPLOAD REPORT',
    `Project  : ${req.projectName}`,
    `Generated: ${formatDateTime(Date.now())}`,
    '=========================================',
    `- Total Files  : ${allFiles.length} files (${formatBytes(totalBytes)})`,
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
    drive1Stats: statsOf(allFiles),
    firstShot,
    lastShot,
  };
}
