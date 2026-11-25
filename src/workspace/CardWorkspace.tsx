import { AlertTriangle, CloudUpload, Eye, Play, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NameDialog, PropertiesDialog, type NamePrompt } from '../components/files/FileDialogs';
import { CardColumn, type CardMode } from '../components/columns/CardColumn';
import { DriveColumn } from '../components/columns/DriveColumn';
import { GoogleDriveColumn } from '../components/columns/GoogleDriveColumn';
import { ConflictModal, type ConflictPrompt } from '../components/ConflictModal';
import { DateMismatchAlert } from '../components/DateMismatchAlert';
import { BottomPanelSplitter, CopyArrowSplitter, ResizeSplitter } from '../components/layout/Splitters';
import { InfoStrip } from '../components/layout/ColumnParts';
import { PipelineBar } from '../components/PipelineBar';
import { ReportPreviewModal } from '../components/ReportPreviewModal';
import { useDropZone } from '../hooks/useDropZone';
import type { ListCommand } from '../hooks/useExplorerList';
import { useFolderNav } from '../hooks/useFolderNav';
import { useLatestRef } from '../hooks/useLatestRef';
import { buildDateGroups, countExtensions, countMismatchFiles, countSidecarXml, filterCardFiles, sumBytes } from '../lib/cardAnalysis';
import { createDemoCardFiles } from '../lib/demo';
import { DRAG_TYPES } from '../lib/dragData';
import type { FileMenuActions } from '../lib/fileMenu';
import { baseNameOf, folderCopyTarget, isDemoPath, isDriveRoot, parentDirOf, trimTrailingSeparators } from '../lib/paths';
import type { ProgressStore } from '../lib/progressStore';
import { buildDriveUploadItems, buildReportUploadItems } from '../lib/uploadPlan';
import {
  CANCELLED,
  formatBytes,
  formatDateTime,
  parseGoogleDriveFolderId,
  statsOf,
  toShowFolderName,
  type BackupReport,
  type BuildReportRequest,
  type CardIngestRecord,
  type ConflictPolicy,
  type CopyVerifyRequest,
  type CopyVerifySummary,
  type DateFilterMode,
  type DriveInfo,
  type FileEntry,
  type MediaReportResult,
  type PackMode,
  type ShotDatesEvent,
} from '../types/framebackup';
import type { CardTab, SharedWorkspace, WorkspaceStatus } from './shared';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface CardWorkspaceProps {
  tab: CardTab;
  active: boolean;
  /** Số khu vực thẻ đang mở (hiện ô "Thư mục máy" khi có từ 2 thẻ). */
  tabCount: number;
  shared: SharedWorkspace;
  progress: ProgressStore;
  /** Thẻ gợi ý cho khu vực mới (ổ rời chưa có khu vực nào dùng). */
  initialSource?: string;
  onCamFolderChange: (value: string) => void;
  onStatus: (tabId: string, status: WorkspaceStatus) => void;
}

type ColumnId = 'card' | 'd1' | 'd2';
const COL_NAME: Record<ColumnId, string> = { card: 'Thẻ nhớ', d1: 'Ổ 1', d2: 'Ổ 2' };

interface RunOpts {
  skipStep2?: boolean;
  card?: CardIngestRecord;
  notes?: string[];
  allowPowerAction?: boolean;
  packMode?: PackMode;
  skippedOldFiles?: number;
  keptMismatchFiles?: number;
}

