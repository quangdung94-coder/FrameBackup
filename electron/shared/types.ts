/**
 * FrameBackup IPC contract — dùng chung cho Electron (main/preload/services) và Renderer (React).
 * File này CHỈ chứa type thuần, không import Node/DOM, để cả 2 tsconfig đều biên dịch được.
 */

/** Kết quả đơn giản cho các lệnh hệ thống (eject, power, import credentials...). */
export interface ActionResult {
  ok: boolean;
  message: string;
}

/** 'pending' = chưa đọc xong ngày chụp (đang đọc ngầm), tạm dùng giờ sửa file. */
export type DateSource = 'exif' | 'video-atom' | 'mtime' | 'pending';
export type DateFilterMode = 'all' | 'target-only' | 'split';
export type CopyEngineId = 'builtin' | 'teracopy' | 'robocopy' | 'fastcopy' | 'rsync' | 'ditto';

export interface CopyEngineOption {
  id: CopyEngineId;
  name: string;
  description: string;
  available: boolean;
  executablePath?: string;
  platform: 'all' | 'win32' | 'darwin';
}

export interface DriveInfo {
  id: string;
  label: string;
  mountPath: string;
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
  isRemovable: boolean;
}

export interface FileEntry {
  name: string;
  relativePath: string;
  fullPath: string;
  isDirectory: boolean;
  sizeBytes: number;
  mtimeMs: number;
  shotTimeMs: number;
  dateSource: DateSource;
  mediaType: 'video' | 'photo' | 'raw' | 'folder' | 'other';
  extension: string;
}

export interface SystemInfo {
  platform: string;
  arch: string;
  hostname: string;
  preventSleepActive: boolean;
  appVersion?: string;
}

export interface CopyVerifyRequest {
  /** Khu vực thẻ (tab) gửi job — nhiều thẻ chạy song song. Bỏ trống = 'main'. */
  jobId?: string;
  stage: 'card-to-drive1' | 'drive1-to-drive2';
  sourceDir: string;
  destDir: string;
  targetDate?: string;
  overnightMode?: boolean;
  dateFilterMode?: DateFilterMode;
  engine?: CopyEngineId;
  selectedFilePaths?: string[];
  allowedExtensions?: string[];
  includeSidecarXml?: boolean;
  /**
   * Khi đích đã có file CÙNG TÊN nhưng KHÁC nội dung. Mặc định 'keep-both' (không bao giờ ghi đè im lặng).
   * File giống hệt (cùng dung lượng + XXHash64) luôn được bỏ qua như Smart Resume.
   */
  conflictPolicy?: ConflictPolicy;
}

export type ConflictPolicy = 'keep-both' | 'skip' | 'overwrite';

/** 1 file đích đã tồn tại trước khi chép. */
export interface CopyConflict {
  name: string;
  sourcePath: string;
  destPath: string;
  sourceBytes: number;
  destBytes: number;
  /** Cùng dung lượng: có thể giống hệt (app sẽ so XXHash64 khi chạy và tự bỏ qua nếu trùng). */
  sameSize: boolean;
}

/** Kết quả kiểm tra trước khi chép (không ghi gì). */
export interface CopyPreflightResult {
  ok: boolean;
  totalFiles: number;
  totalBytes: number;
  /** Dung lượng cần thêm ở đích (bỏ qua file đã có cùng dung lượng). */
  requiredBytes: number;
  /** Trống ở ổ đích; -1 nếu không đọc được. */
  freeBytes: number;
  conflicts: CopyConflict[];
  /** Số file trùng tên ngay trong lượt chép (vd. 100MSDCF & 101MSDCF) — luôn tự đổi tên "(2)". */
  batchDuplicateNames: number;
  error?: string;
}

export interface CopyProgressEvent {
  jobId?: string;
  stage: 'card-to-drive1' | 'drive1-to-drive2';
  status: 'scanning' | 'copying' | 'verifying' | 'completed' | 'cancelled' | 'error';
  currentFile: string;
  filesCompleted: number;
  totalFiles: number;
  skippedFiles: number;
  resumedFiles: number;
  verifiedFiles: number;
  bytesCopied: number;
  totalBytes: number;
  percent: number;
  speedMBs: number;
  error?: string;
}

