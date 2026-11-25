/**
 * Lưu cài đặt theo máy (localStorage). Mọi hàm đều nuốt lỗi storage (private mode, quota...).
 * Key được gom về 1 chỗ để không gõ sai chuỗi ở nhiều nơi.
 */
export const STORAGE_KEYS = {
  colWeights: 'fb_col_weights',
  bottomHeight: 'fb_bottom_height',
  drive1Path: 'fb_drive1_path',
  drive2Path: 'fb_drive2_path',
  copyEngine: 'fb_copy_engine',
  packMode: 'fb_pack_mode',
  postAction: 'fb_post_action',
  postDelayMin: 'fb_post_delay_min',
  backupHistory: 'fb_backup_history',
  visibleExts: 'fb_visible_exts',
  // v2: mặc định TẮT (v1.3) — bỏ giá trị cũ (mặc định bật)
  includeSidecarXml: 'fb_include_sidecar_xml_v2',
  filterCopyVisible: 'fb_filter_copy_visible',
  loginBrowser: 'fb_login_browser',
  uploadOnlyPack: 'fb_upload_only_pack',
  sequentialRuns: 'fb_sequential_runs',
} as const;

export function loadSavedString(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function loadSavedNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const val = Number(localStorage.getItem(key));
    if (!Number.isNaN(val) && val >= min && val <= max) return val;
  } catch {
    // Ignore
  }
  return fallback;
}

/** Boolean lưu dạng "true"/"false"; chưa có => `fallback` (mặc định true). */
export function loadSavedFlag(key: string, fallback = true): boolean {
  return loadSavedString(key, fallback ? 'true' : 'false') !== 'false';
}

/** Đọc JSON, chỉ nhận khi `isValid` đúng; ngược lại trả `fallback()`. */
export function loadSavedJson<T>(key: string, isValid: (value: unknown) => value is T, fallback: () => T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isValid(parsed)) return parsed;
    }
  } catch {
    // Ignore storage errors
  }
  return fallback();
}

/** Ghi nhiều key cùng lúc (string giữ nguyên, còn lại JSON.stringify). */
export function saveToStorage(entries: Record<string, string | number | boolean | object>): void {
  try {
    for (const [key, value] of Object.entries(entries)) {
      localStorage.setItem(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
  } catch {
    // Ignore storage errors
  }
}

export const isStringArray = (v: unknown): v is string[] => Array.isArray(v);
