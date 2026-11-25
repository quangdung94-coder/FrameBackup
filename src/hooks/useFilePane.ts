import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileEntry } from '../types/framebackup';

export type PaneMode = 'tree' | 'flat';
export type SortKey = 'name' | 'size' | 'date';
export interface SortState {
  key: SortKey;
  asc: boolean;
}

export interface PaneRow {
  entry: FileEntry;
  depth: number;
  /** Thư mục mở được ngay trong cây (có nút ▸). */
  expandable: boolean;
  expanded: boolean;
  loading: boolean;
}

interface FilePaneOptions {
  /**
   * 'static': `items` là TOÀN BỘ file (quét đệ quy, có relativePath) — cây dựng từ relativePath (cột Thẻ nhớ).
   * 'lazy'  : `items` là nội dung 1 thư mục — mở thư mục con thì gọi `loadChildren` (cột Ổ 1 / Ổ 2).
   */
  kind: 'static' | 'lazy';
  items: FileEntry[];
  mode: PaneMode;
  query: string;
  sort: SortState;
  /** Thư mục đang xem (lazy): đổi thư mục thì xoá cache cây. */
  rootPath?: string;
  loadChildren?: (dirPath: string) => Promise<FileEntry[]>;
  /** Chế độ Phẳng / tìm kiếm cho 'lazy': quét đệ quy thư mục đang xem. */
  loadFlat?: (dirPath: string) => Promise<FileEntry[]>;
}

const naturalCmp = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' }).compare;

function sortEntries(list: FileEntry[], sort: SortState): FileEntry[] {
  const dir = sort.asc ? 1 : -1;
  return [...list].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    let c = 0;
    if (sort.key === 'size') c = a.sizeBytes - b.sizeBytes;
    else if (sort.key === 'date') c = (a.shotTimeMs || a.mtimeMs) - (b.shotTimeMs || b.mtimeMs);
    if (c === 0) c = naturalCmp(a.name, b.name);
    return c * dir;
  });
}

/** Cây thư mục dựng từ danh sách file đệ quy (relativePath dùng \ hoặc /). Thư mục được tạo ảo. */
function buildStaticTree(files: FileEntry[]): Map<string, FileEntry[]> {
  const children = new Map<string, FileEntry[]>();
  const dirs = new Map<string, FileEntry>();
  const push = (parent: string, e: FileEntry) => {
    const arr = children.get(parent);
    if (arr) arr.push(e);
    else children.set(parent, [e]);
  };
  for (const f of files) {
    const rel = f.relativePath.replace(/\\/g, '/');
    const parts = rel.split('/').filter(Boolean);
    if (f.isDirectory || parts.length <= 1) {
      push('', f);
      continue;
    }
    // Đường dẫn đầy đủ của thư mục cha = fullPath bỏ phần đuôi tương ứng
    let parentKey = '';
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts.slice(0, i + 1).join('/');
      let d = dirs.get(key);
      if (!d) {
        const tailLen = parts.slice(i + 1).join('/').length + 1;
        d = {
          name: parts[i],
          relativePath: key,
          fullPath: f.fullPath.slice(0, f.fullPath.length - tailLen),
          isDirectory: true,
          sizeBytes: 0,
          mtimeMs: 0,
          shotTimeMs: 0,
          dateSource: 'mtime',
          mediaType: 'folder',
          extension: '',
        };
        dirs.set(key, d);
        push(parentKey, d);
      }
      d.sizeBytes += f.sizeBytes;
      d.shotTimeMs = Math.max(d.shotTimeMs, f.shotTimeMs);
      d.mtimeMs = Math.max(d.mtimeMs, f.mtimeMs);
      parentKey = key;
    }
    push(parentKey, f);
  }
  return children;
}

/**
 * Dữ liệu cho 1 danh sách file kiểu Explorer: Cây thư mục (mở từng cấp) hoặc Phẳng (mọi file),
 * sắp xếp theo cột, tìm theo tên. Trả về các dòng đang thấy (đã sắp xếp) để vẽ ảo hoá.
 */
