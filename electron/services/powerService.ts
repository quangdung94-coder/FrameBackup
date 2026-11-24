import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type PowerActionType = 'sleep' | 'shutdown';

export async function executePowerAction(action: PowerActionType): Promise<{ ok: boolean; message: string }> {
  try {
    if (process.platform === 'win32') {
      if (action === 'sleep') {
        const psCmd =
          "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)";
        await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psCmd], { windowsHide: true });
        return { ok: true, message: 'Đang đưa máy tính Windows vào chế độ Sleep...' };
      }
      await execFileAsync('shutdown.exe', ['/s', '/t', '5'], { windowsHide: true });
      return { ok: true, message: 'Máy tính Windows sẽ tắt sau 5 giây...' };
    }

    if (process.platform === 'darwin') {
      if (action === 'sleep') {
        try {
          await execFileAsync('pmset', ['sleepnow']);
        } catch {
          await execFileAsync('osascript', ['-e', 'tell application "System Events" to sleep']);
        }
        return { ok: true, message: 'Đang đưa máy Mac vào chế độ Sleep...' };
      }
      await execFileAsync('osascript', ['-e', 'tell application "System Events" to shut down']);
      return { ok: true, message: 'Đang tắt máy Mac...' };
    }

    return { ok: false, message: `Chưa hỗ trợ lệnh ${action} trên nền tảng ${process.platform}.` };
  } catch (err) {
    return {
      ok: false,
      message: `Không thể thực hiện ${action}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
