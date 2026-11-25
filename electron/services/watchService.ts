import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FSWatcher } from 'chokidar';
import type { WatchExpectedFile, WatchStatusEvent } from '../shared/types';
import { isIgnoredSystemName } from './diskService';

// chokidar v4+ is pure ESM; bypass tsc CommonJS downleveling so Electron can load it cleanly
const loadChokidar = () =>
  (new Function('return import("chokidar")')() as Promise<typeof import('chokidar')>);

export type { WatchStatusEvent } from '../shared/types';

/** Thời điểm đổi gần nhất đã ghi nhận của file (0 nếu chưa có). */
const stat0 = (snap: FileSnapshot | undefined) => snap?.mtimeMs ?? 0;

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

function expectedKey(name: string, sizeBytes: number): string {
  return `${name.toLowerCase()}|${sizeBytes}`;
}

/** Số file nguồn (theo tên + dung lượng) đã có mặt trong danh sách file Ổ 1. */
function countMatched(expected: Map<string, number>, present: Map<string, number>): number {
  let matched = 0;
  for (const [key, need] of expected) {
    matched += Math.min(need, present.get(key) ?? 0);
  }
  return matched;
}

/** Đếm mọi file đang có trong thư mục canh (kể cả file đã có TRƯỚC khi bật Watch). */
async function scanPresent(dir: string, out = new Map<string, number>(), depth = 0): Promise<{ present: Map<string, number>; total: number }> {
  let total = 0;
  if (depth <= 8) {
    let dirents: import('node:fs').Dirent[] = [];
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      dirents = [];
    }
    for (const d of dirents) {
      if (isIgnoredSystemName(d.name)) continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        total += (await scanPresent(full, out, depth + 1)).total;
      } else if (d.isFile() && !isTempFile(full)) {
        try {
          const st = await fsp.stat(full);
          const key = expectedKey(d.name, st.size);
          out.set(key, (out.get(key) ?? 0) + 1);
          total += 1;
        } catch {
          // file vừa bị xoá / đổi tên
        }
      }
    }
  }
  return { present: out, total };
}

