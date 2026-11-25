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
import { ensureRemoteSubfolder, listRemoteFilesInFolder, type RemoteFileMeta } from './folders';

// Google Resumable Upload requires chunk size to be a multiple of 256 KB.
// 32 MB for normal files and 64 MB for large videos (>= 256 MB) reduces HTTP 308 round-trips on fast fiber.
const CHUNK_SIZE_DEFAULT = 32 * 1024 * 1024;
const CHUNK_SIZE_LARGE = 64 * 1024 * 1024;
const LARGE_FILE_THRESHOLD = 256 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 3;
const MAX_CHUNK_RETRIES = 6;
const MAX_INIT_RETRIES = 5;

const uploadJob = createJobPool();

function pickChunkSize(totalSize: number): number {
  return totalSize >= LARGE_FILE_THRESHOLD ? CHUNK_SIZE_LARGE : CHUNK_SIZE_DEFAULT;
}

function isRetryableDriveStatus(status: number, bodyText = ''): boolean {
  if ([408, 429, 500, 502, 503, 504].includes(status)) return true;
  if (status === 403 && /rateLimitExceeded|userRateLimitExceeded|sharingRateLimitExceeded/i.test(bodyText)) {
    return true;
  }
  return false;
}

function backoffMs(attempt: number, baseMs = 1500): number {
  const jitter = Math.floor(Math.random() * 400);
  return Math.min(30_000, baseMs * Math.pow(2, attempt - 1) + jitter);
}

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
  existingRemote: RemoteFileMeta | null,
  signal: AbortSignal,
  onDeltaBytes: (delta: number) => void
): Promise<{ id: string; deduped: boolean; md5: string | null }> {
  const stat = await fsp.stat(localPath);
  const totalSize = stat.size;
  const mimeType = guessMimeType(remoteName);
  const chunkSize = pickChunkSize(totalSize);

  // Cloud Smart Deduplication: avoid creating duplicate files on Google Drive when re-running a job
  const isReportOrThumb =
    remoteName.startsWith('_00_BACKUP_REPORT') ||
    remoteName.startsWith('_01_FIRST_SHOT_') ||
    remoteName.startsWith('_02_LAST_SHOT_');

  // Chỉ bỏ qua khi trên Drive đã có file cùng tên, cùng dung lượng VÀ cùng MD5 (trước đây chỉ so dung lượng)
  if (existingRemote && !isReportOrThumb && existingRemote.sizeBytes === totalSize && existingRemote.md5) {
    const localMd5 = await hashFileMd5(localPath, signal);
    if (localMd5 === existingRemote.md5) {
      onDeltaBytes(totalSize);
      return { id: existingRemote.id, deduped: true, md5: existingRemote.md5 };
    }
  }

  const createSessionUrl = async (): Promise<string> => {
    let attempt = 0;
    while (true) {
      if (signal.aborted) throw cancelledError();
      try {
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
          if (isRetryableDriveStatus(initRes.status, errText) && attempt < MAX_INIT_RETRIES) {
            attempt += 1;
            await sleep(backoffMs(attempt, 1200), signal);
            continue;
          }
          throw new Error(`Không tạo được phiên Resumable Upload (HTTP ${initRes.status}): ${errText.slice(0, 200)}`);
        }

        const loc = initRes.headers.get('location');
        if (!loc) throw new Error('Google Drive không trả về Resumable Upload URL.');
        return loc;
      } catch (err) {
        if (signal.aborted || (err instanceof Error && err.message === CANCELLED)) {
          throw cancelledError();
        }
        // Retry transient network errors when initializing session
        const isHttpErr = err instanceof Error && err.message.startsWith('Không tạo được phiên');
        if (!isHttpErr && attempt < MAX_INIT_RETRIES) {
          attempt += 1;
          await sleep(backoffMs(attempt, 1500), signal);
          continue;
        }
        throw err;
      }
    }
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
    return { id: data.id, deduped: false, md5: data.md5Checksum ?? null };
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

  // 2. Stream file in 32MB/64MB chunks with auto-retry & resume
  const handle = await fsp.open(localPath, 'r');
  try {
    let offset = 0;
    const chunkBuf = Buffer.allocUnsafe(Math.min(chunkSize, totalSize));

    while (offset < totalSize) {
      if (signal.aborted) throw cancelledError();

      const length = Math.min(chunkSize, totalSize - offset);
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

          const errTxt = await putRes.text().catch(() => '');
          if (isRetryableDriveStatus(putRes.status, errTxt) && attempt < MAX_CHUNK_RETRIES) {
            attempt += 1;
            await sleep(backoffMs(attempt, 1500), signal);
            const serverOffset = await queryResumableOffset(uploadUrl, totalSize, signal);
            if (serverOffset > offset) {
              onDeltaBytes(serverOffset - offset);
              offset = serverOffset;
              chunkDone = true;
              break;
            }
            continue;
          }

          throw new Error(`Upload lỗi HTTP ${putRes.status}: ${errTxt.slice(0, 180)}`);
        } catch (err) {
          if (signal.aborted || (err instanceof Error && err.message === CANCELLED)) {
            throw cancelledError();
          }
          if (attempt < MAX_CHUNK_RETRIES) {
            attempt += 1;
            await sleep(backoffMs(attempt, 2000), signal);
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
    const folderPromiseCache = new Map<string, Promise<string>>();
    const ensureSubfolderSafe = (parentId: string, seg: string): Promise<string> => {
      const key = `${parentId}/${seg}`;
      const existing = folderPromiseCache.get(key);
      if (existing) return existing;
      const p = ensureRemoteSubfolder(auth, parentId, seg, folderCache).catch((err) => {
        folderPromiseCache.delete(key);
        throw err;
      });
      folderPromiseCache.set(key, p);
      return p;
    };

    let targetFolderId = req.parentFolderId;
    if (req.createProjectSubfolder) {
      targetFolderId = await ensureSubfolderSafe(req.parentFolderId, req.createProjectSubfolder);
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

    // Cache danh sách file trên từng thư mục Drive đích (1 request/thư mục thay vì 1 request/file)
    const remoteFilesCache = new Map<string, Promise<Map<string, RemoteFileMeta>>>();
    const getRemoteFilesInFolder = (folderId: string): Promise<Map<string, RemoteFileMeta>> => {
      const existing = remoteFilesCache.get(folderId);
      if (existing) return existing;
      const p = listRemoteFilesInFolder(auth, folderId).catch((err) => {
        remoteFilesCache.delete(folderId);
        throw err;
      });
      remoteFilesCache.set(folderId, p);
      return p;
    };

    let dedupedFiles = 0;
    let bytesUploaded = 0;
    let filesUploaded = 0;
    const startedAt = Date.now();
    const shouldEmit = createThrottle(150);
    const activeFiles = new Set<string>();

    const formatCurrentFile = (fallback: string): string => {
      if (activeFiles.size === 0) return fallback;
      const first = activeFiles.values().next().value as string;
      return activeFiles.size > 1 ? `${first} (+${activeFiles.size - 1} file khác)` : first;
    };

    const emitProgress = (fallbackName: string, force = false) => {
      const now = Date.now();
      if (!force && !shouldEmit(now)) return;
      onProgress({
        status: 'uploading',
        currentFile: formatCurrentFile(fallbackName),
        filesUploaded,
        totalFiles: validItems.length,
        bytesUploaded,
        totalBytes,
        percent: calcPercent(bytesUploaded, totalBytes),
        speedMBs: calcSpeedMBs(bytesUploaded, startedAt, now),
      });
    };

    // Chạy song song tối đa 3 file cùng lúc; nếu 1 luồng lỗi thì hủy các luồng còn lại
    const poolAbort = new AbortController();
    const onExternalAbort = () => poolAbort.abort();
    if (signal.aborted) poolAbort.abort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });

    let nextIndex = 0;
    let firstError: unknown = null;
    const workerCount = Math.min(MAX_CONCURRENT_UPLOADS, validItems.length);

    const runWorker = async () => {
      while (true) {
        if (poolAbort.signal.aborted) return;
        const idx = nextIndex++;
        if (idx >= validItems.length) return;
        const item = validItems[idx];

        let destParentId = targetFolderId;
        if (item.relativeSubdir) {
          const parts = item.relativeSubdir.split(/[\\/]+/).filter(Boolean);
          for (const seg of parts) {
            if (poolAbort.signal.aborted) throw cancelledError();
            destParentId = await ensureSubfolderSafe(destParentId, seg);
          }
        }

        const remoteMap = await getRemoteFilesInFolder(destParentId);
        const existingRemote = remoteMap.get(item.remoteName) ?? null;

        activeFiles.add(item.remoteName);
        emitProgress(item.remoteName, true);

        try {
          const uploaded = await uploadSingleFileResumable(
            auth,
            item.localPath,
            item.remoteName,
            destParentId,
            existingRemote,
            poolAbort.signal,
            (delta) => {
              bytesUploaded += delta;
              emitProgress(item.remoteName, false);
            }
          );

          if (uploaded.deduped) dedupedFiles += 1;
          else if (!existingRemote) {
            remoteMap.set(item.remoteName, { id: uploaded.id, sizeBytes: -1, md5: uploaded.md5 });
          }
          filesUploaded += 1;
        } finally {
          activeFiles.delete(item.remoteName);
        }
        emitProgress(item.remoteName, true);
      }
    };

    try {
      await Promise.all(
        Array.from({ length: workerCount }, () =>
          runWorker().catch((err) => {
            if (!firstError) firstError = err;
            poolAbort.abort();
          })
        )
      );
      if (firstError) throw firstError;
      if (signal.aborted) throw cancelledError();
    } finally {
      signal.removeEventListener('abort', onExternalAbort);
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
