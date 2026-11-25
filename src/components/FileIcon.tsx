import { Camera, FileText, Film, Folder } from 'lucide-react';
import type { DriveRemoteFile, FileEntry } from '../types/framebackup';

export function FileIcon({ type }: { type: FileEntry['mediaType'] }) {
  if (type === 'folder') return <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
  if (type === 'video') return <Film className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
  if (type === 'raw' || type === 'photo') return <Camera className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  return <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />;
}

/** Loại icon cho file trên Google Drive (theo mimeType). */
export function remoteFileMediaType(rf: DriveRemoteFile): FileEntry['mediaType'] {
  if (rf.isFolder) return 'folder';
  if (rf.mimeType.startsWith('video/')) return 'video';
  if (rf.mimeType.startsWith('image/')) return 'photo';
  return 'other';
}
