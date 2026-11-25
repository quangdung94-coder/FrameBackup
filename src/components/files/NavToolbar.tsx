import { ArrowLeft, ArrowRight, ArrowUp, ChevronRight, FolderOpen, FolderTree, Loader2, Monitor, RefreshCw } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FolderNav } from '../../hooks/useFolderNav';
import { specialIcon, useSpecialFolders } from '../../hooks/useSpecialFolders';
import { buildPathMenu, openContextMenu, type PathMenuActions } from '../../lib/globalMenu';
import { pathSegments } from '../../lib/paths';
import { formatBytes, type DriveInfo } from '../../types/framebackup';

interface DropItem {
  icon: string;
  label: string;
  sub?: string;
  path: string;
}

/** Danh sách sổ xuống dưới 1 nút › của thanh địa chỉ (giống Windows Explorer). */
function FolderDropdown({ anchor, items, loading, current, onPick, onClose }: {
  anchor: DOMRect;
  items: DropItem[];
  loading: boolean;
  current: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 2 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(anchor.left, window.innerWidth - r.width - 6)),
      top: anchor.bottom + r.height > window.innerHeight - 6 ? Math.max(4, anchor.top - r.height - 2) : anchor.bottom + 2,
    });
  }, [anchor, items.length, loading]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  const cur = current.replace(/[\\/]+$/, '').toLowerCase();
  return (
    <div
      ref={ref}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-[100] min-w-[220px] max-w-[360px] max-h-[60vh] overflow-auto py-1 rounded-md bg-[#232329] border border-[#3a3a46] shadow-2xl shadow-black/60 text-[12px] text-zinc-200"
    >
      {loading ? (
        <div className="px-3 py-2 flex items-center gap-2 text-zinc-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang đọc...
        </div>
      ) : items.length === 0 ? (
        <div className="px-3 py-2 text-zinc-500">(không có thư mục con)</div>
      ) : (
        items.map((it) => (
          <button
            key={it.path}
            onClick={() => {
              onPick(it.path);
              onClose();
            }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-blue-600/40 ${
              it.path.replace(/[\\/]+$/, '').toLowerCase() === cur ? 'font-semibold text-white' : ''
            }`}
          >
            <span className="w-4 text-center shrink-0">{it.icon}</span>
            <span className="truncate flex-1">{it.label}</span>
            {it.sub && <span className="text-[10.5px] text-zinc-500 shrink-0">{it.sub}</span>}
          </button>
        ))
      )}
    </div>
  );
}

interface NavToolbarProps {
  nav: FolderNav;
  drives: DriveInfo[];
  /** Cây thư mục bên trái đang mở. */
  treeOpen: boolean;
  onToggleTree: () => void;
  onRefresh: () => void;
  onPickFolder: () => void;
  placeholder: string;
  /** Thẻ demo: không duyệt được. */
  disabled?: boolean;
  /** Chuột phải trên từng đoạn của thanh địa chỉ. */
  pathActions?: PathMenuActions;
}

const btn =
  'w-6 h-6 shrink-0 inline-flex items-center justify-center rounded text-zinc-300 hover:bg-white/10 hover:text-white disabled:text-zinc-600 disabled:hover:bg-transparent';

/**
 * Thanh điều hướng kiểu Explorer: ← Lùi, → Tiến, ↑ Lên, thanh địa chỉ bấm từng đoạn,
 * bấm › để sổ thư mục con, bấm vào chỗ trống của thanh địa chỉ để gõ đường dẫn.
 */
export function NavToolbar({ nav, drives, treeOpen, onToggleTree, onRefresh, onPickFolder, placeholder, disabled, pathActions }: NavToolbarProps) {
  const special = useSpecialFolders();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [drop, setDrop] = useState<{ anchor: DOMRect; items: DropItem[]; loading: boolean } | null>(null);
  const segs = disabled ? [] : pathSegments(nav.path);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Luôn thấy đoạn cuối của đường dẫn dài
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [nav.path, editing]);

  const rootItems = (): DropItem[] => [
    ...special.map((s) => ({ icon: specialIcon(s.id), label: s.label, path: s.path })),
    ...drives.map((d) => ({
      icon: d.isRemovable ? '💳' : '🖴',
      label: d.label,
      sub: `${formatBytes(d.freeBytes)} trống`,
      path: d.mountPath,
    })),
  ];

  const openDrop = (e: React.MouseEvent, dir: string | null) => {
    const anchor = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (dir === null) {
      setDrop({ anchor, items: rootItems(), loading: false });
      return;
    }
    setDrop({ anchor, items: [], loading: true });
    const api = window.frameBackup;
    if (!api) return;
    void api
      .listDirectory(dir)
      .then((list) =>
        setDrop((cur) =>
          cur && cur.anchor === anchor
            ? { anchor, loading: false, items: list.filter((f) => f.isDirectory).map((f) => ({ icon: '📁', label: f.name, path: f.fullPath })) }
            : cur
        )
      )
      .catch(() => setDrop((cur) => (cur && cur.anchor === anchor ? { ...cur, loading: false } : cur)));
  };

  const commitEdit = () => {
    const v = draft.trim().replace(/^"|"$/g, '');
    setEditing(false);
    if (v && v !== nav.path) nav.go(v);
  };

  return (
    <div className="px-1.5 py-1 bg-[#1b1b20] border-b border-[#2b2b34] flex items-center gap-0.5 min-w-0">
      <button className={btn} disabled={disabled || !nav.canBack} onClick={nav.back} title="Lùi (Alt+← / nút Back của chuột)">
        <ArrowLeft className="w-3.5 h-3.5" />
      </button>
      <button className={btn} disabled={disabled || !nav.canForward} onClick={nav.forward} title="Tiến (Alt+→)">
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
      <button className={btn} disabled={disabled || !nav.canUp} onClick={nav.up} title="Lên thư mục cha (Alt+↑)">
        <ArrowUp className="w-3.5 h-3.5" />
      </button>

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={() => setEditing(false)}
          placeholder={placeholder}
          className="flex-1 min-w-0 h-6 bg-[#101013] border border-blue-500/70 rounded px-2 text-[11px] text-zinc-100 outline-none"
        />
      ) : (
        <div
          ref={scrollRef}
          onClick={(e) => {
            if (disabled || e.target !== e.currentTarget) return;
            setDraft(nav.path);
            setEditing(true);
          }}
          title="Bấm vào chỗ trống để gõ đường dẫn"
          className="flex-1 min-w-0 h-6 flex items-center bg-[#101013] border border-[#2b2b34] rounded overflow-x-auto overflow-y-hidden whitespace-nowrap text-[11px] cursor-text [scrollbar-width:none]"
        >
          <button
            className="h-full px-1 shrink-0 text-zinc-400 hover:bg-white/10 hover:text-white"
            title="This PC"
            disabled={disabled}
            onClick={(e) => openDrop(e, null)}
          >
            <Monitor className="w-3 h-3" />
          </button>
          <button
            className="h-full px-0.5 shrink-0 text-zinc-500 hover:bg-white/10 hover:text-white"
            disabled={disabled}
            onClick={(e) => openDrop(e, null)}
            title="Các ổ đĩa & thư mục nhanh"
          >
            <ChevronRight className="w-3 h-3" />
          </button>
          {segs.length === 0 && <span className="px-1.5 text-zinc-500 pointer-events-none">{disabled ? nav.path : placeholder}</span>}
          {segs.map((s, i) => (
            <span key={s.path} className="inline-flex items-center h-full shrink-0">
              <button
                className={`h-full px-1 hover:bg-white/10 ${i === segs.length - 1 ? 'text-zinc-100 font-medium' : 'text-zinc-300'}`}
                onClick={() => nav.go(s.path)}
                onContextMenu={(e) => {
                  if (!pathActions) return;
                  const drive = i === 0 ? drives.find((d) => d.mountPath.replace(/[\\/]+$/, '').toLowerCase() === s.path.replace(/[\\/]+$/, '').toLowerCase()) : undefined;
                  openContextMenu(
                    e,
                    buildPathMenu(s.path, i === 0 ? 'drive' : 'folder', pathActions, { removable: drive?.isRemovable, current: i === segs.length - 1 })
                  );
                }}
                title={s.path}
              >
                {s.label}
              </button>
              <button
                className="h-full px-0.5 text-zinc-500 hover:bg-white/10 hover:text-white"
                onClick={(e) => openDrop(e, s.path)}
                title={`Thư mục con của ${s.label}`}
              >
                <ChevronRight className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <button className={btn} disabled={disabled || !nav.path} onClick={onRefresh} title="Làm mới (F5)">
        <RefreshCw className="w-3.5 h-3.5" />
      </button>
      <button
        className={`${btn} ${treeOpen ? 'bg-blue-600/30 text-blue-100' : ''}`}
        onClick={onToggleTree}
        title="Hiện / ẩn cây thư mục (Desktop, This PC, các ổ)"
      >
        <FolderTree className="w-3.5 h-3.5" />
      </button>
      <button className={btn} onClick={onPickFolder} title="Chọn thư mục bằng hộp thoại hệ thống">
        <FolderOpen className="w-3.5 h-3.5" />
      </button>

      {drop && (
        <FolderDropdown
          anchor={drop.anchor}
          items={drop.items}
          loading={drop.loading}
          current={nav.path}
          onPick={nav.go}
          onClose={() => setDrop(null)}
        />
      )}
    </div>
  );
}
