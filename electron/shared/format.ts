/** Định dạng dung lượng: 1536 -> "1.50 KB". Dùng chung main + renderer + report. */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val >= 100 ? val.toFixed(0) : val >= 10 ? val.toFixed(1) : val.toFixed(2)} ${units[i]}`;
}

/** MB/s tính từ số byte và mốc bắt đầu (tối thiểu 0.1s để tránh chia 0). */
export function calcSpeedMBs(bytes: number, startedAt: number, now: number = Date.now()): number {
  const elapsedSec = Math.max((now - startedAt) / 1000, 0.1);
  return Number((bytes / (1024 * 1024) / elapsedSec).toFixed(1));
}

/** % tiến trình, chặn ở 99 cho tới khi bước "completed" tự đặt 100. */
export function calcPercent(done: number, total: number): number {
  return total > 0 ? Math.min(99, Math.round((done / total) * 100)) : 0;
}
