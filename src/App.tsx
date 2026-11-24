import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
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
import { PipelineBar } from './components/PipelineBar';
import { ReportPreviewModal } from './components/ReportPreviewModal';
import {
  formatBytes,
  formatDateKey,
  formatShortDate,
  isTimestampMatchingTargetDate,
  parseGoogleDriveFolderId,
  type CopyProgressEvent,
  type DateFilterMode,
  type DriveInfo,
  type FileEntry,
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

export default function App() {
  const [sysInfo, setSysInfo] = useState<SystemInfo>({
    platform: 'win32',
    arch: 'x64',
    hostname: 'Local',
    preventSleepActive: false,
  });
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [expandedCol, setExpandedCol] = useState<number | null>(null);

  // Column Paths & Entries
  const [cardPath, setCardPath] = useState('');
  const [cardFiles, setCardFiles] = useState<FileEntry[]>([]);
  const [cardMode, setCardMode] = useState<'ingest' | 'watch'>('ingest');

  const [drive1Path, setDrive1Path] = useState('');
  const [drive1Files, setDrive1Files] = useState<FileEntry[]>([]);

  const [drive2Path, setDrive2Path] = useState('');
  const [drive2Files, setDrive2Files] = useState<FileEntry[]>([]);

  const [driveLink, setDriveLink] = useState('');
  const [projectName, setProjectName] = useState(() => `${getTodayDateString().replace(/-/g, '.')}.New_Show`);

  // Settings (Telegram removed — Drive Report + Sleep/Shutdown only)
  const [targetDate, setTargetDate] = useState(getTodayDateString);
  const [overnightMode, setOvernightMode] = useState(true);
  const [packMode, setPackMode] = useState<'video-raw-smart' | 'none' | 'zip-store' | '7z'>('video-raw-smart');
  const [postAction, setPostAction] = useState<'drive-report-sleep' | 'drive-report-shutdown' | 'drive-report-only'>(
    'drive-report-sleep'
  );
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>('all');
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  // Phase 2 Live Pipeline State
  const [isRunning, setIsRunning] = useState(false);
  const [step1Progress, setStep1Progress] = useState<CopyProgressEvent | null>(null);
  const [step2Progress, setStep2Progress] = useState<CopyProgressEvent | null>(null);
  const [watchStatus, setWatchStatus] = useState<WatchStatusEvent | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Refs for latest paths inside watch callback
  const drive1PathRef = useRef(drive1Path);
  const drive2PathRef = useRef(drive2Path);
  const projectNameRef = useRef(projectName);
  drive1PathRef.current = drive1Path;
  drive2PathRef.current = drive2Path;
  projectNameRef.current = projectName;

  const parsedDriveFolderId = useMemo(() => parseGoogleDriveFolderId(driveLink), [driveLink]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg((prev) => (prev === msg ? null : prev)), 5000);
  };

  const loadSystemData = async () => {
    if (!window.frameBackup) return;
    const [info, diskList] = await Promise.all([
      window.frameBackup.getSystemInfo(),
      window.frameBackup.listDrives(),
    ]);
    setSysInfo(info);
    setDrives(diskList);
  };

  useEffect(() => {
    void loadSystemData();
    if (!window.frameBackup) return;

    const unsubCopy = window.frameBackup.onCopyProgress((ev) => {
      if (ev.stage === 'card-to-drive1') setStep1Progress(ev);
      if (ev.stage === 'drive1-to-drive2') setStep2Progress(ev);
    });

    const unsubWatch = window.frameBackup.onWatchStatus((st) => {
      setWatchStatus(st);
      if (st.state === 'ready') {
        void runDrive1ToDrive2(st.watchDir);
      }
    });

    return () => {
      unsubCopy();
      unsubWatch();
    };
  }, []);

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
      await refreshDirectory(picked, setCardFiles);
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

  const runDrive1ToDrive2 = async (sourceOnDrive1: string) => {
    if (!window.frameBackup) return;
    const d2Base = drive2PathRef.current;
    if (!d2Base) {
      showToast('Chưa chọn thư mục Ổ 2 (Sao lưu) nên chỉ hoàn tất bước 1.');
      return;
    }
    setIsRunning(true);
    const destOnDrive2 = joinPath(d2Base, projectNameRef.current);
    const res2 = await window.frameBackup.startCopyVerify({
      stage: 'drive1-to-drive2',
      sourceDir: sourceOnDrive1,
      destDir: destOnDrive2,
    });
    setIsRunning(false);
    if (res2.success) {
      showToast(`✅ Đã sao lưu & Verify 100% (${res2.verifiedFiles} files) sang Ổ 2!`);
      await refreshDirectory(d2Base, setDrive2Files);
      await loadSystemData();
    } else if (res2.error !== 'CANCELLED') {
      showToast(`❌ Lỗi Sao lưu Ổ 2: ${res2.error}`);
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

    // Watch Mode: user copies manually into Drive 1, app watches Drive 1 then backs up to Drive 2
    if (cardMode === 'watch') {
      await window.frameBackup.setPreventSleep(true);
      setSysInfo((prev) => ({ ...prev, preventSleepActive: true }));
      await window.frameBackup.startWatch(drive1Path, 20);
      showToast('👁 Đang bật Watch Mode tại Ổ 1 (chờ Explorer / TeraCopy / Finder chép xong)...');
      return;
    }

    if (!cardPath || cardPath.startsWith('DEMO')) {
      showToast('Vui lòng chọn thư mục Thẻ nhớ / Nguồn thật ở Cột 1.');
      return;
    }

    setIsRunning(true);
    setStep1Progress(null);
    setStep2Progress(null);
    await window.frameBackup.setPreventSleep(true);
    setSysInfo((prev) => ({ ...prev, preventSleepActive: true }));

    const destOnDrive1 = joinPath(drive1Path, projectName);
    const res1 = await window.frameBackup.startCopyVerify({
      stage: 'card-to-drive1',
      sourceDir: cardPath,
      destDir: destOnDrive1,
      targetDate,
      overnightMode,
      dateFilterMode,
    });

    if (!res1.success) {
      setIsRunning(false);
      if (res1.error !== 'CANCELLED') {
        showToast(`❌ Lỗi Ingest Ổ 1: ${res1.error}`);
      }
      return;
    }

    await refreshDirectory(drive1Path, setDrive1Files);
    showToast(`✅ Xong Ổ 1 (${res1.verifiedFiles} files, bỏ qua ${res1.skippedFiles} file lệch ngày) — Đang chạy Ổ 2...`);

    if (drive2Path) {
      await runDrive1ToDrive2(destOnDrive1);
    } else {
      setIsRunning(false);
      await loadSystemData();
    }
  };

  const handleCancelAll = async () => {
    if (!window.frameBackup) return;
    await window.frameBackup.cancelCopy();
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
    <div className="h-screen w-screen flex flex-col bg-[#121215] text-zinc-100 overflow-hidden">
      {/* Top Status Bar */}
      <div className="h-8 bg-[#0d0d10] border-b border-[#2b2b34] px-3.5 flex items-center justify-between text-[11.5px] text-zinc-400 shrink-0">
        <div className="flex items-center gap-2 font-semibold text-zinc-100">
          <HardDrive className="w-4 h-4 text-blue-500" />
          <span>FrameBackup v0.2.0</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#23232b] border border-[#3e3e4b] text-zinc-300">
            {osBadge} ({sysInfo.arch})
          </span>
          {toastMsg && (
            <span className="ml-2 px-2 py-0.5 rounded bg-blue-500/20 border border-blue-500/40 text-blue-200 text-[11px] font-normal">
              {toastMsg}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleTogglePreventSleep}
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] border transition ${
              sysInfo.preventSleepActive
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-[#1f1f26] border-[#32323d] text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Moon className="w-3 h-3" />
            Prevent Sleep: {sysInfo.preventSleepActive ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={loadSystemData}
            className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-200"
            title="Quét lại ổ đĩa & thẻ nhớ"
          >
            <RefreshCw className="w-3 h-3" /> Quét ổ đĩa ({drives.length})
          </button>
        </div>
      </div>

      {/* Ribbon Toolbar */}
      <div className="bg-[#1b1b20] border-b border-[#2b2b34] px-3.5 py-2 flex items-center justify-between gap-3 flex-wrap shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-[#101013] border border-[#2b2b34] px-2.5 py-1 rounded-md">
            <span className="text-[11px] text-zinc-500">Show:</span>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="bg-transparent text-xs text-zinc-100 outline-none w-44 font-medium"
            />
          </div>

          <div className="flex items-center gap-2 bg-[#101013] border border-[#2b2b34] px-2.5 py-1 rounded-md">
            <span className="text-[11px] text-zinc-500">Ngày quay:</span>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => {
                setTargetDate(e.target.value);
                setAlertDismissed(false);
              }}
              className="bg-transparent text-xs text-zinc-100 outline-none"
            />
            <label className="inline-flex items-center gap-1 text-[11px] text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={overnightMode}
                onChange={(e) => setOvernightMode(e.target.checked)}
                className="accent-blue-500"
              />
              Xuyên đêm
            </label>
          </div>

          <button
            onClick={handleLoadDemoMismatch}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-300 text-[11px] font-medium transition"
          >
            <AlertTriangle className="w-3.5 h-3.5" /> Test Lệch ngày
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-[#101013] border border-[#2b2b34] px-2 py-1 rounded-md">
            <span className="text-[11px] text-zinc-500">Drive:</span>
            <select
              value={packMode}
              onChange={(e) => setPackMode(e.target.value as typeof packMode)}
              className="bg-transparent text-xs text-zinc-100 outline-none"
            >
              <option value="video-raw-smart" className="bg-[#202024]">Video: Folder | Ảnh: Zip Store</option>
              <option value="none" className="bg-[#202024]">Không nén tất cả</option>
              <option value="zip-store" className="bg-[#202024]">Zip Store tất cả</option>
              <option value="7z" className="bg-[#202024]">Nén 7z Tiêu chuẩn</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-[#101013] border border-[#2b2b34] px-2 py-1 rounded-md">
            <span className="text-[11px] text-zinc-500">Xong:</span>
            <select
              value={postAction}
              onChange={(e) => setPostAction(e.target.value as typeof postAction)}
              className="bg-transparent text-xs text-zinc-100 outline-none"
            >
              <option value="drive-report-sleep" className="bg-[#202024]">Drive Report + Sleep</option>
              <option value="drive-report-shutdown" className="bg-[#202024]">Drive Report + Shutdown</option>
              <option value="drive-report-only" className="bg-[#202024]">Chỉ tạo Drive Report</option>
            </select>
          </div>

          {isWatching ? (
            <button
              onClick={() => window.frameBackup?.triggerWatchNow()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold text-xs transition"
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
              ĐÃ CHÉP XONG — CHẠY NGAY
            </button>
          ) : (
            <button
              disabled={isRunning}
              onClick={handleRunFullPipeline}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 hover:brightness-110 disabled:opacity-50 border border-blue-400/60 text-white font-semibold text-xs shadow-lg shadow-blue-950/50 transition"
            >
              {cardMode === 'watch' ? <Eye className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
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

      {/* 4-COLUMN PIPELINE WORKSPACE */}
      <div className="flex-1 flex min-h-0 p-2.5 gap-1">
        {/* COLUMN 1: THẺ NHỚ / NGUỒN */}
        <section
          className={`flex flex-col min-w-[230px] bg-[#18181c] border rounded-lg overflow-hidden transition-all ${
            expandedCol === 1 ? 'flex-[1.9] border-blue-500' : 'flex-1'
          } ${showBigAlert ? 'border-red-500/75' : 'border-[#2b2b34]'}`}
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
                  onClick={() => setExpandedCol(expandedCol === 1 ? null : 1)}
                  className="p-1 rounded bg-[#23232a] hover:bg-[#2e2e38] text-zinc-400 hover:text-white"
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
            <select
              value={cardPath}
              onChange={(e) => {
                const val = e.target.value;
                setCardPath(val);
                setAlertDismissed(false);
                setDateFilterMode('all');
                void refreshDirectory(val, setCardFiles);
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
            {displayedCardFiles.length === 0 ? (
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
                            void refreshDirectory(f.fullPath, setCardFiles);
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

        {/* CONNECTOR 1 -> 2 */}
        <div className="w-6 flex items-center justify-center shrink-0">
          <div className="w-5 h-9 rounded bg-[#1b1b20] border border-[#2b2b34] flex items-center justify-center text-blue-400">
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* COLUMN 2: Ổ 1 (LÀM VIỆC) */}
        <section
          className={`flex flex-col min-w-[220px] bg-[#18181c] border rounded-lg overflow-hidden transition-all ${
            expandedCol === 2 ? 'flex-[1.9] border-blue-500' : 'flex-1'
          } ${d1Insufficient ? 'border-red-500' : 'border-[#2b2b34]'}`}
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
                onClick={() => setExpandedCol(expandedCol === 2 ? null : 2)}
                className="p-1 rounded bg-[#23232a] hover:bg-[#2e2e38] text-zinc-400 hover:text-white"
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
            <input
              type="text"
              value={drive1Path}
              onChange={(e) => setDrive1Path(e.target.value)}
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

        {/* CONNECTOR 2 -> 3 */}
        <div className="w-6 flex items-center justify-center shrink-0">
          <div className="w-5 h-9 rounded bg-[#1b1b20] border border-[#2b2b34] flex items-center justify-center text-emerald-400">
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* COLUMN 3: Ổ 2 (SAO LƯU) */}
        <section
          className={`flex flex-col min-w-[220px] bg-[#18181c] border rounded-lg overflow-hidden transition-all ${
            expandedCol === 3 ? 'flex-[1.9] border-emerald-500' : 'flex-1'
          } ${d2Insufficient ? 'border-red-500' : 'border-[#2b2b34]'}`}
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
                onClick={() => setExpandedCol(expandedCol === 3 ? null : 3)}
                className="p-1 rounded bg-[#23232a] hover:bg-[#2e2e38] text-zinc-400 hover:text-white"
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
            <input
              type="text"
              value={drive2Path}
              onChange={(e) => setDrive2Path(e.target.value)}
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

        {/* CONNECTOR 3 -> 4 */}
        <div className="w-6 flex items-center justify-center shrink-0">
          <div className="w-5 h-9 rounded bg-[#1b1b20] border border-[#2b2b34] flex items-center justify-center text-purple-400">
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* COLUMN 4: GOOGLE DRIVE */}
        <section
          className={`flex flex-col min-w-[230px] bg-[#18181c] border rounded-lg overflow-hidden transition-all ${
            expandedCol === 4 ? 'flex-[1.9] border-purple-500' : 'flex-1 border-[#2b2b34]'
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
              <button
                onClick={() => setExpandedCol(expandedCol === 4 ? null : 4)}
                className="p-1 rounded bg-[#23232a] hover:bg-[#2e2e38] text-zinc-400 hover:text-white"
              >
                {expandedCol === 4 ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="flex items-center justify-between text-[10.5px] text-zinc-400">
              <span>Google Drive API v3 (Phase 4)</span>
              <span className={parsedDriveFolderId ? 'text-emerald-400 font-semibold' : 'text-zinc-500'}>
                {parsedDriveFolderId ? '✓ Link hợp lệ' : 'Chưa dán link'}
              </span>
            </div>
          </div>

          <div className="p-1.5 bg-[#1b1b20] border-b border-[#2b2b34] flex items-center gap-1">
            <div className="flex-1 min-w-0 flex items-center gap-1.5 bg-[#101013] border border-[#2b2b34] rounded px-2 py-1">
              <Link2 className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              <input
                type="text"
                value={driveLink}
                onChange={(e) => setDriveLink(e.target.value)}
                placeholder="Dán link thư mục Google Drive..."
                className="w-full bg-transparent text-[11px] text-zinc-100 outline-none"
              />
            </div>
          </div>

          <div className="px-2 py-1 bg-[#1b1b20] border-b border-[#2b2b34] flex items-center justify-between text-[10.5px] text-zinc-400">
            <span className="truncate">
              {parsedDriveFolderId ? `ID: ${parsedDriveFolderId}` : 'Resumable Upload ON'}
            </span>
            <span className="text-purple-300">+ Report & 2 Thumbs</span>
          </div>

          <div className="flex-1 overflow-auto p-3 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="p-2.5 rounded-lg bg-[#141418] border border-[#2b2b34] space-y-1 text-[11.5px]">
                <div className="font-semibold text-purple-300 flex items-center gap-1.5">
                  <Cloud className="w-4 h-4" /> Tự động tạo ngay đầu thư mục Drive:
                </div>
                <div className="text-zinc-300">• 📄 `_00_BACKUP_REPORT.txt`</div>
                <div className="text-zinc-300">• 🖼️ `_01_FIRST_SHOT_*.jpg`</div>
                <div className="text-zinc-300">• 🖼️ `_02_LAST_SHOT_*.jpg`</div>
              </div>
              {parsedDriveFolderId && (
                <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11.5px] text-emerald-300">
                  Đã nhận diện Folder ID: <code className="font-mono">{parsedDriveFolderId}</code>
                </div>
              )}
            </div>
          </div>

          <div className="px-2.5 py-1.5 bg-[#141418] border-t border-[#2b2b34] flex justify-between text-[11px] text-zinc-400">
            <span>Resumable Chunked</span>
            <span className="text-purple-400">Cloud</span>
          </div>
        </section>
      </div>

      {/* BOTTOM PIPELINE BAR */}
      <PipelineBar
        projectName={projectName}
        step1Progress={step1Progress}
        step2Progress={step2Progress}
        watchStatus={watchStatus}
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
      />
    </div>
  );
}
