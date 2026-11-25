import type { DateGroupSummary } from '../components/DateMismatchAlert';
import { isTimestampMatchingTargetDate, shootDateKey, type DateFilterMode, type FileEntry } from '../types/framebackup';

const isRealMedia = (f: FileEntry) =>
  !f.isDirectory && f.sizeBytes > 0 && (f.mediaType === 'video' || f.mediaType === 'photo' || f.mediaType === 'raw');

/**
 * Date Guard: gom file media thật (video/photo/raw, size > 0) theo ngày quay.
 * File index 0 byte của máy quay (vd. SONYCARD.IND năm 2009) không bao giờ gây cảnh báo giả.
 * Nhóm đúng ngày luôn đứng đầu.
 */
export function buildDateGroups(files: FileEntry[], targetDate: string, overnightMode: boolean): DateGroupSummary[] {
  const map = new Map<string, DateGroupSummary>();
  for (const f of files) {
    if (!isRealMedia(f) || f.dateSource === 'pending') continue; // chưa đọc xong ngày chụp
    const isMatch = isTimestampMatchingTargetDate(f.shotTimeMs, targetDate, overnightMode);
    // Cùng quy tắc "qua đêm" với lúc chép tách theo ngày (file 0h–4h tính vào ngày hôm trước)
    const key = isMatch ? targetDate : shootDateKey(f.shotTimeMs, targetDate, overnightMode);
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalBytes += f.sizeBytes;
    } else {
      map.set(key, { dateKey: key, count: 1, totalBytes: f.sizeBytes, isTarget: isMatch });
    }
  }
  return Array.from(map.values()).sort((a, b) => Number(b.isTarget) - Number(a.isTarget));
}

/** Số file lệch ngày (không thuộc nhóm đúng ngày). */
export function countMismatchFiles(groups: DateGroupSummary[]): number {
  return groups.filter((g) => !g.isTarget).reduce((acc, g) => acc + g.count, 0);
}

/** Đếm số file theo đuôi (cho chip lọc nhanh), nhiều nhất trước. */
export function countExtensions(files: FileEntry[]): [string, number][] {
  const map = new Map<string, number>();
  for (const f of files) {
    if (f.isDirectory || !f.extension) continue;
    const ext = f.extension.toLowerCase();
    map.set(ext, (map.get(ext) ?? 0) + 1);
  }
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

export interface CardFileFilter {
  dateFilterMode: DateFilterMode;
  targetDate: string;
  overnightMode: boolean;
  /** 'all' | 'preset' (theo cài đặt) | '.mp4' ... */
  quickExtFilter: string;
  visibleExtensions: string[];
}

/** Danh sách file hiển thị ở Cột 1 sau lọc ngày + lọc đuôi. Thư mục luôn hiện. */
export function filterCardFiles(files: FileEntry[], opts: CardFileFilter): FileEntry[] {
  const visibleSet = new Set(opts.visibleExtensions.map((e) => e.toLowerCase()));
  return files.filter((f) => {
    if (opts.dateFilterMode === 'target-only' && !f.isDirectory) {
      if (!isTimestampMatchingTargetDate(f.shotTimeMs, opts.targetDate, opts.overnightMode)) return false;
    }
    if (f.isDirectory) return true;
    const ext = f.extension.toLowerCase();
    if (opts.quickExtFilter === 'all') return true;
    if (opts.quickExtFilter === 'preset') return visibleSet.has(ext);
    return ext === opts.quickExtFilter;
  });
}

export function sumBytes(files: FileEntry[]): number {
  return files.reduce((acc, f) => acc + f.sizeBytes, 0);
}

/** Số file XML (Sony C0001M01.XML) sẽ được kèm theo video khi bật "Kèm XML theo video" — giống cách main ghép. */
export function countSidecarXml(copySet: FileEntry[], allFiles: FileEntry[]): number {
  const stem = (n: string) => n.replace(/\.[^.]*$/, '').toLowerCase();
  const stems = new Set(copySet.filter((f) => f.mediaType === 'video').map((f) => stem(f.name)));
  if (stems.size === 0) return 0;
  const queued = new Set(copySet.map((f) => f.fullPath.toLowerCase()));
  let n = 0;
  for (const f of allFiles) {
    if (f.isDirectory || f.extension.toLowerCase() !== '.xml' || queued.has(f.fullPath.toLowerCase())) continue;
    const b = stem(f.name);
    if (stems.has(b) || (b.endsWith('m01') && stems.has(b.slice(0, -3)))) n += 1;
  }
  return n;
}
