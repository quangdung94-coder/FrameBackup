import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function safeEjectDrive(mountPath: string): Promise<{ ok: boolean; message: string }> {
  if (!mountPath) return { ok: false, message: 'Chưa chọn ổ đĩa / thẻ nhớ để Eject.' };

  try {
    if (process.platform === 'win32') {
      const driveLetterMatch = mountPath.match(/^([A-Za-z]:)/);
      if (!driveLetterMatch) {
        return { ok: false, message: 'Đường dẫn không phải ổ đĩa hợp lệ trên Windows.' };
      }
      const driveLetter = driveLetterMatch[1].toUpperCase();
      const psCmd = `(New-Object -ComObject Shell.Application).Namespace(17).ParseName('${driveLetter}').InvokeVerb('Eject')`;
      await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psCmd], { windowsHide: true });
      return { ok: true, message: `Đã gửi lệnh Safe Eject cho thẻ ${driveLetter}.` };
    }

    if (process.platform === 'darwin') {
      await execFileAsync('diskutil', ['eject', mountPath]);
      return { ok: true, message: `Đã Eject an toàn ${mountPath}.` };
    }

    return { ok: false, message: `Chưa hỗ trợ Eject tự động trên nền tảng ${process.platform}.` };
  } catch (err) {
    return {
      ok: false,
      message: `Không thể Eject (có thể file đang mở): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
