const pad2 = (n: number) => String(n).padStart(2, '0');

export function formatShortDate(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function formatDisplayDate(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-');
  if (!y || !m || !d) return yyyyMmDd;
  return `${d}/${m}/${y}`;
}

/**
 * File có thuộc ngày quay không. Chế độ xuyên đêm: file từ 00:00–03:59 ngày hôm sau vẫn tính là đúng ngày.
 * `targetDateStr` rỗng/undefined => luôn khớp.
 */
export function isTimestampMatchingTargetDate(
  shotTimeMs: number,
  targetDateStr: string | undefined,
  overnightMode = true
): boolean {
  if (!targetDateStr) return true;
  const fileKey = formatDateKey(shotTimeMs);
  if (fileKey === targetDateStr) return true;

  if (overnightMode) {
    const fileDate = new Date(shotTimeMs);
    const targetStart = new Date(`${targetDateStr}T00:00:00`);
    const nextDay = new Date(targetStart.getTime() + 24 * 60 * 60 * 1000);
    const nextDayKey = formatDateKey(nextDay.getTime());
    if (fileKey === nextDayKey && fileDate.getHours() < OVERNIGHT_CUTOFF_HOUR) {
      return true;
    }
  }
  return false;
}

/** "dd/mm/yyyy hh:mm:ss" — dùng trong file report. */
export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(
    d.getMinutes()
  )}:${pad2(d.getSeconds())}`;
}

/** "14h05" — dùng đặt tên thumbnail. */
export function formatTimeTag(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}h${pad2(d.getMinutes())}`;
}

/** Quay xuyên đêm: file trước 04:00 sáng tính vào ngày quay hôm trước. */
export const OVERNIGHT_CUTOFF_HOUR = 4;

/**
 * Ngày quay (yyyy-mm-dd) của 1 file. Dùng chung cho Date Guard, lọc và "Tách theo ngày"
 * để clip 01:30 sáng ngày 25 của show ngày 24 không bị tách sang thư mục 25.
 */
export function shootDateKey(shotTimeMs: number, targetDateStr: string | undefined, overnightMode = true): string {
  if (targetDateStr && isTimestampMatchingTargetDate(shotTimeMs, targetDateStr, overnightMode)) return targetDateStr;
  const d = new Date(shotTimeMs);
  if (overnightMode && d.getHours() < OVERNIGHT_CUTOFF_HOUR) {
    return formatDateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12).getTime());
  }
  return formatDateKey(shotTimeMs);
}
