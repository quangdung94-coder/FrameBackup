import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileOpResult, PathProperties, ShotDateItem, ShotDateRequestItem, ShotDatesEvent } from '../shared/types';
import { readShotDateCached } from './shotDateCache';

/** Ký tự không được có trong tên file / thư mục (Windows là khắt khe nhất). */
const INVALID_NAME = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED_WIN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function validateName(raw: string): string | null {
  const name = raw.trim().replace(/[. ]+$/, '');
  if (!name) return null;
  if (INVALID_NAME.test(name) || RESERVED_WIN.test(name) || name === '.' || name === '..') return null;
  return name;
}

const exists = async (p: string) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

/** Chuột phải > Thư mục mới. Không bao giờ ghi đè: tên đã có thì báo lỗi. */
export async function createFolder(parentDir: string, rawName: string): Promise<FileOpResult> {
  if (typeof parentDir !== 'string' || !parentDir) return { ok: false, message: 'Chưa có thư mục đang mở.' };
  const name = validateName(String(rawName ?? ''));
  if (!name) return { ok: false, message: 'Tên thư mục không hợp lệ (không dùng \\ / : * ? " < > |).' };
  const target = path.join(parentDir, name);
  if (await exists(target)) return { ok: false, message: `"${name}" đã có trong thư mục này.` };
  try {
    await fs.mkdir(target);
    return { ok: true, message: `Đã tạo thư mục ${name}`, path: target };
  } catch (err) {
    return { ok: false, message: `Không tạo được thư mục: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Chuột phải > Đổi tên (chỉ đổi tên trong cùng thư mục, không di chuyển, không ghi đè). */
export async function renamePath(fullPath: string, rawName: string): Promise<FileOpResult> {
  if (typeof fullPath !== 'string' || !fullPath) return { ok: false, message: 'Đường dẫn trống.' };
  const name = validateName(String(rawName ?? ''));
  if (!name) return { ok: false, message: 'Tên mới không hợp lệ (không dùng \\ / : * ? " < > |).' };
  const target = path.join(path.dirname(fullPath), name);
  if (target === fullPath) return { ok: true, message: 'Tên không đổi.', path: fullPath };
  // Đổi hoa/thường trên Windows/macOS: cùng file => cho phép
  const sameIgnoringCase = target.toLowerCase() === fullPath.toLowerCase();
  if (!sameIgnoringCase && (await exists(target))) return { ok: false, message: `"${name}" đã có trong thư mục này.` };
  try {
    await fs.rename(fullPath, target);
    return { ok: true, message: `Đã đổi tên thành ${name}`, path: target };
  } catch (err) {
    return { ok: false, message: `Không đổi tên được: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const PROPS_MAX_ENTRIES = 300_000;
const PROPS_MAX_MS = 20_000;

/** Chuột phải > Thuộc tính: dung lượng, số file / thư mục bên trong, ngày tạo / sửa. */
export async function getPathProperties(fullPath: string): Promise<PathProperties> {
  const base: PathProperties = {
    ok: false,
    name: path.basename(fullPath) || fullPath,
    fullPath,
    isDirectory: false,
    sizeBytes: 0,
    files: 0,
    folders: 0,
    createdMs: 0,
    modifiedMs: 0,
  };
  try {
    const st = await fs.stat(fullPath);
    base.ok = true;
    base.isDirectory = st.isDirectory();
    base.createdMs = st.birthtimeMs || st.ctimeMs;
    base.modifiedMs = st.mtimeMs;
    if (!base.isDirectory) {
      base.sizeBytes = st.size;
      return base;
    }
    const started = Date.now();
    let seen = 0;
    const stack = [fullPath];
    while (stack.length > 0) {
      if (seen > PROPS_MAX_ENTRIES || Date.now() - started > PROPS_MAX_MS) {
        base.partial = true;
        break;
      }
      const dir = stack.pop()!;
      let dirents;
      try {
        dirents = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const d of dirents) {
        seen += 1;
        const p = path.join(dir, d.name);
        if (d.isDirectory()) {
          base.folders += 1;
          stack.push(p);
        } else if (d.isFile()) {
          base.files += 1;
          try {
            base.sizeBytes += (await fs.stat(p)).size;
          } catch {
            // file vừa bị xoá
          }
        }
      }
    }
    return base;
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---- Đọc ngày chụp ngầm ----
const shotJobs = new Map<string, { cancelled: boolean }>();

export function cancelShotDates(key: string) {
  const job = shotJobs.get(key);
  if (job) job.cancelled = true;
  shotJobs.delete(key);
}

/**
 * Đọc ngày chụp của danh sách file (có nhớ), gửi kết quả từng đợt (~0,25 giây/đợt) để danh sách cập nhật dần.
 * Yêu cầu mới cùng `key` huỷ yêu cầu cũ (đổi thẻ / quét lại).
 */
export async function readShotDates(key: string, items: ShotDateRequestItem[], emit: (ev: ShotDatesEvent) => void) {
  cancelShotDates(key);
  const job = { cancelled: false };
  shotJobs.set(key, job);
  const total = items.length;
  let done = 0;
  let pending: ShotDateItem[] = [];
  let lastEmit = Date.now();
  const flush = (finished: boolean) => {
    if (job.cancelled) return;
    emit({ key, items: pending, done, total, finished });
    pending = [];
    lastEmit = Date.now();
  };

  let next = 0;
  const worker = async () => {
    while (!job.cancelled && next < items.length) {
      const it = items[next++];
      try {
        const meta = await readShotDateCached(it.fullPath, it.sizeBytes, it.mtimeMs);
        pending.push({ fullPath: it.fullPath, shotTimeMs: meta.shotTimeMs, dateSource: meta.dateSource });
      } catch {
        pending.push({ fullPath: it.fullPath, shotTimeMs: it.mtimeMs, dateSource: 'mtime' });
      }
      done += 1;
      if (Date.now() - lastEmit > 250) flush(false);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, Math.max(1, items.length)) }, worker));
  flush(true);
  if (shotJobs.get(key) === job) shotJobs.delete(key);
}