export interface CopyVerifySummary {
  stage: 'card-to-drive1' | 'drive1-to-drive2';
  success: boolean;
  totalFiles: number;
  copiedFiles: number;
  resumedFiles: number;
  verifiedFiles: number;
  skippedFiles: number;
  totalBytes: number;
  destDir: string;
  usedEngine: CopyEngineId;
  /** File đích trùng tên khác nội dung đã bỏ qua (policy skip). */
  skippedConflicts?: number;
  /** File được đổi tên "(2)" để không đè file khác. */
  renamedFiles?: number;
  /** File .fbpart sót lại từ lần chép bị ngắt trước đó (chưa xoá — hỏi người dùng). */
  orphanPartFiles?: string[];
  /** Số file theo loại của lượt chép (dùng cho báo cáo: cột Thẻ). */
  byType?: TypeCounts;
  /** Số file đã xác nhận bằng sổ verify (không phải hash lại vì đã verify trước đó). */
  ledgerHits?: number;
  error?: string;
}

export interface WatchStatusEvent {
  jobId?: string;
  state: 'idle' | 'watching' | 'receiving' | 'stabilizing' | 'ready' | 'error';
  watchDir: string;
  fileCount: number;
  countdownSec: number;
  lockedFiles: number;
  message: string;
  /** Số file nguồn (thẻ) mà Ổ 1 phải có đủ trước khi tự chạy tiếp. 0 = không biết nguồn. */
  expectedFiles?: number;
  /** Số file nguồn đã thấy trên Ổ 1 (khớp tên + dung lượng). */
  matchedFiles?: number;
  /** true nếu "ready" khi CHƯA khớp đủ file nguồn (bấm Chạy ngay thủ công) => không tự Sleep/Shutdown. */
  incomplete?: boolean;
}

/** 1 file nguồn mà Watch Mode chờ xuất hiện trên Ổ 1. */
export interface WatchExpectedFile {
  name: string;
  sizeBytes: number;
}

export type PackMode = 'video-raw-smart' | 'none' | 'zip-store' | '7z';

export interface ShotInfo {
  name: string;
  relativePath: string;
  shotTimeMs: number;
  mediaType: FileEntry['mediaType'];
  thumbnailPath?: string;
  thumbnailFileName?: string;
  thumbnailDataUrl?: string;
}

export interface MediaReportResult {
  projectName: string;
  stagingDir: string;
  reportFilePath: string;
  reportFileName: string;
  reportText: string;
  totalFiles: number;
  videoCount: number;
  photoCount: number;
  rawCount: number;
  totalBytes: number;
  /** Thống kê Ổ 1 theo loại (dùng cho báo cáo cuối). */
  drive1Stats?: LocationStats;
  firstShot: ShotInfo | null;
  lastShot: ShotInfo | null;
}

export interface InspectReportRequest {
  jobId?: string;
  projectName: string;
  sourceDir: string;
  /** Nếu truyền, chỉ quét & trích Thumbnail trong đúng các file / thư mục con được chọn. */
  selectedFilePaths?: string[];
  verifyStatusText?: string;
  skippedOldFiles?: number;
  keptMismatchFiles?: number;
}

export interface PackageRequest {
  jobId?: string;
  projectName: string;
  sourceDir: string;
  packMode: PackMode;
  /** Nếu truyền, chỉ đóng gói đúng các file / thư mục con được chọn trong `sourceDir`. */
  selectedFilePaths?: string[];
}

export interface PackageProgressEvent {
  jobId?: string;
  status: 'scanning' | 'packing' | 'completed' | 'cancelled' | 'error';
  percent: number;
  message: string;
}

export interface PackageResult {
  success: boolean;
  packMode: PackMode;
  archivePaths: string[];
  looseFilePaths: string[];
  totalOutputBytes: number;
  /** Số file / dung lượng gốc trên Ổ 1 đã được đưa vào gói (file nén + file lẻ). */
  sourceFiles?: number;
  sourceBytes?: number;
  error?: string;
}

export interface DriveAuthStatus {
  hasCredentials: boolean;
  signedIn: boolean;
  /** built-in = cấu hình Google nhúng sẵn trong app; custom = credentials.json tự nạp (nâng cao). */
  clientSource?: 'built-in' | 'custom' | 'none';
  email?: string;
  displayName?: string;
  quotaLimitBytes?: number;
  quotaUsageBytes?: number;
  error?: string;
}

