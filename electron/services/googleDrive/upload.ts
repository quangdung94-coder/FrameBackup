import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import type { Auth } from 'googleapis';
import { sleep } from '../../lib/abort';
import { cancelledError, errorMessage, isCancelledMessage, CANCELLED } from '../../lib/errors';
import { hashFileMd5 } from '../../lib/hash';
import { createJobPool } from '../../lib/jobSlot';
import { createThrottle } from '../../lib/progress';
import { driveFolderWebLink } from '../../shared/driveLink';
import { calcPercent, calcSpeedMBs } from '../../shared/format';
import type { DriveUploadItem, DriveUploadProgressEvent, DriveUploadRequest, DriveUploadSummary } from '../../shared/types';
import { getAuthorizedOAuthClient } from './auth';
import { ensureRemoteSubfolder, findExistingRemoteFile } from './folders';

const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB (must be multiple of 256 KB for Google Resumable Upload)
const MAX_CHUNK_RETRIES = 6;

const uploadJob = createJobPool();

function guessMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const map: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.txt': 'text/plain; charset=utf-8',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.7z': 'application/x-7z-compressed',
  };
  return map[ext] || 'application/octet-stream';
}

async function queryResumableOffset(uploadUrl: string, totalSize: number, signal: AbortSignal): Promise<number> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Range': `bytes */${totalSize}` },
    signal,
  });
  if (res.status === 200 || res.status === 201) return totalSize;
  if (res.status === 308) {
    const range = res.headers.get('range');
    if (range) {
      const m = range.match(/bytes=0-(\d+)/);
      if (m) return Number(m[1]) + 1;
    }
    return 0;
  }
  throw new Error(`Không thể khôi phục phiên upload (HTTP ${res.status})`);
}

