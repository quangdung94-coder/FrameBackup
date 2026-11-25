import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_VISIBLE_EXTENSIONS, FileFilterModal } from './components/FileFilterModal';
import { GoogleDriveAuthModal } from './components/GoogleDriveAuthModal';
import { HistoryModal } from './components/HistoryModal';
import { CardTabs } from './components/layout/CardTabs';
import { RibbonToolbar, type PostAction } from './components/layout/RibbonToolbar';
import { NotificationTray } from './components/layout/NotificationTray';
import { TopStatusBar } from './components/layout/TopStatusBar';
import { PowerCountdownModal } from './components/PowerCountdownModal';
import { useActivityLog } from './hooks/useActivityLog';
import { useColumnLayout } from './hooks/useColumnLayout';
import { useLatestRef } from './hooks/useLatestRef';
import { createProgressStore, type ProgressStore } from './lib/progressStore';
import {
  isStringArray,
  loadSavedFlag,
  loadSavedJson,
  loadSavedNumber,
  loadSavedString,
  saveToStorage,
  STORAGE_KEYS,
} from './lib/storage';
import { getTodayDateString } from './lib/time';
import {
  parseGoogleDriveFolderId,
  type BackupHistoryItem,
  type CopyEngineId,
  type CopyEngineOption,
  type DriveAuthStatus,
  type DriveFolderCheckResult,
  type DriveInfo,
  type PackMode,
  type PowerActionType,
  type SystemInfo,
} from './types/framebackup';
import { CardWorkspace } from './workspace/CardWorkspace';
import type { CardTab, SharedWorkspace, UploadPackChoice, WorkspaceStatus } from './workspace/shared';

const isHistoryList = (v: unknown): v is BackupHistoryItem[] => Array.isArray(v);

let tabSeq = 0;
const newTabId = () => `card-${++tabSeq}`;

