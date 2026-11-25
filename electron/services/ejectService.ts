import { execFileAsync, runPowerShell } from '../lib/exec';
import type { ActionResult } from '../shared/types';

export async function safeEjectDrive(mountPath: string): Promise<ActionResult> {
  if (!mountPath) return { ok: false, message: 'Chưa chọn ổ đĩa / thẻ nhớ để Eject.' };

  try {
    if (process.platform === 'win32') {
      const driveLetterMatch = mountPath.match(/^([A-Za-z]:)/);
      if (!driveLetterMatch) {
        return { ok: false, message: 'Đường dẫn không phải ổ đĩa hợp lệ trên Windows.' };
      }
      const driveLetter = driveLetterMatch[1].toUpperCase();
      // Guard: only allow ejecting Removable drives (DriveType = 2)
      const checkCmd = `(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${driveLetter}'").DriveType`;
      const { stdout } = await runPowerShell(checkCmd);
      if (stdout.trim() !== '2') {
        return {
          ok: false,
          message: `Ổ ${driveLetter} là ổ cứng cố định (không phải thẻ nhớ rời) nên không thể Eject.`,
        };
      }

      const psCmd = `(New-Object -ComObject Shell.Application).Namespace(17).ParseName('${driveLetter}').InvokeVerb('Eject')`;
      await runPowerShell(psCmd);
      return { ok: true, message: `Đã gửi lệnh Safe Eject cho thẻ nhớ ${driveLetter}.` };
    }

    if (process.platform === 'darwin') {
      const volMatch = mountPath.match(/^(\/Volumes\/[^/]+)/);
      if (!volMatch) {
        return { ok: false, message: 'Chỉ có thể Eject ổ đĩa/thẻ nhớ rời trong /Volumes/.' };
      }
      const volumeRoot = volMatch[1];
      await execFileAsync('diskutil', ['eject', volumeRoot]);
      return { ok: true, message: `Đã Eject an toàn ${volumeRoot}.` };
    }

    return { ok: false, message: `Chưa hỗ trợ Eject tự động trên nền tảng ${process.platform}.` };
  } catch (err) {
    return {
      ok: false,
      message: `Không thể Eject (có thể file đang mở): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
