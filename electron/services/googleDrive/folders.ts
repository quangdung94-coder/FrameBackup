import { google, type Auth } from 'googleapis';
import { parseGoogleDriveFolderId, driveFolderWebLink } from '../../shared/driveLink';
import type { DriveFolderCheckResult, DriveRemoteFile } from '../../shared/types';
import { getAuthorizedOAuthClient } from './auth';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

export function escapeDriveQueryLiteral(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function checkDriveFolderAccess(folderUrlOrId: string): Promise<DriveFolderCheckResult> {
  const folderId = parseGoogleDriveFolderId(folderUrlOrId);
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

    if (meta.data.mimeType !== FOLDER_MIME) {
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
      isFolder: f.mimeType === FOLDER_MIME,
    }));

    return {
      ok: canEdit,
      folderId: meta.data.id || folderId,
      folderName: meta.data.name || 'Google Drive Folder',
      canEdit,
      webViewLink: meta.data.webViewLink || driveFolderWebLink(folderId),
      files,
      // drive.file: thư mục công khai / chia sẻ vẫn đọc được tên, nhưng app chỉ ghi được sau khi người dùng chọn qua Picker.
      // Nên khi chưa ghi được => mời "Cấp quyền thư mục" trước; nếu đã chọn mà vẫn không ghi được thì tài khoản thật sự chỉ có quyền Xem.
      needsPick: canEdit ? undefined : true,
      error: canEdit
        ? undefined
        : 'Chưa ghi được vào thư mục này. Bấm "Cấp quyền thư mục" và chọn đúng thư mục này 1 lần. Nếu đã chọn mà vẫn báo, nghĩa là tài khoản đang đăng nhập chỉ có quyền Xem: chủ thư mục cần thêm tài khoản này làm Editor (link công khai thường chỉ cho Xem).',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // drive.file: thư mục chưa được người dùng chọn cho app => Google trả 404 / 403
    const code = (err as { code?: number | string })?.code;
    if (code === 404 || code === 403 || /not found|insufficient/i.test(msg)) {
      return {
        ok: false,
        folderId,
        canEdit: false,
        files: [],
        needsPick: true,
        error: 'App chưa được cấp quyền vào thư mục này — bấm "Cấp quyền thư mục" và chọn thư mục 1 lần.',
      };
    }
    return {
      ok: false,
      folderId,
      canEdit: false,
      files: [],
      error: `Không truy cập được thư mục Drive: ${msg}`,
    };
  }
}

/** Tìm hoặc tạo thư mục con trên Drive (có cache theo parentId/tên). */
export async function ensureRemoteSubfolder(
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
    q: `'${escapeDriveQueryLiteral(parentId)}' in parents and name = '${escapedName}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
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
      mimeType: FOLDER_MIME,
      parents: [parentId],
    },
    fields: 'id',
    supportsAllDrives: true,
  });

  const newId = created.data.id!;
  cache.set(cacheKey, newId);
  return newId;
}

export interface RemoteFileMeta {
  id: string;
  sizeBytes: number;
  md5: string | null;
}

/** Liệt kê toàn bộ file (không tính thư mục) trong 1 thư mục Drive để đối chiếu trùng hàng loạt (1–2 API call thay vì gọi cho từng file). */
export async function listRemoteFilesInFolder(
  auth: Auth.OAuth2Client,
  parentId: string
): Promise<Map<string, RemoteFileMeta>> {
  const drive = google.drive({ version: 'v3', auth });
  const map = new Map<string, RemoteFileMeta>();
  const q = `'${escapeDriveQueryLiteral(parentId)}' in parents and mimeType != '${FOLDER_MIME}' and trashed = false`;
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q,
      fields: 'nextPageToken,files(id,name,size,md5Checksum)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files || []) {
      if (!f.id || !f.name) continue;
      if (!map.has(f.name)) {
        map.set(f.name, {
          id: f.id,
          sizeBytes: f.size ? Number(f.size) : -1,
          md5: f.md5Checksum ?? null,
        });
      }
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return map;
}
