import type { LocationStats, MediaKind, TypeCounts } from './types';

/** Thứ tự & nhãn hiển thị các loại file trong báo cáo. */
export const MEDIA_KIND_LABELS: [MediaKind, string][] = [
  ['video', 'Video (MP4/MOV...)'],
  ['xml', 'File kèm XML'],
  ['raw', 'Ảnh RAW'],
  ['photo', 'Ảnh JPG/HEIC'],
  ['other', 'Khác'],
];

export const emptyTypeCounts = (): TypeCounts => ({ video: 0, xml: 0, raw: 0, photo: 0, other: 0 });

/** Loại file cho báo cáo: XML theo đuôi, còn lại theo mediaType đã quét. */
export function mediaKindOf(extension: string, mediaType: string): MediaKind {
  if (extension.toLowerCase() === '.xml') return 'xml';
  if (mediaType === 'video' || mediaType === 'raw' || mediaType === 'photo') return mediaType;
  return 'other';
}

export function statsOf(files: { extension: string; mediaType: string; sizeBytes: number; isDirectory?: boolean }[]): LocationStats {
  const byType = emptyTypeCounts();
  let bytes = 0;
  let count = 0;
  for (const f of files) {
    if (f.isDirectory) continue;
    byType[mediaKindOf(f.extension, f.mediaType)] += 1;
    bytes += f.sizeBytes;
    count += 1;
  }
  return { files: count, bytes, byType };
}

/** "C0001 (2).MP4" -> "c0001.mp4" (bỏ hậu tố đổi tên khi so tên file giữa các nơi lưu). */
export function baseCompareName(name: string): string {
  return name.toLowerCase().replace(/ \(\d+\)(\.[^.]*)?$/, '$1');
}
