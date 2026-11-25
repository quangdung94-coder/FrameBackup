import fs from 'node:fs/promises';
import type { DriveInfo } from '../shared/types';
import { listSystemDrives } from './diskService';

/**
 * Tự nhận thẻ / ổ cứng khi cắm hoặc rút (v1.4).
 * Mỗi 2 giây chỉ làm việc rất nhẹ: Windows = thử từng ký tự ổ A–Z, macOS = đọc /Volumes.
 * Chỉ khi danh sách thay đổi mới đọc lại đầy đủ (tên ổ, dung lượng) rồi báo cho giao diện.
 */
const POLL_MS = 2_000;

let timer: NodeJS.Timeout | null = null;
let lastSig = '';
let busy = false;

async function signature(): Promise<string> {
  if (process.platform === 'win32') {
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const present = await Promise.all(
      letters.map(async (l) => {
        try {
          await fs.access(`${l}:\\`);
          return l;
        } catch {
          return '';
        }
      })
    );
    return present.filter(Boolean).join('');
  }
  try {
    return (await fs.readdir('/Volumes')).sort().join('|');
  } catch {
    return '';
  }
}

export function startDriveWatcher(onChange: (drives: DriveInfo[]) => void) {
  stopDriveWatcher();
  void signature().then((s) => (lastSig = s));
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const sig = await signature();
      if (sig !== lastSig) {
        lastSig = sig;
        onChange(await listSystemDrives());
      }
    } catch {
      // bỏ qua, thử lại lượt sau
    } finally {
      busy = false;
    }
  }, POLL_MS);
}

export function stopDriveWatcher() {
  if (timer) clearInterval(timer);
  timer = null;
}
