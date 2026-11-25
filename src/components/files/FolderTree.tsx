import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { specialIcon, useSpecialFolders } from '../../hooks/useSpecialFolders';
import { pathSegments } from '../../lib/paths';
import { buildPathMenu, openContextMenu, type PathMenuActions } from '../../lib/globalMenu';
import type { DriveInfo } from '../../types/framebackup';

const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase();

interface Node {
  key: string;
  label: string;
  icon: string;
  path: string;
  kind: 'drive' | 'folder' | 'special';
  removable?: boolean;
}

/**
 * Cây thư mục bên trái 1 cột (giống Air Explorer / Windows Explorer):
 * Desktop, Tài liệu, Tải về... và This PC với các ổ, mở từng cấp. Bấm 1 thư mục = mở nó ở danh sách bên phải.
 */
export function FolderTree({
  currentPath,
  drives,
  onNavigate,
  pathActions,
}: {
  currentPath: string;
  drives: DriveInfo[];
  onNavigate: (path: string) => void;
  /** Chuột phải trên ổ / thư mục (Open, New folder, Properties...). */
  pathActions?: PathMenuActions;
}) {
  const special = useSpecialFolders();
  const [open, setOpen] = useState<Set<string>>(() => new Set(['__pc']));
  const [children, setChildren] = useState<Map<string, Node[]>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());

  const load = (path: string) => {
    const api = window.frameBackup;
    if (!api || children.has(norm(path)) || loading.has(norm(path))) return;
    setLoading((s) => new Set(s).add(norm(path)));
    void api
      .listDirectory(path)
      .then((list) => list.filter((f) => f.isDirectory).map((f) => ({ key: norm(f.fullPath), label: f.name, icon: '📁', path: f.fullPath, kind: 'folder' as const })))
      .catch(() => [] as Node[])
      .then((nodes) => {
        setChildren((m) => new Map(m).set(norm(path), nodes));
        setLoading((s) => {
          const n = new Set(s);
          n.delete(norm(path));
          return n;
        });
      });
  };

  // Mở sẵn các thư mục cha của thư mục đang xem
  useEffect(() => {
    const segs = pathSegments(currentPath);
    if (segs.length === 0) return;
    setOpen((prev) => {
      const next = new Set(prev);
      for (const s of segs.slice(0, -1)) next.add(norm(s.path));
      return next;
    });
    for (const s of segs.slice(0, -1)) load(s.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);

  const toggle = (n: Node) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(n.key)) next.delete(n.key);
      else {
        next.add(n.key);
        load(n.path);
      }
      return next;
    });
  };

  const cur = norm(currentPath);
  const rows: JSX.Element[] = [];
  const draw = (n: Node, depth: number) => {
    const isOpen = open.has(n.key);
    const kids = children.get(n.key);
    const hasKids = kids === undefined || kids.length > 0;
    rows.push(
      <div
        key={`${n.key}-${depth}`}
        onClick={() => onNavigate(n.path)}
        onContextMenu={(e) =>
          pathActions && openContextMenu(e, buildPathMenu(n.path, n.kind, pathActions, { removable: n.removable, current: n.key === cur }))
        }
        className={`flex items-center gap-1 pr-2 h-[22px] cursor-pointer whitespace-nowrap rounded-sm ${
          n.key === cur ? 'bg-blue-600/35 text-white' : 'text-zinc-300 hover:bg-white/[0.06]'
        }`}
        style={{ paddingLeft: 4 + depth * 12 }}
        title={n.path}
      >
        <button
          className="w-4 h-4 shrink-0 flex items-center justify-center text-zinc-500 hover:text-zinc-100"
          onClick={(e) => {
            e.stopPropagation();
            if (hasKids) toggle(n);
          }}
        >
          {loading.has(n.key) ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : !hasKids ? null : isOpen ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </button>
        <span className="w-4 text-center shrink-0 text-[11px]">{n.icon}</span>
        <span className="truncate">{n.label}</span>
      </div>
    );
    if (isOpen && kids) for (const k of kids) draw(k, depth + 1);
  };

  for (const s of special) draw({ key: norm(s.path), label: s.label, icon: specialIcon(s.id), path: s.path, kind: 'special' }, 0);
  const pcOpen = open.has('__pc');
  rows.push(
    <div
      key="__pc"
      onClick={() => setOpen((p) => (p.has('__pc') ? new Set([...p].filter((x) => x !== '__pc')) : new Set(p).add('__pc')))}
      className="flex items-center gap-1 pl-1 pr-2 h-[22px] cursor-pointer text-zinc-200 hover:bg-white/[0.06] rounded-sm"
    >
      <span className="w-4 h-4 flex items-center justify-center text-zinc-500">
        {pcOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </span>
      <span className="w-4 text-center text-[11px]">💻</span>
      <span>This PC</span>
    </div>
  );
  if (pcOpen) {
    for (const d of drives) draw({ key: norm(d.mountPath), label: d.label, icon: d.isRemovable ? '💳' : '🖴', path: d.mountPath, kind: 'drive', removable: d.isRemovable }, 1);
  }

  return <div className="h-full overflow-auto py-1 text-[11.5px] select-none">{rows}</div>;
}
