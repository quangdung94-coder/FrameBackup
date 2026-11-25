import type { PostAction } from '../components/layout/RibbonToolbar';
import type { useColumnLayout } from '../hooks/useColumnLayout';
import type {
  BackupHistoryItem,
  CopyEngineId,
  DriveAuthStatus,
  DriveFolderCheckResult,
  DriveInfo,
  PackMode,
} from '../types/framebackup';

/** "Nén" = theo kiểu đóng gói ở thanh trên; "Không nén" = up nguyên file, giữ cấu trúc thư mục. */
export type UploadPackChoice = 'pack' | 'none';

export interface CardTab {
  id: string;
  /** Tên máy của thẻ này (vd. "Cam B"): thư mục con trên Google Drive + tên trong báo cáo. Không tạo thư mục trên ổ. */
  camFolder: string;
}

/** Trạng thái 1 khu vực thẻ báo lên thanh tab. */
export interface WorkspaceStatus {
  label: string;
  cardPath: string;
  running: boolean;
  waiting: boolean;
  watching: boolean;
  verdict?: 'ok' | 'warn';
}

/** Cài đặt & dịch vụ dùng chung mọi khu vực thẻ (1 Show). */
export interface SharedWorkspace {
  drives: DriveInfo[];
  projectName: string;
  targetDate: string;
  overnightMode: boolean;
  copyEngine: CopyEngineId;
  packMode: PackMode;
  postAction: PostAction;
  visibleExtensions: string[];
  includeSidecarXml: boolean;
  setIncludeSidecarXml: (v: boolean) => void;
  drive1Root: string;
  drive2Root: string;
  setDrive1Root: (p: string) => void;
  setDrive2Root: (p: string) => void;
  driveLink: string;
  setDriveLink: (v: string) => void;
  driveAuth: DriveAuthStatus;
  driveFolderCheck: DriveFolderCheckResult | null;
  checkingDriveLink: boolean;
  checkDriveLink: (link?: string, silent?: boolean) => Promise<void>;
  openDriveAuth: () => void;
  uploadPack: UploadPackChoice;
  setUploadPack: (v: UploadPackChoice) => void;
  layout: ReturnType<typeof useColumnLayout>;
  activityLogs: { id: number; time: string; text: string; level: 'info' | 'success' | 'warn' | 'error' }[];
  showToast: (msg: string) => void;
  reloadSystem: () => Promise<void>;
  setTargetDate: (v: string) => void;
  /** Ghi lịch sử; `allowPowerAction` = được tự Sleep/Shutdown nếu không còn thẻ nào chạy. */
  finishJob: (tabId: string, entry: Omit<BackupHistoryItem, 'id' | 'completedAt'>, allowPowerAction: boolean) => void;
  /** Chạy lần lượt (nếu bật): chờ tới lượt rồi trả về hàm nhả lượt. */
  acquireRunSlot: () => Promise<() => void>;
  /** Thẻ đã chép & verify trong phiên này (để Eject không hỏi lại). */
  verifiedCardRoots: Set<string>;
}

export const BACKUP_HISTORY_LIMIT = 100;
export type { BackupHistoryItem };
