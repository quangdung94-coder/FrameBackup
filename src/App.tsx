import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  Camera,
  Cloud,
  Database,
  Eye,
  FileText,
  Film,
  Folder,
  FolderOpen,
  HardDrive,
  Link2,
  Maximize2,
  Minimize2,
  Moon,
  Play,
  RefreshCw,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { DateMismatchAlert, type DateGroupSummary } from './components/DateMismatchAlert';
import { GoogleDriveAuthModal } from './components/GoogleDriveAuthModal';
import { PipelineBar, type ActivityLogEntry } from './components/PipelineBar';
import { ReportPreviewModal } from './components/ReportPreviewModal';
import {
  formatBytes,
  formatDateKey,
  formatShortDate,
  getParentDirectory,
  isTimestampMatchingTargetDate,
  parseGoogleDriveFolderId,
  sanitizeFolderName,
  type CopyEngineId,
  type CopyEngineOption,
  type CopyProgressEvent,
  type DateFilterMode,
  type DriveAuthStatus,
  type DriveFolderCheckResult,
  type DriveInfo,
  type DriveUploadItem,
  type DriveUploadProgressEvent,
  type FileEntry,
  type MediaReportResult,
  type PackMode,
  type PackageProgressEvent,
  type SystemInfo,
  type WatchStatusEvent,
} from './types/framebackup';

function getTodayDateString(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function joinPath(base: string, child: string): string {
  const sep = base.includes('\\') ? '\\' : '/';
  return base.endsWith(sep) ? `${base}${child}` : `${base}${sep}${child}`;
}

function createDemoCardFiles(targetDate: string): FileEntry[] {
  const base = new Date(`${targetDate}T08:15:10`).getTime();
  const oldTwoDays = base - 2 * 24 * 60 * 60 * 1000;
  return [
    { name: 'C0001_CamA.MP4', relativePath: 'C0001_CamA.MP4', fullPath: 'DEMO/C0001_CamA.MP4', isDirectory: false, sizeBytes: 4.12 * 1024 ** 3, mtimeMs: base, shotTimeMs: base, dateSource: 'video-atom', mediaType: 'video', extension: '.mp4' },
    { name: 'C0002_CamA.MP4', relativePath: 'C0002_CamA.MP4', fullPath: 'DEMO/C0002_CamA.MP4', isDirectory: false, sizeBytes: 6.85 * 1024 ** 3, mtimeMs: base + 5200_000, shotTimeMs: base + 5200_000, dateSource: 'video-atom', mediaType: 'video', extension: '.mp4' },
    { name: 'C0891_OldCard.MP4', relativePath: 'C0891_OldCard.MP4', fullPath: 'DEMO/C0891_OldCard.MP4', isDirectory: false, sizeBytes: 2.4 * 1024 ** 3, mtimeMs: oldTwoDays, shotTimeMs: oldTwoDays, dateSource: 'video-atom', mediaType: 'video', extension: '.mp4' },
    { name: '_DSC0892.ARW', relativePath: '_DSC0892.ARW', fullPath: 'DEMO/_DSC0892.ARW', isDirectory: false, sizeBytes: 44 * 1024 ** 2, mtimeMs: oldTwoDays + 300_000, shotTimeMs: oldTwoDays + 300_000, dateSource: 'exif', mediaType: 'raw', extension: '.arw' },
    { name: 'C0003_CamA.MP4', relativePath: 'C0003_CamA.MP4', fullPath: 'DEMO/C0003_CamA.MP4', isDirectory: false, sizeBytes: 5.3 * 1024 ** 3, mtimeMs: base + 38000_000, shotTimeMs: base + 38000_000, dateSource: 'video-atom', mediaType: 'video', extension: '.mp4' },
    { name: '_DSC1001.ARW', relativePath: '_DSC1001.ARW', fullPath: 'DEMO/_DSC1001.ARW', isDirectory: false, sizeBytes: 42.5 * 1024 ** 2, mtimeMs: base + 21000_000, shotTimeMs: base + 21000_000, dateSource: 'exif', mediaType: 'raw', extension: '.arw' },
  ];
}

function FileIcon({ type }: { type: FileEntry['mediaType'] }) {
  if (type === 'folder') return <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
  if (type === 'video') return <Film className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
  if (type === 'raw' || type === 'photo') return <Camera className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  return <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />;
}

const DEFAULT_COL_WEIGHTS: [number, number, number, number] = [25, 25, 25, 25];
const DEFAULT_BOTTOM_HEIGHT = 195;

function loadSavedColWeights(): [number, number, number, number] {
  try {
    const raw = localStorage.getItem('fb_col_weights');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === 4 && parsed.every((n) => typeof n === 'number' && n >= 10)) {
        return parsed as [number, number, number, number];
      }
    }
  } catch {
    // Ignore storage errors
  }
  return [...DEFAULT_COL_WEIGHTS];
}

function loadSavedNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const val = Number(localStorage.getItem(key));
    if (!Number.isNaN(val) && val >= min && val <= max) return val;
  } catch {
    // Ignore
  }
  return fallback;
}

