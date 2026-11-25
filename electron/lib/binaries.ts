/**
 * Binary đóng gói kèm app (ffmpeg-static, 7zip-bin) nằm trong app.asar.unpacked khi build.
 * Đổi đường dẫn app.asar -> app.asar.unpacked để spawn được.
 */
export function resolveUnpackedBinary(binaryPath: string): string;
export function resolveUnpackedBinary(binaryPath: string | null | undefined): string | null;
export function resolveUnpackedBinary(binaryPath: string | null | undefined): string | null {
  return binaryPath ? binaryPath.replace('app.asar', 'app.asar.unpacked') : null;
}