/** 1 khu vực làm việc cho 1 thẻ nhớ: 4 cột Thẻ ➔ Ổ 1 ➔ Ổ 2 ➔ Drive + thanh tiến trình riêng. */
export function CardWorkspace({ tab, active, tabCount, shared, progress, initialSource, onCamFolderChange, onStatus }: CardWorkspaceProps) {
  const jobId = tab.id;
  const { showToast, layout } = shared;

  const [cardPath, setCardPath] = useState('');
  const [cardFiles, setCardFiles] = useState<FileEntry[]>([]);
  const [cardScanning, setCardScanning] = useState(false);
  const [cardMode, setCardMode] = useState<CardMode>('ingest');
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>('all');
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [quickExtFilter, setQuickExtFilter] = useState<string>('all');

  const [drive1Files, setDrive1Files] = useState<FileEntry[]>([]);
  const [drive2Files, setDrive2Files] = useState<FileEntry[]>([]);
  /** Đọc ngày chụp ngầm: đã đọc / tổng (null = xong hoặc không cần). */
  const [shotDateProgress, setShotDateProgress] = useState<{ done: number; total: number } | null>(null);
  /** "Clipboard" của app: Sao chép ở 1 cột rồi Dán ở cột khác (chép có verify). */
  const [clip, setClip] = useState<{ from: ColumnId; paths: string[] } | null>(null);
  const [namePrompt, setNamePrompt] = useState<NamePrompt | null>(null);
  const [propsPath, setPropsPath] = useState<string | null>(null);

  const [cardSelected, setCardSelected] = useState<Set<string>>(new Set());
  const [d1Selected, setD1Selected] = useState<Set<string>>(new Set());

  const [conflictPrompt, setConflictPrompt] = useState<ConflictPrompt | null>(null);
  const conflictResolverRef = useRef<((policy: ConflictPolicy | null) => void) | null>(null);

  const [isRunning, setIsRunning] = useState(false);
  const [waitingSlot, setWaitingSlot] = useState(false);
  const [watching, setWatching] = useState(false);
  const [mediaReport, setMediaReport] = useState<MediaReportResult | null>(null);
  const [backupReport, setBackupReport] = useState<BackupReport | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const cardScanSeqRef = useRef(0);
  const watchCardRef = useRef<CardIngestRecord | undefined>(undefined);

  const showName = toShowFolderName(shared.projectName);

  // ---- Đọc thư mục ----
  const refreshDirectory = useCallback(
    async (pathStr: string, setter: (items: FileEntry[]) => void) => {
      if (!pathStr || !window.frameBackup) {
        setter([]);
        return;
      }
      try {
        setter(await window.frameBackup.listDirectory(pathStr));
      } catch (err) {
        setter([]);
        showToast(`Lỗi đọc thư mục: ${errorText(err)}`);
      }
    },
    [showToast]
  );

  // Ổ 1 / Ổ 2: duyệt kiểu Explorer (Lùi / Tiến / Lên). Thư mục đang mở = nơi chép vào. Nhớ thư mục cuối cho lần mở app sau.
  const drive1Nav = useFolderNav(shared.drive1Root, (dir) => {
    void refreshDirectory(dir, setDrive1Files);
    shared.setDrive1Root(dir);
  });
  const drive2Nav = useFolderNav(shared.drive2Root, (dir) => {
    void refreshDirectory(dir, setDrive2Files);
    shared.setDrive2Root(dir);
  });
  const drive1View = drive1Nav.path;
  const drive2View = drive2Nav.path;
  useEffect(() => {
    void refreshDirectory(drive1View, setDrive1Files);
    void refreshDirectory(drive2View, setDrive2Files);
    // Chỉ lần đầu: sau đó mỗi lần đổi thư mục đã tự đọc lại
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Giá trị mới nhất cho các callback đăng ký 1 lần (Watch, tiến trình)
  const latest = useLatestRef({ shared, drive2View, showName, tab, isRunning });

  // ---- Báo trạng thái lên thanh tab ----
  const driveOf = (p: string): DriveInfo | undefined => {
    if (!p) return undefined;
    const n = p.toLowerCase();
    return shared.drives.find((d) => n.startsWith(d.mountPath.toLowerCase()));
  };
  const cardDriveInfo = driveOf(cardPath);
  const cardLabel = isDemoPath(cardPath) ? 'Thẻ demo' : cardDriveInfo?.label ?? (cardPath ? cardPath.split(/[\\/]/).filter(Boolean).pop() ?? cardPath : '');
  useEffect(() => {
    onStatus(tab.id, {
      label: cardLabel,
      cardPath,
      running: isRunning,
      waiting: waitingSlot,
      watching,
      verdict: backupReport?.verdict,
    });
  }, [tab.id, cardLabel, cardPath, isRunning, waitingSlot, watching, backupReport, onStatus]);

  // ---- Cột 1: dữ liệu suy ra ----
  const dateGroups = useMemo(
    () => buildDateGroups(cardFiles, shared.targetDate, shared.overnightMode),
    [cardFiles, shared.targetDate, shared.overnightMode]
  );
  const hasMismatch = useMemo(() => dateGroups.some((g) => !g.isTarget), [dateGroups]);
  const showBigAlert = hasMismatch && !alertDismissed && dateFilterMode === 'all';
  const cardExtensionCounts = useMemo(() => countExtensions(cardFiles), [cardFiles]);
  const displayedCardFiles = useMemo(
    () =>
      filterCardFiles(cardFiles, {
        dateFilterMode,
        targetDate: shared.targetDate,
        overnightMode: shared.overnightMode,
        quickExtFilter,
        visibleExtensions: shared.visibleExtensions,
      }),
    [cardFiles, dateFilterMode, shared.targetDate, shared.overnightMode, quickExtFilter, shared.visibleExtensions]
  );
  const displayedFileList = useMemo(() => displayedCardFiles.filter((f) => !f.isDirectory), [displayedCardFiles]);
  const totalCardBytes = useMemo(() => sumBytes(displayedFileList), [displayedFileList]);
  const selectedCardBytes = useMemo(() => {
    if (cardSelected.size === 0) return 0;
    let s = 0;
    for (const f of cardFiles) if (cardSelected.has(f.fullPath)) s += f.sizeBytes;
    return s;
  }, [cardFiles, cardSelected]);

  const d1DriveInfo = driveOf(drive1View);
  const d2DriveInfo = driveOf(drive2View);
  const d1Insufficient = Boolean(d1DriveInfo && totalCardBytes > 0 && d1DriveInfo.freeBytes < totalCardBytes);
  const d2Insufficient = Boolean(d2DriveInfo && totalCardBytes > 0 && d2DriveInfo.freeBytes < totalCardBytes);

  const drive1ViewRef = useLatestRef(drive1View);
  const drive2ViewRef = useLatestRef(drive2View);
  const refreshDrive1View = () => refreshDirectory(drive1ViewRef.current, setDrive1Files);
  const refreshDrive2View = () => refreshDirectory(drive2ViewRef.current, setDrive2Files);

  const cardNav = useFolderNav('', (dir) => {
    setCardPath(dir);
    void refreshCardSmart(dir);
  });

  const refreshCardSmart = async (pathStr: string, forceRecursive = false) => {
    const seq = ++cardScanSeqRef.current;
    if (!pathStr || !window.frameBackup) {
      setCardFiles([]);
      setCardScanning(false);
      return;
    }
    const matchedDrive = shared.drives.find((d) => d.mountPath.toLowerCase() === pathStr.toLowerCase());
    const isFixedRoot = Boolean(matchedDrive && !matchedDrive.isRemovable);
    setCardScanning(true);
    const api = window.frameBackup;
    void api.cancelShotDates?.(jobId);
    setShotDateProgress(null);
    try {
      // Hiện danh sách NGAY (ngày chụp lấy từ bộ nhớ nếu đã đọc trước đó), đọc ngày chụp còn thiếu ngầm phía sau
      const items =
        isFixedRoot && !forceRecursive
          ? await api.listDirectory(pathStr)
          : api.scanRecursiveQuick
          ? await api.scanRecursiveQuick(pathStr)
          : await api.scanRecursive(pathStr);
      if (seq !== cardScanSeqRef.current) return;
      setCardFiles(items);
      const pending = items.filter((f) => !f.isDirectory && f.dateSource === 'pending');
      if (pending.length > 0 && api.readShotDates) {
        setShotDateProgress({ done: 0, total: pending.length });
        void api.readShotDates(
          jobId,
          pending.map((f) => ({ fullPath: f.fullPath, sizeBytes: f.sizeBytes, mtimeMs: f.mtimeMs }))
        );
      }
    } catch (err) {
      if (seq === cardScanSeqRef.current) showToast(`Lỗi đọc thư mục nguồn: ${errorText(err)}`);
    } finally {
      if (seq === cardScanSeqRef.current) setCardScanning(false);
    }
  };

  const selectCardSource = (val: string) => {
    cardNav.reset(val);
    setAlertDismissed(false);
    setDateFilterMode('all');
    setQuickExtFilter('all');
    setBackupReport(null);
  };

  // Ngày chụp đọc ngầm về từng đợt => cập nhật danh sách thẻ
  useEffect(() => {
    const api = window.frameBackup;
    if (!api?.onShotDates) return;
    const unsub = api.onShotDates((ev: ShotDatesEvent) => {
      if (ev.key !== jobId) return;
      if (ev.items.length > 0) {
        const map = new Map(ev.items.map((it) => [it.fullPath, it]));
        setCardFiles((prev) =>
          prev.map((f) => {
            const it = map.get(f.fullPath);
            return it ? { ...f, shotTimeMs: it.shotTimeMs, dateSource: it.dateSource } : f;
          })
        );
      }
      setShotDateProgress(ev.finished ? null : { done: ev.done, total: ev.total });
    });
    return () => {
      unsub();
      void api.cancelShotDates?.(jobId);
    };
  }, [jobId]);

  // Khu vực mới: tự chọn thẻ gợi ý
  useEffect(() => {
    if (initialSource && !cardPath) selectCardSource(initialSource);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Sự kiện tiến trình của RIÊNG khu vực này (jobId) ----
  useEffect(() => {
    const api = window.frameBackup;
    if (!api) return;
    const mine = (id?: string) => (id ?? 'main') === jobId;
    const unsubCopy = api.onCopyProgress((ev) => {
      if (!mine(ev.jobId)) return;
      progress.set(ev.stage === 'card-to-drive1' ? { step1: ev } : { step2: ev });
    });
    const unsubPack = api.onPackageProgress((ev) => {
      if (mine(ev.jobId)) progress.set({ step3: ev });
    });
    const unsubDrive = api.onDriveUploadProgress((ev) => {
      if (mine(ev.jobId)) progress.set({ step4: ev });
    });
    const unsubWatch = api.onWatchStatus((st) => {
      if (!mine(st.jobId)) return;
      progress.set({ watch: st });
      setWatching(['watching', 'receiving', 'stabilizing'].includes(st.state));
      if (st.state === 'ready') {
        if (latest.current.isRunning) {
          latest.current.shared.showToast('⚠️ Watch báo đủ file nhưng thẻ này đang chạy việc khác — bấm "Chạy ngay" khi xong.');
          return;
        }
        const notes = [
          st.incomplete
            ? `Chế độ Watch: mới thấy ${st.matchedFiles ?? 0}/${st.expectedFiles ?? 0} file của thẻ trong thư mục Ổ 1 đang canh khi bấm "Chạy ngay". Máy không tự Sleep / Shutdown.`
            : 'Ổ 1 được chép ngoài app (chế độ Watch): app so tên + dung lượng với thẻ, chưa so XXHash64 với thẻ.',
        ];
        void runAfterDrive1(st.watchDir, { card: watchCardRef.current, notes, allowPowerAction: !st.incomplete });
      }
    });
    return () => {
      unsubCopy();
      unsubPack();
      unsubDrive();
      unsubWatch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, progress]);

  // ---- Kiểm tra trước khi chép ----
  const confirmCopyPlan = async (req: CopyVerifyRequest, routeLabel: string): Promise<CopyVerifyRequest | null> => {
    if (!window.frameBackup) return null;
    const pre = await window.frameBackup.preflightCopy(req);
    if (!pre.ok) {
      showToast(`❌ ${routeLabel}: ${pre.error ?? 'Không kiểm tra được nguồn/đích'}`);
      return null;
    }
    if (pre.totalFiles === 0) {
      showToast(`Không có file nào để chép (${routeLabel}).`);
      return null;
    }
    if (pre.freeBytes >= 0 && pre.requiredBytes > pre.freeBytes) {
      showToast(`❌ ${routeLabel}: ổ đích không đủ chỗ — cần thêm ${formatBytes(pre.requiredBytes)}, chỉ còn ${formatBytes(pre.freeBytes)}.`);
      return null;
    }
    const differing = pre.conflicts.filter((c) => !c.sameSize);
    if (differing.length === 0) return { ...req, conflictPolicy: 'keep-both' };
    const policy = await new Promise<ConflictPolicy | null>((resolve) => {
      conflictResolverRef.current = resolve;
      setConflictPrompt({ routeLabel, preflight: pre });
    });
    if (!policy) {
      showToast('Đã hủy lượt chép.');
      return null;
    }
    return { ...req, conflictPolicy: policy };
  };

  const resolveConflictPrompt = (policy: ConflictPolicy | null) => {
    setConflictPrompt(null);
    conflictResolverRef.current?.(policy);
    conflictResolverRef.current = null;
  };

  const handleCopyAftermath = async (res: CopyVerifySummary) => {
    if (!window.frameBackup) return;
    const notes: string[] = [];
    if (res.renamedFiles) notes.push(`${res.renamedFiles} file trùng tên đã lưu thành "tên (2)"`);
    if (res.skippedConflicts) notes.push(`bỏ qua ${res.skippedConflicts} file trùng tên`);
    if (res.ledgerHits) notes.push(`${res.ledgerHits} file đã verify trước đó nên không phải đọc lại`);
    if (notes.length > 0) showToast(`ℹ️ ${notes.join(', ')}.`);
    const parts = res.orphanPartFiles ?? [];
    if (parts.length > 0) {
      const ok = window.confirm(
        `Tìm thấy ${parts.length} file tạm .fbpart sót lại ở đích (do lần chép trước bị ngắt).\n` +
          'Đây là file chép dở, không dùng được. Xoá chúng để giải phóng dung lượng?'
      );
      if (ok) showToast((await window.frameBackup.deletePartFiles(parts)).message);
    }
  };

  /** Yêu cầu chép Thẻ ➔ Ổ 1: chép đúng những file đang hiện (chip lọc đuôi), hoặc những file đang chọn. */
  const buildCardCopyRequest = (destDir: string, selectedPaths: string[]): CopyVerifyRequest => ({
    jobId,
    stage: 'card-to-drive1',
    sourceDir: cardPath,
    destDir,
    targetDate: shared.targetDate,
    overnightMode: shared.overnightMode,
    dateFilterMode,
    engine: shared.copyEngine,
    selectedFilePaths: selectedPaths.length > 0 ? selectedPaths : undefined,
    allowedExtensions:
      quickExtFilter === 'all' ? undefined : quickExtFilter === 'preset' ? shared.visibleExtensions : [quickExtFilter],
    includeSidecarXml: shared.includeSidecarXml,
  });

  /** Đích là gốc ổ (J:\\) => hỏi trước, gợi ý tạo thư mục mới. true = chép tiếp. */
  const confirmDest = (dir: string, col: ColumnId): boolean => {
    if (!isDriveRoot(dir)) return true;
    const ok = window.confirm(
      `Thư mục đang mở ở ${COL_NAME[col]} là GỐC ổ (${dir}).\nChép thẳng vào gốc ổ?\n\nBấm Cancel để tạo Thư mục mới trước (chuột phải > Thư mục mới).`
    );
    if (!ok) openNewFolder(col);
    return ok;
  };

  const markCardVerified = (res: CopyVerifySummary) => {
    if (!res.success || isDemoPath(cardPath)) return;
    shared.verifiedCardRoots.add((cardDriveInfo?.mountPath ?? cardPath).toLowerCase());
  };

  const cardRecordFrom = (res: CopyVerifySummary): CardIngestRecord => ({
    files: res.totalFiles,
    bytes: res.totalBytes,
    byType: res.byType ?? statsOf([]).byType,
    at: Date.now(),
    sourceDir: cardPath,
    hashVerified: true,
  });

  const isBusy = () => {
    if (isRunning || waitingSlot) {
      showToast('Thẻ này đang có tiến trình chạy, vui lòng chờ xong hoặc bấm Dừng.');
      return true;
    }
    return false;
  };

  const keepAwake = async () => {
    await window.frameBackup?.setPreventSleep(true);
  };

  /** Chờ tới lượt (nếu bật "chạy lần lượt"), rồi đánh dấu đang chạy. Trả về hàm kết thúc. */
  const beginRun = async (): Promise<() => void> => {
    setWaitingSlot(true);
    const release = await shared.acquireRunSlot();
    setWaitingSlot(false);
    setIsRunning(true);
    return () => {
      setIsRunning(false);
      release();
    };
  };

  // ---- Bước 2 ➔ 4 sau khi Ổ 1 đã có dữ liệu ----
  const runAfterDrive1 = async (sourceOnDrive1: string, opts: RunOpts = {}) => {
    const api = window.frameBackup;
    if (!api) return;
    const { shared: sh, drive2View: d2View, showName: show, tab: t } = latest.current;
    // Ổ 2: chép cả thư mục nguồn vào thư mục đang mở ở Ổ 2 (giống dán thư mục trong Explorer)
    const d2Dir = d2View ? folderCopyTarget(sourceOnDrive1, d2View) : '';
    const stagingName = t.camFolder.trim() ? `${show}_${t.camFolder.trim()}` : show;
    const end = await beginRun();
    try {
      const notes = [...(opts.notes ?? [])];
      let drive2VerifiedNow = false;

      // Bước 2: Ổ 1 ➔ Ổ 2 (file đã verify trước đó không phải đọc lại — sổ verify)
      if (d2Dir && !opts.skipStep2) {
        const req2 = await confirmCopyPlan(
          { jobId, stage: 'drive1-to-drive2', sourceDir: sourceOnDrive1, destDir: d2Dir, engine: sh.copyEngine },
          'Ổ 1 ➔ Ổ 2'
        );
        if (!req2) return;
        const res2 = await api.startCopyVerify(req2);
        if (!res2.success) {
          if (res2.error !== CANCELLED) showToast(`❌ Lỗi Sao lưu Ổ 2: ${res2.error}`);
          return;
        }
        drive2VerifiedNow = true;
        await handleCopyAftermath(res2);
        await refreshDrive2View();
      }

      // Bước 3: Thumbnail + thống kê Ổ 1 + đóng gói
      progress.set({ step3: { jobId, status: 'scanning', percent: 5, message: 'Đang trích xuất Thumbnail Shot đầu & cuối...' } });
      const media = await api.inspectAndBuildReport({ jobId, projectName: stagingName, sourceDir: sourceOnDrive1 });
      setMediaReport(media);
      const packRes = await api.packageForDrive({
        jobId,
        projectName: stagingName,
        sourceDir: sourceOnDrive1,
        packMode: opts.packMode ?? sh.packMode,
      });
      if (!packRes.success) {
        if (packRes.error !== CANCELLED) showToast(`❌ Lỗi đóng gói: ${packRes.error}`);
        return;
      }
      if (packRes.archivePaths.length > 0 && packRes.looseFilePaths.length > 0) {
        notes.push('Trên Drive: ảnh được gom vào 1 file Zip (không nén), video để lẻ giữ nguyên thư mục.');
      } else if (packRes.archivePaths.length > 0) {
        notes.push('Trên Drive: toàn bộ file nằm trong file nén (đã kiểm tra file nén bằng 7-Zip).');
      }

      // Bước 4: Upload Drive (thumbnail + file nén + file lẻ), báo cáo up SAU cùng
      const folderId = parseGoogleDriveFolderId(sh.driveLink);
      const canUpload = Boolean(folderId && sh.driveAuth.signedIn);
      let driveInfo: BuildReportRequest['drive'] = { status: 'skipped' };
      let targetFolderId: string | null = null;
      let webLink: string | undefined;
      if (canUpload && folderId) {
        const upRes = await api.uploadToGoogleDrive({
          jobId,
          parentFolderId: folderId,
          createProjectSubfolder: t.camFolder.trim() || undefined,
          items: buildDriveUploadItems([media.firstShot, media.lastShot], packRes, sourceOnDrive1),
          cleanupArchivePaths: packRes.archivePaths,
        });
        if (upRes.success) {
          targetFolderId = upRes.targetFolderId;
          webLink = upRes.webViewLink;
          driveInfo = {
            status: 'uploaded',
            files: packRes.sourceFiles,
            bytes: packRes.sourceBytes,
            folderName: [sh.driveFolderCheck?.folderName, t.camFolder.trim()].filter(Boolean).join(' / ') || undefined,
            link: upRes.webViewLink,
          };
          if (upRes.dedupedFiles) notes.push(`${upRes.dedupedFiles} file đã có sẵn trên Drive (cùng MD5) nên không up lại.`);
        } else {
          driveInfo = { status: upRes.error === CANCELLED ? 'cancelled' : 'failed', error: upRes.error };
          if (upRes.error !== CANCELLED) showToast(`❌ Lỗi Upload Google Drive: ${upRes.error}`);
        }
      }

      // Báo cáo cuối (đã biết số file trên Drive)
      const report = await api.buildBackupReport({
        jobId,
        projectName: t.camFolder.trim() ? `${sh.projectName} · ${t.camFolder.trim()}` : sh.projectName,
        shootDate: sh.targetDate,
        drive1Dir: sourceOnDrive1,
        drive2Dir: d2Dir || undefined,
        card: opts.card,
        drive2VerifiedNow,
        drive: driveInfo,
        firstShot: media.firstShot,
        lastShot: media.lastShot,
        notes: [
          ...(opts.skippedOldFiles ? [`Date Guard: đã bỏ ${opts.skippedOldFiles} file lệch ngày quay.`] : []),
          ...(opts.keptMismatchFiles ? [`Date Guard: đã xác nhận chép cả ${opts.keptMismatchFiles} file từ máy sai ngày/giờ.`] : []),
          ...notes,
        ],
        stagingDir: media.stagingDir,
      });
      setBackupReport(report);

      if (targetFolderId) {
        await api.uploadToGoogleDrive({ jobId, parentFolderId: targetFolderId, items: buildReportUploadItems(report) });
        void sh.checkDriveLink(sh.driveLink, true);
      }

      await sh.reloadSystem();
      await refreshDrive1View();
      const ok = report.verdict === 'ok';
      showToast(
        driveInfo.status === 'uploaded'
          ? `${ok ? '✅' : '⚠️'} ${report.headline} — đã up ${packRes.sourceFiles ?? 0} file + báo cáo PDF lên Drive.`
          : `${ok ? '✅' : '⚠️'} ${report.headline}${canUpload ? '' : ' (chưa up Drive: đăng nhập & dán link ở Cột 4)'}`
      );
      if (driveInfo.status === 'failed' || driveInfo.status === 'cancelled') return;
      sh.finishJob(
        jobId,
        {
          projectName: t.camFolder.trim() ? `${show} / ${t.camFolder.trim()}` : show,
          totalFiles: media.totalFiles,
          totalBytes: media.totalBytes,
          drive1Path: sourceOnDrive1,
          drive2BackedUp: drive2VerifiedNow || report.boxes[2]?.state === 'ok',
          driveUploaded: driveInfo.status === 'uploaded',
          driveWebLink: webLink,
          verdict: report.verdict,
        },
        (opts.allowPowerAction ?? true) && ok
      );
    } catch (err) {
      showToast(`❌ Lỗi xử lý Bước 2–4: ${errorText(err)}`);
    } finally {
      end();
    }
  };

  // ---- Nút chính: chạy cả chuỗi cho thẻ này ----
  const handleRunFullPipeline = async () => {
    const api = window.frameBackup;
    if (!api) {
      showToast('Hãy mở app bằng Electron (npm run dev) để chạy Copy & Verify thật.');
      return;
    }
    const d1Dir = drive1View;
    if (!d1Dir) {
      showToast('Vui lòng mở thư mục đích ở Ổ 1 (Cột 2) trước khi chạy.');
      return;
    }
    if (isBusy()) return;

    if (cardMode === 'watch') {
      await keepAwake();
      const realCard = cardPath && !isDemoPath(cardPath);
      const expectedSource = realCard
        ? cardSelected.size > 0
          ? cardFiles.filter((f) => cardSelected.has(f.fullPath))
          : displayedFileList.filter((f) => f.sizeBytes > 0)
        : [];
      watchCardRef.current =
        expectedSource.length > 0
          ? { ...statsOf(expectedSource), at: Date.now(), sourceDir: cardPath, hashVerified: false }
          : undefined;
      progress.set({ step1: null, step2: null, step3: null, step4: null });
      setBackupReport(null);
      await api.startWatch(
        d1Dir,
        20,
        expectedSource.map((f) => ({ name: f.name, sizeBytes: f.sizeBytes })),
        jobId
      );
      showToast(
        expectedSource.length > 0
          ? `👁 Đang canh "${d1Dir}" — chờ đủ ${expectedSource.length} file từ thẻ (tính cả file đã có sẵn).`
          : `👁 Đang canh "${d1Dir}" — Hãy chép file từ thẻ vào thư mục này!`
      );
      return;
    }

    if (!cardPath || isDemoPath(cardPath)) {
      showToast('Vui lòng chọn thư mục Thẻ nhớ / Nguồn thật ở Cột 1.');
      return;
    }
    if (d1Insufficient) {
      showToast('❌ Ổ 1 không đủ dung lượng trống để chứa thẻ nhớ này! Hãy dọn ổ hoặc chọn ổ khác.');
      return;
    }
    if (drive2View && d2Insufficient) {
      showToast('❌ Ổ 2 (Sao lưu) không đủ dung lượng trống! Hãy chọn ổ sao lưu khác.');
      return;
    }

    if (!confirmDest(d1Dir, 'd1')) return;
    const selectedPaths = Array.from(cardSelected);
    const req1 = await confirmCopyPlan(buildCardCopyRequest(d1Dir, selectedPaths), 'Thẻ nhớ ➔ Ổ 1');
    if (!req1) return;

    progress.set({ step1: null, step2: null, step3: null, step4: null, watch: null });
    setMediaReport(null);
    setBackupReport(null);
    const end = await beginRun();
    let res1: CopyVerifySummary;
    try {
      await keepAwake();
      res1 = await api.startCopyVerify(req1);
      if (!res1.success) {
        if (res1.error !== CANCELLED) showToast(`❌ Lỗi Ingest Ổ 1: ${res1.error}`);
        return;
      }
      if (selectedPaths.length === 0) markCardVerified(res1);
      await handleCopyAftermath(res1);
      await refreshDrive1View();
      showToast(`✅ Xong Ổ 1 (${res1.verifiedFiles} file, bỏ ${res1.skippedFiles} file theo bộ lọc) — đang chạy tiếp...`);
    } catch (err) {
      showToast(`❌ Lỗi chuỗi sao lưu: ${errorText(err)}`);
      return;
    } finally {
      end();
    }
    await runAfterDrive1(d1Dir, {
      card: cardRecordFrom(res1),
      skippedOldFiles: dateFilterMode === 'target-only' ? res1.skippedFiles : 0,
      keptMismatchFiles: dateFilterMode === 'all' ? countMismatchFiles(dateGroups) : 0,
      notes: selectedPaths.length > 0 ? [`Chỉ chép ${selectedPaths.length} mục đang chọn trên thẻ.`] : [],
    });
  };

  /** Up Drive / sao lưu: thư mục đang mở ở Ổ 1. */
  const resolveDrive1Source = (): string => trimTrailingSeparators(drive1View) || drive1View;

  // ---- ☁ Chỉ Up Drive: không chép thẻ, không đụng Ổ 2 ----
  const handleUploadOnly = async () => {
    const api = window.frameBackup;
    if (!api) return;
    if (!drive1View) {
      showToast('Hãy mở thư mục cần up ở Ổ 1 (Cột 2).');
      return;
    }
    if (!shared.driveAuth.signedIn || !parseGoogleDriveFolderId(shared.driveLink)) {
      showToast('Hãy đăng nhập Google Drive và dán link thư mục Drive ở Cột 4 trước.');
      return;
    }
    if (isBusy()) return;
    const source = resolveDrive1Source();
    const ledger = await api.getShowLedger(source);
    const skipNote = (at: number) => `✓ Đã verify lúc ${formatDateTime(at)} — bỏ qua`;
    progress.set({
      step1: ledger.card
        ? { jobId, stage: 'card-to-drive1', status: 'completed', currentFile: skipNote(ledger.card.at), filesCompleted: ledger.card.files, totalFiles: ledger.card.files, skippedFiles: 0, resumedFiles: 0, verifiedFiles: ledger.card.files, bytesCopied: ledger.card.bytes, totalBytes: ledger.card.bytes, percent: 100, speedMBs: 0 }
        : null,
      step2: ledger.drive2
        ? { jobId, stage: 'drive1-to-drive2', status: 'completed', currentFile: skipNote(ledger.drive2.at), filesCompleted: ledger.drive2.files, totalFiles: ledger.drive2.files, skippedFiles: 0, resumedFiles: 0, verifiedFiles: ledger.drive2.files, bytesCopied: 0, totalBytes: 0, percent: 100, speedMBs: 0 }
        : null,
      step3: null,
      step4: null,
      watch: null,
    });
    setMediaReport(null);
    setBackupReport(null);
    await keepAwake();
    const packMode: PackMode = shared.uploadPack === 'none' ? 'none' : shared.packMode === 'none' ? 'video-raw-smart' : shared.packMode;
    await runAfterDrive1(source, {
      skipStep2: true,
      packMode,
      notes: [`Chạy "Chỉ Up Drive" từ ${source} (${packMode === 'none' ? 'không nén' : 'có nén'}), không chép lại Ổ 2.`],
    });
  };

  // ---- Chép lẻ: Thẻ ➔ Ổ 1, Ổ 1 ➔ Ổ 2 (nút ➔, kéo thả, chuột phải) ----
  const handleCopyCardToDrive1Only = async (overrideSelectedPaths?: string[]) => {
    const api = window.frameBackup;
    if (!api || isBusy()) return;
    if (!cardPath || isDemoPath(cardPath)) {
      showToast('Hãy chọn thư mục Thẻ nhớ / Nguồn thật ở Cột 1.');
      return;
    }
    const d1Dir = drive1View;
    if (!d1Dir) {
      showToast('Hãy mở thư mục đích ở Ổ 1 (Cột 2) trước khi copy.');
      return;
    }
    if (!confirmDest(d1Dir, 'd1')) return;
    const pathsToUse = overrideSelectedPaths ?? Array.from(cardSelected);
    const req1 = await confirmCopyPlan(buildCardCopyRequest(d1Dir, pathsToUse), 'Thẻ nhớ ➔ Ổ 1');
    if (!req1) return;
    progress.set({ step1: null });
    const end = await beginRun();
    try {
      await keepAwake();
      const res1 = await api.startCopyVerify(req1);
      if (res1.success) {
        if (pathsToUse.length === 0) markCardVerified(res1);
        await handleCopyAftermath(res1);
        await refreshDrive1View();
        await shared.reloadSystem();
        showToast(`✅ Đã copy & Verify ${res1.verifiedFiles} file sang Ổ 1 (${d1Dir})!`);
      } else if (res1.error !== CANCELLED) {
        showToast(`❌ Lỗi copy sang Ổ 1: ${res1.error}`);
      }
    } finally {
      end();
    }
  };

  /**
   * Chép giữa 2 ổ (verify XXHash64, có sổ verify). Có `paths`: chép các mục đó (từ thư mục chứa chúng) vào `destDir`.
   * Không có: chép cả thư mục `sourceDir` vào `destDir` (thành destDir\\<tên thư mục>).
   */
  const copyDriveToDrive = async (sourceDir: string, destView: string, paths: string[], to: 'd1' | 'd2') => {
    const api = window.frameBackup;
    if (!api || isBusy()) return;
    const from = to === 'd2' ? 'Ổ 1' : 'Ổ 2';
    if (!sourceDir || !destView) {
      showToast(`Hãy mở thư mục ở cả ${from} và ${COL_NAME[to]}.`);
      return;
    }
    if (!confirmDest(destView, to)) return;
    const src = trimTrailingSeparators(sourceDir) || sourceDir;
    const destDir = paths.length > 0 ? destView : folderCopyTarget(src, destView);
    if (paths.length === 0 && src.toLowerCase() === (trimTrailingSeparators(destDir) || destDir).toLowerCase()) {
      showToast('Nguồn và đích là cùng 1 thư mục.');
      return;
    }
    const route = `${from} ➔ ${COL_NAME[to]}`;
    const req2 = await confirmCopyPlan(
      {
        jobId,
        stage: 'drive1-to-drive2',
        sourceDir: src,
        destDir,
        engine: shared.copyEngine,
        selectedFilePaths: paths.length > 0 ? paths : undefined,
      },
      route
    );
    if (!req2) return;
    progress.set({ step2: null });
    const end = await beginRun();
    try {
      await keepAwake();
      const res2 = await api.startCopyVerify(req2);
      if (res2.success) {
        await handleCopyAftermath(res2);
        await (to === 'd2' ? refreshDrive2View() : refreshDrive1View());
        await shared.reloadSystem();
        showToast(`✅ Đã chép & Verify ${res2.verifiedFiles} file (${route}) vào ${destDir}`);
      } else if (res2.error !== CANCELLED) {
        showToast(`❌ Lỗi chép ${route}: ${res2.error}`);
      }
    } finally {
      end();
    }
  };

  const handleCopyDrive1ToDrive2Only = async (overrideSelectedPaths?: string[]) => {
    const pathsToUse = overrideSelectedPaths ?? Array.from(d1Selected);
    const src = pathsToUse.length > 0 ? parentDirOf(pathsToUse[0]) : resolveDrive1Source();
    await copyDriveToDrive(src, drive2View, pathsToUse, 'd2');
  };

  // ---- Sao chép / Dán giữa các cột (Ctrl+C / Ctrl+V / chuột phải) ----
  const copyToClip = (from: ColumnId, paths: string[]) => {
    if (paths.length === 0) return;
    setClip({ from, paths });
    showToast(`📋 Đã sao chép ${paths.length} mục ở ${COL_NAME[from]} — mở cột đích, chuột phải > Dán (Ctrl+V).`);
  };
  const pasteLabel = (to: ColumnId): { label: string; disabled: boolean } => {
    if (!clip) return { label: 'Dán', disabled: true };
    const ok = (clip.from === 'card' && to === 'd1') || (clip.from === 'd1' && to === 'd2') || (clip.from === 'd2' && to === 'd1');
    return { label: `Dán ${clip.paths.length} mục từ ${COL_NAME[clip.from]} (Verify)`, disabled: !ok || busy };
  };
  const pasteInto = (to: ColumnId) => {
    if (!clip) {
      showToast('Chưa sao chép mục nào (chọn file rồi Ctrl+C hoặc chuột phải > Sao chép).');
      return;
    }
    const { from, paths } = clip;
    if (from === 'card' && to === 'd1') void handleCopyCardToDrive1Only(paths);
    else if (from === 'd1' && to === 'd2') void copyDriveToDrive(parentDirOf(paths[0]), drive2View, paths, 'd2');
    else if (from === 'd2' && to === 'd1') void copyDriveToDrive(parentDirOf(paths[0]), drive1View, paths, 'd1');
    else if (from === to) showToast('Không dán vào chính cột đã sao chép (app không chép trùng trong cùng thư mục).');
    else if (to === 'card') showToast('Không dán vào Thẻ nhớ — thẻ chỉ là nguồn, app không ghi lên thẻ.');
    else showToast('Thẻ nhớ chỉ chép sang Ổ 1 (Ổ 2 là bản sao lưu của Ổ 1).');
  };

  // ---- Thư mục mới / Đổi tên / Thuộc tính ----
  const colDir = (col: ColumnId) => (col === 'card' ? cardPath : col === 'd1' ? drive1View : drive2View);
  const refreshCol = (col: ColumnId) =>
    col === 'card' ? refreshCardSmart(cardPath) : col === 'd1' ? refreshDrive1View() : refreshDrive2View();
  function openNewFolder(col: ColumnId) {
    const parent = colDir(col);
    if (!parent || isDemoPath(parent) || !window.frameBackup?.createFolder) {
      showToast('Hãy mở 1 thư mục trước.');
      return;
    }
    setNamePrompt({
      title: `Thư mục mới trong ${COL_NAME[col]}`,
      label: parent,
      initial: col === 'card' ? 'Thư mục mới' : showName || 'Thư mục mới',
      confirmLabel: 'Tạo',
      onSubmit: async (name) => {
        const r = await window.frameBackup!.createFolder(parent, name);
        if (!r.ok) return r.message;
        showToast(`📁 ${r.message}`);
        await refreshCol(col);
        return null;
      },
    });
  }
  const openRename = (col: ColumnId, file: FileEntry) => {
    if (isDemoPath(file.fullPath) || !window.frameBackup?.renamePath) return;
    setNamePrompt({
      title: 'Đổi tên',
      label: file.fullPath,
      initial: file.name,
      confirmLabel: 'Đổi tên',
      onSubmit: async (name) => {
        const r = await window.frameBackup!.renamePath(file.fullPath, name);
        if (!r.ok) return r.message;
        showToast(r.message);
        await refreshCol(col);
        return null;
      },
    });
  };
  const openProperties = (fullPath: string) => {
    if (!fullPath || isDemoPath(fullPath)) return;
    setPropsPath(fullPath);
  };

  const commandFor =
    (col: ColumnId) =>
    (cmd: ListCommand, targets: string[], focused: FileEntry | null) => {
      if (cmd === 'copy') copyToClip(col, targets);
      else if (cmd === 'paste') pasteInto(col);
      else if (cmd === 'newFolder') openNewFolder(col);
      else if (cmd === 'rename' && focused && col !== 'card') openRename(col, focused);
      else if (cmd === 'properties') openProperties(focused?.fullPath ?? colDir(col));
    };

  const handleCancel = async () => {
    const api = window.frameBackup;
    if (!api) return;
    await api.cancelCopy(jobId);
    await api.cancelPackaging(jobId);
    await api.cancelDriveUpload(jobId);
    await api.stopWatch(jobId);
    progress.set({ watch: null });
    setWatching(false);
    showToast('Đã dừng chuỗi sao lưu của thẻ này.');
  };

  const handleSafeEject = async () => {
    const api = window.frameBackup;
    if (!api || !cardPath) return;
    if (isRunning || watching) {
      showToast('⛔ Đang chép / Watch — không Eject thẻ lúc này. Bấm Dừng hoặc chờ xong.');
      return;
    }
    const cardRoot = (cardDriveInfo?.mountPath ?? cardPath).toLowerCase();
    if (!shared.verifiedCardRoots.has(cardRoot)) {
      const ok = window.confirm(
        'Thẻ này CHƯA được chép & verify xong trong phiên làm việc này.\nVẫn Eject thẻ? (Chỉ format thẻ sau khi đã chắc chắn có bản sao.)'
      );
      if (!ok) return;
    }
    const res = await api.safeEject(cardPath);
    showToast(res.message);
    if (res.ok) {
      setCardPath('');
      setCardFiles([]);
      await shared.reloadSystem();
    }
  };

  const handleLoadDemoMismatch = () => {
    setCardPath('DEMO_SD_CARD (Dữ liệu mô phỏng)');
    setCardFiles(createDemoCardFiles(shared.targetDate));
    setDateFilterMode('all');
    setAlertDismissed(false);
  };

  const handlePickFolder = async (col: 1 | 2 | 3) => {
    const api = window.frameBackup;
    if (!api) {
      showToast('Chức năng chọn thư mục hệ thống hoạt động khi chạy bằng Electron (npm run dev).');
      return;
    }
    const titles = {
      1: 'Chọn Thẻ nhớ / Thư mục Nguồn (Cột 1)',
      2: 'Chọn thư mục đích Ổ 1 — Làm việc (app chép thẳng vào thư mục này)',
      3: 'Chọn thư mục đích Ổ 2 — Sao lưu (app chép thẳng vào thư mục này)',
    };
    const picked = await api.pickDirectory(titles[col]);
    if (!picked) return;
    if (col === 1) selectCardSource(picked);
    else if (col === 2) drive1Nav.go(picked);
    else drive2Nav.go(picked);
  };

  // Kéo & thả: Thẻ -> Ổ 1, Ổ 1 -> Ổ 2
  const drive1Drop = useDropZone(DRAG_TYPES.cardFiles, (paths) => void handleCopyCardToDrive1Only(paths));
  const drive2Drop = useDropZone(DRAG_TYPES.drive1Files, (paths) => void handleCopyDrive1ToDrive2Only(paths));

  const navigateCard = cardNav.go;
  const navigateDrive1 = drive1Nav.go;
  const navigateDrive2 = drive2Nav.go;

  // ---- Menu chuột phải / mở file ----
  const copyPathsToClipboard = (paths: string[]) => {
    void navigator.clipboard
      .writeText(paths.join('\n'))
      .then(() => showToast(paths.length > 1 ? `Đã sao chép ${paths.length} đường dẫn.` : 'Đã sao chép đường dẫn.'))
      .catch(() => showToast('Không sao chép được vào clipboard.'));
  };
  const openEntry = (file: FileEntry, navigate: (dir: string) => void) => {
    if (file.isDirectory) {
      navigate(file.fullPath);
      return;
    }
    if (!window.frameBackup || isDemoPath(file.fullPath)) return;
    void window.frameBackup.openPath(file.fullPath).then((r) => {
      if (!r.ok) showToast(`Không mở được file: ${r.message}`);
    });
  };
  const revealEntry = (fullPath: string) => {
    if (!window.frameBackup || isDemoPath(fullPath)) return;
    void window.frameBackup.showInFolder(fullPath);
  };
  const busy = isRunning || waitingSlot;
  const cardMenuActions: Omit<FileMenuActions, 'selectAll' | 'clear'> = {
    open: (f) => openEntry(f, navigateCard),
    reveal: revealEntry,
    currentDir: isDemoPath(cardPath) ? undefined : cardPath || undefined,
    refresh: cardPath && !isDemoPath(cardPath) ? () => void refreshCardSmart(cardPath) : undefined,
    transfer: {
      label: (n) => `Copy ${n} mục sang Ổ 1 (Verify XXHash64)`,
      run: (paths) => void handleCopyCardToDrive1Only(paths),
      disabled: busy,
    },
    copyPaths: copyPathsToClipboard,
    copyItems: (paths) => copyToClip('card', paths),
    properties: isDemoPath(cardPath) ? undefined : openProperties,
  };
  const drive1MenuActions: Omit<FileMenuActions, 'selectAll' | 'clear'> = {
    open: (f) => openEntry(f, navigateDrive1),
    reveal: revealEntry,
    currentDir: drive1View || undefined,
    refresh: drive1View ? () => void refreshDrive1View() : undefined,
    transfer: {
      label: (n) => `Sao lưu ${n} mục sang Ổ 2 (Verify XXHash64)`,
      run: (paths) => void handleCopyDrive1ToDrive2Only(paths),
      disabled: busy || !drive2View,
    },
    copyPaths: copyPathsToClipboard,
    copyItems: (paths) => copyToClip('d1', paths),
    paste: { ...pasteLabel('d1'), run: () => pasteInto('d1') },
    newFolder: drive1View ? () => openNewFolder('d1') : undefined,
    rename: (f) => openRename('d1', f),
    properties: openProperties,
  };
  const drive2MenuActions: Omit<FileMenuActions, 'selectAll' | 'clear'> = {
    open: (f) => openEntry(f, navigateDrive2),
    reveal: revealEntry,
    currentDir: drive2View || undefined,
    refresh: drive2View ? () => void refreshDrive2View() : undefined,
    copyPaths: copyPathsToClipboard,
    copyItems: (paths) => copyToClip('d2', paths),
    paste: { ...pasteLabel('d2'), run: () => pasteInto('d2') },
    newFolder: drive2View ? () => openNewFolder('d2') : undefined,
    rename: (f) => openRename('d2', f),
    properties: openProperties,
  };

  const copyCount = cardSelected.size > 0 ? cardSelected.size : displayedFileList.length;
  const copyBytes = cardSelected.size > 0 ? selectedCardBytes : totalCardBytes;
  const multiCard = tabCount > 1;
  const copySet = useMemo(
    () => (cardSelected.size > 0 ? cardFiles.filter((f) => cardSelected.has(f.fullPath)) : displayedFileList),
    [cardSelected, cardFiles, displayedFileList]
  );
  const xmlExtra = useMemo(
    () => (shared.includeSidecarXml ? countSidecarXml(copySet, cardFiles) : 0),
    [shared.includeSidecarXml, copySet, cardFiles]
  );
  const d2Target = drive2View ? (d1Selected.size > 0 ? drive2View : folderCopyTarget(drive1View, drive2View)) : '';

  return (
    <div className={active ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
      {/* Thanh hành động của thẻ này */}
      <div className="bg-[#17171c] border-b border-[#2b2b34] px-4 py-2 flex items-center gap-2.5 flex-wrap shrink-0">
        {(multiCard || tab.camFolder) && (
          <div className="h-9 flex items-center gap-2 bg-[#101013] border border-[#32323d] px-3 rounded-lg">
            <span className="text-xs text-zinc-400 font-medium">Tên máy (Drive):</span>
            <input
              value={tab.camFolder}
              disabled={busy}
              onChange={(e) => onCamFolderChange(e.target.value.replace(/[<>:"/\\|?*]/g, ''))}
              placeholder="(up thẳng vào thư mục Drive)"
              className="bg-transparent text-[13px] text-zinc-100 outline-none w-36 font-semibold disabled:opacity-60"
              title="Tên thư mục con trên Google Drive cho thẻ này (vd. Cam A, Cam B) + tên trong báo cáo. Trên ổ cứng, app chép vào đúng thư mục đang mở ở Ổ 1 — không tự tạo thư mục."
            />
          </div>
        )}
        <div className="text-[11.5px] text-zinc-400 min-w-0 truncate max-w-[420px]" title={drive1View}>
          Chép vào ➔ <span className="text-zinc-200 font-medium">{drive1View || '(chưa mở thư mục Ổ 1)'}</span>
          {drive1View && isDriveRoot(drive1View) && <span className="text-amber-300"> ⚠ gốc ổ</span>}
        </div>
        <button
          onClick={handleLoadDemoMismatch}
          className="h-8 inline-flex items-center gap-1.5 px-2.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/35 text-red-200 text-[11.5px] font-semibold transition"
        >
          <AlertTriangle className="w-3.5 h-3.5" /> Test Lệch ngày
        </button>

        <span className="flex-1" />

        <div className="h-10 inline-flex items-stretch rounded-lg overflow-hidden border border-purple-400/60 shadow-lg shadow-purple-950/40">
          <button
            disabled={busy}
            onClick={() => void handleUploadOnly()}
            className="inline-flex items-center gap-2 px-4 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold text-sm"
            title="Bỏ qua Thẻ ➔ Ổ 1 và Ổ 1 ➔ Ổ 2: chỉ Thumbnail + (Nén) + Up Drive + Báo cáo, từ thư mục đang mở ở Ổ 1"
          >
            <CloudUpload className="w-4 h-4" /> CHỈ UP DRIVE
          </button>
          <div className="flex items-center bg-[#2a1f3d] text-[11.5px]">
            {(['pack', 'none'] as const).map((v) => (
              <button
                key={v}
                onClick={() => shared.setUploadPack(v)}
                className={`h-full px-2.5 font-semibold ${
                  shared.uploadPack === v ? 'bg-purple-500/45 text-white' : 'text-purple-200/70 hover:text-white'
                }`}
                title={
                  v === 'pack'
                    ? `Nén theo kiểu ở thanh trên (${shared.packMode === 'none' ? 'Video lẻ | Ảnh: Zip Store' : 'đang chọn'})`
                    : 'Không nén: up nguyên file gốc, giữ cấu trúc thư mục'
                }
              >
                {v === 'pack' ? 'Nén' : 'Không nén'}
              </button>
            ))}
          </div>
        </div>

        {watching ? (
          <button
            onClick={() => window.frameBackup?.triggerWatchNow(jobId)}
            className="h-10 inline-flex items-center gap-2 px-5 rounded-lg bg-amber-500 hover:bg-amber-400 text-amber-950 font-extrabold text-sm transition shadow-lg shadow-amber-950/40"
          >
            <Zap className="w-4 h-4 fill-current" />
            ĐÃ CHÉP XONG — CHẠY NGAY
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={() => void handleRunFullPipeline()}
            className="h-10 inline-flex items-center gap-2 px-5 rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 hover:brightness-110 disabled:opacity-50 border border-blue-400/70 text-white font-bold text-sm shadow-lg shadow-blue-950/60 transition"
          >
            {cardMode === 'watch' ? <Eye className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
            {waitingSlot
              ? 'ĐANG CHỜ LƯỢT...'
              : isRunning
              ? 'ĐANG SAO LƯU...'
              : cardMode === 'watch'
              ? 'BẮT ĐẦU CANH Ổ 1'
              : multiCard
              ? 'CHẠY THẺ NÀY'
              : 'CHẠY TOÀN BỘ CHUỖI'}
          </button>
        )}
      </div>

      <DateMismatchAlert
        visible={showBigAlert}
        sourceLabel={cardPath || 'THẺ NHỚ'}
        targetDate={shared.targetDate}
        groups={dateGroups}
        onSelectDateChip={(dateKey) => {
          shared.setTargetDate(dateKey);
          setDateFilterMode('target-only');
          showToast(`Đã chọn lọc riêng ngày ${dateKey}`);
        }}
        onFilterTargetOnly={() => setDateFilterMode('target-only')}
        onSplitByDate={() => {
          setDateFilterMode('split');
          setAlertDismissed(true);
        }}
        onIgnoreAndCopyAll={() => setAlertDismissed(true)}
        onDismiss={() => setAlertDismissed(true)}
      />

      <div ref={active ? layout.workspaceRef : undefined} className="flex-1 flex min-h-0 p-2.5 gap-0">
        <CardColumn
          style={layout.columnStyle(1)}
          expanded={layout.expandedCol === 1}
          onToggleExpand={() => layout.toggleExpandCol(1)}
          alertBorder={showBigAlert}
          cardPath={cardPath}
          drives={shared.drives}
          driveInfo={cardDriveInfo}
          cardMode={cardMode}
          onToggleCardMode={() => setCardMode(cardMode === 'ingest' ? 'watch' : 'ingest')}
          dateFilterMode={dateFilterMode}
          allFilesCount={cardFiles.filter((f) => !f.isDirectory).length}
          displayedFiles={displayedCardFiles}
          extensionCounts={cardExtensionCounts}
          quickExtFilter={quickExtFilter}
          onQuickExtFilter={setQuickExtFilter}
          scanning={cardScanning}
          shotDateProgress={shotDateProgress}
          nav={cardNav}
          includeSidecarXml={shared.includeSidecarXml}
          onIncludeSidecarXml={shared.setIncludeSidecarXml}
          onRefresh={() => cardPath && !isDemoPath(cardPath) && void refreshCardSmart(cardPath)}
          onCommand={commandFor('card')}
          onSelectedChange={setCardSelected}
          totalBytes={totalCardBytes}
          targetDate={shared.targetDate}
          overnightMode={shared.overnightMode}
          onEject={handleSafeEject}
          onSelectSource={selectCardSource}
          onPickFolder={() => handlePickFolder(1)}
          menuActions={cardMenuActions}
        />

        <CopyArrowSplitter
          tone="blue"
          title="Bấm nút ➔ để Copy từ Thẻ nhớ sang Ổ 1 • Kéo thanh này để chỉnh độ rộng cột"
          label="Chép sang Ổ 1"
          detail={`${copyCount} file${xmlExtra > 0 ? ` +${xmlExtra} XML` : ''}`}
          sub={formatBytes(copyBytes)}
          buttonTitle={`Chép ${copyCount} file${xmlExtra > 0 ? ` (+${xmlExtra} XML kèm theo)` : ''} · ${formatBytes(copyBytes)} ${cardSelected.size > 0 ? '(đang chọn)' : '(đang hiện)'} vào ${drive1View || 'thư mục đang mở ở Ổ 1'}`}
          disabled={busy || !cardPath || isDemoPath(cardPath) || !drive1View}
          onResizeStart={(e) => layout.startHorizontalResize(0, e)}
          onReset={layout.resetColumns}
          onCopy={() => void handleCopyCardToDrive1Only()}
        />

        <DriveColumn
          index={2}
          style={layout.columnStyle(2)}
          expanded={layout.expandedCol === 2}
          onToggleExpand={() => layout.toggleExpandCol(2)}
          nav={drive1Nav}
          drives={shared.drives}
          files={drive1Files}
          driveInfo={d1DriveInfo}
          insufficient={d1Insufficient}
          isDragOver={drive1Drop.isOver}
          dragCount={cardSelected.size}
          dropHandlers={drive1Drop.handlers}
          onRefresh={() => void refreshDrive1View()}
          onCommand={commandFor('d1')}
          onPickFolder={() => handlePickFolder(2)}
          menuActions={drive1MenuActions}
          onSelectedChange={setD1Selected}
          dragType={DRAG_TYPES.drive1Files}
          infoStrip={
            <InfoStrip>
              {drive1View && isDriveRoot(drive1View) ? (
                <button
                  className="truncate text-amber-300 hover:text-amber-200 text-left"
                  onClick={() => openNewFolder('d1')}
                  title="Đang mở gốc ổ: nên tạo thư mục cho buổi quay rồi mở nó"
                >
                  ⚠ Đang ở gốc ổ — bấm để tạo Thư mục mới
                </button>
              ) : (
                <span className="truncate" title={drive1View}>
                  Thẻ chép vào: {drive1View ? baseNameOf(trimTrailingSeparators(drive1View)) ?? drive1View : '—'}
                </span>
              )}
              <span className="text-emerald-400 shrink-0">XXHash64</span>
            </InfoStrip>
          }
          footerRight={<span className="text-blue-400">Primary</span>}
        />

        <CopyArrowSplitter
          tone="emerald"
          title="Bấm nút ➔ để Sao lưu từ Ổ 1 sang Ổ 2 • Kéo thanh này để chỉnh độ rộng cột"
          label="Sao lưu sang Ổ 2"
          detail={d1Selected.size > 0 ? `${d1Selected.size} mục` : 'Cả thư mục'}
          sub={drive1View ? baseNameOf(trimTrailingSeparators(drive1View)) ?? '' : ''}
          buttonTitle={
            d1Selected.size > 0
              ? `Sao lưu ${d1Selected.size} mục đã chọn vào ${drive2View || 'Ổ 2'}`
              : `Sao lưu cả thư mục đang mở ở Ổ 1 vào ${d2Target || '(chưa mở thư mục Ổ 2)'}`
          }
          disabled={busy || !drive1View || !drive2View}
          onResizeStart={(e) => layout.startHorizontalResize(1, e)}
          onReset={layout.resetColumns}
          onCopy={() => void handleCopyDrive1ToDrive2Only()}
        />

        <DriveColumn
          index={3}
          style={layout.columnStyle(3)}
          expanded={layout.expandedCol === 3}
          onToggleExpand={() => layout.toggleExpandCol(3)}
          nav={drive2Nav}
          drives={shared.drives}
          files={drive2Files}
          driveInfo={d2DriveInfo}
          insufficient={d2Insufficient}
          isDragOver={drive2Drop.isOver}
          dragCount={d1Selected.size}
          dropHandlers={drive2Drop.handlers}
          onRefresh={() => void refreshDrive2View()}
          onCommand={commandFor('d2')}
          onPickFolder={() => handlePickFolder(3)}
          menuActions={drive2MenuActions}
          footerRight={<span className="text-emerald-400">Backup</span>}
        />

        <ResizeSplitter onResizeStart={(e) => layout.startHorizontalResize(2, e)} onReset={layout.resetColumns} />

        <GoogleDriveColumn
          style={layout.columnStyle(4)}
          expanded={layout.expandedCol === 4}
          onToggleExpand={() => layout.toggleExpandCol(4)}
          driveAuth={shared.driveAuth}
          driveLink={shared.driveLink}
          parsedFolderId={parseGoogleDriveFolderId(shared.driveLink)}
          folderCheck={shared.driveFolderCheck}
          checkingLink={shared.checkingDriveLink}
          uploadDisabled={busy}
          onOpenAuth={shared.openDriveAuth}
          onDriveLinkChange={shared.setDriveLink}
          onCheckLink={() => void shared.checkDriveLink()}
          onUploadFromDrive1={() => void handleUploadOnly()}
        />
      </div>

      <BottomPanelSplitter onResizeStart={layout.startVerticalResize} onReset={layout.resetBottomHeight} />

      <PipelineBar
        projectName={tab.camFolder.trim() ? `${shared.projectName} · ${tab.camFolder.trim()}` : shared.projectName}
        heightPx={layout.bottomHeight}
        progress={progress}
        activityLogs={shared.activityLogs}
        isRunning={busy || watching}
        onCancel={handleCancel}
        onOpenReportPreview={() => setReportOpen(true)}
      />

      <ConflictModal prompt={conflictPrompt} onChoose={resolveConflictPrompt} />
      <NameDialog prompt={namePrompt} onClose={() => setNamePrompt(null)} />
      <PropertiesDialog path={propsPath} drives={shared.drives} onClose={() => setPropsPath(null)} />

      <ReportPreviewModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        projectName={shared.projectName}
        targetDate={shared.targetDate}
        driveLink={shared.driveLink}
        mediaReport={mediaReport}
        backupReport={backupReport}
      />
    </div>
  );
}
