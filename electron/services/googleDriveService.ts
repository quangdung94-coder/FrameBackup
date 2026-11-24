import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { google, type Auth } from 'googleapis';

const DRIVE_SCOPE = ['https://www.googleapis.com/auth/drive'];
const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB (must be multiple of 256 KB for Google Resumable Upload)
const MAX_CHUNK_RETRIES = 6;

export interface DriveAuthStatus {
  hasCredentials: boolean;
  signedIn: boolean;
  email?: string;
  displayName?: string;
  quotaLimitBytes?: number;
  quotaUsageBytes?: number;
  error?: string;
}

export interface DriveRemoteFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  modifiedTime: string;
  isFolder: boolean;
}

export interface DriveFolderCheckResult {
  ok: boolean;
  folderId?: string;
  folderName?: string;
  canEdit: boolean;
  webViewLink?: string;
  files: DriveRemoteFile[];
  error?: string;
}

export interface DriveUploadItem {
  localPath: string;
  remoteName: string;
  relativeSubdir?: string; // e.g. "DCIM/100MSDCF" for loose files
}

export interface DriveUploadRequest {
  parentFolderId: string;
  createProjectSubfolder?: string;
  items: DriveUploadItem[];
  cleanupArchivePaths?: string[];
}

export interface DriveUploadProgressEvent {
  status: 'preparing' | 'uploading' | 'completed' | 'cancelled' | 'error';
  currentFile: string;
  filesUploaded: number;
  totalFiles: number;
  bytesUploaded: number;
  totalBytes: number;
  percent: number;
  speedMBs: number;
  error?: string;
}

export interface DriveUploadSummary {
  success: boolean;
  targetFolderId: string;
  webViewLink?: string;
  filesUploaded: number;
  totalFiles: number;
  totalBytes: number;
  error?: string;
}

interface StoredOAuthClient {
  client_id: string;
  client_secret: string;
  redirect_uris?: string[];
}

let userDataDir = '';
let activeUploadAbort: AbortController | null = null;

export function initGoogleDriveStorage(appUserDataPath: string) {
  userDataDir = appUserDataPath;
}

function getCredsPath(): string {
  return path.join(userDataDir, 'google-oauth-credentials.json');
}

function getTokenPath(): string {
  return path.join(userDataDir, 'google-oauth-token.json');
}

export function parseDriveFolderId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (folderMatch) return folderMatch[1];
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (idParamMatch) return idParamMatch[1];
  if (/^[a-zA-Z0-9_-]{15,}$/.test(trimmed)) return trimmed;
  return null;
}

