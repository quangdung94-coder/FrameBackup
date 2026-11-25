import fs from 'node:fs';

/**
 * Binary đóng gói kèm app (ffmpeg-static, 7zip-bin) nằm trong app.asar.unpacked khi build.
 * Đổi đường dẫn app.asar -> app.asar.unpacked để spawn được, và đảm bảo quyền thực thi (+x) trên macOS/Linux.
 */
export function resolveUnpackedBinary(binaryPath: string): string;
export function resolveUnpackedBinary(binaryPath: string | null | undefined): string | null;
export function resolveUnpackedBinary(binaryPath: string | null | undefined): string | null {
  if (!binaryPath) return null;
  const resolved = binaryPath.replace('app.asar', 'app.asar.unpacked');
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(resolved, 0o755);
    } catch {
      // Bỏ qua nếu hệ thống file chỉ đọc hoặc file không tồn tại
    }
  }
  return resolved;
}
