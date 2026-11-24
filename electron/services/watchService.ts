import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FSWatcher } from 'chokidar';
import { isIgnoredSystemName } from './diskService';

// chokidar v4+ is pure ESM; bypass tsc CommonJS downleveling so Electron can load it cleanly
const loadChokidar = () =>
  (new Function('return import("chokidar")')() as Promise<typeof import('chokidar')>);

export interface WatchStatusEvent {
  state: 'idle' | 'watching' | 'receiving' | 'stabilizing' | 'ready' | 'error';
  watchDir: string;
  fileCount: number;
  countdownSec: number;
  lockedFiles: number;
  message: string;
}

const TEMP_EXTS = ['.tmp', '.part', '.crdownload', '.download', '.partial', '.fbpart'];

function isTempFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  if (isIgnoredSystemName(base)) return true;
  return TEMP_EXTS.some((ext) => base.endsWith(ext));
}

async function isFileWriteLocked(filePath: string): Promise<boolean> {
  let handle: fsp.FileHandle | null = null;
  try {
    handle = await fsp.open(filePath, 'r+');
    return false;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      return true;
    }
    return false;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

interface FileSnapshot {
  size: number;
  mtimeMs: number;
}

class FolderWatchController {
  private watcher: FSWatcher | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private watchDir = '';
  private debounceSec = 20;
  private lastActivityMs = 0;
  private trackedFiles = new Set<string>();
  private snapshots = new Map<string, FileSnapshot>();
  private onEvent: ((ev: WatchStatusEvent) => void) | null = null;
  private hasSeenActivity = false;
  private isChecking = false;

  async start(dirPath: string, debounceSec: number, onEvent: (ev: WatchStatusEvent) => void): Promise<void> {
    await this.stop();
    this.watchDir = dirPath;
    this.debounceSec = Math.max(5, debounceSec);
    this.lastActivityMs = Date.now();
    this.trackedFiles.clear();
    this.snapshots.clear();
    this.hasSeenActivity = false;
    this.isChecking = false;
    this.onEvent = onEvent;

    // ignoreInitial: true ensures Watch Mode only triggers on NEW incoming copy activity,
    // not pre-existing folders already stored on Drive 1.
    const chokidarMod = await loadChokidar();
    this.watcher = chokidarMod.default.watch(dirPath, {
      persistent: true,
      ignoreInitial: true,
      depth: 8,
      awaitWriteFinish: false,
    });

    const markActivity = (filePath: string) => {
      if (isIgnoredSystemName(path.basename(filePath))) return;
      this.trackedFiles.add(filePath);
      this.lastActivityMs = Date.now();
      this.hasSeenActivity = true;
    };

    this.watcher
      .on('add', markActivity)
      .on('change', markActivity)
      .on('unlink', (fp) => {
        this.trackedFiles.delete(fp);
        this.snapshots.delete(fp);
        this.lastActivityMs = Date.now();
      })
      .on('error', (err) => {
        this.emit({
          state: 'error',
          watchDir: this.watchDir,
          fileCount: this.trackedFiles.size,
          countdownSec: 0,
          lockedFiles: 0,
          message: `Lỗi Watch Folder: ${String(err)}`,
        });
      });

    this.emit({
      state: 'watching',
      watchDir: this.watchDir,
      fileCount: 0,
      countdownSec: this.debounceSec,
      lockedFiles: 0,
      message: 'Đang chờ file mới đổ vào Ổ 1 (Explorer / TeraCopy / Finder)...',
    });

    this.tickTimer = setInterval(() => {
      void this.checkStability();
    }, 1000);
  }

  private async checkStability() {
    if (!this.watcher || !this.hasSeenActivity || this.isChecking) return;
    this.isChecking = true;

    try {
      let tempCount = 0;
      let activeCount = 0;
      const sample = Array.from(this.trackedFiles).slice(-40);

      for (const fp of sample) {
        if (isTempFile(fp)) {
          tempCount += 1;
          continue;
        }
        // Check size/mtime growth across ticks (essential for macOS where locks are advisory)
        try {
          const stat = await fsp.stat(fp);
          const prev = this.snapshots.get(fp);
          if (!prev || prev.size !== stat.size || prev.mtimeMs !== stat.mtimeMs) {
            this.snapshots.set(fp, { size: stat.size, mtimeMs: stat.mtimeMs });
            if (prev) {
              activeCount += 1;
              continue;
            }
          }
        } catch {
          // File may have been renamed or removed
          this.trackedFiles.delete(fp);
          this.snapshots.delete(fp);
          continue;
        }

        // Check mandatory write lock (Windows Explorer / TeraCopy)
        if (await isFileWriteLocked(fp)) {
          activeCount += 1;
        }
      }

      const busyTotal = tempCount + activeCount;
      if (busyTotal > 0) {
        this.lastActivityMs = Date.now();
        this.emit({
          state: 'receiving',
          watchDir: this.watchDir,
          fileCount: this.trackedFiles.size,
          countdownSec: this.debounceSec,
          lockedFiles: busyTotal,
          message: `Đang nhận dữ liệu (${busyTotal} file đang ghi/tạm)...`,
        });
        return;
      }

      const elapsedSec = Math.floor((Date.now() - this.lastActivityMs) / 1000);
      const remaining = Math.max(0, this.debounceSec - elapsedSec);

      if (remaining > 0) {
        this.emit({
          state: 'stabilizing',
          watchDir: this.watchDir,
          fileCount: this.trackedFiles.size,
          countdownSec: remaining,
          lockedFiles: 0,
          message: `Không còn file đang ghi • Đếm ngược ổn định (${remaining}s)...`,
        });
      } else {
        const count = this.trackedFiles.size;
        const dir = this.watchDir;
        await this.stop();
        this.emit({
          state: 'ready',
          watchDir: dir,
          fileCount: count,
          countdownSec: 0,
          lockedFiles: 0,
          message: `Đã ổn định 100% (${count} file mới) — Kích hoạt Sao lưu Ổ 2!`,
        });
      }
    } finally {
      this.isChecking = false;
    }
  }

  async triggerNow(): Promise<void> {
    if (!this.watcher) return;
    const count = this.trackedFiles.size;
    const dir = this.watchDir;
    await this.stop();
    this.emit({
      state: 'ready',
      watchDir: dir,
      fileCount: count,
      countdownSec: 0,
      lockedFiles: 0,
      message: `Kích hoạt thủ công (${count} files) — Bắt đầu Sao lưu Ổ 2!`,
    });
  }

  async stop(): Promise<void> {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.isChecking = false;
  }

  private emit(ev: WatchStatusEvent) {
    this.onEvent?.(ev);
  }
}

export const folderWatcher = new FolderWatchController();