function formatNowClock(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function App() {
  const [sysInfo, setSysInfo] = useState<SystemInfo>({
    platform: 'win32',
    arch: 'x64',
    hostname: 'Local',
    preventSleepActive: false,
  });
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [copyEngines, setCopyEngines] = useState<CopyEngineOption[]>([
    {
      id: 'builtin',
      name: 'FrameBackup Built-in (XXHash64)',
      description: 'Mặc định',
      available: true,
      platform: 'all',
    },
  ]);
  const [selectedCopyEngine, setSelectedCopyEngine] = useState<CopyEngineId>('builtin');
  const [expandedCol, setExpandedCol] = useState<number | null>(null);

  // Resizable layout & UI zoom (persisted in localStorage)
  const [colWeights, setColWeights] = useState<[number, number, number, number]>(loadSavedColWeights);
  const [bottomHeight, setBottomHeight] = useState<number>(() =>
    loadSavedNumber('fb_bottom_height', DEFAULT_BOTTOM_HEIGHT, 155, 480)
  );
  const [uiScale, setUiScale] = useState<number>(() => loadSavedNumber('fb_ui_scale', 100, 100, 125));
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const logIdRef = useRef(0);
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);

  // Column Paths & Entries
  const [cardPath, setCardPath] = useState('');
  const [cardFiles, setCardFiles] = useState<FileEntry[]>([]);
  const [cardScanning, setCardScanning] = useState(false);
  const [cardMode, setCardMode] = useState<'ingest' | 'watch'>('ingest');

  const [drive1Path, setDrive1Path] = useState('');
  const [drive1Files, setDrive1Files] = useState<FileEntry[]>([]);

  const [drive2Path, setDrive2Path] = useState('');
  const [drive2Files, setDrive2Files] = useState<FileEntry[]>([]);

  const [driveLink, setDriveLink] = useState('');
  const [driveAuth, setDriveAuth] = useState<DriveAuthStatus>({ hasCredentials: false, signedIn: false });
  const [driveAuthModalOpen, setDriveAuthModalOpen] = useState(false);
  const [driveFolderCheck, setDriveFolderCheck] = useState<DriveFolderCheckResult | null>(null);
  const [checkingDriveLink, setCheckingDriveLink] = useState(false);
  const [projectName, setProjectName] = useState(() => `${getTodayDateString().replace(/-/g, '.')}.New_Show`);

  // Settings (Telegram removed — Drive Report + Sleep/Shutdown only)
  const [targetDate, setTargetDate] = useState(getTodayDateString);
  const [overnightMode, setOvernightMode] = useState(true);
  const [packMode, setPackMode] = useState<PackMode>('video-raw-smart');
  const [postAction, setPostAction] = useState<'drive-report-sleep' | 'drive-report-shutdown' | 'drive-report-only'>(
    'drive-report-sleep'
  );
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>('all');
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  // Phase 2, 3 & 4 Live Pipeline State
  const [isRunning, setIsRunning] = useState(false);
  const [step1Progress, setStep1Progress] = useState<CopyProgressEvent | null>(null);
  const [step2Progress, setStep2Progress] = useState<CopyProgressEvent | null>(null);
  const [step3Progress, setStep3Progress] = useState<PackageProgressEvent | null>(null);
  const [step4Progress, setStep4Progress] = useState<DriveUploadProgressEvent | null>(null);
  const [mediaReport, setMediaReport] = useState<MediaReportResult | null>(null);
  const [watchStatus, setWatchStatus] = useState<WatchStatusEvent | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Refs for latest paths inside watch callback & race-condition guard
  const cardScanSeqRef = useRef(0);
  const drive1PathRef = useRef(drive1Path);
  const drive2PathRef = useRef(drive2Path);
  const projectNameRef = useRef(projectName);
  const selectedCopyEngineRef = useRef(selectedCopyEngine);
  const packModeRef = useRef(packMode);
  const driveLinkRef = useRef(driveLink);
  const driveAuthRef = useRef(driveAuth);
  drive1PathRef.current = drive1Path;
  drive2PathRef.current = drive2Path;
  projectNameRef.current = projectName;
  selectedCopyEngineRef.current = selectedCopyEngine;
  packModeRef.current = packMode;
  driveLinkRef.current = driveLink;
  driveAuthRef.current = driveAuth;

  const parsedDriveFolderId = useMemo(() => parseGoogleDriveFolderId(driveLink), [driveLink]);

  const pushLog = (text: string, level: ActivityLogEntry['level'] = 'info') => {
    setActivityLogs((prev) => [
      { id: ++logIdRef.current, time: formatNowClock(), text, level },
      ...prev.slice(0, 79),
    ]);
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    const level: ActivityLogEntry['level'] = msg.startsWith('❌')
      ? 'error'
      : msg.startsWith('✅')
      ? 'success'
      : msg.startsWith('⚠') || msg.startsWith('👁')
      ? 'warn'
      : 'info';
    pushLog(msg, level);
    setTimeout(() => setToastMsg((prev) => (prev === msg ? null : prev)), 5000);
  };

  useEffect(() => {
    try {
      localStorage.setItem('fb_col_weights', JSON.stringify(colWeights));
    } catch {
      // Ignore
    }
  }, [colWeights]);

  useEffect(() => {
    try {
      localStorage.setItem('fb_bottom_height', String(bottomHeight));
    } catch {
      // Ignore
    }
  }, [bottomHeight]);

  useEffect(() => {
    try {
      localStorage.setItem('fb_ui_scale', String(uiScale));
    } catch {
      // Ignore
    }
  }, [uiScale]);

  const startHorizontalResize = (dividerIndex: 0 | 1 | 2, e: React.MouseEvent) => {
    e.preventDefault();
    const container = workspaceRef.current;
    if (!container) return;
    const totalWidth = container.getBoundingClientRect().width;
    if (totalWidth <= 0) return;

    const startX = e.clientX;
    const startWeights: [number, number, number, number] = [...colWeights];
    const scaleFactor = uiScale / 100;
    setExpandedCol(null);

    document.body.style.cursor = 'col-resize';

    const onMove = (ev: MouseEvent) => {
      const deltaPct = ((ev.clientX - startX) / scaleFactor / totalWidth) * 100;
      const pairSum = startWeights[dividerIndex] + startWeights[dividerIndex + 1];
      const minPct = 12;
      const nextLeft = Math.min(pairSum - minPct, Math.max(minPct, startWeights[dividerIndex] + deltaPct));
      const nextRight = pairSum - nextLeft;
      const next: [number, number, number, number] = [...startWeights];
      next[dividerIndex] = Number(nextLeft.toFixed(2));
      next[dividerIndex + 1] = Number(nextRight.toFixed(2));
      setColWeights(next);
    };

    const onUp = () => {
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startVerticalResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = bottomHeight;
    const scaleFactor = uiScale / 100;

    document.body.style.cursor = 'row-resize';

    const onMove = (ev: MouseEvent) => {
      const deltaY = (startY - ev.clientY) / scaleFactor;
      const clamped = Math.max(155, Math.min(480, Math.round(startHeight + deltaY)));
      setBottomHeight(clamped);
    };

    const onUp = () => {
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleToggleExpandCol = (colIndex: 1 | 2 | 3 | 4) => {
    if (expandedCol === colIndex) {
      setExpandedCol(null);
      setColWeights([...DEFAULT_COL_WEIGHTS]);
    } else {
      setExpandedCol(colIndex);
      const next: [number, number, number, number] = [18, 18, 18, 18];
      next[colIndex - 1] = 46;
      setColWeights(next);
    }
  };

  const loadSystemData = async () => {
    if (!window.frameBackup) return;
    const [info, diskList, engineList, authStatus] = await Promise.all([
      window.frameBackup.getSystemInfo(),
      window.frameBackup.listDrives(),
      window.frameBackup.listCopyEngines(),
      window.frameBackup.getDriveAuthStatus(),
    ]);
    setSysInfo(info);
    setDrives(diskList);
    if (engineList.length > 0) setCopyEngines(engineList);
    setDriveAuth(authStatus);
  };

  useEffect(() => {
    void loadSystemData();
    if (!window.frameBackup) return;

    const unsubCopy = window.frameBackup.onCopyProgress((ev) => {
      if (ev.stage === 'card-to-drive1') setStep1Progress(ev);
      if (ev.stage === 'drive1-to-drive2') setStep2Progress(ev);
    });

    const unsubPack = window.frameBackup.onPackageProgress((ev) => {
      setStep3Progress(ev);
    });

    const unsubDrive = window.frameBackup.onDriveUploadProgress((ev) => {
      setStep4Progress(ev);
    });

    const unsubWatch = window.frameBackup.onWatchStatus((st) => {
      setWatchStatus(st);
      if (st.state === 'ready') {
        void runStep2To4(st.watchDir, 0, 0);
      }
    });

    return () => {
      unsubCopy();
      unsubPack();
      unsubDrive();
      unsubWatch();
    };
  }, []);

  const refreshCardSmart = async (pathStr: string, forceRecursive = false) => {
    const seq = ++cardScanSeqRef.current;
    if (!pathStr || !window.frameBackup) {
      setCardFiles([]);
      setCardScanning(false);
      return;
    }

    // Prevent accidentally deep-scanning a huge fixed OS drive root (like C:\ or /)
    const matchedDrive = drives.find((d) => d.mountPath.toLowerCase() === pathStr.toLowerCase());
    const isFixedRoot = Boolean(matchedDrive && !matchedDrive.isRemovable);

    setCardScanning(true);
    try {
      const items =
        isFixedRoot && !forceRecursive
          ? await window.frameBackup.listDirectory(pathStr)
          : await window.frameBackup.scanRecursive(pathStr);
      if (seq === cardScanSeqRef.current) {
        setCardFiles(items);
      }
    } catch (err) {
      if (seq === cardScanSeqRef.current) {
        showToast(`Lỗi đọc thư mục nguồn: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      if (seq === cardScanSeqRef.current) {
        setCardScanning(false);
      }
    }
  };

  const refreshDirectory = async (pathStr: string, setter: (items: FileEntry[]) => void) => {
    if (!pathStr || !window.frameBackup) {
      setter([]);
      return;
    }
    const items = await window.frameBackup.listDirectory(pathStr);
    setter(items);
  };

  const handlePickFolder = async (col: 1 | 2 | 3) => {
    if (!window.frameBackup) {
      showToast('Chức năng chọn thư mục hệ thống hoạt động khi chạy bằng Electron (npm run dev).');
      return;
    }
    const titles = {
      1: 'Chọn Thẻ nhớ / Thư mục Nguồn (Cột 1)',
      2: 'Chọn Thư mục Ổ 1 — Làm việc (Cột 2)',
      3: 'Chọn Thư mục Ổ 2 — Sao lưu (Cột 3)',
    };
    const picked = await window.frameBackup.pickDirectory(titles[col]);
    if (!picked) return;
    if (col === 1) {
      setCardPath(picked);
      setAlertDismissed(false);
      setDateFilterMode('all');
      await refreshCardSmart(picked);
    } else if (col === 2) {
      setDrive1Path(picked);
      await refreshDirectory(picked, setDrive1Files);
    } else {
      setDrive2Path(picked);
      await refreshDirectory(picked, setDrive2Files);
    }
  };

  const handleTogglePreventSleep = async () => {
    if (!window.frameBackup) return;
    const next = !sysInfo.preventSleepActive;
    const active = await window.frameBackup.setPreventSleep(next);
    setSysInfo((prev) => ({ ...prev, preventSleepActive: active }));
  };

  const handleSafeEject = async () => {
    if (!window.frameBackup || !cardPath) return;
    const res = await window.frameBackup.safeEject(cardPath);
    showToast(res.message);
    if (res.ok) {
      setCardPath('');
      setCardFiles([]);
      await loadSystemData();
    }
  };

  const handleCheckDriveLink = async (linkOverride?: string) => {
    if (!window.frameBackup) return;
    const target = (linkOverride ?? driveLink).trim();
    if (!target) {
      showToast('Hãy dán link thư mục Google Drive trước khi kiểm tra.');
      return;
    }
    setCheckingDriveLink(true);
    try {
      const res = await window.frameBackup.checkDriveFolder(target);
      setDriveFolderCheck(res);
      if (res.ok) {
        showToast(`✅ Kết nối thư mục Drive "${res.folderName}" — Quyền Editor OK!`);
      } else if (res.error) {
        showToast(`⚠️ ${res.error}`);
      }
    } finally {
      setCheckingDriveLink(false);
    }
  };

  const runStep2To4 = async (
    sourceOnDrive1: string,
    skippedOldFiles: number,
    keptMismatchFiles: number
  ) => {
    if (!window.frameBackup) return;
    const safeShow = sanitizeFolderName(projectNameRef.current) || 'FrameBackup_Show';
    const d2Base = drive2PathRef.current;

    setIsRunning(true);
    try {
      let verifyText = 'PASSED (Ổ 1 XXHash64 100%)';

      if (d2Base) {
        const destOnDrive2 = joinPath(d2Base, safeShow);
        const res2 = await window.frameBackup.startCopyVerify({
          stage: 'drive1-to-drive2',
          sourceDir: sourceOnDrive1,
          destDir: destOnDrive2,
          engine: selectedCopyEngineRef.current,
        });
        if (!res2.success) {
          if (res2.error !== 'CANCELLED') {
            showToast(`❌ Lỗi Sao lưu Ổ 2: ${res2.error}`);
          }
          return;
        }
        verifyText = `PASSED (Ổ 1 & Ổ 2: ${res2.verifiedFiles} files khớp 100%)`;
        await refreshDirectory(d2Base, setDrive2Files);
      }

      // Phase 3: Media Inspector (First/Last Shot + Thumbnails) & Packaging
      setStep3Progress({ status: 'scanning', percent: 5, message: 'Đang trích xuất Thumbnail Shot đầu & cuối...' });
      const report = await window.frameBackup.inspectAndBuildReport({
        projectName: safeShow,
        sourceDir: sourceOnDrive1,
        verifyStatusText: verifyText,
        skippedOldFiles,
        keptMismatchFiles,
      });
      setMediaReport(report);

      const packRes = await window.frameBackup.packageForDrive({
        projectName: safeShow,
        sourceDir: sourceOnDrive1,
        packMode: packModeRef.current,
      });

      if (!packRes.success) {
        if (packRes.error !== 'CANCELLED') {
          showToast(`❌ Lỗi đóng gói: ${packRes.error}`);
        }
        return;
      }

      // Phase 4: Resumable Upload to Google Drive (Report + 2 Thumbnails + Archives/Loose Files)
      const folderId = parseGoogleDriveFolderId(driveLinkRef.current);
      if (folderId && driveAuthRef.current.signedIn) {
        const uploadItems: DriveUploadItem[] = [];

        // 1. Report + 2 Thumbnails right at top of Drive folder
        uploadItems.push({ localPath: report.reportFilePath, remoteName: report.reportFileName });
        if (report.firstShot?.thumbnailPath && report.firstShot.thumbnailFileName) {
          uploadItems.push({
            localPath: report.firstShot.thumbnailPath,
            remoteName: report.firstShot.thumbnailFileName,
          });
        }
        if (report.lastShot?.thumbnailPath && report.lastShot.thumbnailFileName) {
          uploadItems.push({
            localPath: report.lastShot.thumbnailPath,
            remoteName: report.lastShot.thumbnailFileName,
          });
        }

        // 2. Packaged archives (Zip Store / 7z)
        for (const ap of packRes.archivePaths) {
          const baseName = ap.split(/[\\/]/).pop() || 'archive.zip';
          uploadItems.push({ localPath: ap, remoteName: baseName });
        }

        // 3. Loose files (preserving relative subfolder structure, case-insensitive drive prefix on Windows)
        const normalizedRoot = sourceOnDrive1.replace(/[\\/]+$/, '');
        const lowerRoot = normalizedRoot.toLowerCase();
        for (const fp of packRes.looseFilePaths) {
          const rel = fp.toLowerCase().startsWith(lowerRoot)
            ? fp.slice(normalizedRoot.length).replace(/^[\\/]+/, '')
            : '';
          const parts = rel.split(/[\\/]+/).filter(Boolean);
          const remoteName = parts.pop() || fp.split(/[\\/]/).pop() || 'file';
          const relativeSubdir = parts.length > 0 ? parts.join('/') : undefined;
          uploadItems.push({ localPath: fp, remoteName, relativeSubdir });
        }

        const upRes = await window.frameBackup.uploadToGoogleDrive({
          parentFolderId: folderId,
          items: uploadItems,
          cleanupArchivePaths: packRes.archivePaths,
        });

        await loadSystemData();

        if (upRes.success) {
          showToast(`✅ HOÀN TẤT 100%! Đã upload ${upRes.filesUploaded} files + Báo cáo & 2 Thumbnail lên Google Drive.`);
          void handleCheckDriveLink(driveLinkRef.current);
        } else if (upRes.error !== 'CANCELLED') {
          showToast(`❌ Lỗi Upload Google Drive: ${upRes.error}`);
        }
      } else {
        await loadSystemData();
        showToast(
          folderId
            ? '✅ Xong Bước 1–3! Hãy đăng nhập Google Drive ở Cột 4 để bật tự động Upload.'
            : '✅ Xong Bước 1–3 (Backup + Thumbnail + Đóng gói)! Dán Link Drive ở Cột 4 nếu muốn Upload.'
        );
      }
    } catch (err) {
      showToast(`❌ Lỗi xử lý Bước 2–4: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleRunFullPipeline = async () => {
    if (!window.frameBackup) {
      showToast('Hãy mở app bằng Electron (npm run dev) để chạy Copy & Verify thật.');
      return;
    }
    if (!drive1Path) {
      showToast('Vui lòng chọn thư mục Ổ 1 (Cột 2) trước khi chạy.');
      return;
    }

    const safeShow = sanitizeFolderName(projectName);
    if (!safeShow) {
      showToast('Tên Show không hợp lệ (không được để trống hoặc chỉ chứa ký tự đặc biệt).');
      return;
    }

    // Watch Mode: scope strictly to the target Show folder so we never accidentally copy old shows in Drive 1
    if (cardMode === 'watch') {
      const trimmedD1 = drive1Path.replace(/[\\/]+$/, '');
      const endsWithShow = trimmedD1.toLowerCase().endsWith(safeShow.toLowerCase());
      const watchTargetDir = endsWithShow ? trimmedD1 : joinPath(trimmedD1, safeShow);
      await window.frameBackup.ensureDirectory(watchTargetDir);
      await refreshDirectory(drive1Path, setDrive1Files);
      await window.frameBackup.setPreventSleep(true);
      setSysInfo((prev) => ({ ...prev, preventSleepActive: true }));
      await window.frameBackup.startWatch(watchTargetDir, 20);
      showToast(`👁 Đang canh thư mục "${watchTargetDir}" — Hãy chép file từ thẻ vào thư mục này!`);
      return;
    }

    if (!cardPath || cardPath.startsWith('DEMO')) {
      showToast('Vui lòng chọn thư mục Thẻ nhớ / Nguồn thật ở Cột 1.');
      return;
    }

    // Pre-flight storage check
    if (d1Insufficient) {
      showToast('❌ Ổ 1 không đủ dung lượng trống để chứa thẻ nhớ này! Hãy dọn ổ hoặc chọn ổ khác.');
      return;
    }
    if (drive2Path && d2Insufficient) {
      showToast('❌ Ổ 2 (Sao lưu) không đủ dung lượng trống! Hãy chọn ổ sao lưu khác.');
      return;
    }

    setIsRunning(true);
    setStep1Progress(null);
    setStep2Progress(null);
    setStep3Progress(null);
    setStep4Progress(null);
    setMediaReport(null);

    try {
      await window.frameBackup.setPreventSleep(true);
      setSysInfo((prev) => ({ ...prev, preventSleepActive: true }));

      const destOnDrive1 = joinPath(drive1Path, safeShow);
      const res1 = await window.frameBackup.startCopyVerify({
        stage: 'card-to-drive1',
        sourceDir: cardPath,
        destDir: destOnDrive1,
        targetDate,
        overnightMode,
        dateFilterMode,
        engine: selectedCopyEngine,
      });

      if (!res1.success) {
        setIsRunning(false);
        if (res1.error !== 'CANCELLED') {
          showToast(`❌ Lỗi Ingest Ổ 1: ${res1.error}`);
        }
        return;
      }

      await refreshDirectory(drive1Path, setDrive1Files);
      const resumeNote = res1.resumedFiles > 0 ? `, Resume ${res1.resumedFiles}` : '';
      showToast(
        `✅ Xong Ổ 1 (${res1.verifiedFiles} files${resumeNote}, lọc bỏ ${res1.skippedFiles} file lệch ngày) — Đang chạy tiếp...`
      );

      const keptMismatch =
        dateFilterMode === 'all'
          ? dateGroups.filter((g) => !g.isTarget).reduce((acc, g) => acc + g.count, 0)
          : 0;
      await runStep2To4(destOnDrive1, res1.skippedFiles, keptMismatch);
    } catch (err) {
      setIsRunning(false);
      showToast(`❌ Lỗi chuỗi sao lưu: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCancelAll = async () => {
    if (!window.frameBackup) return;
    await window.frameBackup.cancelCopy();
    await window.frameBackup.cancelPackaging();
    await window.frameBackup.cancelDriveUpload();
    await window.frameBackup.stopWatch();
    setWatchStatus(null);
    setIsRunning(false);
    showToast('Đã dừng chuỗi sao lưu.');
  };

  const handleLoadDemoMismatch = () => {
    setCardPath('DEMO_SD_CARD (Dữ liệu mô phỏng)');
    setCardFiles(createDemoCardFiles(targetDate));
    setDateFilterMode('all');
    setAlertDismissed(false);
  };

  // Date Guard analysis using real EXIF / Video Atom / mtime shotTimeMs
  const dateGroups = useMemo<DateGroupSummary[]>(() => {
    const map = new Map<string, DateGroupSummary>();
    for (const f of cardFiles) {
      if (f.isDirectory) continue;
      const isMatch = isTimestampMatchingTargetDate(f.shotTimeMs, targetDate, overnightMode);
      const key = isMatch ? targetDate : formatDateKey(f.shotTimeMs);
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        existing.totalBytes += f.sizeBytes;
      } else {
        map.set(key, { dateKey: key, count: 1, totalBytes: f.sizeBytes, isTarget: isMatch });
      }
    }
    return Array.from(map.values()).sort((a, b) => Number(b.isTarget) - Number(a.isTarget));
  }, [cardFiles, targetDate, overnightMode]);

  const hasMismatch = useMemo(() => dateGroups.some((g) => !g.isTarget), [dateGroups]);
  const showBigAlert = hasMismatch && !alertDismissed && dateFilterMode === 'all';

  const displayedCardFiles = useMemo(() => {
    if (dateFilterMode !== 'target-only') return cardFiles;
    return cardFiles.filter(
      (f) => f.isDirectory || isTimestampMatchingTargetDate(f.shotTimeMs, targetDate, overnightMode)
    );
  }, [cardFiles, dateFilterMode, targetDate, overnightMode]);

  const totalCardBytes = useMemo(
    () => displayedCardFiles.reduce((acc, f) => acc + f.sizeBytes, 0),
    [displayedCardFiles]
  );

  const findDriveForPath = (pathStr: string): DriveInfo | undefined => {
    if (!pathStr) return undefined;
    const normalized = pathStr.toLowerCase();
    return drives.find((d) => normalized.startsWith(d.mountPath.toLowerCase()));
  };

  const cardDriveInfo = findDriveForPath(cardPath);
  const d1DriveInfo = findDriveForPath(drive1Path);
  const d2DriveInfo = findDriveForPath(drive2Path);

  const d1Insufficient = Boolean(d1DriveInfo && totalCardBytes > 0 && d1DriveInfo.freeBytes < totalCardBytes);
  const d2Insufficient = Boolean(d2DriveInfo && totalCardBytes > 0 && d2DriveInfo.freeBytes < totalCardBytes);

  const osBadge = sysInfo.platform === 'darwin' ? 'macOS' : sysInfo.platform === 'win32' ? 'Windows' : sysInfo.platform;
  const isWatching = Boolean(watchStatus && ['watching', 'receiving', 'stabilizing'].includes(watchStatus.state));

  return (
    <div
      style={{ zoom: `${uiScale}%` }}
      className="h-screen w-screen flex flex-col bg-[#121215] text-zinc-100 overflow-hidden"
    >
      {/* Top Status Bar */}
      <div className="h-10 bg-[#0d0d10] border-b border-[#2b2b34] px-4 flex items-center justify-between text-xs text-zinc-400 shrink-0">
        <div className="flex items-center gap-2.5 font-semibold text-zinc-100 min-w-0">
          <HardDrive className="w-4 h-4 text-blue-500 shrink-0" />
          <span className="text-[13px] shrink-0">FrameBackup v0.4.0</span>
          <span className="text-[11px] px-2 py-0.5 rounded bg-[#23232b] border border-[#3e3e4b] text-zinc-300 shrink-0">
            {osBadge} ({sysInfo.arch})
          </span>
          {toastMsg && (
            <span className="ml-2 px-2.5 py-0.5 rounded-md bg-blue-500/20 border border-blue-500/40 text-blue-200 text-xs font-normal truncate">
              {toastMsg}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* UI Scale Selector */}
          <div className="inline-flex items-center bg-[#18181f] border border-[#32323d] rounded-md p-0.5 text-[11px]">
            {[100, 115, 125].map((pct) => (
              <button
                key={pct}
                onClick={() => setUiScale(pct)}
                className={`px-2 py-0.5 rounded transition font-medium ${
                  uiScale === pct ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-100'
                }`}
                title={`Tỷ lệ hiển thị ${pct}%`}
              >
                {pct}%
              </button>
            ))}
          </div>

          <button
            onClick={handleTogglePreventSleep}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition font-medium ${
              sysInfo.preventSleepActive
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-[#1f1f26] border-[#32323d] text-zinc-300 hover:text-white'
            }`}
          >
            <Moon className="w-3.5 h-3.5" />
            Prevent Sleep: {sysInfo.preventSleepActive ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={loadSystemData}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#1f1f26] hover:bg-[#2a2a35] border border-[#32323d] text-zinc-200 text-xs transition"
            title="Quét lại ổ đĩa & thẻ nhớ"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Quét ổ ({drives.length})
          </button>
        </div>
      </div>

      {/* Ribbon Toolbar (Larger, Night-Friendly Controls) */}
      <div className="bg-[#1b1b20] border-b border-[#2b2b34] px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap shrink-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="h-9 flex items-center gap-2 bg-[#101013] border border-[#32323d] px-3 rounded-lg">
            <span className="text-xs text-zinc-400 font-medium">Show:</span>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="bg-transparent text-[13px] text-zinc-100 outline-none w-48 font-semibold"
            />
          </div>

          <div className="h-9 flex items-center gap-2.5 bg-[#101013] border border-[#32323d] px-3 rounded-lg">
            <span className="text-xs text-zinc-400 font-medium">Ngày quay:</span>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => {
                setTargetDate(e.target.value);
                setAlertDismissed(false);
              }}
              className="bg-transparent text-[13px] text-zinc-100 outline-none font-medium"
            />
            <label className="inline-flex items-center gap-1.5 text-xs text-zinc-300 cursor-pointer pl-1 border-l border-[#2e2e38]">
              <input
                type="checkbox"
                checked={overnightMode}
                onChange={(e) => setOvernightMode(e.target.checked)}
                className="accent-blue-500 w-3.5 h-3.5"
              />
              Xuyên đêm
            </label>
          </div>

          <button
            onClick={handleLoadDemoMismatch}
            className="h-9 inline-flex items-center gap-1.5 px-3 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/45 text-red-200 text-xs font-semibold transition"
          >
            <AlertTriangle className="w-4 h-4" /> Test Lệch ngày
          </button>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="h-9 flex items-center gap-2 bg-[#101013] border border-[#32323d] px-3 rounded-lg">
            <span className="text-xs text-zinc-400 font-medium">Copy:</span>
            <select
              value={selectedCopyEngine}
              onChange={(e) => setSelectedCopyEngine(e.target.value as CopyEngineId)}
              className="bg-transparent text-[13px] text-zinc-100 outline-none font-medium"
              title="Chọn trình copy (tự nhận diện app đã cài trên Windows / macOS)"
            >
              {copyEngines.map((eng) => (
                <option key={eng.id} value={eng.id} disabled={!eng.available} className="bg-[#202024]">
                  {eng.name}
                  {!eng.available ? ' (Chưa cài)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="h-9 flex items-center gap-2 bg-[#101013] border border-[#32323d] px-3 rounded-lg">
            <span className="text-xs text-zinc-400 font-medium">Drive:</span>
            <select
              value={packMode}
              onChange={(e) => setPackMode(e.target.value as typeof packMode)}
              className="bg-transparent text-[13px] text-zinc-100 outline-none font-medium"
            >
              <option value="video-raw-smart" className="bg-[#202024]">Video: Folder | Ảnh: Zip Store</option>
              <option value="none" className="bg-[#202024]">Không nén tất cả</option>
              <option value="zip-store" className="bg-[#202024]">Zip Store tất cả</option>
              <option value="7z" className="bg-[#202024]">Nén 7z Tiêu chuẩn</option>
            </select>
          </div>

          <div className="h-9 flex items-center gap-2 bg-[#101013] border border-[#32323d] px-3 rounded-lg">
            <span className="text-xs text-zinc-400 font-medium">Xong:</span>
            <select
              value={postAction}
              onChange={(e) => setPostAction(e.target.value as typeof postAction)}
              className="bg-transparent text-[13px] text-zinc-100 outline-none font-medium"
            >
              <option value="drive-report-sleep" className="bg-[#202024]">Drive Report + Sleep</option>
              <option value="drive-report-shutdown" className="bg-[#202024]">Drive Report + Shutdown</option>
              <option value="drive-report-only" className="bg-[#202024]">Chỉ tạo Drive Report</option>
            </select>
          </div>

          {isWatching ? (
            <button
              onClick={() => window.frameBackup?.triggerWatchNow()}
              className="h-10 inline-flex items-center gap-2 px-5 rounded-lg bg-amber-500 hover:bg-amber-400 text-amber-950 font-extrabold text-sm transition shadow-lg shadow-amber-950/40"
            >
              <Zap className="w-4 h-4 fill-current" />
              ĐÃ CHÉP XONG — CHẠY NGAY
            </button>
          ) : (
            <button
              disabled={isRunning}
              onClick={handleRunFullPipeline}
              className="h-10 inline-flex items-center gap-2 px-5 rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 hover:brightness-110 disabled:opacity-50 border border-blue-400/70 text-white font-bold text-sm shadow-lg shadow-blue-950/60 transition"
            >
              {cardMode === 'watch' ? <Eye className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
              {isRunning
                ? 'ĐANG SAO LƯU...'
                : cardMode === 'watch'
                ? 'BẮT ĐẦU CANH Ổ 1'
                : 'CHẠY TOÀN BỘ CHUỖI'}
            </button>
          )}
        </div>
      </div>

      {/* HERO DATE MISMATCH ALERT */}
      <DateMismatchAlert
        visible={showBigAlert}
        sourceLabel={cardPath || 'THẺ NHỚ'}
        targetDate={targetDate}
        groups={dateGroups}
        onFilterTargetOnly={() => setDateFilterMode('target-only')}
        onSplitByDate={() => {
          setDateFilterMode('split');
          setAlertDismissed(true);
        }}
        onIgnoreAndCopyAll={() => setAlertDismissed(true)}
        onDismiss={() => setAlertDismissed(true)}
      />

      {/* 4-COLUMN RESIZABLE PIPELINE WORKSPACE */}
      <div ref={workspaceRef} className="flex-1 flex min-h-0 p-2.5 gap-0">
        {/* COLUMN 1: THẺ NHỚ / NGUỒN */}
        <section
          style={{ flexBasis: `${colWeights[0]}%`, flexGrow: colWeights[0], flexShrink: 1 }}
          className={`flex flex-col min-w-[160px] bg-[#18181c] border rounded-lg overflow-hidden ${
            expandedCol === 1 ? 'border-blue-500' : showBigAlert ? 'border-red-500/75' : 'border-[#2b2b34]'
          }`}
        >
          <div className="p-2 bg-[#141418] border-b border-[#2b2b34] space-y-1.5">
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1.5 font-bold text-xs">
                <span className="w-5 h-5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center text-[11px]">
                  1
                </span>
                <span>THẺ NHỚ (NGUỒN)</span>
              </div>
              <div className="flex items-center gap-1">
                {cardPath && !cardPath.startsWith('DEMO') && (
                  <button
                    onClick={handleSafeEject}
                    className="px-1.5 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-[10.5px] font-medium"
                    title="Safe Eject thẻ nhớ"
                  >
                    ⏏ Eject
                  </button>
                )}
                <button
                  onClick={() => handleToggleExpandCol(1)}
                  className="p-1 rounded bg-[#23232a] hover:bg-[#2e2e38] text-zinc-400 hover:text-white"
                  title="Phóng to / Thu đều cột"
                >
                  {expandedCol === 1 ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[10.5px] text-zinc-400">
              <span className="truncate">
                {cardDriveInfo
                  ? `${cardDriveInfo.label} • Trống ${formatBytes(cardDriveInfo.freeBytes)}`
                  : 'Chọn thẻ nhớ hoặc ổ nguồn'}
              </span>
              <div className="flex-1 h-1 bg-[#272730] rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full"
                  style={{ width: `${cardDriveInfo?.usedPercent ?? 0}%` }}
                />
              </div>
            </div>
          </div>

          <div className="p-1.5 bg-[#1b1b20] border-b border-[#2b2b34] flex items-center gap-1">
            {getParentDirectory(cardPath) && !cardPath.startsWith('DEMO') && (
              <button
                onClick={() => {
                  const p = getParentDirectory(cardPath);
                  if (p) {
                    setCardPath(p);
                    void refreshCardSmart(p);
                  }
                }}
                className="px-1.5 py-1 rounded bg-[#23232a] hover:bg-[#32323c] border border-[#3e3e4b] text-zinc-300 shrink-0"
                title="Lên thư mục cha"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
            )}
            <select
              value={cardPath}
              onChange={(e) => {
                const val = e.target.value;
                setCardPath(val);
                setAlertDismissed(false);
                setDateFilterMode('all');
                void refreshCardSmart(val);
              }}
              className="flex-1 min-w-0 bg-[#101013] border border-[#2b2b34] rounded px-2 py-1 text-[11px] text-zinc-100 outline-none"
            >
              <option value="" className="bg-[#202024]">-- Chọn ổ / thẻ nhớ --</option>
              {drives.map((d) => (
                <option key={d.id} value={d.mountPath} className="bg-[#202024]">
                  {d.isRemovable ? '💳 ' : '💿 '}
                  {d.label} ({formatBytes(d.freeBytes)} trống)
                </option>
              ))}
              {cardPath && !drives.some((d) => d.mountPath === cardPath) && (
                <option value={cardPath} className="bg-[#202024]">{cardPath}</option>
              )}
            </select>
            <button
              onClick={() => handlePickFolder(1)}
              className="px-2 py-1 rounded bg-[#23232a] hover:bg-[#32323c] border border-[#3e3e4b] text-[11px] text-zinc-200 shrink-0"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="px-2 py-1 bg-[#1b1b20] border-b border-[#2b2b34] flex items-center justify-between text-[10.5px] text-zinc-400">
            <button
              onClick={() => setCardMode(cardMode === 'ingest' ? 'watch' : 'ingest')}
              className="hover:text-zinc-200"
              title="Bấm để đổi giữa App tự Ingest từ thẻ và Watch Mode canh Ổ 1"
            >
              Chế độ: <strong className="text-amber-300">{cardMode === 'ingest' ? 'App tự Ingest' : 'Watch Ổ 1'}</strong>
            </button>
            <span>
              {dateFilterMode === 'target-only'
                ? 'Đã lọc đúng ngày'
                : dateFilterMode === 'split'
                ? 'Tách theo ngày'
                : `${displayedCardFiles.length} mục`}
            </span>
          </div>

          <div className="flex-1 overflow-auto">
            {cardScanning ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 text-blue-300 gap-2">
                <RefreshCw className="w-6 h-6 animate-spin" />
                <div className="text-xs">Đang quét toàn bộ file & Metadata EXIF/Video trên thẻ...</div>
              </div>
            ) : displayedCardFiles.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 text-zinc-500 gap-2">
                <FolderOpen className="w-7 h-7 text-zinc-600" />
                <div className="text-xs">Chọn thẻ nhớ / thư mục nguồn ở trên</div>
                <div className="text-[11px] text-zinc-600">Hoặc bấm &ldquo;Test Lệch ngày&rdquo; để xem thử</div>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-[11.5px]">
                <thead className="sticky top-0 bg-[#202026] text-zinc-400 text-[10.5px]">
                  <tr>
                    <th className="py-1.5 px-2 font-semibold">File</th>
                    <th className="py-1.5 px-2 font-semibold">Size</th>
                    <th className="py-1.5 px-2 font-semibold">Ngày gốc</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedCardFiles.map((f) => {
                    const mismatch =
                      !f.isDirectory && !isTimestampMatchingTargetDate(f.shotTimeMs, targetDate, overnightMode);
                    return (
                      <tr
                        key={f.fullPath}
                        onDoubleClick={() => {
                          if (f.isDirectory) {
                            setCardPath(f.fullPath);
                            void refreshCardSmart(f.fullPath);
                          }
                        }}
                        className={`border-b border-white/[0.03] hover:bg-[#272730] ${
                          mismatch ? 'bg-red-500/15 text-red-200 border-l-2 border-l-red-500' : ''
                        }`}
                      >
                        <td className="py-1 px-2 max-w-[140px] truncate">
                          <div className="flex items-center gap-1.5">
                            <FileIcon type={f.mediaType} />
                            <span className="truncate">{f.name}</span>
                          </div>
                        </td>
                        <td className="py-1 px-2 whitespace-nowrap text-zinc-400">
                          {f.isDirectory ? '—' : formatBytes(f.sizeBytes)}
                        </td>
                        <td className="py-1 px-2 whitespace-nowrap" title={`Nguồn ngày: ${f.dateSource}`}>
                          {mismatch ? (
                            <span className="px-1.5 py-0.5 rounded bg-red-500 text-white text-[10px] font-bold">
                              {formatShortDate(f.shotTimeMs)}
                            </span>
                          ) : (
                            <span className="text-zinc-400">{formatShortDate(f.shotTimeMs)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-2.5 py-1.5 bg-[#141418] border-t border-[#2b2b34] flex justify-between text-[11px] text-zinc-400">
            <span>{displayedCardFiles.length} mục</span>
            <span className="text-amber-300 font-medium">{formatBytes(totalCardBytes)}</span>
          </div>
        </section>

        {/* RESIZABLE SPLITTER 1 <-> 2 */}
        <div
          onMouseDown={(e) => startHorizontalResize(0, e)}
          onDoubleClick={() => {
            setExpandedCol(null);
            setColWeights([...DEFAULT_COL_WEIGHTS]);
          }}
          title="Kéo trái/phải để chỉnh độ rộng cột • Double-click để chia đều"
          className="w-3.5 cursor-col-resize flex items-center justify-center shrink-0 group select-none"
        >
          <div className="w-1 h-14 rounded-full bg-[#2e2e38] group-hover:bg-blue-500 group-hover:h-24 transition-all flex items-center justify-center">
            <ArrowRight className="w-3 h-3 text-blue-400 opacity-0 group-hover:opacity-100" />
          </div>
        </div>

        {/* COLUMN 2: Ổ 1 (LÀM VIỆC) */}
        <section
          style={{ flexBasis: `${colWeights[1]}%`, flexGrow: colWeights[1], flexShrink: 1 }}
          className={`flex flex-col min-w-[160px] bg-[#18181c] border rounded-lg overflow-hidden ${
            expandedCol === 2 ? 'border-blue-500' : d1Insufficient ? 'border-red-500' : 'border-[#2b2b34]'
          }`}
        >
          <div className="p-2 bg-[#141418] border-b border-[#2b2b34] space-y-1.5">
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1.5 font-bold text-xs">
                <span className="w-5 h-5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/40 flex items-center justify-center text-[11px]">
                  2
                </span>
                <span>Ổ 1 (LÀM VIỆC)</span>
              </div>
              <button
                onClick={() => handleToggleExpandCol(2)}
                className="p-1 rounded bg-[#23232a] hover:bg-[#2e2e38] text-zinc-400 hover:text-white"
                title="Phóng to / Thu đều cột"
              >
                {expandedCol === 2 ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="flex items-center gap-2 text-[10.5px]">
              <span className={d1Insufficient ? 'text-red-400 font-bold' : 'text-zinc-400 truncate'}>
                {d1DriveInfo
                  ? d1Insufficient
                    ? `⚠️ Thiếu chỗ! Trống ${formatBytes(d1DriveInfo.freeBytes)}`
                    : `${d1DriveInfo.label} • Trống ${formatBytes(d1DriveInfo.freeBytes)}`
                  : 'Chọn thư mục Ổ 1 (NVMe/SSD)'}
              </span>
              <div className="flex-1 h-1 bg-[#272730] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${d1Insufficient ? 'bg-red-500' : 'bg-blue-500'}`}
                  style={{ width: `${d1DriveInfo?.usedPercent ?? 0}%` }}
                />
              </div>
            </div>
          </div>

          <div className="p-1.5 bg-[#1b1b20] border-b border-[#2b2b34] flex items-center gap-1">
            {getParentDirectory(drive1Path) && (
              <button
                onClick={() => {
                  const p = getParentDirectory(drive1Path);
                  if (p) {
                    setDrive1Path(p);
                    void refreshDirectory(p, setDrive1Files);
                  }
                }}
                className="px-1.5 py-1 rounded bg-[#23232a] hover:bg-[#32323c] border border-[#3e3e4b] text-zinc-300 shrink-0"
                title="Lên thư mục cha"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
            )}
            <input
              type="text"
              value={drive1Path}
              onChange={(e) => setDrive1Path(e.target.value)}
              onBlur={() => void refreshDirectory(drive1Path, setDrive1Files)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void refreshDirectory(drive1Path, setDrive1Files);
              }}
              placeholder="Đường dẫn Ổ 1 (vd: I:\01_Project video)"
              className="flex-1 min-w-0 bg-[#101013] border border-[#2b2b34] rounded px-2 py-1 text-[11px] text-zinc-100 outline-none"
            />
            <button
              onClick={() => handlePickFolder(2)}
              className="px-2 py-1 rounded bg-[#23232a] hover:bg-[#32323c] border border-[#3e3e4b] text-zinc-200 shrink-0"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="px-2 py-1 bg-[#1b1b20] border-b border-[#2b2b34] flex items-center justify-between text-[10.5px] text-zinc-400">
            <span className="truncate">Đích: {projectName}</span>
            <span className="text-emerald-400 inline-flex items-center gap-1 shrink-0">
              <ShieldCheck className="w-3 h-3" /> XXHash64
            </span>
          </div>

          <div className="flex-1 overflow-auto">
            {drive1Files.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 text-zinc-500 gap-1.5">
                <HardDrive className="w-7 h-7 text-zinc-600" />
                <div className="text-xs">Chưa chọn thư mục Ổ 1</div>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-[11.5px]">
                <thead className="sticky top-0 bg-[#202026] text-zinc-400 text-[10.5px]">
                  <tr>
                    <th className="py-1.5 px-2 font-semibold">Tên</th>
                    <th className="py-1.5 px-2 font-semibold">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {drive1Files.map((f) => (
                    <tr
                      key={f.fullPath}
                      onDoubleClick={() => {
                        if (f.isDirectory) {
                          setDrive1Path(f.fullPath);
                          void refreshDirectory(f.fullPath, setDrive1Files);
                        }
                      }}
                      className="border-b border-white/[0.03] hover:bg-[#272730]"
                    >
                      <td className="py-1 px-2 max-w-[160px] truncate">
                        <div className="flex items-center gap-1.5">
                          <FileIcon type={f.mediaType} />
                          <span className="truncate">{f.name}</span>
                        </div>
                      </td>
                      <td className="py-1 px-2 text-zinc-400 whitespace-nowrap">
                        {f.isDirectory ? 'Folder' : formatBytes(f.sizeBytes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-2.5 py-1.5 bg-[#141418] border-t border-[#2b2b34] flex justify-between text-[11px] text-zinc-400">
            <span>{drive1Files.length} mục hiện có</span>
            <span className="text-blue-400">Primary</span>
          </div>
        </section>

        {/* RESIZABLE SPLITTER 2 <-> 3 */}
        <div
          onMouseDown={(e) => startHorizontalResize(1, e)}
          onDoubleClick={() => {
            setExpandedCol(null);
            setColWeights([...DEFAULT_COL_WEIGHTS]);
          }}
          title="Kéo trái/phải để chỉnh độ rộng cột • Double-click để chia đều"
          className="w-3.5 cursor-col-resize flex items-center justify-center shrink-0 group select-none"
        >
          <div className="w-1 h-14 rounded-full bg-[#2e2e38] group-hover:bg-emerald-500 group-hover:h-24 transition-all flex items-center justify-center">
            <ArrowRight className="w-3 h-3 text-emerald-400 opacity-0 group-hover:opacity-100" />
          </div>
        </div>

        {/* COLUMN 3: Ổ 2 (SAO LƯU) */}
        <section
          style={{ flexBasis: `${colWeights[2]}%`, flexGrow: colWeights[2], flexShrink: 1 }}
          className={`flex flex-col min-w-[160px] bg-[#18181c] border rounded-lg overflow-hidden ${
            expandedCol === 3 ? 'border-emerald-500' : d2Insufficient ? 'border-red-500' : 'border-[#2b2b34]'
          }`}
        >
          <div className="p-2 bg-[#141418] border-b border-[#2b2b34] space-y-1.5">
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1.5 font-bold text-xs">
                <span className="w-5 h-5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center text-[11px]">
                  3
                </span>
                <span>Ổ 2 (SAO LƯU)</span>
              </div>
              <button
                onClick={() => handleToggleExpandCol(3)}
                className="p-1 rounded bg-[#23232a] hover:bg-[#2e2e38] text-zinc-400 hover:text-white"
                title="Phóng to / Thu đều cột"
              >
                {expandedCol === 3 ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="flex items-center gap-2 text-[10.5px]">
              <span className={d2Insufficient ? 'text-red-400 font-bold' : 'text-zinc-400 truncate'}>
                {d2DriveInfo
                  ? d2Insufficient
                    ? `⚠️ Thiếu chỗ! Trống ${formatBytes(d2DriveInfo.freeBytes)}`
                    : `${d2DriveInfo.label} • Trống ${formatBytes(d2DriveInfo.freeBytes)}`
                  : 'Chọn thư mục Ổ 2 (Backup HDD)'}
              </span>
              <div className="flex-1 h-1 bg-[#272730] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${d2Insufficient ? 'bg-red-500' : 'bg-emerald-500'}`}
                  style={{ width: `${d2DriveInfo?.usedPercent ?? 0}%` }}
                />
              </div>
            </div>
          </div>

          <div className="p-1.5 bg-[#1b1b20] border-b border-[#2b2b34] flex items-center gap-1">
            {getParentDirectory(drive2Path) && (
              <button
                onClick={() => {
                  const p = getParentDirectory(drive2Path);
                  if (p) {
                    setDrive2Path(p);
                    void refreshDirectory(p, setDrive2Files);
                  }
                }}
                className="px-1.5 py-1 rounded bg-[#23232a] hover:bg-[#32323c] border border-[#3e3e4b] text-zinc-300 shrink-0"
                title="Lên thư mục cha"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
            )}
            <input
              type="text"
              value={drive2Path}
              onChange={(e) => setDrive2Path(e.target.value)}
              onBlur={() => void refreshDirectory(drive2Path, setDrive2Files)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void refreshDirectory(drive2Path, setDrive2Files);
              }}
              placeholder="Đường dẫn Ổ 2 (vd: E:\Backup_2026)"
              className="flex-1 min-w-0 bg-[#101013] border border-[#2b2b34] rounded px-2 py-1 text-[11px] text-zinc-100 outline-none"
            />
            <button
              onClick={() => handlePickFolder(3)}
              className="px-2 py-1 rounded bg-[#23232a] hover:bg-[#32323c] border border-[#3e3e4b] text-zinc-200 shrink-0"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="px-2 py-1 bg-[#1b1b20] border-b border-[#2b2b34] flex items-center justify-between text-[10.5px] text-zinc-400">
            <span>Mirror 1:1 từ Ổ 1</span>
            <span className="text-emerald-400">Verify 100%</span>
          </div>

          <div className="flex-1 overflow-auto">
            {drive2Files.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 text-zinc-500 gap-1.5">
                <Database className="w-7 h-7 text-zinc-600" />
                <div className="text-xs">Chưa chọn thư mục Ổ 2</div>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-[11.5px]">
                <thead className="sticky top-0 bg-[#202026] text-zinc-400 text-[10.5px]">
                  <tr>
                    <th className="py-1.5 px-2 font-semibold">Tên</th>
                    <th className="py-1.5 px-2 font-semibold">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {drive2Files.map((f) => (
                    <tr
                      key={f.fullPath}
                      onDoubleClick={() => {
                        if (f.isDirectory) {
                          setDrive2Path(f.fullPath);
                          void refreshDirectory(f.fullPath, setDrive2Files);
                        }
                      }}
                      className="border-b border-white/[0.03] hover:bg-[#272730]"
                    >
                      <td className="py-1 px-2 max-w-[160px] truncate">
                        <div className="flex items-center gap-1.5">
                          <FileIcon type={f.mediaType} />
                          <span className="truncate">{f.name}</span>
                        </div>
                      </td>
                      <td className="py-1 px-2 text-zinc-400 whitespace-nowrap">
                        {f.isDirectory ? 'Folder' : formatBytes(f.sizeBytes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-2.5 py-1.5 bg-[#141418] border-t border-[#2b2b34] flex justify-between text-[11px] text-zinc-400">
            <span>{drive2Files.length} mục hiện có</span>
            <span className="text-emerald-400">Backup</span>
          </div>
        </section>

        {/* RESIZABLE SPLITTER 3 <-> 4 */}
        <div
          onMouseDown={(e) => startHorizontalResize(2, e)}
          onDoubleClick={() => {
            setExpandedCol(null);
            setColWeights([...DEFAULT_COL_WEIGHTS]);
          }}
          title="Kéo trái/phải để chỉnh độ rộng cột • Double-click để chia đều"
          className="w-3.5 cursor-col-resize flex items-center justify-center shrink-0 group select-none"
        >
          <div className="w-1 h-14 rounded-full bg-[#2e2e38] group-hover:bg-purple-500 group-hover:h-24 transition-all flex items-center justify-center">
            <ArrowRight className="w-3 h-3 text-purple-400 opacity-0 group-hover:opacity-100" />
          </div>
        </div>

        {/* COLUMN 4: GOOGLE DRIVE */}
        <section
          style={{ flexBasis: `${colWeights[3]}%`, flexGrow: colWeights[3], flexShrink: 1 }}
          className={`flex flex-col min-w-[160px] bg-[#18181c] border rounded-lg overflow-hidden ${
            expandedCol === 4 ? 'border-purple-500' : 'border-[#2b2b34]'
          }`}
        >
          <div className="p-2 bg-[#141418] border-b border-[#2b2b34] space-y-1.5">
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1.5 font-bold text-xs">
                <span className="w-5 h-5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/40 flex items-center justify-center text-[11px]">
                  4
                </span>
                <span>GOOGLE DRIVE</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setDriveAuthModalOpen(true)}
                  className={`px-2 py-0.5 rounded text-[10.5px] font-semibold border transition ${
                    driveAuth.signedIn
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                      : 'bg-purple-600/25 border-purple-500/50 text-purple-200 hover:bg-purple-600/40'
                  }`}
                >
                  {driveAuth.signedIn ? '✓ Drive OK' : 'Kết nối Drive'}
                </button>
                <button
                  onClick={() => handleToggleExpandCol(4)}
                  className="p-1 rounded bg-[#23232a] hover:bg-[#2e2e38] text-zinc-400 hover:text-white"
                  title="Phóng to / Thu đều cột"
                >
                  {expandedCol === 4 ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between text-[10.5px] text-zinc-400 gap-2">
              <span className="truncate">
                {driveAuth.signedIn
                  ? `${driveAuth.email}${
                      driveAuth.quotaLimitBytes && driveAuth.quotaUsageBytes !== undefined
                        ? ` • Trống ${formatBytes(Math.max(0, driveAuth.quotaLimitBytes - driveAuth.quotaUsageBytes))}`
                        : ''
                    }`
                  : 'Chưa đăng nhập Google Drive'}
              </span>
              {driveFolderCheck && (
                <span className={driveFolderCheck.canEdit ? 'text-emerald-400 font-semibold shrink-0' : 'text-red-400 font-semibold shrink-0'}>
                  {driveFolderCheck.canEdit ? '✓ Editor' : '✕ Chỉ xem'}
                </span>
              )}
            </div>
          </div>

          <div className="p-1.5 bg-[#1b1b20] border-b border-[#2b2b34] flex items-center gap-1">
            <div className="flex-1 min-w-0 flex items-center gap-1.5 bg-[#101013] border border-[#2b2b34] rounded px-2 py-1">
              <Link2 className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              <input
                type="text"
                value={driveLink}
                onChange={(e) => {
                  setDriveLink(e.target.value);
                  setDriveFolderCheck(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCheckDriveLink();
                }}
                placeholder="Dán link thư mục Google Drive..."
                className="w-full bg-transparent text-[11px] text-zinc-100 outline-none"
              />
            </div>
            <button
              disabled={checkingDriveLink || !driveLink.trim()}
              onClick={() => void handleCheckDriveLink()}
              className="px-2 py-1 rounded bg-purple-600/80 hover:bg-purple-500 disabled:opacity-40 text-white text-[11px] font-semibold shrink-0"
            >
              {checkingDriveLink ? '...' : 'Check'}
            </button>
          </div>

          <div className="px-2 py-1 bg-[#1b1b20] border-b border-[#2b2b34] flex items-center justify-between text-[10.5px] text-zinc-400">
            <span className="truncate">
              {driveFolderCheck?.folderName
                ? `📁 ${driveFolderCheck.folderName}`
                : parsedDriveFolderId
                ? `ID: ${parsedDriveFolderId}`
                : 'Resumable 16MB Chunk'}
            </span>
            <span className="text-purple-300 shrink-0">+ Report & 2 Thumbs</span>
          </div>

          <div className="flex-1 overflow-auto">
            {driveFolderCheck && driveFolderCheck.files.length > 0 ? (
              <table className="w-full text-left border-collapse text-[11.5px]">
                <thead className="sticky top-0 bg-[#202026] text-zinc-400 text-[10.5px]">
                  <tr>
                    <th className="py-1.5 px-2 font-semibold">File trên Drive</th>
                    <th className="py-1.5 px-2 font-semibold">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {driveFolderCheck.files.map((rf) => (
                    <tr key={rf.id} className="border-b border-white/[0.03] hover:bg-[#272730]">
                      <td className="py-1 px-2 max-w-[160px] truncate">
                        <div className="flex items-center gap-1.5">
                          <FileIcon
                            type={
                              rf.isFolder
                                ? 'folder'
                                : rf.mimeType.startsWith('video/')
                                ? 'video'
                                : rf.mimeType.startsWith('image/')
                                ? 'photo'
                                : 'other'
                            }
                          />
                          <span className="truncate">{rf.name}</span>
                        </div>
                      </td>
                      <td className="py-1 px-2 text-zinc-400 whitespace-nowrap">
                        {rf.isFolder ? 'Folder' : formatBytes(rf.sizeBytes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-3 space-y-2">
                <div className="p-2.5 rounded-lg bg-[#141418] border border-[#2b2b34] space-y-1 text-[11.5px]">
                  <div className="font-semibold text-purple-300 flex items-center gap-1.5">
                    <Cloud className="w-4 h-4" /> Tự động tạo ngay đầu thư mục Drive:
                  </div>
                  <div className="text-zinc-300">• 📄 `_00_BACKUP_REPORT.txt`</div>
                  <div className="text-zinc-300">• 🖼️ `_01_FIRST_SHOT_*.jpg`</div>
                  <div className="text-zinc-300">• 🖼️ `_02_LAST_SHOT_*.jpg`</div>
                </div>
                {driveFolderCheck?.error && (
                  <div className="p-2.5 rounded-lg bg-red-500/15 border border-red-500/40 text-[11.5px] text-red-200">
                    {driveFolderCheck.error}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="px-2.5 py-1.5 bg-[#141418] border-t border-[#2b2b34] flex justify-between text-[11px] text-zinc-400">
            <span>{driveFolderCheck ? `${driveFolderCheck.files.length} mục trên Drive` : 'Resumable Chunked'}</span>
            <span className="text-purple-400">Cloud</span>
          </div>
        </section>
      </div>

      {/* HORIZONTAL RESIZE SPLITTER (Drag up/down to resize Progress & Log Panel) */}
      <div
        onMouseDown={startVerticalResize}
        onDoubleClick={() => setBottomHeight(DEFAULT_BOTTOM_HEIGHT)}
        title="Kéo lên/xuống để chỉnh độ cao khung tiến trình & Live Log • Double-click để mặc định"
        className="h-2.5 bg-[#121215] border-t border-[#2b2b34] cursor-row-resize flex items-center justify-center shrink-0 group select-none hover:bg-blue-500/15 transition"
      >
        <div className="w-16 h-1 rounded-full bg-[#3e3e4b] group-hover:bg-blue-400 transition" />
      </div>

      {/* BOTTOM PIPELINE BAR */}
      <PipelineBar
        projectName={projectName}
        heightPx={bottomHeight}
        step1Progress={step1Progress}
        step2Progress={step2Progress}
        step3Progress={step3Progress}
        step4Progress={step4Progress}
        watchStatus={watchStatus}
        activityLogs={activityLogs}
        isRunning={isRunning || isWatching}
        onCancel={handleCancelAll}
        onOpenReportPreview={() => setReportOpen(true)}
      />

      {/* REPORT PREVIEW MODAL */}
      <ReportPreviewModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        projectName={projectName}
        targetDate={targetDate}
        driveLink={driveLink}
        mediaReport={mediaReport}
      />

      {/* GOOGLE DRIVE AUTH MODAL */}
      <GoogleDriveAuthModal
        open={driveAuthModalOpen}
        onClose={() => setDriveAuthModalOpen(false)}
        authStatus={driveAuth}
        onAuthChanged={setDriveAuth}
        onNotify={showToast}
      />
    </div>
  );
}
