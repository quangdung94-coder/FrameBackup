/**
 * Renderer entry cho kiểu dữ liệu & tiện ích FrameBackup.
 * Nguồn thật nằm ở electron/shared (dùng chung với main/preload) — file này chỉ re-export
 * để mọi `import ... from './types/framebackup'` cũ vẫn chạy.
 */
import type { FrameBackupBridge } from '../../electron/shared/types';

export * from '../../electron/shared';

declare global {
  interface Window {
    frameBackup?: FrameBackupBridge;
  }
}