function escapeDriveQueryLiteral(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function readStoredClient(): Promise<StoredOAuthClient | null> {
  try {
    const raw = await fsp.readFile(getCredsPath(), 'utf8');
    const json = JSON.parse(raw);
    const cfg = json.installed || json.web || json;
    if (cfg && typeof cfg.client_id === 'string' && typeof cfg.client_secret === 'string') {
      return {
        client_id: cfg.client_id,
        client_secret: cfg.client_secret,
        redirect_uris: cfg.redirect_uris,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function importOAuthCredentials(sourceJsonPath: string): Promise<{ ok: boolean; message: string }> {
  try {
    const raw = await fsp.readFile(sourceJsonPath, 'utf8');
    const json = JSON.parse(raw);
    const cfg = json.installed || json.web || json;
    if (!cfg?.client_id || !cfg?.client_secret) {
      return {
        ok: false,
        message: 'File JSON không hợp lệ (thiếu client_id / client_secret của Google OAuth Desktop App).',
      };
    }
    const prevClient = await readStoredClient();
    await fsp.mkdir(userDataDir, { recursive: true });
    await fsp.writeFile(getCredsPath(), raw, 'utf8');
    // If OAuth client_id changed, clear old token issued for previous client
    if (prevClient && prevClient.client_id !== cfg.client_id) {
      await fsp.unlink(getTokenPath()).catch(() => {});
    }
    return { ok: true, message: 'Đã lưu file credentials.json thành công! Bấm "Đăng nhập Google" để kết nối.' };
  } catch (err) {
    return {
      ok: false,
      message: `Không đọc được file credentials.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function getAuthorizedOAuthClient(): Promise<Auth.OAuth2Client | null> {
  const clientCfg = await readStoredClient();
  if (!clientCfg) return null;

  let tokenJson: Auth.Credentials;
  try {
    tokenJson = JSON.parse(await fsp.readFile(getTokenPath(), 'utf8'));
  } catch {
    return null;
  }

  const oauth2 = new google.auth.OAuth2(clientCfg.client_id, clientCfg.client_secret, 'http://127.0.0.1');
  oauth2.setCredentials(tokenJson);

  oauth2.on('tokens', (newTokens) => {
    const merged = { ...tokenJson, ...newTokens };
    tokenJson = merged;
    void fsp.writeFile(getTokenPath(), JSON.stringify(merged, null, 2), 'utf8').catch(() => {});
  });

  return oauth2;
}

export async function getDriveAuthStatus(): Promise<DriveAuthStatus> {
  const clientCfg = await readStoredClient();
  if (!clientCfg) {
    return { hasCredentials: false, signedIn: false };
  }

  const auth = await getAuthorizedOAuthClient();
  if (!auth) {
    return { hasCredentials: true, signedIn: false };
  }

  try {
    const drive = google.drive({ version: 'v3', auth });
    const about = await drive.about.get({
      fields: 'user(displayName,emailAddress),storageQuota(limit,usage)',
    });
    const user = about.data.user;
    const quota = about.data.storageQuota;
    return {
      hasCredentials: true,
      signedIn: true,
      email: user?.emailAddress || undefined,
      displayName: user?.displayName || undefined,
      quotaLimitBytes: quota?.limit ? Number(quota.limit) : undefined,
      quotaUsageBytes: quota?.usage ? Number(quota.usage) : undefined,
    };
  } catch (err) {
    return {
      hasCredentials: true,
      signedIn: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function signInGoogleDrive(openExternalUrl: (url: string) => Promise<void>): Promise<DriveAuthStatus> {
  const clientCfg = await readStoredClient();
  if (!clientCfg) {
    return {
      hasCredentials: false,
      signedIn: false,
      error: 'Chưa nạp file credentials.json từ Google Cloud Console.',
    };
  }

  return new Promise<DriveAuthStatus>((resolve) => {
    let finished = false;
    const done = (status: DriveAuthStatus) => {
      if (finished) return;
      finished = true;
      server.close();
      clearTimeout(timeout);
      resolve(status);
    };

    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
        if (reqUrl.pathname !== '/oauth2callback') {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        const code = reqUrl.searchParams.get('code');
        const errParam = reqUrl.searchParams.get('error');
        if (errParam || !code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h2>Đăng nhập bị hủy hoặc lỗi. Anh có thể đóng tab này.</h2>');
          done({ hasCredentials: true, signedIn: false, error: errParam || 'Không nhận được mã xác thực.' });
          return;
        }

        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
        const oauth2 = new google.auth.OAuth2(clientCfg.client_id, clientCfg.client_secret, redirectUri);
        const { tokens } = await oauth2.getToken(code);

        await fsp.mkdir(userDataDir, { recursive: true });
        await fsp.writeFile(getTokenPath(), JSON.stringify(tokens, null, 2), 'utf8');

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<div style="font-family:sans-serif;text-align:center;padding:40px;background:#121215;color:#f4f4f5;height:100vh;">' +
            '<h2 style="color:#10b981;">✅ Kết nối Google Drive cho FrameBackup thành công!</h2>' +
            '<p>Anh có thể đóng tab trình duyệt này và quay lại ứng dụng FrameBackup.</p></div>'
        );

        const status = await getDriveAuthStatus();
        done(status);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('OAuth Error');
        done({
          hasCredentials: true,
          signedIn: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    const timeout = setTimeout(() => {
      done({
        hasCredentials: true,
        signedIn: false,
        error: 'Hết thời gian chờ đăng nhập Google (3 phút). Vui lòng thử lại.',
      });
    }, 180_000);

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
      const oauth2 = new google.auth.OAuth2(clientCfg.client_id, clientCfg.client_secret, redirectUri);

      const authUrl = oauth2.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: DRIVE_SCOPE,
      });

      void openExternalUrl(authUrl).catch((err) => {
        done({
          hasCredentials: true,
          signedIn: false,
          error: `Không mở được trình duyệt: ${err instanceof Error ? err.message : String(err)}`,
        });
      });
    });
  });
}

export async function signOutGoogleDrive(): Promise<DriveAuthStatus> {
  await fsp.unlink(getTokenPath()).catch(() => {});
  return getDriveAuthStatus();
}

export async function checkDriveFolderAccess(folderUrlOrId: string): Promise<DriveFolderCheckResult> {
  const folderId = parseDriveFolderId(folderUrlOrId);
  if (!folderId) {
    return { ok: false, canEdit: false, files: [], error: 'Link hoặc Folder ID Google Drive không hợp lệ.' };
  }

  const auth = await getAuthorizedOAuthClient();
  if (!auth) {
    return {
      ok: false,
      folderId,
      canEdit: false,
      files: [],
      error: 'Chưa đăng nhập Google Drive. Bấm "Kết nối Drive" trước khi kiểm tra.',
    };
  }

  try {
    const drive = google.drive({ version: 'v3', auth });
    const meta = await drive.files.get({
      fileId: folderId,
      fields: 'id,name,mimeType,capabilities(canAddChildren),webViewLink',
      supportsAllDrives: true,
    });

    if (meta.data.mimeType !== 'application/vnd.google-apps.folder') {
      return {
        ok: false,
        folderId,
        canEdit: false,
        files: [],
        error: 'Link này trỏ tới 1 file, không phải thư mục Google Drive.',
      };
    }

    const canEdit = Boolean(meta.data.capabilities?.canAddChildren);

    const listRes = await drive.files.list({
      q: `'${escapeDriveQueryLiteral(folderId)}' in parents and trashed = false`,
      fields: 'files(id,name,mimeType,size,modifiedTime)',
      orderBy: 'folder,name',
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const files: DriveRemoteFile[] = (listRes.data.files || []).map((f) => ({
      id: f.id || '',
      name: f.name || '',
      mimeType: f.mimeType || '',
      sizeBytes: f.size ? Number(f.size) : 0,
      modifiedTime: f.modifiedTime || '',
      isFolder: f.mimeType === 'application/vnd.google-apps.folder',
    }));

    return {
      ok: canEdit,
      folderId: meta.data.id || folderId,
      folderName: meta.data.name || 'Google Drive Folder',
      canEdit,
      webViewLink: meta.data.webViewLink || `https://drive.google.com/drive/folders/${folderId}`,
      files,
      error: canEdit ? undefined : 'Tài khoản Google của anh chỉ có quyền Xem (Viewer), không có quyền Editor để upload!',
    };
  } catch (err) {
    return {
      ok: false,
      folderId,
      canEdit: false,
      files: [],
      error: `Không truy cập được thư mục Drive: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
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
    '.zip': 'application/zip',
    '.7z': 'application/x-7z-compressed',
  };
  return map[ext] || 'application/octet-stream';
}

async function ensureRemoteSubfolder(
  auth: Auth.OAuth2Client,
  parentId: string,
  folderName: string,
  cache: Map<string, string>
): Promise<string> {
  const cacheKey = `${parentId}/${folderName}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const drive = google.drive({ version: 'v3', auth });
  const escapedName = escapeDriveQueryLiteral(folderName);
  const existing = await drive.files.list({
    q: `'${escapeDriveQueryLiteral(parentId)}' in parents and name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (existing.data.files && existing.data.files.length > 0 && existing.data.files[0].id) {
    const id = existing.data.files[0].id;
    cache.set(cacheKey, id);
    return id;
  }

  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
    supportsAllDrives: true,
  });

  const newId = created.data.id!;
  cache.set(cacheKey, newId);
  return newId;
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('CANCELLED'));
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error('CANCELLED'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
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

async function findExistingRemoteFile(
  auth: Auth.OAuth2Client,
  parentId: string,
  remoteName: string
): Promise<{ id: string; sizeBytes: number } | null> {
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.list({
    q: `'${escapeDriveQueryLiteral(parentId)}' in parents and name = '${escapeDriveQueryLiteral(
      remoteName
    )}' and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id,size)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const first = res.data.files?.[0];
  if (!first?.id) return null;
  return { id: first.id, sizeBytes: first.size ? Number(first.size) : -1 };
}

async function uploadSingleFileResumable(
  auth: Auth.OAuth2Client,
  localPath: string,
  remoteName: string,
  parentFolderId: string,
  signal: AbortSignal,
  onDeltaBytes: (delta: number) => void
): Promise<string> {
  const stat = await fsp.stat(localPath);
  const totalSize = stat.size;
  const mimeType = guessMimeType(remoteName);

  // Cloud Smart Deduplication: avoid creating duplicate files on Google Drive when re-running a job
  const isReportOrThumb =
    remoteName === '_00_BACKUP_REPORT.txt' ||
    remoteName.startsWith('_01_FIRST_SHOT_') ||
    remoteName.startsWith('_02_LAST_SHOT_');
  const existingRemote = await findExistingRemoteFile(auth, parentFolderId, remoteName);

  if (existingRemote && !isReportOrThumb && existingRemote.sizeBytes === totalSize) {
    onDeltaBytes(totalSize);
    return existingRemote.id;
  }

  const createSessionUrl = async (): Promise<string> => {
    const tokenRes = await auth.getAccessToken();
    const accessToken = tokenRes.token;
    if (!accessToken) throw new Error('Không lấy được Google Access Token.');

    const endpoint =
      existingRemote && isReportOrThumb
        ? `https://www.googleapis.com/upload/drive/v3/files/${existingRemote.id}?uploadType=resumable&supportsAllDrives=true&fields=id`
        : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id';
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
    const data = (await putZero.json()) as { id?: string };
    return data.id || '';
  }

  // 2. Stream file in 16MB chunks with auto-retry & resume
  const handle = await fsp.open(localPath, 'r');
  try {
    let offset = 0;
    const chunkBuf = Buffer.allocUnsafe(Math.min(CHUNK_SIZE, totalSize));

    while (offset < totalSize) {
      if (signal.aborted) throw new Error('CANCELLED');

      const length = Math.min(CHUNK_SIZE, totalSize - offset);
      const { bytesRead } = await handle.read(chunkBuf, 0, length, offset);
      if (bytesRead <= 0) break;

      const slice = chunkBuf.subarray(0, bytesRead);
      const endByte = offset + bytesRead - 1;

      let attempt = 0;
      let chunkDone = false;

      while (!chunkDone) {
        if (signal.aborted) throw new Error('CANCELLED');
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
            const data = (await putRes.json()) as { id?: string };
            return data.id || '';
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
          if (signal.aborted || (err instanceof Error && err.message === 'CANCELLED')) {
            throw new Error('CANCELLED');
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
    return '';
  } finally {
    await handle.close().catch(() => {});
  }
}

export function cancelDriveUpload(): boolean {
  if (activeUploadAbort) {
    activeUploadAbort.abort();
    activeUploadAbort = null;
    return true;
  }
  return false;
}

export async function uploadProjectToDrive(
  req: DriveUploadRequest,
  onProgress: (ev: DriveUploadProgressEvent) => void
): Promise<DriveUploadSummary> {
  if (activeUploadAbort) activeUploadAbort.abort();
  const controller = new AbortController();
  activeUploadAbort = controller;
  const { signal } = controller;

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
    for (const item of req.items) {
      if (fs.existsSync(item.localPath)) {
        const st = await fsp.stat(item.localPath);
        if (st.isFile()) {
          totalBytes += st.size;
          validItems.push(item);
        }
      }
    }

    let bytesUploaded = 0;
    let filesUploaded = 0;
    const startedAt = Date.now();
    let lastEmitAt = 0;

    for (const item of validItems) {
      if (signal.aborted) throw new Error('CANCELLED');

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
        percent: totalBytes > 0 ? Math.min(99, Math.round((bytesUploaded / totalBytes) * 100)) : 0,
        speedMBs: Number((bytesUploaded / (1024 * 1024) / Math.max((Date.now() - startedAt) / 1000, 0.1)).toFixed(1)),
      });

      await uploadSingleFileResumable(auth, item.localPath, item.remoteName, destParentId, signal, (delta) => {
        bytesUploaded += delta;
        const now = Date.now();
        if (now - lastEmitAt > 150) {
          lastEmitAt = now;
          const elapsed = Math.max((now - startedAt) / 1000, 0.1);
          onProgress({
            status: 'uploading',
            currentFile: item.remoteName,
            filesUploaded,
            totalFiles: validItems.length,
            bytesUploaded,
            totalBytes,
            percent: totalBytes > 0 ? Math.min(99, Math.round((bytesUploaded / totalBytes) * 100)) : 0,
            speedMBs: Number((bytesUploaded / (1024 * 1024) / elapsed).toFixed(1)),
          });
        }
      });

      filesUploaded += 1;
    }

    // Optional cleanup of temporary zip/7z staging archives & empty staging folder after 100% upload success
    if (req.cleanupArchivePaths) {
      for (const ap of req.cleanupArchivePaths) {
        await fsp.unlink(ap).catch(() => {});
        await fsp.rmdir(path.dirname(ap)).catch(() => {});
      }
    }

    const elapsed = Math.max((Date.now() - startedAt) / 1000, 0.1);
    onProgress({
      status: 'completed',
      currentFile: 'Upload Google Drive hoàn tất 100%!',
      filesUploaded,
      totalFiles: validItems.length,
      bytesUploaded: totalBytes,
      totalBytes,
      percent: 100,
      speedMBs: Number((totalBytes / (1024 * 1024) / elapsed).toFixed(1)),
    });

    activeUploadAbort = null;
    return {
      success: true,
      targetFolderId,
      webViewLink: `https://drive.google.com/drive/folders/${targetFolderId}`,
      filesUploaded,
      totalFiles: validItems.length,
      totalBytes,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isCancelled = message === 'CANCELLED';
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
    activeUploadAbort = null;
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