async function uploadSingleFileResumable(
  auth: Auth.OAuth2Client,
  localPath: string,
  remoteName: string,
  parentFolderId: string,
  signal: AbortSignal,
  onDeltaBytes: (delta: number) => void
): Promise<{ id: string; deduped: boolean }> {
  const stat = await fsp.stat(localPath);
  const totalSize = stat.size;
  const mimeType = guessMimeType(remoteName);

  // Cloud Smart Deduplication: avoid creating duplicate files on Google Drive when re-running a job
  const isReportOrThumb =
    remoteName.startsWith('_00_BACKUP_REPORT') ||
    remoteName.startsWith('_01_FIRST_SHOT_') ||
    remoteName.startsWith('_02_LAST_SHOT_');
  const existingRemote = await findExistingRemoteFile(auth, parentFolderId, remoteName);

  // Chỉ bỏ qua khi trên Drive đã có file cùng tên, cùng dung lượng VÀ cùng MD5 (trước đây chỉ so dung lượng)
  if (existingRemote && !isReportOrThumb && existingRemote.sizeBytes === totalSize && existingRemote.md5) {
    const localMd5 = await hashFileMd5(localPath, signal);
    if (localMd5 === existingRemote.md5) {
      onDeltaBytes(totalSize);
      return { id: existingRemote.id, deduped: true };
    }
  }

  const createSessionUrl = async (): Promise<string> => {
    const tokenRes = await auth.getAccessToken();
    const accessToken = tokenRes.token;
    if (!accessToken) throw new Error('Không lấy được Google Access Token.');

    const endpoint =
      existingRemote && isReportOrThumb
        ? `https://www.googleapis.com/upload/drive/v3/files/${existingRemote.id}?uploadType=resumable&supportsAllDrives=true&fields=id,md5Checksum`
        : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,md5Checksum';
    const method = existingRemote && isReportOrThumb ? 'PATCH' : 'POST';
    const metadataBody =
      method === 'PATCH'
        ? JSON.stringify({ name: remoteName })
        : JSON.stringify({ name: remoteName, parents: [parentFolderId] });

    const initRes = await fetch(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(totalSize),
      },
      body: metadataBody,
      signal,
    });

    if (!initRes.ok) {
      const errText = await initRes.text().catch(() => '');
      throw new Error(`Không tạo được phiên Resumable Upload (HTTP ${initRes.status}): ${errText.slice(0, 200)}`);
    }

    const loc = initRes.headers.get('location');
    if (!loc) throw new Error('Google Drive không trả về Resumable Upload URL.');
    return loc;
  };

  // MD5 tính dần theo từng chunk đọc lên (không phải đọc file 2 lần). Nếu bị nhảy offset thì tính lại cả file.
  const md5 = crypto.createHash('md5');
  let hashedUpTo = 0;
  let hashGap = false;
  const feedHash = (slice: Buffer, at: number) => {
    if (hashGap) return;
    if (at > hashedUpTo) {
      hashGap = true;
      return;
    }
    const end = at + slice.length;
    if (end > hashedUpTo) {
      md5.update(slice.subarray(hashedUpTo - at));
      hashedUpTo = end;
    }
  };
  const verifyRemote = async (data: { id?: string; md5Checksum?: string }) => {
    if (!data.id) throw new Error(`Google Drive không trả về ID cho file ${remoteName}`);
    if (data.md5Checksum) {
      const localMd5 =
        !hashGap && hashedUpTo === totalSize ? md5.digest('hex') : await hashFileMd5(localPath, signal);
      if (localMd5 !== data.md5Checksum) {
        throw new Error(`Lỗi toàn vẹn khi upload (MD5 trên Drive không khớp): ${remoteName}`);
      }
    }
    return { id: data.id, deduped: false };
  };

  let uploadUrl = await createSessionUrl();
  let sessionRestarts = 0;

  // Empty 0-byte file edge case
  if (totalSize === 0) {
    const putZero = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Length': '0', 'Content-Type': mimeType },
      signal,
    });
    if (!putZero.ok) throw new Error(`Lỗi upload file rỗng ${remoteName} (HTTP ${putZero.status})`);
    const data = (await putZero.json()) as { id?: string; md5Checksum?: string };
    return verifyRemote(data);
  }

  // 2. Stream file in 16MB chunks with auto-retry & resume
  const handle = await fsp.open(localPath, 'r');
  try {
    let offset = 0;
    const chunkBuf = Buffer.allocUnsafe(Math.min(CHUNK_SIZE, totalSize));

    while (offset < totalSize) {
      if (signal.aborted) throw cancelledError();

      const length = Math.min(CHUNK_SIZE, totalSize - offset);
      const { bytesRead } = await handle.read(chunkBuf, 0, length, offset);
      if (bytesRead <= 0) break;

      const slice = chunkBuf.subarray(0, bytesRead);
      feedHash(slice, offset);
      const endByte = offset + bytesRead - 1;

      let attempt = 0;
      let chunkDone = false;

      while (!chunkDone) {
        if (signal.aborted) throw cancelledError();
        try {
          const putRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Length': String(bytesRead),
              'Content-Type': mimeType,
              'Content-Range': `bytes ${offset}-${endByte}/${totalSize}`,
            },
            body: slice,
            signal,
          });

          if (putRes.status === 200 || putRes.status === 201) {
            onDeltaBytes(bytesRead);
            const data = (await putRes.json()) as { id?: string; md5Checksum?: string };
            return verifyRemote(data);
          }

          if (putRes.status === 308) {
            const range = putRes.headers.get('range');
            let nextOffset = offset + bytesRead;
            if (range) {
              const m = range.match(/bytes=0-(\d+)/);
              if (m) nextOffset = Number(m[1]) + 1;
            }
            const advanced = Math.max(0, nextOffset - offset);
            offset = nextOffset;
            onDeltaBytes(advanced);
            chunkDone = true;
            break;
          }

          // Resumable session URI expired (404 / 410 Gone) after prolonged outage -> recreate session cleanly
          if ((putRes.status === 404 || putRes.status === 410) && sessionRestarts < 2) {
            sessionRestarts += 1;
            uploadUrl = await createSessionUrl();
            if (offset > 0) {
              onDeltaBytes(-offset);
              offset = 0;
            }
            chunkDone = true;
            break;
          }

          if ([408, 429, 500, 502, 503, 504].includes(putRes.status) && attempt < MAX_CHUNK_RETRIES) {
            attempt += 1;
            await sleep(Math.min(30_000, 1500 * Math.pow(2, attempt - 1)), signal);
            const serverOffset = await queryResumableOffset(uploadUrl, totalSize, signal);
            if (serverOffset > offset) {
              onDeltaBytes(serverOffset - offset);
              offset = serverOffset;
              chunkDone = true;
              break;
            }
            continue;
          }

          const errTxt = await putRes.text().catch(() => '');
          throw new Error(`Upload lỗi HTTP ${putRes.status}: ${errTxt.slice(0, 180)}`);
        } catch (err) {
          if (signal.aborted || (err instanceof Error && err.message === CANCELLED)) {
            throw cancelledError();
          }
          if (attempt < MAX_CHUNK_RETRIES) {
            attempt += 1;
            await sleep(Math.min(30_000, 2000 * Math.pow(2, attempt - 1)), signal);
            try {
              const serverOffset = await queryResumableOffset(uploadUrl, totalSize, signal);
              if (serverOffset > offset) {
                onDeltaBytes(serverOffset - offset);
                offset = serverOffset;
                chunkDone = true;
                break;
              }
            } catch {
              // Retry same chunk
            }
          } else {
            throw err;
          }
        }
      }
    }
    throw new Error(`Upload kết thúc nhưng Google Drive chưa xác nhận file: ${remoteName}`);
  } finally {
    await handle.close().catch(() => {});
  }
}

export function cancelDriveUpload(jobId?: string): boolean {
  return uploadJob.cancel(jobId);
}