export default function App() {
  const [sysInfo, setSysInfo] = useState<SystemInfo>({ platform: 'win32', arch: 'x64', hostname: 'Local', preventSleepActive: false });
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [copyEngines, setCopyEngines] = useState<CopyEngineOption[]>([
    { id: 'builtin', name: 'FrameBackup Built-in (XXHash64)', description: 'Mặc định', available: true, platform: 'all' },
  ]);
  const [copyEngine, setCopyEngine] = useState<CopyEngineId>(
    () => (loadSavedString(STORAGE_KEYS.copyEngine, 'builtin') as CopyEngineId) || 'builtin'
  );

  const layout = useColumnLayout();
  const { activityLogs, toasts, unread, markRead, dismissToast, showToast } = useActivityLog();

  // Gốc Ổ 1 / Ổ 2 dùng chung cả Show (nhớ theo máy). Mỗi thẻ tự vào <gốc>/<Show>[/<Thư mục máy>].
  const [drive1Root, setDrive1Root] = useState(() => loadSavedString(STORAGE_KEYS.drive1Path, ''));
  const [drive2Root, setDrive2Root] = useState(() => loadSavedString(STORAGE_KEYS.drive2Path, ''));

  const [driveLink, setDriveLinkState] = useState('');
  const [driveAuth, setDriveAuth] = useState<DriveAuthStatus>({ hasCredentials: false, signedIn: false });
  const [driveAuthModalOpen, setDriveAuthModalOpen] = useState(false);
  const [driveFolderCheck, setDriveFolderCheck] = useState<DriveFolderCheckResult | null>(null);
  const [checkingDriveLink, setCheckingDriveLink] = useState(false);
  const [projectName, setProjectName] = useState(() => `${getTodayDateString().replace(/-/g, '.')}.New_Show`);

  const [targetDate, setTargetDate] = useState(getTodayDateString);
  const [overnightMode, setOvernightMode] = useState(true);
  const [packMode, setPackMode] = useState<PackMode>(
    () => (loadSavedString(STORAGE_KEYS.packMode, 'video-raw-smart') as PackMode) || 'video-raw-smart'
  );
  const [uploadPack, setUploadPack] = useState<UploadPackChoice>(() =>
    loadSavedString(STORAGE_KEYS.uploadOnlyPack, 'pack') === 'none' ? 'none' : 'pack'
  );
  const [postAction, setPostAction] = useState<PostAction>(
    () => (loadSavedString(STORAGE_KEYS.postAction, 'drive-report-sleep') as PostAction) || 'drive-report-sleep'
  );
  const [postDelayMin, setPostDelayMin] = useState<number>(() => loadSavedNumber(STORAGE_KEYS.postDelayMin, 1, 1, 120));
  const [pendingPowerAction, setPendingPowerAction] = useState<PowerActionType | null>(null);
  const [historyItems, setHistoryItems] = useState<BackupHistoryItem[]>(() =>
    loadSavedJson(STORAGE_KEYS.backupHistory, isHistoryList, () => [])
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [fileFilterOpen, setFileFilterOpen] = useState(false);
  const [visibleExtensions, setVisibleExtensions] = useState<string[]>(() =>
    loadSavedJson(STORAGE_KEYS.visibleExts, isStringArray, () => [...DEFAULT_VISIBLE_EXTENSIONS])
  );
  const [includeSidecarXml, setIncludeSidecarXml] = useState<boolean>(() => loadSavedFlag(STORAGE_KEYS.includeSidecarXml, false));
  const [sequentialRuns, setSequentialRuns] = useState<boolean>(() => loadSavedString(STORAGE_KEYS.sequentialRuns, 'false') === 'true');

  // ---- Nhiều thẻ: mỗi thẻ 1 tab ----
  const [tabs, setTabs] = useState<CardTab[]>(() => [{ id: newTabId(), camFolder: '' }]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [statuses, setStatuses] = useState<Record<string, WorkspaceStatus | undefined>>({});
  const [initialSources, setInitialSources] = useState<Record<string, string>>({});
  const storesRef = useRef<Record<string, ProgressStore>>({});
  for (const t of tabs) if (!storesRef.current[t.id]) storesRef.current[t.id] = createProgressStore();
  const statusesRef = useLatestRef(statuses);

  const handleStatus = useCallback((tabId: string, st: WorkspaceStatus) => {
    setStatuses((prev) => {
      const old = prev[tabId];
      if (
        old &&
        old.label === st.label &&
        old.cardPath === st.cardPath &&
        old.running === st.running &&
        old.waiting === st.waiting &&
        old.watching === st.watching &&
        old.verdict === st.verdict
      ) {
        return prev;
      }
      return { ...prev, [tabId]: st };
    });
  }, []);

  useEffect(() => {
    saveToStorage({
      [STORAGE_KEYS.drive1Path]: drive1Root,
      [STORAGE_KEYS.drive2Path]: drive2Root,
      [STORAGE_KEYS.copyEngine]: copyEngine,
      [STORAGE_KEYS.packMode]: packMode,
      [STORAGE_KEYS.uploadOnlyPack]: uploadPack,
      [STORAGE_KEYS.postAction]: postAction,
      [STORAGE_KEYS.postDelayMin]: postDelayMin,
      [STORAGE_KEYS.backupHistory]: historyItems.slice(0, 100),
      [STORAGE_KEYS.visibleExts]: visibleExtensions,
      [STORAGE_KEYS.includeSidecarXml]: includeSidecarXml,
      [STORAGE_KEYS.sequentialRuns]: sequentialRuns,
    });
  }, [drive1Root, drive2Root, copyEngine, packMode, uploadPack, postAction, postDelayMin, historyItems, visibleExtensions, includeSidecarXml, sequentialRuns]);

  const loadSystemData = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    void loadSystemData();
  }, [loadSystemData]);

  const driveLinkRef = useLatestRef(driveLink);
  /** `silent`: tự kiểm tra (dán link / sau khi up) — chỉ đổi trạng thái ở Cột 4, không bật thông báo. */
  const checkDriveLink = useCallback(
    async (linkOverride?: string, silent = false) => {
      if (!window.frameBackup) return;
      const target = (linkOverride ?? driveLinkRef.current).trim();
      if (!target) {
        if (!silent) showToast('Hãy dán link thư mục Google Drive trước khi kiểm tra.');
        return;
      }
      setCheckingDriveLink(true);
      try {
        const res = await window.frameBackup.checkDriveFolder(target);
        setDriveFolderCheck(res);
        if (silent) return;
        if (res.ok) showToast(`✅ Kết nối thư mục Drive "${res.folderName}" — Quyền Editor OK!`);
        else if (res.error) showToast(`⚠️ ${res.error}`);
      } finally {
        setCheckingDriveLink(false);
      }
    },
    [driveLinkRef, showToast]
  );

  // Đã đăng nhập + dán link hợp lệ => tự kiểm tra thư mục
  const parsedDriveFolderId = useMemo(() => parseGoogleDriveFolderId(driveLink), [driveLink]);
  useEffect(() => {
    if (!driveAuth.signedIn || !parsedDriveFolderId) return;
    const timer = setTimeout(() => void checkDriveLink(driveLinkRef.current, true), 600);
    return () => clearTimeout(timer);
  }, [driveAuth.signedIn, parsedDriveFolderId, checkDriveLink, driveLinkRef]);

  // ---- Chạy lần lượt (tuỳ chọn) ----
  const sequentialRef = useLatestRef(sequentialRuns);
  const slotChainRef = useRef<Promise<void>>(Promise.resolve());
  const acquireRunSlot = useCallback(async () => {
    if (!sequentialRef.current) return () => {};
    const prev = slotChainRef.current;
    let release: () => void = () => {};
    slotChainRef.current = new Promise<void>((r) => {
      release = r;
    });
    await prev;
    return release;
  }, [sequentialRef]);

  // ---- Xong 1 thẻ: lịch sử + Sleep/Shutdown khi KHÔNG còn thẻ nào chạy ----
  const postActionRef = useLatestRef(postAction);
  const finishJob = useCallback(
    (tabId: string, entry: Omit<BackupHistoryItem, 'id' | 'completedAt'>, allowPowerAction: boolean) => {
      const item: BackupHistoryItem = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, completedAt: Date.now(), ...entry };
      setHistoryItems((prev) => [item, ...prev.slice(0, 99)]);
      if (!allowPowerAction) {
        if (postActionRef.current !== 'drive-report-only') {
          showToast('⚠️ Báo cáo chưa "AN TOÀN" — không tự Sleep/Shutdown. Hãy xem báo cáo.');
        }
        return;
      }
      const othersBusy = Object.entries(statusesRef.current).some(
        ([id, st]) => id !== tabId && st && (st.running || st.waiting || st.watching)
      );
      if (othersBusy) {
        if (postActionRef.current !== 'drive-report-only') showToast('ℹ️ Còn thẻ khác đang chạy — chưa Sleep/Shutdown.');
        return;
      }
      if (postActionRef.current === 'drive-report-sleep') setPendingPowerAction('sleep');
      else if (postActionRef.current === 'drive-report-shutdown') setPendingPowerAction('shutdown');
    },
    [postActionRef, showToast, statusesRef]
  );

  const verifiedCardRootsRef = useRef<Set<string>>(new Set());

  const shared: SharedWorkspace = {
    drives,
    projectName,
    targetDate,
    overnightMode,
    copyEngine,
    packMode,
    postAction,
    visibleExtensions,
    includeSidecarXml,
    setIncludeSidecarXml,
    drive1Root,
    drive2Root,
    setDrive1Root,
    setDrive2Root,
    driveLink,
    setDriveLink: (v) => {
      setDriveLinkState(v);
      setDriveFolderCheck(null);
    },
    driveAuth,
    driveFolderCheck,
    checkingDriveLink,
    checkDriveLink,
    openDriveAuth: () => setDriveAuthModalOpen(true),
    uploadPack,
    setUploadPack,
    layout,
    activityLogs,
    showToast,
    reloadSystem: loadSystemData,
    setTargetDate,
    finishJob,
    acquireRunSlot,
    verifiedCardRoots: verifiedCardRootsRef.current,
  };

  const addTab = () => {
    const id = newTabId();
    const letter = String.fromCharCode(65 + (tabs.length % 26));
    // Gợi ý thẻ: ổ rời chưa có khu vực nào dùng
    const used = new Set(Object.values(statuses).map((s) => s?.cardPath.toLowerCase()));
    const freeCard = drives.find((d) => d.isRemovable && !used.has(d.mountPath.toLowerCase()));
    setTabs((prev) => [
      // Từ thẻ thứ 2: mỗi thẻ vào thư mục máy riêng để file trùng tên giữa 2 máy không đè nhau
      ...prev.map((t, i) => (prev.length === 1 && i === 0 && !t.camFolder && !statuses[t.id]?.cardPath ? { ...t, camFolder: 'Cam A' } : t)),
      { id, camFolder: `Cam ${letter}` },
    ]);
    if (freeCard) setInitialSources((prev) => ({ ...prev, [id]: freeCard.mountPath }));
    setActiveTabId(id);
    void loadSystemData();
  };

  const closeTab = (id: string) => {
    const st = statuses[id];
    if (st?.running || st?.watching) {
      showToast('Thẻ này đang chạy — bấm Dừng trước khi đóng.');
      return;
    }
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (id === activeTabId && next.length > 0) setActiveTabId(next[Math.max(0, prev.findIndex((t) => t.id === id) - 1)].id);
      return next;
    });
    setStatuses((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    delete storesRef.current[id];
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#121215] text-zinc-100 overflow-hidden">
      <TopStatusBar
        sysInfo={sysInfo}
        logs={activityLogs}
        unread={unread}
        onMarkRead={markRead}
        historyCount={historyItems.length}
        driveCount={drives.length}
        onTogglePreventSleep={async () => {
          if (!window.frameBackup) return;
          const active = await window.frameBackup.setPreventSleep(!sysInfo.preventSleepActive);
          setSysInfo((prev) => ({ ...prev, preventSleepActive: active }));
        }}
        onOpenHistory={() => setHistoryOpen(true)}
        onRescanDrives={loadSystemData}
      />

      <RibbonToolbar
        projectName={projectName}
        targetDate={targetDate}
        overnightMode={overnightMode}
        visibleExtCount={visibleExtensions.length}
        copyEngines={copyEngines}
        copyEngine={copyEngine}
        packMode={packMode}
        postAction={postAction}
        postDelayMin={postDelayMin}
        onProjectNameChange={setProjectName}
        onTargetDateChange={setTargetDate}
        onOvernightModeChange={setOvernightMode}
        onOpenFileFilter={() => setFileFilterOpen(true)}
        onCopyEngineChange={setCopyEngine}
        onPackModeChange={setPackMode}
        onPostActionChange={setPostAction}
        onPostDelayMinChange={setPostDelayMin}
      />

      <CardTabs
        tabs={tabs}
        activeId={activeTabId}
        statuses={statuses}
        stores={storesRef.current}
        sequential={sequentialRuns}
        onSequentialChange={setSequentialRuns}
        onSelect={setActiveTabId}
        onAdd={addTab}
        onClose={closeTab}
      />

      {tabs.map((t) => (
        <CardWorkspace
          key={t.id}
          tab={t}
          active={t.id === activeTabId}
          tabCount={tabs.length}
          shared={shared}
          progress={storesRef.current[t.id]}
          initialSource={initialSources[t.id]}
          onCamFolderChange={(value) => setTabs((prev) => prev.map((x) => (x.id === t.id ? { ...x, camFolder: value } : x)))}
          onStatus={handleStatus}
        />
      ))}

      <GoogleDriveAuthModal
        open={driveAuthModalOpen}
        onClose={() => setDriveAuthModalOpen(false)}
        authStatus={driveAuth}
        onAuthChanged={setDriveAuth}
        onNotify={showToast}
      />

      <FileFilterModal
        open={fileFilterOpen}
        onClose={() => setFileFilterOpen(false)}
        visibleExtensions={visibleExtensions}
        onChangeVisibleExtensions={setVisibleExtensions}
        includeSidecarXml={includeSidecarXml}
        onChangeIncludeSidecarXml={setIncludeSidecarXml}
      />

      <HistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        items={historyItems}
        onClearHistory={() => {
          setHistoryItems([]);
          showToast('Đã xóa lịch sử sao lưu trên máy này.');
        }}
      />

      <NotificationTray toasts={toasts} onDismiss={dismissToast} />

      <PowerCountdownModal
        action={pendingPowerAction}
        delayMinutes={postDelayMin}
        onCancel={() => {
          setPendingPowerAction(null);
          showToast('Đã hủy hẹn giờ Sleep/Shutdown — giữ máy thức.');
        }}
        onExecute={async (act) => {
          setPendingPowerAction(null);
          const res = await window.frameBackup?.executePowerAction(act);
          if (res && !res.ok) showToast(`❌ ${res.message}`);
        }}
      />
    </div>
  );
}
