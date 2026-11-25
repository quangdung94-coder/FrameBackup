const pad2 = (n: number) => String(n).padStart(2, '0');

/** Ngày hôm nay dạng yyyy-mm-dd (giờ máy). */
export function getTodayDateString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** Giờ hiện tại hh:mm:ss cho Live Log. */
export function formatNowClock(): string {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
