import { spawn, type ChildProcess } from 'node:child_process';
import { cancelledError } from './errors';

export interface RunProcessOptions {
  args: string[];
  signal: AbortSignal;
  cwd?: string;
  windowsHide?: boolean;
  /** Mỗi chunk stdout/stderr (thô). */
  onOutput?: (chunk: Buffer | string) => void;
  /** Mã thoát nào được xem là thành công (mặc định: chỉ 0). */
  isSuccessExitCode?: (code: number | null) => boolean;
  /** Thông báo lỗi khi mã thoát không thành công. */
  formatExitError?: (code: number | null) => string;
}

/**
 * Spawn 1 tiến trình ngoài có thể hủy bằng AbortSignal.
 * Dùng chung cho trình copy ngoài (TeraCopy/Robocopy/FastCopy/rsync/ditto) và 7za.
 */
export function runAbortableProcess(executable: string, opts: RunProcessOptions): Promise<void> {
  const isOk = opts.isSuccessExitCode ?? ((code) => code === 0);
  return new Promise<void>((resolve, reject) => {
    const child: ChildProcess = spawn(executable, opts.args, {
      cwd: opts.cwd,
      windowsHide: opts.windowsHide,
    });

    const onAbort = () => {
      child.kill();
      reject(cancelledError());
    };
    if (opts.signal.aborted) return onAbort();
    opts.signal.addEventListener('abort', onAbort, { once: true });

    if (opts.onOutput) {
      child.stdout?.on('data', opts.onOutput);
      child.stderr?.on('data', opts.onOutput);
    }

    child.on('error', (err) => {
      opts.signal.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.on('close', (code) => {
      opts.signal.removeEventListener('abort', onAbort);
      if (isOk(code)) resolve();
      else reject(new Error(opts.formatExitError ? opts.formatExitError(code) : `Tiến trình kết thúc với mã lỗi ${code}`));
    });
  });
}