export async function uploadProjectToDrive(
  req: DriveUploadRequest,
  onProgress: (ev: DriveUploadProgressEvent) => void
): Promise<DriveUploadSummary> {
  const jobController = uploadJob.begin(req.jobId);
  const { signal } = jobController;

  try {
    const auth = await getAuthorizedOAuthClient();
    if (!auth) {
      throw new Error('Chưa đăng nhập Google Drive. Hãy kết nối tài khoản Google trước.');
    }

    onProgress({
      status: 'preparing',
      currentFile: 'Đang chuẩn bị thư mục trên Google Drive...',
      filesUploaded: 0,
      totalFiles: req.items.length,
      bytesUploaded: 0,
      totalBytes: 0,
      percent: 0,
      speedMBs: 0,
    });

    const folderCache = new Map<string, string>();
    let targetFolderId = req.parentFolderId;
    if (req.createProjectSubfolder) {
      targetFolderId = await ensureRemoteSubfolder(auth, req.parentFolderId, req.createProjectSubfolder, folderCache);
    }

    // Calculate total upload size
    let totalBytes = 0;
    const validItems: DriveUploadItem[] = [];
    const missingItems: string[] = [];
    for (const item of req.items) {
      const st = fs.existsSync(item.localPath) ? await fsp.stat(item.localPath) : null;
      if (st && st.isFile()) {
        totalBytes += st.size;
        validItems.push(item);
      } else {
        missingItems.push(item.remoteName || path.basename(item.localPath));
      }
    }
    // Thiếu file nguồn => dừng hẳn, không báo "Hoàn tất 100%" (trước đây lặng lẽ bỏ qua)
    if (missingItems.length > 0) {
      const preview = missingItems.slice(0, 5).join(', ');
      throw new Error(
        `Không tìm thấy ${missingItems.length} file nguồn để upload: ${preview}${missingItems.length > 5 ? '...' : ''}`
      );
    }
    let dedupedFiles = 0;

    let bytesUploaded = 0;
    let filesUploaded = 0;
    const startedAt = Date.now();
    const shouldEmit = createThrottle(150);

    for (const item of validItems) {
      if (signal.aborted) throw cancelledError();

      let destParentId = targetFolderId;
      if (item.relativeSubdir) {
        const parts = item.relativeSubdir.split(/[\\/]+/).filter(Boolean);
        for (const seg of parts) {
          destParentId = await ensureRemoteSubfolder(auth, destParentId, seg, folderCache);
        }
      }

      onProgress({
        status: 'uploading',
        currentFile: item.remoteName,
        filesUploaded,
        totalFiles: validItems.length,
        bytesUploaded,
        totalBytes,
        percent: calcPercent(bytesUploaded, totalBytes),
        speedMBs: calcSpeedMBs(bytesUploaded, startedAt),
      });

      const uploaded = await uploadSingleFileResumable(auth, item.localPath, item.remoteName, destParentId, signal, (delta) => {
        bytesUploaded += delta;
        const now = Date.now();
        if (shouldEmit(now)) {
          onProgress({
            status: 'uploading',
            currentFile: item.remoteName,
            filesUploaded,
            totalFiles: validItems.length,
            bytesUploaded,
            totalBytes,
            percent: calcPercent(bytesUploaded, totalBytes),
            speedMBs: calcSpeedMBs(bytesUploaded, startedAt, now),
          });
        }
      });

      if (uploaded.deduped) dedupedFiles += 1;
      filesUploaded += 1;
    }

    // Optional cleanup of temporary zip/7z staging archives & empty staging folder after 100% upload success
    if (req.cleanupArchivePaths) {
      for (const ap of req.cleanupArchivePaths) {
        await fsp.unlink(ap).catch(() => {});
        await fsp.rmdir(path.dirname(ap)).catch(() => {});
      }
    }

    onProgress({
      status: 'completed',
      currentFile: `Upload Google Drive hoàn tất 100% (đã so MD5)${dedupedFiles > 0 ? `, ${dedupedFiles} file đã có sẵn trên Drive` : ''}`,
      filesUploaded,
      totalFiles: validItems.length,
      bytesUploaded: totalBytes,
      totalBytes,
      percent: 100,
      speedMBs: calcSpeedMBs(totalBytes, startedAt),
    });

    uploadJob.release(req.jobId, jobController);
    return {
      success: true,
      targetFolderId,
      webViewLink: driveFolderWebLink(targetFolderId),
      filesUploaded,
      totalFiles: validItems.length,
      totalBytes,
      dedupedFiles,
    };
  } catch (err) {
    const message = errorMessage(err);
    const isCancelled = isCancelledMessage(message);
    onProgress({
      status: isCancelled ? 'cancelled' : 'error',
      currentFile: isCancelled ? 'Đã hủy Upload Drive' : message,
      filesUploaded: 0,
      totalFiles: req.items.length,
      bytesUploaded: 0,
      totalBytes: 0,
      percent: 0,
      speedMBs: 0,
      error: message,
    });
    uploadJob.release(req.jobId, jobController);
    return {
      success: false,
      targetFolderId: req.parentFolderId,
      filesUploaded: 0,
      totalFiles: req.items.length,
      totalBytes: 0,
      error: message,
    };
  }
}
