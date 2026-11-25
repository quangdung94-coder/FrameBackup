import { google, type Auth } from 'googleapis';
import { parseGoogleDriveFolderId, driveFolderWebLink } from '../../shared/driveLink';
import type { DriveFolderCheckResult, DriveRemoteFile } from '../../shared/types';
import { getAuthorizedOAuthClient } from './auth';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

export function escapeDriveQueryLiteral(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** @deprecated giữ tên cũ — dùng parseGoogleDriveFolderId trong shared/driveLink. */
export const parseDriveFolderId = parseGoogleDriveFolderId;

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

export async function findExistingRemoteFile(
  auth: Auth.OAuth2Client,
  parentId: string,
  remoteName: string
): Promise<{ id: string; sizeBytes: number; md5: string | null } | null> {
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.list({
    q: `'${escapeDriveQueryLiteral(parentId)}' in parents and name = '${escapeDriveQueryLiteral(
      remoteName
    )}' and mimeType != '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id,size,md5Checksum)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const first = res.data.files?.[0];
  if (!first?.id) return null;
  return { id: first.id, sizeBytes: first.size ? Number(first.size) : -1, md5: first.md5Checksum ?? null };
}
