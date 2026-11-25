import type { IpcContext } from './context';
import { registerDiskIpc } from './diskIpc';
import { registerDriveIpc, stopDriveJobs } from './driveIpc';
import { registerPipelineIpc, stopPipelineJobs } from './pipelineIpc';
import { stopPreventSleepOnQuit } from './powerSave';
import { registerSystemIpc } from './systemIpc';

export { createIpcContext } from './context';

export function registerIpcHandlers(ctx: IpcContext) {
  registerSystemIpc(ctx);
  registerDiskIpc(ctx);
  registerPipelineIpc(ctx);
  registerDriveIpc(ctx);
}

/** Dừng watcher, hủy copy / đóng gói / upload, tắt chống Sleep — gọi khi đóng hết cửa sổ. */
export async function shutdownBackgroundJobs() {
  await stopPipelineJobs();
  stopDriveJobs();
  stopPreventSleepOnQuit();
}