/** Trình duyệt dùng để mở trang đăng nhập Google. id 'system' = mặc định của máy. */
export interface BrowserOption {
  id: string;
  name: string;
  path?: string;
}

export interface DriveRemoteFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  modifiedTime: string;
  isFolder: boolean;
}

export interface DriveFolderCheckResult {
  ok: boolean;
  folderId?: string;
  folderName?: string;
  canEdit: boolean;
  webViewLink?: string;
  files: DriveRemoteFile[];
  error?: string;
  /** v1.4: app chưa được cấp quyền vào thư mục này (drive.file) — cần chọn 1 lần bằng Google Picker. */
  needsPick?: boolean;
}

/** Kết quả chọn thư mục Google Drive bằng Google Picker. */
export interface DrivePickResult {
  ok: boolean;
  folderId?: string;
  folderName?: string;
  cancelled?: boolean;
  error?: string;
}

export interface DriveUploadItem {
  localPath: string;
  remoteName: string;
  relativeSubdir?: string; // e.g. "DCIM/100MSDCF" for loose files
}

export interface DriveUploadRequest {
  jobId?: string;
  parentFolderId: string;
  createProjectSubfolder?: string;
  items: DriveUploadItem[];
  cleanupArchivePaths?: string[];
}

export interface DriveUploadProgressEvent {
  jobId?: string;
  status: 'preparing' | 'uploading' | 'completed' | 'cancelled' | 'error';
  currentFile: string;
  filesUploaded: number;
  totalFiles: number;
  bytesUploaded: number;
  totalBytes: number;
  percent: number;
  speedMBs: number;
  error?: string;
}

