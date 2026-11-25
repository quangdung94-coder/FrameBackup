import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileEntry } from '../types/framebackup';
import { getMediaInfo, requestMediaInfo, useMediaVersion } from '../lib/mediaStore';
import { isSidecarFile } from '../lib/sidecar';

export type PaneMode = 'tree' | 'flat';
export type SortKey = 'name' | 'size' | 'date' | 'duration';

/** v1.4 kiểu xem như Explorer / Finder (nhớ theo cột). */
export type ViewLayout = 'details' | 'list' | 'tiles' | 'icons';
export interface ViewPrefs {
  layout: ViewLayout;
  /** Cỡ hình ở kiểu Biểu tượng (px), Ctrl + cuộn chuột để đổi. */
  iconSize: number;
  /** Ẩn file phụ (XML, THM, SONYCARD.IND...) khỏi danh sách. */
  hideSidecar: boolean;
  /** Cột Thời lượng ở kiểu Chi tiết. */
  showDuration: boolean;
  /** Nhóm theo ngày quay / loại file / máy quay. */
  groupBy: GroupBy;
  /** Khung xem trước (hình lớn + thông tin clip). */
  showPreview: boolean;
}
export type GroupBy = 'none' | 'date' | 'type' | 'camera';
export const DEFAULT_VIEW: ViewPrefs = {
  layout: 'details',
  iconSize: 128,
  hideSidecar: false,
  showDuration: true,
  groupBy: 'none',
  showPreview: false,
};

/** 1 nhóm trong danh sách: các dòng [start, start + count). */
export interface PaneGroup {
  key: string;
  label: string;
  start: number;
  count: number;
}

const TYPE_LABEL: Record<string, string> = { folder: 'Folders', video: 'Video', photo: 'Photos', raw: 'RAW', other: 'Other files' };
const TYPE_ORDER = ['folder', 'video', 'photo', 'raw', 'other'];
const pad2 = (n: number) => String(n).padStart(2, '0');
const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function groupKeyOf(f: FileEntry, by: GroupBy): { key: string; label: string } {
  if (by === 'type') {
    const t = f.isDirectory ? 'folder' : f.mediaType;
    return { key: String(TYPE_ORDER.indexOf(t)), label: TYPE_LABEL[t] ?? 'Other files' };
  }
  if (by === 'camera') {
    if (f.isDirectory) return { key: '0', label: 'Folders' };
    const m = getMediaInfo(f.fullPath)?.cameraModel;
    return m ? { key: `1${m}`, label: m } : { key: '2', label: 'Unknown camera' };
  }
  // date
  if (f.isDirectory) return { key: '0', label: 'Folders' };
  const t = f.shotTimeMs || f.mtimeMs;
  if (!t) return { key: '9', label: 'Unknown date' };
  const d = new Date(t);
  const ymd = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return { key: `1${ymd}`, label: `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} (${WEEKDAY[d.getDay()]})` };
}

/** Gom dòng thành nhóm; dòng con (mở trong cây) đi theo dòng cấp 0 phía trên. */
function groupRows(rows: PaneRow[], by: GroupBy): { rows: PaneRow[]; groups: PaneGroup[] } {
  if (by === 'none' || rows.length === 0) return { rows, groups: [] };
  const buckets = new Map<string, { label: string; rows: PaneRow[] }>();
  let cur: { label: string; rows: PaneRow[] } | null = null;
  for (const r of rows) {
    if (r.depth === 0 || !cur) {
      const g = groupKeyOf(r.entry, by);
      cur = buckets.get(g.key) ?? { label: g.label, rows: [] };
      buckets.set(g.key, cur);
    }
    cur.rows.push(r);
  }
  const keys = Array.from(buckets.keys()).sort();
  const out: PaneRow[] = [];
  const groups: PaneGroup[] = [];
  for (const k of keys) {
    const b = buckets.get(k)!;
    groups.push({ key: k, label: b.label, start: out.length, count: b.rows.length });
    out.push(...b.rows);
  }
  return { rows: out, groups };
}
export const ICON_MIN = 72;
export const ICON_MAX = 256;
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
  /** v1.4: ẩn file phụ (XML, THM...) khỏi danh sách (vẫn chép theo cài đặt). */
  hideSidecar?: boolean;
  groupBy?: GroupBy;
  /** Chỉ hiện file của máy quay này (rỗng = tất cả). */
  cameraFilter?: string;
}

const naturalCmp = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' }).compare;