export function useFilePane({ kind, items, mode, query, sort, rootPath, loadChildren, loadFlat }: FilePaneOptions) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [lazyChildren, setLazyChildren] = useState<Map<string, FileEntry[]>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [flatItems, setFlatItems] = useState<FileEntry[] | null>(null);
  const [flatLoading, setFlatLoading] = useState(false);
  const flatSeqRef = useRef(0);

  // Đổi thư mục đang xem => quên cây đã mở & danh sách phẳng
  useEffect(() => {
    setExpanded(new Set());
    setLazyChildren(new Map());
    setFlatItems(null);
  }, [rootPath, kind]);

  // Danh sách đổi (làm mới / chép xong) => tải lại các thư mục đang mở & danh sách phẳng
  useEffect(() => {
    if (kind !== 'lazy') return;
    setLazyChildren(new Map());
    setFlatItems(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const needFlat = kind === 'lazy' && (mode === 'flat' || query.trim() !== '');
  useEffect(() => {
    if (!needFlat || flatItems || !rootPath || !loadFlat) return;
    const seq = ++flatSeqRef.current;
    setFlatLoading(true);
    loadFlat(rootPath)
      .then((list) => {
        if (seq === flatSeqRef.current) setFlatItems(list);
      })
      .catch(() => {
        if (seq === flatSeqRef.current) setFlatItems([]);
      })
      .finally(() => {
        if (seq === flatSeqRef.current) setFlatLoading(false);
      });
  }, [needFlat, flatItems, rootPath, loadFlat]);

  // Thư mục đang mở mà chưa có dữ liệu con (vd. vừa làm mới) => tải lại
  useEffect(() => {
    if (kind !== 'lazy' || !loadChildren) return;
    for (const dir of expanded) {
      if (!lazyChildren.has(dir) && !loading.has(dir)) void fetchChildren(dir);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, lazyChildren]);

  const staticTree = useMemo(() => (kind === 'static' ? buildStaticTree(items) : null), [kind, items]);
  const staticKeyOf = (e: FileEntry) => e.relativePath.replace(/\\/g, '/');

  async function fetchChildren(dirPath: string) {
    if (!loadChildren) return;
    setLoading((prev) => new Set(prev).add(dirPath));
    try {
      const list = await loadChildren(dirPath);
      setLazyChildren((prev) => new Map(prev).set(dirPath, list));
    } catch {
      setLazyChildren((prev) => new Map(prev).set(dirPath, []));
    } finally {
      setLoading((prev) => {
        const next = new Set(prev);
        next.delete(dirPath);
        return next;
      });
    }
  }

  const toggleExpand = (entry: FileEntry) => {
    const key = kind === 'static' ? staticKeyOf(entry) : entry.fullPath;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const q = query.trim().toLowerCase();

  const rows = useMemo<PaneRow[]>(() => {
    // Phẳng hoặc đang tìm: 1 cấp, chỉ file
    if (mode === 'flat' || q) {
      const source = kind === 'static' ? items : flatItems ?? (q ? items : []);
      const files = source.filter((f) => !f.isDirectory && (!q || f.name.toLowerCase().includes(q)));
      return sortEntries(files, sort).map((entry) => ({ entry, depth: 0, expandable: false, expanded: false, loading: false }));
    }
    const out: PaneRow[] = [];
    if (kind === 'static' && staticTree) {
      const walk = (key: string, depth: number) => {
        for (const e of sortEntries(staticTree.get(key) ?? [], sort)) {
          const k = staticKeyOf(e);
          const expandable = e.isDirectory && staticTree.has(k);
          const isOpen = expandable && expanded.has(k);
          out.push({ entry: e, depth, expandable, expanded: isOpen, loading: false });
          if (isOpen) walk(k, depth + 1);
        }
      };
      walk('', 0);
      return out;
    }
    const walk = (list: FileEntry[], depth: number) => {
      for (const e of sortEntries(list, sort)) {
        const isOpen = e.isDirectory && expanded.has(e.fullPath);
        out.push({
          entry: e,
          depth,
          expandable: e.isDirectory && Boolean(loadChildren),
          expanded: isOpen,
          loading: loading.has(e.fullPath),
        });
        if (isOpen) walk(lazyChildren.get(e.fullPath) ?? [], depth + 1);
      }
    };
    walk(items, 0);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, q, kind, items, flatItems, sort, staticTree, expanded, lazyChildren, loading]);

  const visibleItems = useMemo(() => rows.map((r) => r.entry), [rows]);

  return { rows, visibleItems, toggleExpand, flatLoading: needFlat && flatLoading };
}

const isPaneMode = (v: unknown): v is PaneMode => v === 'tree' || v === 'flat';
const isSortState = (v: unknown): v is SortState =>
  typeof v === 'object' && v !== null && ['name', 'size', 'date'].includes((v as SortState).key);

/** Chế độ xem / sắp xếp của 1 cột (nhớ theo máy) + ô tìm. */
export function usePaneUi(storageKey: string, defaultMode: PaneMode, defaultSort: SortState = { key: 'name', asc: true }) {
  const [mode, setModeState] = useState<PaneMode>(() => {
    try {
      const v = localStorage.getItem(`${storageKey}_mode`);
      return isPaneMode(v) ? v : defaultMode;
    } catch {
      return defaultMode;
    }
  });
  const [sort, setSortState] = useState<SortState>(() => {
    try {
      const raw = localStorage.getItem(`${storageKey}_sort`);
      const v: unknown = raw ? JSON.parse(raw) : null;
      return isSortState(v) ? v : defaultSort;
    } catch {
      return defaultSort;
    }
  });
  const [query, setQuery] = useState('');
  const setMode = (m: PaneMode) => {
    setModeState(m);
    try {
      localStorage.setItem(`${storageKey}_mode`, m);
    } catch {
      // ignore
    }
  };
  const setSort = (s: SortState) => {
    setSortState(s);
    try {
      localStorage.setItem(`${storageKey}_sort`, JSON.stringify(s));
    } catch {
      // ignore
    }
  };
  return { mode, setMode, sort, setSort, query, setQuery };
}
