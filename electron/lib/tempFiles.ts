import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Ghi danh sách (mỗi dòng 1 đường dẫn) vào file tạm trong thư mục temp của OS. Trả về đường dẫn file. */
export async function writeTempListFile(prefix: string, lines: string[], eol: '\n' | '\r\n' = '\n'): Promise<string> {
  const filePath = path.join(os.tmpdir(), `${prefix}_${Date.now()}.txt`);
  await fsp.writeFile(filePath, lines.join(eol), 'utf8');
  return filePath;
}

/** Xóa file, bỏ qua lỗi (không tồn tại, đang khóa...). */
export async function unlinkQuietly(filePath: string | null | undefined): Promise<void> {
  if (!filePath) return;
  await fsp.unlink(filePath).catch(() => {});
}

/** Thư mục staging chung trong temp của OS: <tmp>/framebackup_staging/<name>. */
export function osStagingDir(safeName: string): string {
  return path.join(os.tmpdir(), 'framebackup_staging', safeName);
}
