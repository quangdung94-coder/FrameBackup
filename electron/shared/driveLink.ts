/** Lấy Folder ID từ link Google Drive (…/folders/<id>, ?id=<id>) hoặc ID trần. */
export function parseGoogleDriveFolderId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (folderMatch) return folderMatch[1];
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (idParamMatch) return idParamMatch[1];
  if (/^[a-zA-Z0-9_-]{15,}$/.test(trimmed)) return trimmed;
  return null;
}

/** Removes characters illegal in Windows/macOS folder names. */

export function driveFolderWebLink(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}