export interface DriveUploadSummary {
  success: boolean;
  targetFolderId: string;
  webViewLink?: string;
  filesUploaded: number;
  totalFiles: number;
  totalBytes: number;
  /** File đã có sẵn trên Drive (cùng tên + MD5) nên không up lại. */
  dedupedFiles?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Báo cáo sao lưu (4 ô Thẻ / Ổ 1 / Ổ 2 / Drive)
// ---------------------------------------------------------------------------

export type MediaKind = 'video' | 'xml' | 'raw' | 'photo' | 'other';
export type TypeCounts = Record<MediaKind, number>;

export interface LocationStats {
  files: number;
  bytes: number;
  byType: TypeCounts;
}

/** Thẻ đã được chép bằng app (ghi trong sổ verify của thư mục Show trên Ổ 1). */
export interface CardIngestRecord extends LocationStats {
  at: number;
  sourceDir: string;
  /** true = đã so XXHash64 với thẻ (app tự chép). false = Watch (chép ngoài app, chỉ so tên + dung lượng). */
  hashVerified: boolean;
}

export interface Drive2BackupRecord {
  at: number;
  destDir: string;
  files: number;
}

export interface ShowLedgerInfo {
  card?: CardIngestRecord;
  drive2?: Drive2BackupRecord;
}

export type ReportBoxState = 'ok' | 'warn' | 'error' | 'source' | 'none';

export interface ReportBox {
  key: 'card' | 'drive1' | 'drive2' | 'drive';
  title: string;
  state: ReportBoxState;
  /** null = không có dữ liệu (vd. không dùng Ổ 2). */
  stats: LocationStats | null;
  /** Số file cần có (để hiện "6 / 12 file"). */
  expectedFiles?: number;
  /** Dòng trạng thái ngắn: "✓ Khớp thẻ (XXHash64)", "✗ Thiếu 6 file"... */
  status: string;
  path?: string;
}

export interface BuildReportRequest {
  jobId?: string;
  projectName: string;
  /** Ngày quay (YYYY-MM-DD). */
  shootDate?: string;
  drive1Dir: string;
  drive2Dir?: string;
  /** Thẻ của lượt này (app chép hoặc Watch). Không có thì lấy từ sổ verify của Ổ 1. */
  card?: CardIngestRecord;
  /** Ổ 2 vừa được sao lưu + verify trong lượt này. */
  drive2VerifiedNow?: boolean;
  /** true khi người dùng chỉ chọn upload một phần file/thư mục con (không phải toàn bộ thư mục gốc). */
  selectedUploadOnly?: boolean;
  drive: {
    status: 'uploaded' | 'failed' | 'cancelled' | 'skipped';
    /** Số file của Ổ 1 đã nằm trên Drive (trong file nén hoặc file lẻ). */
    files?: number;
    bytes?: number;
    folderName?: string;
    link?: string;
    error?: string;
  };
  firstShot: ShotInfo | null;
  lastShot: ShotInfo | null;
  /** Ghi chú thêm (Date Guard, Watch, cách chạy...). */
  notes?: string[];
  stagingDir: string;
}

export interface BackupReport {
  verdict: 'ok' | 'warn';
  headline: string;
  subline: string;
  boxes: ReportBox[];
  txtPath: string;
  txtFileName: string;
  pdfPath?: string;
  pdfFileName?: string;
  text: string;
  html: string;
}

export type PowerActionType = 'sleep' | 'shutdown';

/** Lịch sử chỉ dùng phía renderer (localStorage). */
export interface BackupHistoryItem {
  id: string;
  completedAt: number;
  projectName: string;
  totalFiles: number;
  totalBytes: number;
  drive1Path: string;
  drive2BackedUp: boolean;
  driveUploaded: boolean;
  driveWebLink?: string;
  verdict?: 'ok' | 'warn';
}


/** Kết quả đọc ngày chụp ngầm (gửi dần từng đợt). */
export interface ShotDateItem {
  fullPath: string;
  shotTimeMs: number;
  dateSource: DateSource;
}
export interface ShotDatesEvent {
  /** Khóa yêu cầu (mỗi khu vực thẻ 1 khóa); yêu cầu mới cùng khóa huỷ yêu cầu cũ. */
  key: string;
  items: ShotDateItem[];
  done: number;
  total: number;
  finished: boolean;
}
export interface ShotDateRequestItem {
  fullPath: string;
  sizeBytes: number;
  mtimeMs: number;
}

/** Hộp Thuộc tính (chuột phải > Thuộc tính). */
export interface PathProperties {
  ok: boolean;
  error?: string;
  name: string;
  fullPath: string;
  isDirectory: boolean;
  sizeBytes: number;
  files: number;
  folders: number;
  createdMs: number;
  modifiedMs: number;
  /** Thư mục quá lớn: đếm chưa hết (dừng sau giới hạn). */
  partial?: boolean;
}

/** Thư mục đặc biệt cho cây bên trái (Desktop, Tài liệu, Tải về...). */
export interface SpecialFolder {
  id: 'desktop' | 'documents' | 'downloads' | 'pictures' | 'videos' | 'home';
  label: string;
  path: string;
}

export interface FileOpResult {
  ok: boolean;
  message: string;
  /** Đường dẫn mới (thư mục vừa tạo / tên mới). */
  path?: string;
}

/** v1.4: thông tin clip / ảnh cho kiểu xem (đọc lười, có thể thiếu trường). */
export interface MediaInfo {
  durationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  /** Tên máy quay (Sony XML / EXIF / metadata). */
  cameraModel?: string;
}

export interface MediaThumbRequest {
  path: string;
}

export interface FrameBackupBridge {
  getSystemInfo: () => Promise<SystemInfo>;
  setPreventSleep: (enabled: boolean) => Promise<boolean>;
  listDrives: () => Promise<DriveInfo[]>;
  listDirectory: (dirPath: string) => Promise<FileEntry[]>;
  scanRecursive: (dirPath: string) => Promise<FileEntry[]>;
  /** Quét nhanh: chỉ tên / dung lượng / loại; ngày chụp lấy từ bộ nhớ, chưa có thì 'pending'. */
  scanRecursiveQuick: (dirPath: string) => Promise<FileEntry[]>;
  /** Đọc ngày chụp ngầm, kết quả gửi dần qua onShotDates. */
  readShotDates: (key: string, items: ShotDateRequestItem[]) => Promise<void>;
  cancelShotDates: (key: string) => Promise<void>;
  onShotDates: (cb: (ev: ShotDatesEvent) => void) => () => void;
  /** Cắm / rút thẻ hoặc ổ cứng: danh sách ổ mới. */
  onDrivesChanged?: (cb: (drives: DriveInfo[]) => void) => () => void;
  createFolder: (parentDir: string, name: string) => Promise<FileOpResult>;
  renamePath: (fullPath: string, newName: string) => Promise<FileOpResult>;
  getPathProperties: (fullPath: string) => Promise<PathProperties>;
  getSpecialFolders: () => Promise<SpecialFolder[]>;
  ensureDirectory: (dirPath: string) => Promise<string>;
  pickDirectory: (title?: string) => Promise<string | null>;
  openExternalUrl: (url: string) => Promise<void>;
  listCopyEngines: () => Promise<CopyEngineOption[]>;
  preflightCopy: (req: CopyVerifyRequest) => Promise<CopyPreflightResult>;
  startCopyVerify: (req: CopyVerifyRequest) => Promise<CopyVerifySummary>;
  /** Xoá file .fbpart sót lại (chỉ nhận đường dẫn kết thúc bằng .fbpart). */
  deletePartFiles: (paths: string[]) => Promise<ActionResult>;
  /** Mở file bằng app mặc định / hiện file trong Explorer–Finder. */
  openPath: (fullPath: string) => Promise<ActionResult>;
  showInFolder: (fullPath: string) => Promise<void>;
  /** jobId bỏ trống = hủy tất cả. */
  cancelCopy: (jobId?: string) => Promise<boolean>;
  onCopyProgress: (cb: (ev: CopyProgressEvent) => void) => () => void;
  startWatch: (dirPath: string, debounceSec: number, expected?: WatchExpectedFile[], jobId?: string) => Promise<void>;
  stopWatch: (jobId?: string) => Promise<void>;
  triggerWatchNow: (jobId?: string) => Promise<void>;
  onWatchStatus: (cb: (ev: WatchStatusEvent) => void) => () => void;
  safeEject: (mountPath: string) => Promise<ActionResult>;
  inspectAndBuildReport: (req: InspectReportRequest) => Promise<MediaReportResult>;
  packageForDrive: (req: PackageRequest) => Promise<PackageResult>;
  cancelPackaging: (jobId?: string) => Promise<boolean>;
  /** Tạo báo cáo cuối (txt + PDF) sau khi up xong. */
  buildBackupReport: (req: BuildReportRequest) => Promise<BackupReport>;
  /** Thẻ / Ổ 2 đã verify cho thư mục Show này (sổ verify). */
  getShowLedger: (showDir: string) => Promise<ShowLedgerInfo>;
  onPackageProgress: (cb: (ev: PackageProgressEvent) => void) => () => void;
  getDriveAuthStatus: () => Promise<DriveAuthStatus>;
  importDriveCredentials: () => Promise<ActionResult>;
  /** browserId: id từ listBrowsers(); bỏ trống = trình duyệt mặc định. */
  signInGoogleDrive: (browserId?: string) => Promise<DriveAuthStatus>;
  cancelGoogleSignIn: () => Promise<boolean>;
  listBrowsers: () => Promise<BrowserOption[]>;
  /** Bỏ credentials.json tự nạp, quay về cấu hình Google nhúng sẵn. */
  useBuiltInGoogleClient: () => Promise<DriveAuthStatus>;
  signOutGoogleDrive: () => Promise<DriveAuthStatus>;
  checkDriveFolder: (urlOrId: string) => Promise<DriveFolderCheckResult>;
  /** v1.4: mở Google Picker trong trình duyệt để cấp quyền / chọn thư mục Drive. */
  pickDriveFolder?: (startFolderId?: string, browserId?: string) => Promise<DrivePickResult>;
  /** v1.4: kiểu xem — thông tin clip/ảnh, hình thu nhỏ. */
  probeMediaInfo?: (paths: string[]) => Promise<Record<string, MediaInfo>>;
  getMediaThumbnail?: (req: MediaThumbRequest) => Promise<string | null>;
  cancelDrivePick?: () => Promise<boolean>;
  uploadToGoogleDrive: (req: DriveUploadRequest) => Promise<DriveUploadSummary>;
  cancelDriveUpload: (jobId?: string) => Promise<boolean>;
  onDriveUploadProgress: (cb: (ev: DriveUploadProgressEvent) => void) => () => void;
  executePowerAction: (action: PowerActionType) => Promise<ActionResult>;
}
