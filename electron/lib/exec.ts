import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** execFile dạng Promise — dùng chung cho mọi service gọi lệnh hệ thống (powershell, df, diskutil, ffmpeg...). */
export const execFileAsync = promisify(execFile);

/** Chạy 1 lệnh PowerShell không profile, ẩn cửa sổ. */
export function runPowerShell(command: string, options: { timeout?: number } = {}) {
  return execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true, ...options });
}
