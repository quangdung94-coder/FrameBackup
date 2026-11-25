import { ipcMain } from 'electron';
import { detectCopyEngines } from '../services/copyEngineService';
import { cancelActiveCopy, preflightCopy, runCopyAndVerify } from '../services/copyVerifyService';
import { inspectAndBuildReport } from '../services/mediaInspectorService';
import { cancelPackaging, packageForDrive } from '../services/packagingService';
import { buildBackupReport } from '../services/reportService';
import { flushVerifyLedger, getShowLedger } from '../services/verifyLedger';
import { folderWatcher } from '../services/watchService';
import { IPC, IPC_EVENTS } from '../shared/ipcChannels';
import type {
  BuildReportRequest,
  CopyVerifyRequest,
  InspectReportRequest,
  PackageRequest,
  WatchExpectedFile,
} from '../shared/types';
import type { IpcContext } from './context';

const optId = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** Copy & Verify, Watch Mode, Media Report, Đóng gói. Mọi job mang jobId của khu vực thẻ (tab). */
export function registerPipelineIpc(ctx: IpcContext) {
  // Phase 2: Copy & Verify + External Engines
  ipcMain.handle(IPC.copy.listEngines, async () => detectCopyEngines());
  ipcMain.handle(IPC.copy.start, async (_event, req: CopyVerifyRequest) =>
    runCopyAndVerify(req, (progress) => ctx.send(IPC_EVENTS.copyProgress, progress))
  );
  ipcMain.handle(IPC.copy.cancel, (_event, jobId?: string) => cancelActiveCopy(optId(jobId)));
  ipcMain.handle(IPC.copy.preflight, async (_event, req: CopyVerifyRequest) => preflightCopy(req));

  // Phase 2: Watch Mode
  ipcMain.handle(
    IPC.watch.start,
    async (_event, dirPath: string, debounceSec: number, expected?: WatchExpectedFile[], jobId?: string) => {
      await folderWatcher.start(optId(jobId), dirPath, debounceSec, (status) => ctx.send(IPC_EVENTS.watchStatus, status), expected);
    }
  );
  ipcMain.handle(IPC.watch.stop, async (_event, jobId?: string) => {
    await folderWatcher.stop(optId(jobId));
  });
  ipcMain.handle(IPC.watch.triggerNow, async (_event, jobId?: string) => {
    await folderWatcher.triggerNow(optId(jobId));
  });

  // Phase 3: Media Inspector, Packaging & Report
  ipcMain.handle(IPC.media.inspectAndReport, async (_event, req: InspectReportRequest) => inspectAndBuildReport(req));
  ipcMain.handle(IPC.media.buildReport, async (_event, req: BuildReportRequest) => buildBackupReport(req));
  ipcMain.handle(IPC.media.showLedger, async (_event, showDir: string) => getShowLedger(String(showDir || '')));
  ipcMain.handle(IPC.pack.start, async (_event, req: PackageRequest) =>
    packageForDrive(req, (progress) => ctx.send(IPC_EVENTS.packageProgress, { ...progress, jobId: req.jobId }))
  );
  ipcMain.handle(IPC.pack.cancel, (_event, jobId?: string) => cancelPackaging(optId(jobId)));
}

/** Dừng mọi job đang chạy khi đóng app. */
export async function stopPipelineJobs() {
  await folderWatcher.stop();
  cancelActiveCopy();
  cancelPackaging();
  await flushVerifyLedger();
}
