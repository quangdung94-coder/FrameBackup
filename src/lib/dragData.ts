/** Kiểu dữ liệu kéo-thả nội bộ giữa các cột. */
export const DRAG_TYPES = {
  /** Cột 1 (Thẻ nhớ) -> Cột 2 (Ổ 1) */
  cardFiles: 'application/x-framebackup-files',
  /** Cột 2 (Ổ 1) -> Cột 3 (Ổ 2) */
  drive1Files: 'application/x-framebackup-drive1',
  /** Cột 3 (Ổ 2) -> Cột 4 (Google Drive) */
  drive2Files: 'application/x-framebackup-drive2',
} as const;

export type DragType = (typeof DRAG_TYPES)[keyof typeof DRAG_TYPES];

export function writeDragPaths(dt: DataTransfer, type: DragType, paths: string[]): void {
  dt.setData(type, JSON.stringify(paths));
  dt.effectAllowed = 'copy';
}

/** Đọc danh sách đường dẫn đã thả; null nếu rỗng / sai định dạng. */
export function readDragPaths(dt: DataTransfer, type: DragType): string[] | null {
  const raw = dt.getData(type);
  if (!raw) return null;
  try {
    const paths = JSON.parse(raw) as string[];
    if (Array.isArray(paths) && paths.length > 0) return paths;
  } catch {
    // Ignore malformed drop
  }
  return null;
}
