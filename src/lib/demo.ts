import type { FileEntry } from '../types/framebackup';

/** Dữ liệu thẻ nhớ mô phỏng có file lệch ngày (nút "Test Lệch ngày"). */
export function createDemoCardFiles(targetDate: string): FileEntry[] {
  const base = new Date(`${targetDate}T08:15:10`).getTime();
  const oldTwoDays = base - 2 * 24 * 60 * 60 * 1000;
  return [
    { name: 'C0001_CamA.MP4', relativePath: 'C0001_CamA.MP4', fullPath: 'DEMO/C0001_CamA.MP4', isDirectory: false, sizeBytes: 4.12 * 1024 ** 3, mtimeMs: base, shotTimeMs: base, dateSource: 'video-atom', mediaType: 'video', extension: '.mp4' },
    { name: 'C0002_CamA.MP4', relativePath: 'C0002_CamA.MP4', fullPath: 'DEMO/C0002_CamA.MP4', isDirectory: false, sizeBytes: 6.85 * 1024 ** 3, mtimeMs: base + 5200_000, shotTimeMs: base + 5200_000, dateSource: 'video-atom', mediaType: 'video', extension: '.mp4' },
    { name: 'C0891_OldCard.MP4', relativePath: 'C0891_OldCard.MP4', fullPath: 'DEMO/C0891_OldCard.MP4', isDirectory: false, sizeBytes: 2.4 * 1024 ** 3, mtimeMs: oldTwoDays, shotTimeMs: oldTwoDays, dateSource: 'video-atom', mediaType: 'video', extension: '.mp4' },
    { name: '_DSC0892.ARW', relativePath: '_DSC0892.ARW', fullPath: 'DEMO/_DSC0892.ARW', isDirectory: false, sizeBytes: 44 * 1024 ** 2, mtimeMs: oldTwoDays + 300_000, shotTimeMs: oldTwoDays + 300_000, dateSource: 'exif', mediaType: 'raw', extension: '.arw' },
    { name: 'C0003_CamA.MP4', relativePath: 'C0003_CamA.MP4', fullPath: 'DEMO/C0003_CamA.MP4', isDirectory: false, sizeBytes: 5.3 * 1024 ** 3, mtimeMs: base + 38000_000, shotTimeMs: base + 38000_000, dateSource: 'video-atom', mediaType: 'video', extension: '.mp4' },
    { name: '_DSC1001.ARW', relativePath: '_DSC1001.ARW', fullPath: 'DEMO/_DSC1001.ARW', isDirectory: false, sizeBytes: 42.5 * 1024 ** 2, mtimeMs: base + 21000_000, shotTimeMs: base + 21000_000, dateSource: 'exif', mediaType: 'raw', extension: '.arw' },
  ];
}
