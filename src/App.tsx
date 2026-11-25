import { ParallelRunModal, type ParallelChoice, type ParallelPrompt } from './components/ParallelRunModal';
import { GlobalContextMenu } from './lib/globalMenu';
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
import { BACKUP_HISTORY_LIMIT, type CardTab, type SharedWorkspace, type UploadPackChoice, type WorkspaceStatus } from './workspace/shared';

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
      [STORAGE_KEYS.backupHistory]: historyItems.slice(0, BACKUP_HISTORY_LIMIT),
      [STORAGE_KEYS.visibleExts]: visibleExtensions,
      [STORAGE_KEYS.includeSidecarXml]: includeSidecarXml,
    });
  }, [drive1Root, drive2Root, copyEngine, packMode, uploadPack, postAction, postDelayMin, historyItems, visibleExtensions, includeSidecarXml]);

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

  // ---- v1.4: tự nhận thẻ / ổ khi cắm hoặc rút ----
  const [cardInserts, setCardInserts] = useState<Record<string, { path: string; seq: number }>>({});
  const drivesRef = useLatestRef(drives);
  const tabsRef = useLatestRef(tabs);
  const activeTabRef = useLatestRef(activeTabId);
  useEffect(() => {
    const api = window.frameBackup;
    if (!api?.onDrivesChanged) return;
    let seq = 0;
    return api.onDrivesChanged((next) => {
      const prev = drivesRef.current;
      const key = (d: DriveInfo) => d.mountPath.toLowerCase();
      const before = new Set(prev.map(key));
      const after = new Set(next.map(key));
      setDrives(next);
      const added = next.filter((d) => !before.has(key(d)));
      const removed = prev.filter((d) => !after.has(key(d)));
      for (const d of removed) showToast(`⏏ ${d.isRemovable ? 'Thẻ' : 'Ổ'} ${d.label} đã được rút ra.`);
      for (const d of added) {
        if (!d.isRemovable) {
          showToast(`🖴 Đã nhận ổ ${d.label}.`);
          continue;
        }
        // Thẻ mới: mở vào khu vực thẻ đang xem nếu còn trống, không thì khu vực trống đầu tiên
        const sts = statusesRef.current;
        const free = (id: string) => !sts[id]?.cardPath;
        const list = tabsRef.current;
        const target = free(activeTabRef.current) ? activeTabRef.current : list.find((t) => free(t.id))?.id;
        if (target) {
          seq += 1;
          setCardInserts((m) => ({ ...m, [target]: { path: d.mountPath, seq } }));
          const name = list.find((t) => t.id === target)?.camFolder;
          showToast(`💳 Đã nhận thẻ ${d.label} — đã mở ở ${name ? `thẻ ${name}` : 'khu vực thẻ'}.`);
        } else {
          showToast(`💳 Đã nhận thẻ ${d.label} — bấm "+ Thêm thẻ" để mở thẻ này.`);
        }
      }
    });
  }, [drivesRef, tabsRef, activeTabRef, statusesRef, showToast]);

  const driveLinkRef = useLatestRef(driveLink);
  /** `silent`: tự kiểm tra (dán link / sau khi up) — chỉ đổi trạng thái ở Cột 4, không bật thông báo. */
  const checkDriveLink = useCallback(
    async (linkOverride?: string, silent = false): Promise<DriveFolderCheckResult | null> => {
      if (!window.frameBackup) return null;
      const target = (linkOverride ?? driveLinkRef.current).trim();
      if (!target) {
        if (!silent) showToast('Hãy dán link thư mục Google Drive trước khi kiểm tra.');
        return null;
      }
      setCheckingDriveLink(true);
      try {
        const res = await window.frameBackup.checkDriveFolder(target);
        setDriveFolderCheck(res);
        if (silent) return res;
        if (res.ok) showToast(`✅ Kết nối thư mục Drive "${res.folderName}" — Quyền Editor OK!`);
        else if (res.error) showToast(`⚠️ ${res.error}`);
        return res;
      } finally {
        setCheckingDriveLink(false);
      }
    },
    [driveLinkRef, showToast]
  );

  // ---- v1.4: chọn / cấp quyền thư mục Drive bằng Google Picker (quyền drive.file) ----
  const [pickingDriveFolder, setPickingDriveFolder] = useState(false);
  const pickDriveFolder = useCallback(async () => {
    const api = window.frameBackup;
    if (!api?.pickDriveFolder) return;
    setPickingDriveFolder(true);
    try {
      const startId = parseGoogleDriveFolderId(driveLinkRef.current) ?? undefined;
      const res = await api.pickDriveFolder(startId, loadSavedString(STORAGE_KEYS.loginBrowser, 'system'));
      if (!res.ok || !res.folderId) {
        if (!res.cancelled && res.error) showToast(`⚠️ ${res.error}`);
        return;
      }
      const link = `https://drive.google.com/drive/folders/${res.folderId}`;
      setDriveLinkState(link);
      setDriveFolderCheck(null);
      showToast(`✅ Đã cấp quyền thư mục Drive "${res.folderName ?? res.folderId}".`);
      await checkDriveLink(link, true);
    } finally {
      setPickingDriveFolder(false);
    }
  }, [driveLinkRef, checkDriveLink, showToast]);

  // ---- v1.4: 1 nút "Check" — kiểm tra; app chưa có quyền ghi thì tự mở bảng chọn thư mục của Google ----
  const checkDriveAccess = useCallback(async () => {
    const link = driveLinkRef.current.trim();
    if (!link) {
      if (driveAuth.signedIn) await pickDriveFolder();
      else showToast('Hãy đăng nhập Google và dán link thư mục Drive trước.');
      return;
    }
    const res = await checkDriveLink(link, true);
    if (!res) return;
    if (res.ok) showToast(`✅ Kết nối thư mục Drive "${res.folderName}" — Quyền Editor OK!`);
    else if (res.needsPick && driveAuth.signedIn) {
      showToast('🔑 App chưa có quyền ghi vào thư mục này — đang mở bảng chọn của Google, anh bấm "Chọn" 1 lần.');
      await pickDriveFolder();
    } else if (res.error) showToast(`⚠️ ${res.error}`);
  }, [driveLinkRef, driveAuth, checkDriveLink, pickDriveFolder, showToast]);



  // Đã đăng nhập + dán link hợp lệ => tự kiểm tra thư mục
  const parsedDriveFolderId = useMemo(() => parseGoogleDriveFolderId(driveLink), [driveLink]);
  useEffect(() => {
    if (!driveAuth.signedIn || !parsedDriveFolderId) return;
    const timer = setTimeout(() => void checkDriveLink(driveLinkRef.current, true), 600);
    return () => clearTimeout(timer);
  }, [driveAuth.signedIn, parsedDriveFolderId, checkDriveLink, driveLinkRef]);

  // ---- Chạy nhiều thẻ: song song / xếp hàng / hỏi (v1.4) ----
  const activeRunsRef = useRef<Set<Promise<void>>>(new Set());
  const [parallelChoice, setParallelChoiceState] = useState<'ask' | 'parallel' | 'queue'>(() => {
    const v = loadSavedString(STORAGE_KEYS.parallelChoice, '');
    if (v === 'parallel' || v === 'queue' || v === 'ask') return v;
    // Người dùng cũ đã bật "Chạy lần lượt từng thẻ" => giữ nguyên là xếp hàng
    return loadSavedString(STORAGE_KEYS.sequentialRuns, 'false') === 'true' ? 'queue' : 'ask';
  });
  const parallelChoiceRef = useLatestRef(parallelChoice);
  const drive1RootRef = useLatestRef(drive1Root);
  const setParallelChoice = useCallback((v: 'ask' | 'parallel' | 'queue') => {
    setParallelChoiceState(v);
    saveToStorage({ [STORAGE_KEYS.parallelChoice]: v });
  }, []);
  const [parallelPrompts, setParallelPrompts] = useState<ParallelPrompt[]>([]);
  const askParallel = useCallback(
    (tabLabel: string, others: string[], sharedDrive: string) =>
      new Promise<ParallelChoice>((resolve) => {
        const prompt: ParallelPrompt = {
          tabLabel,
          others,
          sharedDrive,
          resolve: (choice, remember) => {
            if (remember && choice !== 'cancel') setParallelChoice(choice);
            setParallelPrompts((q) => q.filter((x) => x !== prompt));
            resolve(choice);
          },
        };
        setParallelPrompts((q) => [...q, prompt]);
      }),
    [setParallelChoice]
  );

  /** Xin lượt chạy cho 1 thẻ. Trả null nếu anh bấm Hủy. */
  const acquireRunSlot = useCallback(
    async (tabId: string): Promise<(() => void) | null> => {
      const others = Array.from(activeRunsRef.current);
      let release: () => void = () => {};
      const mine = new Promise<void>((r) => {
        release = () => {
          activeRunsRef.current.delete(mine);
          r();
        };
      });
      if (others.length > 0) {
        let choice: ParallelChoice;
        if (parallelChoiceRef.current === 'parallel') choice = 'parallel';
        else if (parallelChoiceRef.current === 'queue') choice = 'queue';
        else {
          const sts = statusesRef.current;
          const names = Object.entries(sts)
            .filter(([id, st]) => id !== tabId && st && (st.running || st.waiting))
            .map(([, st]) => st!.label || 'Thẻ khác');
          const label = sts[tabId]?.label || 'thẻ này';
          const d1 = drive1RootRef.current.match(/^[A-Za-z]:/)?.[0] ?? (drive1RootRef.current.startsWith('/Volumes/') ? drive1RootRef.current.split('/').slice(0, 3).join('/') : '');
          choice = await askParallel(label, names.length > 0 ? names : ['thẻ khác'], d1);
        }
        if (choice === 'cancel') return null;
        activeRunsRef.current.add(mine);
        if (choice === 'queue') await Promise.all(others);
        return release;
      }
      activeRunsRef.current.add(mine);
      return release;
    },
    [parallelChoiceRef, statusesRef, askParallel]
  );

  // ---- Xong 1 thẻ: lịch sử + Sleep/Shutdown khi KHÔNG còn thẻ nào chạy ----
  const postActionRef = useLatestRef(postAction);
  const finishJob = useCallback(
    (tabId: string, entry: Omit<BackupHistoryItem, 'id' | 'completedAt'>, allowPowerAction: boolean) => {
      const item: BackupHistoryItem = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, completedAt: Date.now(), ...entry };
      setHistoryItems((prev) => [item, ...prev.slice(0, BACKUP_HISTORY_LIMIT - 1)]);
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
    pickDriveFolder,
    checkDriveAccess,
    pickingDriveFolder,
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
    parallelChoice,
    setParallelChoice,
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
        parallelChoice={parallelChoice}
        onParallelChoiceChange={setParallelChoice}
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
          cardInsert={cardInserts[t.id]}
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
      <GlobalContextMenu />
      <ParallelRunModal prompt={parallelPrompts[0] ?? null} />

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
