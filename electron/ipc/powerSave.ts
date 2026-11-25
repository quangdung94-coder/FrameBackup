import { powerSaveBlocker } from 'electron';

/** Trạng thái "Chống Sleep" (powerSaveBlocker) dùng chung cho IPC system & lúc thoát app. */
let powerSaveId: number | null = null;

export function isPreventSleepActive(): boolean {
  return powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId);
}

export function setPreventSleep(enabled: boolean): boolean {
  if (enabled) {
    if (powerSaveId === null || !powerSaveBlocker.isStarted(powerSaveId)) {
      powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
    }
    return true;
  }
  if (powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveBlocker.stop(powerSaveId);
  }
  powerSaveId = null;
  return false;
}

/** Tắt chống Sleep trước khi Sleep/Shutdown máy. */
export function releasePreventSleep(): void {
  if (powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveBlocker.stop(powerSaveId);
    powerSaveId = null;
  }
}

/** Dọn dẹp khi đóng app (giữ nguyên hành vi cũ: không reset id). */
export function stopPreventSleepOnQuit(): void {
  if (powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveBlocker.stop(powerSaveId);
  }
}
