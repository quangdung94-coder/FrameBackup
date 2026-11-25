import { Bell, History, Moon, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ActivityLogEntry } from '../PipelineBar';
import framebackupLogo from '../../assets/framebackup-logo.svg';
import type { SystemInfo } from '../../types/framebackup';

interface TopStatusBarProps {
  sysInfo: SystemInfo;
  logs: ActivityLogEntry[];
  unread: number;
  onMarkRead: () => void;
  historyCount: number;
  driveCount: number;
  onTogglePreventSleep: () => void;
  onOpenHistory: () => void;
  onRescanDrives: () => void;
}

function osLabel(platform: string): string {
  return platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform;
}

const LEVEL_ICON: Record<ActivityLogEntry['level'], string> = { info: 'ℹ️', success: '✅', warn: '⚠️', error: '❌' };

/** Nút 🔔: xem lại toàn bộ thông báo trong phiên. */
function NotificationBell({ logs, unread, onMarkRead }: { logs: ActivityLogEntry[]; unread: number; onMarkRead: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          setOpen((v) => !v);
          onMarkRead();
        }}
        className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#1f1f26] hover:bg-[#2a2a35] border border-[#3a3a46] text-zinc-100 text-[13px] font-semibold transition"
        title="Xem lại các thông báo"
      >
        <Bell className="w-4 h-4 text-amber-300" />
        {unread > 0 && <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[11px] font-bold">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-[95] w-[420px] max-h-[60vh] overflow-auto rounded-lg border border-[#3a3a46] bg-[#1c1c21] shadow-2xl shadow-black/60 p-1.5 text-[12px] text-zinc-200">
          {logs.length === 0 ? (
            <div className="px-2 py-3 text-zinc-500">Chưa có thông báo nào.</div>
          ) : (
            logs.map((l) => (
              <div key={l.id} className="flex gap-2 px-2 py-1.5 border-b border-white/5 last:border-0">
                <span className="font-mono text-[10.5px] text-zinc-500 shrink-0 pt-px">{l.time}</span>
                <span className="min-w-0 break-words">
                  {/^[❌✅⚠⛔👁ℹ]/u.test(l.text) ? '' : `${LEVEL_ICON[l.level]} `}
                  {l.text}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Thanh trên cùng: logo, OS, 🔔 thông báo, Prevent Sleep, Lịch sử, Quét ổ. */
export function TopStatusBar({
  sysInfo,
  logs,
  unread,
  onMarkRead,
  historyCount,
  driveCount,
  onTogglePreventSleep,
  onOpenHistory,
  onRescanDrives,
}: TopStatusBarProps) {
  return (
    <div className="h-12 bg-[#0d0d10] border-b border-[#2b2b34] px-4 flex items-center justify-between text-xs text-zinc-400 shrink-0">
      <div className="flex items-center gap-2.5 font-semibold text-zinc-100 min-w-0">
        <img src={framebackupLogo} alt="FrameBackup" className="w-6 h-6 shrink-0" />
        <span className="text-sm shrink-0">FrameBackup v{sysInfo.appVersion || '1.0.0'}</span>
        <span className="text-[11.5px] px-2 py-0.5 rounded bg-[#23232b] border border-[#3e3e4b] text-zinc-300 shrink-0">
          {osLabel(sysInfo.platform)} ({sysInfo.arch})
        </span>
      </div>
      <div className="flex items-center gap-2.5 shrink-0">
        <NotificationBell logs={logs} unread={unread} onMarkRead={onMarkRead} />
        <button
          onClick={onTogglePreventSleep}
          className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[13px] border transition font-semibold ${
            sysInfo.preventSleepActive
              ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200'
              : 'bg-[#1f1f26] border-[#3a3a46] text-zinc-200 hover:text-white hover:bg-[#2a2a35]'
          }`}
        >
          <Moon className="w-4 h-4" />
          Prevent Sleep: {sysInfo.preventSleepActive ? 'ON' : 'OFF'}
        </button>
        <button
          onClick={onOpenHistory}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#1f1f26] hover:bg-[#2a2a35] border border-[#3a3a46] text-zinc-100 text-[13px] font-semibold transition"
          title="Xem lịch sử các show đã sao lưu & link Drive"
        >
          <History className="w-4 h-4 text-blue-400" /> Lịch sử ({historyCount})
        </button>
        <button
          onClick={onRescanDrives}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#1f1f26] hover:bg-[#2a2a35] border border-[#3a3a46] text-zinc-100 text-[13px] font-semibold transition"
          title="Quét lại ổ đĩa & thẻ nhớ"
        >
          <RefreshCw className="w-4 h-4" /> Quét ổ ({driveCount})
        </button>
      </div>
    </div>
  );
}