/** Không quét lại toàn bộ thư mục mỗi giây — cách nhau tối thiểu (ms). */
const PRESENCE_SCAN_INTERVAL_MS = 3000;

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
  /** Đếm số lần cần mỗi cặp "tên|dung lượng" của file nguồn (thẻ). */
  private expected = new Map<string, number>();
  private expectedTotal = 0;
  private lastMatched = 0;
  private lastPresenceScanMs = 0;
  private presentTotal = 0;
  private lastPresent = new Map<string, number>();

  constructor(private readonly jobId?: string) {}

  async start(
    dirPath: string,
    debounceSec: number,
    onEvent: (ev: WatchStatusEvent) => void,
    expectedFiles: WatchExpectedFile[] = []
  ): Promise<void> {
    await this.stop();
    this.expected.clear();
    for (const f of expectedFiles) {
      const key = expectedKey(f.name, f.sizeBytes);
      this.expected.set(key, (this.expected.get(key) ?? 0) + 1);
    }
    this.expectedTotal = expectedFiles.length;
    this.lastMatched = 0;
    this.watchDir = dirPath;
    this.debounceSec = Math.max(5, debounceSec);
    this.lastActivityMs = Date.now();
    this.trackedFiles.clear();
    this.snapshots.clear();
    this.hasSeenActivity = false;
    this.isChecking = false;
    this.onEvent = onEvent;
    this.lastPresenceScanMs = 0;
    this.presentTotal = 0;
    this.lastPresent = new Map();

    // ignoreInitial: true => chokidar chỉ báo file MỚI (để biết còn đang chép hay đã yên).
    // Việc đếm "đủ file so với thẻ" thì quét cả thư mục (scanPresent), nên file chép TRƯỚC khi bật Watch vẫn được tính.
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
          fileCount: Math.max(this.presentTotal, this.trackedFiles.size),
          countdownSec: 0,
          lockedFiles: 0,
          message: `Lỗi Watch Folder: ${String(err)}`,
        });
      });

    // Đã biết thẻ nguồn: đếm ngay các file đã có sẵn. Nếu đã có file khớp thẻ thì bắt đầu đếm ngược luôn
    // (trước đây phải chờ có file MỚI thì mới đếm => báo "0/6" dù Ổ 1 đã đủ file).
    if (this.expectedTotal > 0) {
      await this.refreshPresence(true);
      if (this.lastMatched > 0) this.hasSeenActivity = true;
    }

    this.emit({
      state: 'watching',
      watchDir: this.watchDir,
      fileCount: this.presentTotal,
      countdownSec: this.debounceSec,
      lockedFiles: 0,
      message:
        this.expectedTotal > 0
          ? `Đang canh Ổ 1: đã có ${this.lastMatched}/${this.expectedTotal} file khớp thẻ...`
          : 'Đang chờ file mới đổ vào Ổ 1 (Explorer / TeraCopy / Finder)...',
      expectedFiles: this.expectedTotal,
      matchedFiles: this.lastMatched,
    });

    this.tickTimer = setInterval(() => {
      void this.checkStability();
    }, 1000);
  }

  /** Quét lại cả thư mục để đếm file khớp thẻ (tên + dung lượng). */
  private async refreshPresence(force = false) {
    const now = Date.now();
    if (!force && now - this.lastPresenceScanMs < PRESENCE_SCAN_INTERVAL_MS) return;
    this.lastPresenceScanMs = now;
    const { present, total } = await scanPresent(this.watchDir);
    this.lastPresent = present;
    this.presentTotal = total;
    this.lastMatched = this.expectedTotal > 0 ? countMatched(this.expected, present) : 0;
  }

  private async checkStability() {
    if (!this.watcher || !this.hasSeenActivity || this.isChecking) return;
    this.isChecking = true;

    try {
      let tempCount = 0;
      let activeCount = 0;
      // Kiểm tra TẤT CẢ file đã nhận (trước đây chỉ 40 file cuối => dễ báo xong khi còn file đang ghi).
      const now = Date.now();
      for (const fp of Array.from(this.trackedFiles)) {
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

        // Check mandatory write lock (Windows Explorer / TeraCopy) — chỉ file mới đổi gần đây cho nhẹ
        const recentlyChanged = now - stat0(this.snapshots.get(fp)) < (this.debounceSec + 10) * 1000;
        if (recentlyChanged && (await isFileWriteLocked(fp))) {
          activeCount += 1;
        }
      }

      if (this.expectedTotal > 0) await this.refreshPresence();
      const matched = this.lastMatched;
      const progressInfo = { expectedFiles: this.expectedTotal, matchedFiles: matched };

      const busyTotal = tempCount + activeCount;
      if (busyTotal > 0) {
        this.lastActivityMs = Date.now();
        this.emit({
          state: 'receiving',
          watchDir: this.watchDir,
          fileCount: Math.max(this.presentTotal, this.trackedFiles.size),
          countdownSec: this.debounceSec,
          lockedFiles: busyTotal,
          message: `Đang nhận dữ liệu (${busyTotal} file đang ghi/tạm)...`,
          ...progressInfo,
        });
        return;
      }

      const elapsedSec = Math.floor((Date.now() - this.lastActivityMs) / 1000);
      const remaining = Math.max(0, this.debounceSec - elapsedSec);

      // Biết thẻ nguồn: chỉ coi là xong khi Ổ 1 có đủ mọi file của thẻ (đúng tên + dung lượng).
      // Explorer đang chờ hộp "Replace / Skip" hay đầu đọc thẻ chậm sẽ không bị tưởng là đã chép xong.
      if (remaining === 0 && this.expectedTotal > 0 && matched < this.expectedTotal) {
        this.emit({
          state: 'stabilizing',
          watchDir: this.watchDir,
          fileCount: Math.max(this.presentTotal, this.trackedFiles.size),
          countdownSec: 0,
          lockedFiles: 0,
          message: `Chờ đủ file từ thẻ: mới có ${matched}/${this.expectedTotal} file khớp tên & dung lượng. Bấm "Chạy ngay" nếu anh cố ý chép thiếu.`,
          ...progressInfo,
        });
        return;
      }

      // Vừa đủ file => quét lại ngay lần cuối trước khi báo xong (tránh lệch 3 giây)
      if (remaining === 0 && this.expectedTotal > 0) {
        await this.refreshPresence(true);
        if (this.lastMatched < this.expectedTotal) return;
      }

      if (remaining > 0) {
        this.emit({
          state: 'stabilizing',
          watchDir: this.watchDir,
          fileCount: Math.max(this.presentTotal, this.trackedFiles.size),
          countdownSec: remaining,
          lockedFiles: 0,
          message: `Không còn file đang ghi • Đếm ngược ổn định (${remaining}s)...`,
          ...progressInfo,
        });
      } else {
        const count = Math.max(this.presentTotal, this.trackedFiles.size);
        const dir = this.watchDir;
        const info = { expectedFiles: this.expectedTotal, matchedFiles: this.lastMatched };
        await this.stop();
        this.emit({
          state: 'ready',
          watchDir: dir,
          fileCount: count,
          countdownSec: 0,
          lockedFiles: 0,
          message:
            this.expectedTotal > 0
              ? `Đã đủ ${info.matchedFiles}/${info.expectedFiles} file khớp thẻ & ổn định — chạy tiếp!`
              : `Đã ổn định 100% (${count} file mới) — Kích hoạt Sao lưu Ổ 2!`,
          ...info,
          incomplete: false,
        });
      }
    } finally {
      this.isChecking = false;
    }
  }

  async triggerNow(): Promise<void> {
    if (!this.watcher) return;
    if (this.expectedTotal > 0) await this.refreshPresence(true);
    const count = Math.max(this.presentTotal, this.trackedFiles.size);
    const dir = this.watchDir;
    const incomplete = this.expectedTotal > 0 && this.lastMatched < this.expectedTotal;
    await this.stop();
    this.emit({
      state: 'ready',
      watchDir: dir,
      fileCount: count,
      countdownSec: 0,
      lockedFiles: 0,
      message: incomplete
        ? `Kích hoạt thủ công khi mới khớp ${this.lastMatched}/${this.expectedTotal} file thẻ — sẽ KHÔNG tự Sleep/Shutdown.`
        : `Kích hoạt thủ công (${count} files) — Bắt đầu Sao lưu Ổ 2!`,
      expectedFiles: this.expectedTotal,
      matchedFiles: this.lastMatched,
      incomplete,
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

  get isActive() {
    return this.watcher !== null;
  }

  private emit(ev: WatchStatusEvent) {
    this.onEvent?.({ ...ev, jobId: this.jobId });
  }
}

/** Mỗi khu vực thẻ (jobId) có 1 Watch riêng. */
class FolderWatchPool {
  private watchers = new Map<string, FolderWatchController>();

  private get(jobId = 'main') {
    let w = this.watchers.get(jobId);
    if (!w) {
      w = new FolderWatchController(jobId);
      this.watchers.set(jobId, w);
    }
    return w;
  }

  start(jobId: string | undefined, dirPath: string, debounceSec: number, onEvent: (ev: WatchStatusEvent) => void, expected?: WatchExpectedFile[]) {
    return this.get(jobId).start(dirPath, debounceSec, onEvent, expected);
  }

  triggerNow(jobId?: string) {
    return this.get(jobId).triggerNow();
  }

  async stop(jobId?: string) {
    if (jobId !== undefined) {
      await this.watchers.get(jobId)?.stop();
      return;
    }
    await Promise.all(Array.from(this.watchers.values()).map((w) => w.stop()));
  }
}

export const folderWatcher = new FolderWatchPool();