function sortList(list: FileEntry[], sort: SortState): FileEntry[] {
  const dir = sort.asc ? 1 : -1;
  return [...list].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    let c = 0;
    if (sort.key === 'size') c = a.sizeBytes - b.sizeBytes;
    else if (sort.key === 'date') c = (a.shotTimeMs || a.mtimeMs) - (b.shotTimeMs || b.mtimeMs);
    else if (sort.key === 'duration') c = (getMediaInfo(a.fullPath)?.durationSec ?? -1) - (getMediaInfo(b.fullPath)?.durationSec ?? -1);
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
export function useFilePane({
  kind,
  items,
  mode,
  query,
  sort,
  rootPath,
  loadChildren,
  loadFlat,
  hideSidecar,
  groupBy = 'none',
  cameraFilter = '',
}: FilePaneOptions) {
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

  // Sắp xếp theo thời lượng: cần thông tin mọi file đang có => xin 1 lần, sắp lại khi có kết quả
  const sortByDuration = sort.key === 'duration' || groupBy === 'camera' || Boolean(cameraFilter);
  const mediaVersion = useMediaVersion();
  const durationVersion = sortByDuration ? mediaVersion : 0;
  useEffect(() => {
    if (!sortByDuration) return;
    requestMediaInfo(kind === 'static' ? items : flatItems ?? items);
    for (const list of lazyChildren.values()) requestMediaInfo(list);
  }, [sortByDuration, kind, items, flatItems, lazyChildren]);

  const rows = useMemo<PaneRow[]>(() => {
    const keep = (f: FileEntry) =>
      (!hideSidecar || !isSidecarFile(f)) && (!cameraFilter || f.isDirectory || getMediaInfo(f.fullPath)?.cameraModel === cameraFilter);
    const sortEntries = (list: FileEntry[], st: SortState) => sortList(hideSidecar || cameraFilter ? list.filter(keep) : list, st);
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
  }, [mode, q, kind, items, flatItems, sort, staticTree, expanded, lazyChildren, loading, durationVersion, hideSidecar, cameraFilter]);

  const groupVersion = groupBy === 'camera' ? mediaVersion : 0;
  const grouped = useMemo(() => groupRows(rows, groupBy), [rows, groupBy, groupVersion]);
  const visibleItems = useMemo(() => grouped.rows.map((r) => r.entry), [grouped]);

  return { rows: grouped.rows, groups: grouped.groups, visibleItems, toggleExpand, flatLoading: needFlat && flatLoading };
}

const isPaneMode = (v: unknown): v is PaneMode => v === 'tree' || v === 'flat';
const isSortState = (v: unknown): v is SortState =>
  typeof v === 'object' && v !== null && ['name', 'size', 'date', 'duration'].includes((v as SortState).key);

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
  const [view, setViewState] = useState<ViewPrefs>(() => {
    try {
      const raw = localStorage.getItem(`${storageKey}_view`);
      const v = raw ? (JSON.parse(raw) as Partial<ViewPrefs>) : {};
      const layout = ['details', 'list', 'tiles', 'icons'].includes(String(v.layout)) ? (v.layout as ViewLayout) : DEFAULT_VIEW.layout;
      const iconSize = typeof v.iconSize === 'number' ? Math.max(ICON_MIN, Math.min(ICON_MAX, v.iconSize)) : DEFAULT_VIEW.iconSize;
      return {
        layout,
        iconSize,
        hideSidecar: typeof v.hideSidecar === 'boolean' ? v.hideSidecar : DEFAULT_VIEW.hideSidecar,
        showDuration: typeof v.showDuration === 'boolean' ? v.showDuration : DEFAULT_VIEW.showDuration,
        groupBy: ['none', 'date', 'type', 'camera'].includes(String(v.groupBy)) ? (v.groupBy as GroupBy) : DEFAULT_VIEW.groupBy,
        showPreview: typeof v.showPreview === 'boolean' ? v.showPreview : DEFAULT_VIEW.showPreview,
      };
    } catch {
      return DEFAULT_VIEW;
    }
  });
  const setView = (patch: Partial<ViewPrefs>) => {
    setViewState((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(`${storageKey}_view`, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };
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
  // Lọc theo máy quay: chỉ trong phiên làm việc (không nhớ), đổi thư mục vẫn giữ
  const [cameraFilter, setCameraFilter] = useState('');
  return { mode, setMode, sort, setSort, query, setQuery, view, setView, cameraFilter, setCameraFilter };
}
